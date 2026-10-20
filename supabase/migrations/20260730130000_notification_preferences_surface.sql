/*
  # Notification preference resolution

  `notification_preferences` was created in `20260522210000_mobile_push.sql`
  with mode all/mentions/none and a `muted_until`, and then nothing ever read or
  wrote it. There is no mute in the product at all — which means one busy server
  leaves the whole app permanently unread, and there is no way to stay in a
  community without hearing about every message in it.

  This migration adds the resolution logic. The UI surface is in
  `src/lib/notificationPrefs.ts` and the sidebar/rail badges.

  ## Table redeclared idempotently
  `20260522210000` is still unapplied on the live database. Rather than making
  this migration depend on the ordering of a pending one, the table definition
  is repeated verbatim under IF NOT EXISTS. Applying either one first is fine.

  ## Precedence
  Most specific wins: channel/dm override > community > global > 'all'.
  A scope is muted if its mode is 'none', or if `muted_until` is in the future
  regardless of mode — a temporary mute is a distinct thing from permanently
  setting a scope to silent, and people use both.
*/

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  scope_kind text NOT NULL CHECK (scope_kind IN ('dm', 'channel', 'community', 'global')),
  scope_id uuid,
  mode text NOT NULL DEFAULT 'all' CHECK (mode IN ('all', 'mentions', 'none')),
  muted_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, scope_kind, scope_id)
);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own notification prefs" ON public.notification_preferences;
CREATE POLICY "Users manage own notification prefs"
  ON public.notification_preferences FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_notif_prefs_user
  ON public.notification_preferences(user_id, scope_kind);

-- ---------------------------------------------------------------------------
-- Upsert
-- ---------------------------------------------------------------------------

/*
  Sets (or clears) the preference for one scope.

  Passing mode 'all' with no `muted_until` deletes the row rather than storing
  a default — otherwise the table accumulates a row per channel the user ever
  glanced at, and "has an override" stops meaning anything.
*/
CREATE OR REPLACE FUNCTION public.set_notification_preference(
  p_scope_kind text,
  p_scope_id uuid,
  p_mode text DEFAULT 'all',
  p_muted_until timestamptz DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_scope_kind NOT IN ('dm', 'channel', 'community', 'global') THEN
    RAISE EXCEPTION 'Unknown notification scope %', p_scope_kind USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_mode, 'all') NOT IN ('all', 'mentions', 'none') THEN
    RAISE EXCEPTION 'Unknown notification mode %', p_mode USING ERRCODE = '22023';
  END IF;

  IF COALESCE(p_mode, 'all') = 'all'
     AND (p_muted_until IS NULL OR p_muted_until <= now()) THEN
    DELETE FROM public.notification_preferences
     WHERE user_id = v_uid
       AND scope_kind = p_scope_kind
       AND scope_id IS NOT DISTINCT FROM p_scope_id;
    RETURN;
  END IF;

  INSERT INTO public.notification_preferences (user_id, scope_kind, scope_id, mode, muted_until)
  VALUES (v_uid, p_scope_kind, p_scope_id, COALESCE(p_mode, 'all'), p_muted_until)
  ON CONFLICT (user_id, scope_kind, scope_id) DO UPDATE
    SET mode        = EXCLUDED.mode,
        muted_until = EXCLUDED.muted_until,
        updated_at  = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_notification_preference(text, uuid, text, timestamptz) TO authenticated;

-- ---------------------------------------------------------------------------
-- Resolution
-- ---------------------------------------------------------------------------

/*
  The effective mode for one channel, after precedence and mute expiry.

  Returned as text rather than a composite so callers can compare it directly.
  A live temporary mute reports 'none' — from the caller's point of view a
  scope that is muted until tomorrow behaves exactly like one set to silent,
  and collapsing the two here keeps every call site from re-deriving it.
*/
CREATE OR REPLACE FUNCTION public.resolve_channel_notification_mode(
  p_channel_id uuid,
  p_community_id uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_community_id uuid := p_community_id;
  v_mode text;
  v_muted_until timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RETURN 'all';
  END IF;

  IF v_community_id IS NULL THEN
    SELECT s.community_id INTO v_community_id
      FROM public.channels ch
      JOIN public.servers s ON s.id = ch.server_id
     WHERE ch.id = p_channel_id;
  END IF;

  FOR v_mode, v_muted_until IN
    SELECT np.mode, np.muted_until
      FROM public.notification_preferences np
     WHERE np.user_id = v_uid
       AND (
         (np.scope_kind = 'channel'   AND np.scope_id = p_channel_id)
         OR (np.scope_kind = 'community' AND np.scope_id = v_community_id)
         OR (np.scope_kind = 'global'    AND np.scope_id IS NULL)
       )
     ORDER BY CASE np.scope_kind
                WHEN 'channel'   THEN 1
                WHEN 'community' THEN 2
                ELSE 3
              END
  LOOP
    IF v_muted_until IS NOT NULL AND v_muted_until > now() THEN
      RETURN 'none';
    END IF;
    -- An expired temporary mute leaves the stored mode in force, which is what
    -- someone who set "mentions only, muted for an hour" expects to come back to.
    RETURN v_mode;
  END LOOP;

  RETURN 'all';
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_channel_notification_mode(uuid, uuid) TO authenticated;

/*
  Every channel in a community whose effective mode is not 'all', so the client
  can render mute state for a whole sidebar in one round trip instead of one
  query per channel.
*/
CREATE OR REPLACE FUNCTION public.community_notification_modes(p_community_id uuid)
RETURNS TABLE (channel_id uuid, mode text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT ch.id,
         public.resolve_channel_notification_mode(ch.id, p_community_id)
    FROM public.channels ch
    JOIN public.servers s ON s.id = ch.server_id
   WHERE s.community_id = p_community_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.community_notification_modes(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Unread integration
-- ---------------------------------------------------------------------------

/*
  Muted scopes should not drive the unread dot, but they must still surface
  direct mentions — the entire point of muting a busy server is to stay in it
  without watching it, and losing a direct ping would make mute unusable.

  `community_unread_summary` (20260729120000) already returns per-channel
  counts. Rather than change its shape, this exposes the mode alongside it and
  lets the client decide what to render, which keeps the unread RPC free of
  notification concerns.
*/
CREATE OR REPLACE FUNCTION public.user_muted_scopes()
RETURNS TABLE (scope_kind text, scope_id uuid, mode text, muted_until timestamptz)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT np.scope_kind, np.scope_id, np.mode, np.muted_until
    FROM public.notification_preferences np
   WHERE np.user_id = auth.uid()
     AND (np.mode <> 'all' OR (np.muted_until IS NOT NULL AND np.muted_until > now()))
   ORDER BY np.scope_kind, np.updated_at DESC
   LIMIT 500;
$$;

GRANT EXECUTE ON FUNCTION public.user_muted_scopes() TO authenticated;
