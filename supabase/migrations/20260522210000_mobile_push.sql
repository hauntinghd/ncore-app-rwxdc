/*
  # Mobile push: notify-mobile fanout

  ## Summary
  Adds the database side of mobile push notifications:
    1. Hardens `user_devices` (RLS, push_enabled flag, last_seen index).
    2. Creates `notification_preferences` so users can mute conversations
       cross-device (today's mute is localStorage-only).
    3. Adds an AFTER INSERT trigger on `direct_messages` that calls the
       `notify-mobile` Edge Function via `pg_net.http_post`. The function
       does the actual FCM/APNs fanout.

  ## What this does NOT do
  - Channel-mention notifications. Pure DMs only for v1. Channel mentions
    require either a `mentioned_user_ids uuid[]` column populated client-
    side, or server-side regex mention extraction; both are invasive
    enough to defer to a later migration.
  - Provision FCM / APNs credentials. Those go on the Edge Function as
    secrets (`FCM_SERVICE_ACCOUNT_JSON`, `APNS_KEY_ID`, `APNS_TEAM_ID`,
    `APNS_BUNDLE_ID`, `APNS_PRIVATE_KEY`). See `deploy/DEPLOY.md`.

  ## Rollback
  - Drop trigger `direct_messages_notify_mobile_trigger`
  - Drop function `notify_mobile_dm()`
  - Drop function `_notify_mobile_invoke()`
*/

-- ============================================================
-- user_devices: hardening + new columns
-- ============================================================
ALTER TABLE public.user_devices
  ADD COLUMN IF NOT EXISTS push_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS app_version text;

CREATE INDEX IF NOT EXISTS idx_user_devices_user_id ON public.user_devices(user_id);
CREATE INDEX IF NOT EXISTS idx_user_devices_last_seen ON public.user_devices(last_seen DESC NULLS LAST);

ALTER TABLE public.user_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own devices select" ON public.user_devices;
CREATE POLICY "Users manage own devices select"
  ON public.user_devices FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users manage own devices insert" ON public.user_devices;
CREATE POLICY "Users manage own devices insert"
  ON public.user_devices FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users manage own devices update" ON public.user_devices;
CREATE POLICY "Users manage own devices update"
  ON public.user_devices FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users manage own devices delete" ON public.user_devices;
CREATE POLICY "Users manage own devices delete"
  ON public.user_devices FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- ============================================================
-- notification_preferences (cross-device per-conversation mute)
-- ============================================================
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

-- ============================================================
-- pg_net is required for triggers to call HTTP endpoints
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- ============================================================
-- Trigger: notify_mobile_dm
-- ============================================================
-- Fires AFTER INSERT on direct_messages, dispatches a non-blocking
-- HTTP call to the notify-mobile edge function. The trigger is
-- intentionally tolerant of missing config (no project ref, no
-- service role key) - it logs and exits without failing the insert.
-- This means a misconfigured push setup CAN NEVER block a message
-- from being sent.

CREATE OR REPLACE FUNCTION public._notify_mobile_invoke(
  p_payload jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = extensions, public
AS $$
DECLARE
  v_url text;
  v_service_key text;
BEGIN
  -- Project URL: prefer GUC override (set per-environment), fall back to
  -- the canonical hostname pattern.
  v_url := current_setting('app.notify_mobile_url', true);
  IF v_url IS NULL OR v_url = '' THEN
    v_url := 'https://kxheuoaurlaociszyrof.supabase.co/functions/v1/notify-mobile';
  END IF;

  v_service_key := current_setting('app.service_role_key', true);

  -- Without a service role key the edge function cannot read user_devices,
  -- so skip silently. Surface a NOTICE so it shows up in pg logs.
  IF v_service_key IS NULL OR v_service_key = '' THEN
    RAISE NOTICE 'notify_mobile: app.service_role_key not configured, skipping';
    RETURN;
  END IF;

  PERFORM extensions.http_post(
    url := v_url,
    body := p_payload,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_key
    ),
    timeout_milliseconds := 5000
  );
EXCEPTION WHEN OTHERS THEN
  -- Never block the insert.
  RAISE NOTICE 'notify_mobile: invoke failed: %', SQLERRM;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_mobile_dm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_preview text;
BEGIN
  -- Trim the content to a safe preview length. We never include the full
  -- message body in the push request payload; the edge function will
  -- only forward what we send here.
  v_preview := substring(coalesce(NEW.content, '') from 1 for 140);

  PERFORM public._notify_mobile_invoke(jsonb_build_object(
    'kind',           'dm',
    'message_id',     NEW.id,
    'conversation_id', NEW.conversation_id,
    'sender_id',      NEW.author_id,
    'content_preview', v_preview,
    'created_at',     NEW.created_at
  ));

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS direct_messages_notify_mobile_trigger ON public.direct_messages;
CREATE TRIGGER direct_messages_notify_mobile_trigger
  AFTER INSERT ON public.direct_messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_mobile_dm();
