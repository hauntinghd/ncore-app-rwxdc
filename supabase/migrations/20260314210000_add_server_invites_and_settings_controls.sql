/*
  # Server invites + invite-only join enforcement + member moderation policy refresh

  Adds:
  - invite_only flag on community_server_customizations
  - community_invites table + RLS
  - join_community_with_invite RPC
  - refreshed community_members policies for invite-only join and admin moderation
*/

ALTER TABLE public.community_server_customizations
  ADD COLUMN IF NOT EXISTS invite_only boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.community_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  max_uses integer CHECK (max_uses IS NULL OR max_uses > 0),
  use_count integer NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  expires_at timestamptz,
  revoked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS community_invites_community_idx
  ON public.community_invites (community_id);

CREATE INDEX IF NOT EXISTS community_invites_code_idx
  ON public.community_invites (code);

DROP TRIGGER IF EXISTS community_invites_set_updated_at ON public.community_invites;
CREATE TRIGGER community_invites_set_updated_at
BEFORE UPDATE ON public.community_invites
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.community_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "community_invites_select_admins" ON public.community_invites;
CREATE POLICY "community_invites_select_admins"
  ON public.community_invites FOR SELECT TO authenticated
  USING (
    public.is_community_admin(community_id, auth.uid())
    OR public.is_platform_admin(auth.uid())
  );

DROP POLICY IF EXISTS "community_invites_insert_admins" ON public.community_invites;
CREATE POLICY "community_invites_insert_admins"
  ON public.community_invites FOR INSERT TO authenticated
  WITH CHECK (
    public.is_community_admin(community_id, auth.uid())
    OR public.is_platform_admin(auth.uid())
  );

DROP POLICY IF EXISTS "community_invites_update_admins" ON public.community_invites;
CREATE POLICY "community_invites_update_admins"
  ON public.community_invites FOR UPDATE TO authenticated
  USING (
    public.is_community_admin(community_id, auth.uid())
    OR public.is_platform_admin(auth.uid())
  )
  WITH CHECK (
    public.is_community_admin(community_id, auth.uid())
    OR public.is_platform_admin(auth.uid())
  );

DROP POLICY IF EXISTS "community_invites_delete_admins" ON public.community_invites;
CREATE POLICY "community_invites_delete_admins"
  ON public.community_invites FOR DELETE TO authenticated
  USING (
    public.is_community_admin(community_id, auth.uid())
    OR public.is_platform_admin(auth.uid())
  );

CREATE OR REPLACE FUNCTION public.join_community_with_invite(
  p_code text,
  p_community_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
  normalized_code text := upper(trim(coalesce(p_code, '')));
  invite_row public.community_invites%ROWTYPE;
  already_member boolean := false;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF normalized_code = '' THEN
    RAISE EXCEPTION 'Invite code is required';
  END IF;

  SELECT *
  INTO invite_row
  FROM public.community_invites ci
  WHERE upper(ci.code) = normalized_code
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid invite code';
  END IF;

  IF invite_row.revoked THEN
    RAISE EXCEPTION 'Invite has been revoked';
  END IF;

  IF invite_row.expires_at IS NOT NULL AND invite_row.expires_at <= now() THEN
    RAISE EXCEPTION 'Invite has expired';
  END IF;

  IF invite_row.max_uses IS NOT NULL AND invite_row.use_count >= invite_row.max_uses THEN
    RAISE EXCEPTION 'Invite has reached maximum uses';
  END IF;

  IF p_community_id IS NOT NULL AND invite_row.community_id <> p_community_id THEN
    RAISE EXCEPTION 'Invite code is not valid for this server';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.community_members cm
    WHERE cm.community_id = invite_row.community_id
      AND cm.user_id = actor_id
  ) INTO already_member;

  IF already_member THEN
    RETURN jsonb_build_object(
      'community_id', invite_row.community_id,
      'joined', false,
      'already_member', true
    );
  END IF;

  INSERT INTO public.community_members (community_id, user_id, role)
  VALUES (invite_row.community_id, actor_id, 'member')
  ON CONFLICT (community_id, user_id) DO NOTHING;

  UPDATE public.community_invites
  SET use_count = use_count + 1,
      updated_at = now()
  WHERE id = invite_row.id;

  RETURN jsonb_build_object(
    'community_id', invite_row.community_id,
    'joined', true,
    'already_member', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.join_community_with_invite(text, uuid) TO authenticated;

DROP POLICY IF EXISTS "community_members_insert_self" ON public.community_members;
CREATE POLICY "community_members_insert_self"
  ON public.community_members FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (
      public.is_community_admin(community_id, auth.uid())
      OR NOT EXISTS (
        SELECT 1
        FROM public.community_server_customizations csc
        WHERE csc.community_id = community_members.community_id
          AND csc.invite_only = true
      )
    )
  );

DROP POLICY IF EXISTS "community_members_update_self_or_owner" ON public.community_members;
CREATE POLICY "community_members_update_self_or_owner"
  ON public.community_members FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_community_admin(community_id, auth.uid())
    OR public.is_platform_admin(auth.uid())
  )
  WITH CHECK (
    user_id = auth.uid()
    OR public.is_community_admin(community_id, auth.uid())
    OR public.is_platform_admin(auth.uid())
  );

DROP POLICY IF EXISTS "community_members_delete_self_or_owner" ON public.community_members;
CREATE POLICY "community_members_delete_self_or_owner"
  ON public.community_members FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_community_admin(community_id, auth.uid())
    OR public.is_platform_admin(auth.uid())
  );
