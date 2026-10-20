/*
  # Custom community roles + per-channel permission overrides

  ## Summary
  Discord-style custom roles per community, plus channel-level allow/deny
  overrides per role. The legacy `community_members.role` text enum
  (`'owner' | 'admin' | 'moderator' | 'member'`) stays as a fallback so
  every existing page keeps working; the new system layers on top.

  ## Tables
  - `community_roles`            — one row per role, per community
  - `community_member_roles`     — m2m from members to roles
  - `channel_role_overrides`     — per-channel allow/deny bitmasks

  ## Functions (RPC, SECURITY DEFINER)
  - `community_role_create(...)`
  - `community_role_update(...)`
  - `community_role_delete(...)`
  - `community_role_assign(...)`
  - `community_role_unassign(...)`
  - `channel_role_override_set(...)`
  - `channel_role_override_clear(...)`
  - `community_member_permissions(p_community_id, p_user_id, p_channel_id)`
      — resolved permission bitmask for a member, optionally scoped to
        a channel. Useful from RLS or the client.

  ## Permission bits (used everywhere)
        1  VIEW_CHANNEL
        2  READ_MESSAGES
        4  SEND_MESSAGES
        8  MANAGE_MESSAGES        (delete/pin others' messages)
       16  ATTACH_FILES
       32  ADD_REACTIONS
       64  MENTION_EVERYONE
      128  MANAGE_CHANNELS
      256  CONNECT_VOICE
      512  SPEAK_VOICE
     1024  VIDEO
     2048  MUTE_MEMBERS
     4096  DEAFEN_MEMBERS
     8192  MANAGE_ROLES
    16384  MANAGE_NICKNAMES
    32768  KICK_MEMBERS
    65536  BAN_MEMBERS
   131072  MANAGE_COMMUNITY
   262144  ADMINISTRATOR          (bypass all checks)
   524288  VIEW_AUDIT_LOG

  Default permissions (the implicit @everyone for a new community):
    VIEW_CHANNEL | READ_MESSAGES | SEND_MESSAGES | ATTACH_FILES |
    ADD_REACTIONS | CONNECT_VOICE | SPEAK_VOICE | VIDEO
    = 1 + 2 + 4 + 16 + 32 + 256 + 512 + 1024 = 1847
*/

-- ============================================================
-- Tables
-- ============================================================
CREATE TABLE IF NOT EXISTS public.community_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text DEFAULT '#5865F2',
  position integer NOT NULL DEFAULT 0,
  permissions bigint NOT NULL DEFAULT 1847,
  is_managed boolean NOT NULL DEFAULT false,
  hoist boolean NOT NULL DEFAULT false,
  mentionable boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (community_id, name)
);

CREATE INDEX IF NOT EXISTS idx_community_roles_community
  ON public.community_roles(community_id, position DESC);

CREATE TABLE IF NOT EXISTS public.community_member_roles (
  community_id uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES public.community_roles(id) ON DELETE CASCADE,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  assigned_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  PRIMARY KEY (community_id, user_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_community_member_roles_user
  ON public.community_member_roles(user_id, community_id);

CREATE TABLE IF NOT EXISTS public.channel_role_overrides (
  channel_id uuid NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  -- role_id NULL = the implicit @everyone override for this channel
  role_id uuid REFERENCES public.community_roles(id) ON DELETE CASCADE,
  allow bigint NOT NULL DEFAULT 0,
  deny bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_role_overrides_channel
  ON public.channel_role_overrides(channel_id);

-- updated_at triggers
DROP TRIGGER IF EXISTS community_roles_updated_at ON public.community_roles;
CREATE TRIGGER community_roles_updated_at
  BEFORE UPDATE ON public.community_roles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS channel_role_overrides_updated_at ON public.channel_role_overrides;
CREATE TRIGGER channel_role_overrides_updated_at
  BEFORE UPDATE ON public.channel_role_overrides
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- Permission resolver
-- ============================================================
CREATE OR REPLACE FUNCTION public.community_member_permissions(
  p_community_id uuid,
  p_user_id uuid,
  p_channel_id uuid DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_legacy_role text;
  v_perms bigint := 0;
  v_everyone_perms bigint := 1847;
  v_role_perms bigint := 0;
  v_override_allow bigint := 0;
  v_override_deny bigint := 0;
  v_admin_bit bigint := 262144;
BEGIN
  -- Legacy enum still wins for owner/admin (so we don't break existing flows).
  SELECT cm.role INTO v_legacy_role
    FROM public.community_members cm
   WHERE cm.community_id = p_community_id AND cm.user_id = p_user_id
   LIMIT 1;

  IF v_legacy_role IS NULL THEN
    -- Not a member: no permissions at all.
    RETURN 0;
  END IF;

  IF v_legacy_role IN ('owner', 'admin') THEN
    RETURN ((1::bigint << 21) - 1); -- all bits up to VIEW_AUDIT_LOG inclusive
  END IF;

  -- Aggregate permissions from the @everyone default + any custom roles
  -- this user is assigned.
  SELECT COALESCE(SUM(DISTINCT cr.permissions), 0)
    INTO v_role_perms
    FROM public.community_member_roles cmr
    JOIN public.community_roles cr ON cr.id = cmr.role_id
   WHERE cmr.community_id = p_community_id
     AND cmr.user_id = p_user_id;

  -- Bitwise OR is what we actually want, not SUM. SUM is a lazy
  -- approximation that double-counts shared bits. Re-fold with bit_or.
  SELECT COALESCE(bit_or(cr.permissions), 0)
    INTO v_role_perms
    FROM public.community_member_roles cmr
    JOIN public.community_roles cr ON cr.id = cmr.role_id
   WHERE cmr.community_id = p_community_id
     AND cmr.user_id = p_user_id;

  v_perms := v_everyone_perms | v_role_perms;

  -- Moderator gets MANAGE_MESSAGES (8) baked in for back-compat.
  IF v_legacy_role = 'moderator' THEN
    v_perms := v_perms | 8;
  END IF;

  -- Administrator bit short-circuits the rest.
  IF (v_perms & v_admin_bit) <> 0 THEN
    RETURN ((1::bigint << 21) - 1);
  END IF;

  -- Apply per-channel overrides (deny then allow).
  IF p_channel_id IS NOT NULL THEN
    -- @everyone override (role_id IS NULL)
    SELECT COALESCE(bit_or(cro.allow), 0), COALESCE(bit_or(cro.deny), 0)
      INTO v_override_allow, v_override_deny
      FROM public.channel_role_overrides cro
     WHERE cro.channel_id = p_channel_id AND cro.role_id IS NULL;

    v_perms := (v_perms & ~v_override_deny) | v_override_allow;

    -- Per-role overrides for roles this user has
    SELECT COALESCE(bit_or(cro.allow), 0), COALESCE(bit_or(cro.deny), 0)
      INTO v_override_allow, v_override_deny
      FROM public.channel_role_overrides cro
      JOIN public.community_member_roles cmr ON cmr.role_id = cro.role_id
     WHERE cro.channel_id = p_channel_id
       AND cmr.community_id = p_community_id
       AND cmr.user_id = p_user_id;

    v_perms := (v_perms & ~v_override_deny) | v_override_allow;
  END IF;

  RETURN v_perms;
END;
$$;

GRANT EXECUTE ON FUNCTION public.community_member_permissions(uuid, uuid, uuid) TO authenticated;

-- Convenience: bool wrapper for use inside RLS policies.
CREATE OR REPLACE FUNCTION public.community_member_has_permission(
  p_community_id uuid,
  p_user_id uuid,
  p_permission_bit bigint,
  p_channel_id uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (public.community_member_permissions(p_community_id, p_user_id, p_channel_id)
          & p_permission_bit) <> 0;
$$;

GRANT EXECUTE ON FUNCTION public.community_member_has_permission(uuid, uuid, bigint, uuid) TO authenticated;

-- ============================================================
-- Internal: assert caller can manage roles in this community
-- ============================================================
CREATE OR REPLACE FUNCTION public._assert_can_manage_roles(p_community_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.community_member_has_permission(p_community_id, auth.uid(), 8192) THEN
    RAISE EXCEPTION 'Caller lacks MANAGE_ROLES permission in this community'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

-- ============================================================
-- RPCs
-- ============================================================
CREATE OR REPLACE FUNCTION public.community_role_create(
  p_community_id uuid,
  p_name text,
  p_color text DEFAULT '#5865F2',
  p_position integer DEFAULT 0,
  p_permissions bigint DEFAULT 1847,
  p_hoist boolean DEFAULT false,
  p_mentionable boolean DEFAULT false
) RETURNS public.community_roles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role public.community_roles;
BEGIN
  PERFORM public._assert_can_manage_roles(p_community_id);

  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'Role name required';
  END IF;
  IF lower(trim(p_name)) IN ('@everyone', 'everyone', '@here', 'here') THEN
    RAISE EXCEPTION 'Reserved role name';
  END IF;

  INSERT INTO public.community_roles (
    community_id, name, color, position, permissions, hoist, mentionable
  ) VALUES (
    p_community_id, trim(p_name), p_color, p_position, p_permissions, p_hoist, p_mentionable
  )
  RETURNING * INTO v_role;

  RETURN v_role;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_role_update(
  p_role_id uuid,
  p_name text DEFAULT NULL,
  p_color text DEFAULT NULL,
  p_position integer DEFAULT NULL,
  p_permissions bigint DEFAULT NULL,
  p_hoist boolean DEFAULT NULL,
  p_mentionable boolean DEFAULT NULL
) RETURNS public.community_roles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role public.community_roles;
  v_community_id uuid;
BEGIN
  SELECT community_id INTO v_community_id FROM public.community_roles WHERE id = p_role_id;
  IF v_community_id IS NULL THEN
    RAISE EXCEPTION 'Role not found';
  END IF;

  PERFORM public._assert_can_manage_roles(v_community_id);

  UPDATE public.community_roles SET
    name         = COALESCE(p_name, name),
    color        = COALESCE(p_color, color),
    position     = COALESCE(p_position, position),
    permissions  = COALESCE(p_permissions, permissions),
    hoist        = COALESCE(p_hoist, hoist),
    mentionable  = COALESCE(p_mentionable, mentionable),
    updated_at   = now()
  WHERE id = p_role_id
  RETURNING * INTO v_role;

  RETURN v_role;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_role_delete(p_role_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_community_id uuid;
  v_is_managed boolean;
BEGIN
  SELECT community_id, is_managed INTO v_community_id, v_is_managed
    FROM public.community_roles WHERE id = p_role_id;
  IF v_community_id IS NULL THEN
    RETURN;
  END IF;
  IF v_is_managed THEN
    RAISE EXCEPTION 'Cannot delete a managed role';
  END IF;

  PERFORM public._assert_can_manage_roles(v_community_id);
  DELETE FROM public.community_roles WHERE id = p_role_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_role_assign(
  p_community_id uuid,
  p_user_id uuid,
  p_role_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role_community uuid;
BEGIN
  PERFORM public._assert_can_manage_roles(p_community_id);

  SELECT community_id INTO v_role_community FROM public.community_roles WHERE id = p_role_id;
  IF v_role_community IS NULL OR v_role_community <> p_community_id THEN
    RAISE EXCEPTION 'Role does not belong to this community';
  END IF;

  -- Target must be a member.
  IF NOT EXISTS (
    SELECT 1 FROM public.community_members
     WHERE community_id = p_community_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'Target user is not a member of this community';
  END IF;

  INSERT INTO public.community_member_roles (community_id, user_id, role_id, assigned_by)
  VALUES (p_community_id, p_user_id, p_role_id, auth.uid())
  ON CONFLICT DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_role_unassign(
  p_community_id uuid,
  p_user_id uuid,
  p_role_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._assert_can_manage_roles(p_community_id);

  DELETE FROM public.community_member_roles
   WHERE community_id = p_community_id
     AND user_id = p_user_id
     AND role_id = p_role_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.channel_role_override_set(
  p_channel_id uuid,
  p_role_id uuid,
  p_allow bigint,
  p_deny bigint
) RETURNS public.channel_role_overrides
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_community_id uuid;
  v_row public.channel_role_overrides;
BEGIN
  SELECT s.community_id INTO v_community_id
    FROM public.channels ch
    JOIN public.servers s ON s.id = ch.server_id
   WHERE ch.id = p_channel_id;

  IF v_community_id IS NULL THEN
    RAISE EXCEPTION 'Channel not found';
  END IF;

  PERFORM public._assert_can_manage_roles(v_community_id);

  INSERT INTO public.channel_role_overrides (channel_id, role_id, allow, deny)
  VALUES (p_channel_id, p_role_id, COALESCE(p_allow, 0), COALESCE(p_deny, 0))
  ON CONFLICT (channel_id, role_id) DO UPDATE
    SET allow = EXCLUDED.allow,
        deny = EXCLUDED.deny,
        updated_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.channel_role_override_clear(
  p_channel_id uuid,
  p_role_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_community_id uuid;
BEGIN
  SELECT s.community_id INTO v_community_id
    FROM public.channels ch
    JOIN public.servers s ON s.id = ch.server_id
   WHERE ch.id = p_channel_id;

  IF v_community_id IS NULL THEN RETURN; END IF;
  PERFORM public._assert_can_manage_roles(v_community_id);

  DELETE FROM public.channel_role_overrides
   WHERE channel_id = p_channel_id AND role_id IS NOT DISTINCT FROM p_role_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.community_role_create(uuid, text, text, integer, bigint, boolean, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.community_role_update(uuid, text, text, integer, bigint, boolean, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.community_role_delete(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.community_role_assign(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.community_role_unassign(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.channel_role_override_set(uuid, uuid, bigint, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.channel_role_override_clear(uuid, uuid) TO authenticated;

-- ============================================================
-- RLS — read access for members; writes go through RPCs (which are
-- SECURITY DEFINER and do their own permission checks).
-- ============================================================
ALTER TABLE public.community_roles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_member_roles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_role_overrides     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read community roles" ON public.community_roles;
CREATE POLICY "Members read community roles"
  ON public.community_roles FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.community_members cm
     WHERE cm.community_id = community_roles.community_id AND cm.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Members read role assignments" ON public.community_member_roles;
CREATE POLICY "Members read role assignments"
  ON public.community_member_roles FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.community_members cm
     WHERE cm.community_id = community_member_roles.community_id AND cm.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Members read channel overrides" ON public.channel_role_overrides;
CREATE POLICY "Members read channel overrides"
  ON public.channel_role_overrides FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
      FROM public.channels ch
      JOIN public.servers s ON s.id = ch.server_id
      JOIN public.community_members cm ON cm.community_id = s.community_id
     WHERE ch.id = channel_role_overrides.channel_id AND cm.user_id = auth.uid()
  ));

-- ============================================================
-- Realtime: surface role changes so badges live-update
-- ============================================================
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.community_roles;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.community_member_roles;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.channel_role_overrides;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
