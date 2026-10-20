/*
  # Community moderation: bans, kicks, and timeouts

  `community_audit_log` has existed since `20260409100000_security_hardening_v2.sql`
  but nothing ever wrote to it, and there was no way to remove or silence a
  member at all — only to delete their messages one at a time. This migration
  adds the three actions every community eventually needs, and makes each of
  them write an audit entry.

  ## Everything goes through SECURITY DEFINER RPCs
  Moderation cannot be expressed as an RLS policy on `community_members`,
  because the check is not "who are you" but "are you above them". The RPCs
  below own that logic; the tables stay closed to direct writes.

  ## Role hierarchy
  You cannot ban, kick, or time out someone whose highest role sits at or above
  your own. Without this, any member holding BAN_MEMBERS could ban the owner.
  The community owner outranks everyone and cannot be actioned at all.

  ## Enforcement is at the database boundary
  A ban that only hides a "Join" button is not a ban. Re-joining is blocked by a
  trigger on `community_members`, and a timed-out member is blocked from
  inserting messages by an extension of the existing permission trigger.
*/

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.community_bans (
  community_id uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  banned_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reason text NOT NULL DEFAULT '',
  -- NULL means permanent. A temporary ban expires on its own rather than
  -- relying on someone remembering to lift it.
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (community_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_community_bans_expiry
  ON public.community_bans (community_id, expires_at);

ALTER TABLE public.community_bans ENABLE ROW LEVEL SECURITY;

/*
  Two read paths, on purpose:
   - moderators (BAN_MEMBERS) see the whole ban list, which is the moderation UI
   - a banned user can see their own ban, so the client can say "you were banned
     from this community" instead of a bare permission error
*/
DROP POLICY IF EXISTS "Moderators can view bans" ON public.community_bans;
CREATE POLICY "Moderators can view bans"
  ON public.community_bans FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.community_member_has_permission(community_id, auth.uid(), 65536, NULL)
  );

-- No write policies. All mutation goes through the RPCs below.

/*
  Timeouts live on the membership row rather than in their own table: a timeout
  ends when the member leaves, and expressing that as a foreign key is simpler
  than reconciling two tables.
*/
ALTER TABLE public.community_members
  ADD COLUMN IF NOT EXISTS timed_out_until timestamptz,
  ADD COLUMN IF NOT EXISTS timed_out_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS timeout_reason text;

CREATE INDEX IF NOT EXISTS idx_community_members_timeout
  ON public.community_members (community_id, timed_out_until)
  WHERE timed_out_until IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Hierarchy helpers
-- ---------------------------------------------------------------------------

/*
  The position of a member's highest role.

  Returns 2147483647 for the community owner so they outrank every possible
  role, and -1 for someone with no roles (or no membership) so they are
  outranked by anyone holding even the lowest role.
*/
CREATE OR REPLACE FUNCTION public.community_member_top_role_position(
  p_community_id uuid,
  p_user_id uuid
)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_owner boolean;
  v_position integer;
BEGIN
  IF p_community_id IS NULL OR p_user_id IS NULL THEN
    RETURN -1;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.communities c
     WHERE c.id = p_community_id AND c.owner_id = p_user_id
  ) INTO v_is_owner;

  IF v_is_owner THEN
    RETURN 2147483647;
  END IF;

  SELECT COALESCE(MAX(r.position), -1) INTO v_position
    FROM public.community_member_roles mr
    JOIN public.community_roles r ON r.id = mr.role_id
   WHERE mr.community_id = p_community_id
     AND mr.user_id = p_user_id;

  RETURN COALESCE(v_position, -1);
END;
$$;

/*
  Raises unless `p_actor` may take a moderation action against `p_target`.

  `p_permission` is the bit the action requires. The hierarchy check is separate
  from and additional to the permission check: holding BAN_MEMBERS says you may
  ban *someone*, not that you may ban *anyone*.
*/
CREATE OR REPLACE FUNCTION public.assert_can_moderate(
  p_community_id uuid,
  p_actor uuid,
  p_target uuid,
  p_permission bigint,
  p_action text
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;

  IF p_target = p_actor THEN
    RAISE EXCEPTION 'You cannot % yourself', p_action USING ERRCODE = '42501';
  END IF;

  IF NOT public.community_member_has_permission(p_community_id, p_actor, p_permission, NULL) THEN
    RAISE EXCEPTION 'You do not have permission to % members here', p_action
      USING ERRCODE = '42501';
  END IF;

  SELECT owner_id INTO v_owner FROM public.communities WHERE id = p_community_id;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Community not found' USING ERRCODE = '23503';
  END IF;
  IF v_owner = p_target THEN
    RAISE EXCEPTION 'The community owner cannot be %ed', p_action USING ERRCODE = '42501';
  END IF;

  -- The owner is exempt from the hierarchy check; everyone else must be
  -- strictly above their target.
  IF p_actor <> v_owner
     AND public.community_member_top_role_position(p_community_id, p_actor)
         <= public.community_member_top_role_position(p_community_id, p_target) THEN
    RAISE EXCEPTION 'You cannot % someone with a role equal to or above your own', p_action
      USING ERRCODE = '42501';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Audit logging
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.write_community_audit(
  p_community_id uuid,
  p_action text,
  p_target_type text,
  p_target_id text,
  p_details jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.community_audit_log (community_id, actor_id, action, target_type, target_id, details)
  VALUES (p_community_id, auth.uid(), p_action, p_target_type, p_target_id, COALESCE(p_details, '{}'::jsonb));
EXCEPTION WHEN OTHERS THEN
  -- An audit write must never be the reason a moderation action fails. Losing
  -- the log entry is bad; leaving an abusive member in place because logging
  -- broke is worse.
  RAISE WARNING 'community audit write failed: %', SQLERRM;
END;
$$;

/*
  The original audit-log read policy only recognised the legacy `role` column
  ('owner'/'admin'), which predates custom roles. Anyone granted VIEW_AUDIT_LOG
  through a role could hold the permission and still see nothing.
*/
DROP POLICY IF EXISTS "Audit log visible with VIEW_AUDIT_LOG" ON public.community_audit_log;
CREATE POLICY "Audit log visible with VIEW_AUDIT_LOG"
  ON public.community_audit_log FOR SELECT
  TO authenticated
  USING (public.community_member_has_permission(community_id, auth.uid(), 524288, NULL));

-- ---------------------------------------------------------------------------
-- Ban
-- ---------------------------------------------------------------------------

/*
  Bans a member and removes their membership.

  `p_delete_message_hours` mirrors Discord's "delete recent messages" option:
  a raider's damage is mostly in the last few minutes, and cleaning it up by
  hand after the ban is tedious. Capped at 7 days.
*/
CREATE OR REPLACE FUNCTION public.community_ban_member(
  p_community_id uuid,
  p_user_id uuid,
  p_reason text DEFAULT '',
  p_delete_message_hours integer DEFAULT 0,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hours integer := LEAST(GREATEST(COALESCE(p_delete_message_hours, 0), 0), 168);
  v_deleted integer := 0;
BEGIN
  PERFORM public.assert_can_moderate(p_community_id, auth.uid(), p_user_id, 65536, 'ban');

  IF p_expires_at IS NOT NULL AND p_expires_at <= now() THEN
    RAISE EXCEPTION 'A ban expiry must be in the future' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.community_bans (community_id, user_id, banned_by, reason, expires_at)
  VALUES (p_community_id, p_user_id, auth.uid(), COALESCE(trim(p_reason), ''), p_expires_at)
  ON CONFLICT (community_id, user_id) DO UPDATE
    SET banned_by  = EXCLUDED.banned_by,
        reason     = EXCLUDED.reason,
        expires_at = EXCLUDED.expires_at,
        created_at = now();

  DELETE FROM public.community_members
   WHERE community_id = p_community_id AND user_id = p_user_id;

  IF v_hours > 0 THEN
    WITH removed AS (
      DELETE FROM public.messages m
       USING public.channels ch, public.servers s
       WHERE m.channel_id = ch.id
         AND ch.server_id = s.id
         AND s.community_id = p_community_id
         AND m.author_id = p_user_id
         AND m.created_at >= now() - make_interval(hours => v_hours)
      RETURNING 1
    )
    SELECT count(*) INTO v_deleted FROM removed;
  END IF;

  PERFORM public.write_community_audit(
    p_community_id, 'member_ban', 'member', p_user_id::text,
    jsonb_build_object(
      'reason', COALESCE(trim(p_reason), ''),
      'expires_at', p_expires_at,
      'messages_deleted', v_deleted,
      'delete_message_hours', v_hours
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.community_unban_member(
  p_community_id uuid,
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Not `assert_can_moderate`: the target is no longer a member, so there is no
  -- hierarchy to compare against. The permission bit is the whole check.
  IF NOT public.community_member_has_permission(p_community_id, auth.uid(), 65536, NULL) THEN
    RAISE EXCEPTION 'You do not have permission to manage bans here' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.community_bans
   WHERE community_id = p_community_id AND user_id = p_user_id;

  PERFORM public.write_community_audit(
    p_community_id, 'member_unban', 'member', p_user_id::text, '{}'::jsonb
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Kick
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.community_kick_member(
  p_community_id uuid,
  p_user_id uuid,
  p_reason text DEFAULT ''
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.assert_can_moderate(p_community_id, auth.uid(), p_user_id, 32768, 'kick');

  DELETE FROM public.community_members
   WHERE community_id = p_community_id AND user_id = p_user_id;

  PERFORM public.write_community_audit(
    p_community_id, 'member_kick', 'member', p_user_id::text,
    jsonb_build_object('reason', COALESCE(trim(p_reason), ''))
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Timeout
-- ---------------------------------------------------------------------------

/*
  Silences a member for a fixed number of minutes without removing them.

  This is the action that is actually wanted most of the time — a heated
  argument needs a cooling-off period, not an eviction. Capped at 28 days,
  matching the longest timeout Discord allows.
*/
CREATE OR REPLACE FUNCTION public.community_timeout_member(
  p_community_id uuid,
  p_user_id uuid,
  p_minutes integer,
  p_reason text DEFAULT ''
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_minutes integer := LEAST(GREATEST(COALESCE(p_minutes, 0), 1), 40320);
  v_until timestamptz;
BEGIN
  PERFORM public.assert_can_moderate(p_community_id, auth.uid(), p_user_id, 2048, 'time out');

  v_until := now() + make_interval(mins => v_minutes);

  UPDATE public.community_members
     SET timed_out_until = v_until,
         timed_out_by    = auth.uid(),
         timeout_reason  = COALESCE(trim(p_reason), '')
   WHERE community_id = p_community_id AND user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That person is not a member of this community' USING ERRCODE = '23503';
  END IF;

  PERFORM public.write_community_audit(
    p_community_id, 'member_timeout', 'member', p_user_id::text,
    jsonb_build_object('minutes', v_minutes, 'until', v_until, 'reason', COALESCE(trim(p_reason), ''))
  );

  RETURN v_until;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_clear_timeout(
  p_community_id uuid,
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.community_member_has_permission(p_community_id, auth.uid(), 2048, NULL) THEN
    RAISE EXCEPTION 'You do not have permission to manage timeouts here' USING ERRCODE = '42501';
  END IF;

  UPDATE public.community_members
     SET timed_out_until = NULL, timed_out_by = NULL, timeout_reason = NULL
   WHERE community_id = p_community_id AND user_id = p_user_id;

  PERFORM public.write_community_audit(
    p_community_id, 'member_timeout_clear', 'member', p_user_id::text, '{}'::jsonb
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Enforcement
-- ---------------------------------------------------------------------------

/*
  Blocks a banned user from re-joining.

  A trigger rather than an RLS policy because membership is created down several
  paths — invite acceptance, discovery, community creation — some of them
  SECURITY DEFINER and therefore invisible to RLS. The trigger sits under all
  of them.
*/
CREATE OR REPLACE FUNCTION public.enforce_community_ban()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expires_at timestamptz;
  v_banned boolean;
BEGIN
  SELECT b.expires_at, true INTO v_expires_at, v_banned
    FROM public.community_bans b
   WHERE b.community_id = NEW.community_id
     AND b.user_id = NEW.user_id;

  IF NOT COALESCE(v_banned, false) THEN
    RETURN NEW;
  END IF;

  -- An expired ban is cleaned up on contact rather than by a scheduled job.
  IF v_expires_at IS NOT NULL AND v_expires_at <= now() THEN
    DELETE FROM public.community_bans
     WHERE community_id = NEW.community_id AND user_id = NEW.user_id;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'You are banned from this community' USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS community_members_enforce_ban ON public.community_members;
CREATE TRIGGER community_members_enforce_ban
  BEFORE INSERT ON public.community_members
  FOR EACH ROW EXECUTE FUNCTION public.enforce_community_ban();

/*
  Extends the existing send-message trigger with a timeout check.

  Replaces `enforce_channel_message_permission` from
  `20260711090000_enforce_channel_permissions.sql` — the trigger binding there
  still points at this function name, so redefining it is the whole change.
*/
CREATE OR REPLACE FUNCTION public.enforce_channel_message_permission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_community_id uuid;
  v_timed_out_until timestamptz;
BEGIN
  IF NEW.author_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Messages must be authored by the authenticated user'
      USING ERRCODE = '42501';
  END IF;

  SELECT s.community_id INTO v_community_id
    FROM public.channels ch
    JOIN public.servers s ON s.id = ch.server_id
   WHERE ch.id = NEW.channel_id;

  IF v_community_id IS NULL THEN
    RAISE EXCEPTION 'Channel not found' USING ERRCODE = '23503';
  END IF;

  IF NOT public.community_member_has_permission(v_community_id, auth.uid(), 4, NEW.channel_id) THEN
    RAISE EXCEPTION 'You do not have permission to send messages in this channel'
      USING ERRCODE = '42501';
  END IF;

  SELECT cm.timed_out_until INTO v_timed_out_until
    FROM public.community_members cm
   WHERE cm.community_id = v_community_id AND cm.user_id = auth.uid();

  IF v_timed_out_until IS NOT NULL AND v_timed_out_until > now() THEN
    RAISE EXCEPTION 'You are timed out in this community until %',
      to_char(v_timed_out_until AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI UTC')
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Reads for the moderation UI
-- ---------------------------------------------------------------------------

/*
  The ban list with usernames attached. A plain select on `community_bans`
  cannot join `profiles` for a user who is no longer a member, so this does the
  join server-side.
*/
CREATE OR REPLACE FUNCTION public.community_ban_list(p_community_id uuid)
RETURNS TABLE (
  user_id uuid,
  username text,
  display_name text,
  avatar_url text,
  banned_by uuid,
  banned_by_username text,
  reason text,
  expires_at timestamptz,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.community_member_has_permission(p_community_id, auth.uid(), 65536, NULL) THEN
    RAISE EXCEPTION 'You do not have permission to view bans here' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT b.user_id,
         p.username,
         p.display_name,
         p.avatar_url,
         b.banned_by,
         actor.username,
         b.reason,
         b.expires_at,
         b.created_at
    FROM public.community_bans b
    LEFT JOIN public.profiles p ON p.id = b.user_id
    LEFT JOIN public.profiles actor ON actor.id = b.banned_by
   WHERE b.community_id = p_community_id
     AND (b.expires_at IS NULL OR b.expires_at > now())
   ORDER BY b.created_at DESC
   LIMIT 500;
END;
$$;

/*
  Recent audit entries with the actor's username resolved.

  Gated on VIEW_AUDIT_LOG rather than relying on the table policy, so the error
  message is a clear "you cannot see this" instead of an empty list.
*/
CREATE OR REPLACE FUNCTION public.community_audit_feed(
  p_community_id uuid,
  p_limit integer DEFAULT 50,
  p_before timestamptz DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  actor_id uuid,
  actor_username text,
  actor_avatar_url text,
  action text,
  target_type text,
  target_id text,
  target_username text,
  details jsonb,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.community_member_has_permission(p_community_id, auth.uid(), 524288, NULL) THEN
    RAISE EXCEPTION 'You do not have permission to view the audit log here'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT a.id,
         a.actor_id,
         actor.username,
         actor.avatar_url,
         a.action,
         a.target_type,
         a.target_id,
         target.username,
         a.details,
         a.created_at
    FROM public.community_audit_log a
    LEFT JOIN public.profiles actor ON actor.id = a.actor_id
    -- `target_id` is text because it addresses channels, roles, and invites as
    -- well as members; only cast when it is actually a uuid.
    LEFT JOIN public.profiles target
           ON a.target_type = 'member'
          AND a.target_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          AND target.id = a.target_id::uuid
   WHERE a.community_id = p_community_id
     AND (p_before IS NULL OR a.created_at < p_before)
   ORDER BY a.created_at DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
END;
$$;

/*
  Currently timed-out members. Expired timeouts are filtered rather than
  cleared: the row is harmless once `timed_out_until` is in the past, and
  keeping it means the moderation UI can still show what happened.
*/
CREATE OR REPLACE FUNCTION public.community_active_timeouts(p_community_id uuid)
RETURNS TABLE (
  user_id uuid,
  username text,
  display_name text,
  avatar_url text,
  timed_out_until timestamptz,
  timed_out_by uuid,
  timeout_reason text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.community_member_has_permission(p_community_id, auth.uid(), 2048, NULL) THEN
    RAISE EXCEPTION 'You do not have permission to view timeouts here' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT cm.user_id,
         p.username,
         p.display_name,
         p.avatar_url,
         cm.timed_out_until,
         cm.timed_out_by,
         cm.timeout_reason
    FROM public.community_members cm
    LEFT JOIN public.profiles p ON p.id = cm.user_id
   WHERE cm.community_id = p_community_id
     AND cm.timed_out_until IS NOT NULL
     AND cm.timed_out_until > now()
   ORDER BY cm.timed_out_until DESC
   LIMIT 200;
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.community_ban_member(uuid, uuid, text, integer, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.community_unban_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.community_kick_member(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.community_timeout_member(uuid, uuid, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.community_clear_timeout(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.community_ban_list(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.community_audit_feed(uuid, integer, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.community_active_timeouts(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.community_member_top_role_position(uuid, uuid) TO authenticated;

-- Internal helpers — not part of the client surface.
REVOKE EXECUTE ON FUNCTION public.assert_can_moderate(uuid, uuid, uuid, bigint, text) FROM public, authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.write_community_audit(uuid, text, text, text, jsonb) FROM public, authenticated, anon;
