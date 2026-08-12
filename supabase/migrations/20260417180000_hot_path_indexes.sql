-- Hot-path indexes for NCore.
--
-- Every one of these is pure additive: no data touched, no columns altered,
-- no RLS change. Safe to run on a live database. Uses CREATE INDEX IF NOT
-- EXISTS so a re-run is a no-op.
--
-- Covers the queries the UI runs most:
--   * ChatPage: message pagination per channel (created_at DESC) + author lookup
--   * DMs:      direct-message pagination per conversation + author lookup
--   * Growth:   user_growth_capabilities lookups on every XP award / perk check
--   * Admin:    security risk cases ordered by triage status / creation date
--   * Profiles: last_seen sort for online/idle queries

-- Channel messages scoped to a channel, newest first.
CREATE INDEX IF NOT EXISTS idx_messages_channel_created_at
  ON public.messages (channel_id, created_at DESC);

-- Who posted what. Helpful for mentions, profile activity feeds, moderation.
CREATE INDEX IF NOT EXISTS idx_messages_author_id
  ON public.messages (author_id);

-- DM pagination scoped to a conversation, newest first.
CREATE INDEX IF NOT EXISTS idx_direct_messages_conversation_created_at
  ON public.direct_messages (conversation_id, created_at DESC);

-- DM by author for profile / moderation.
CREATE INDEX IF NOT EXISTS idx_direct_messages_author_id
  ON public.direct_messages (author_id);

-- Growth capability checks happen on nearly every XP / perk path.
CREATE INDEX IF NOT EXISTS idx_user_growth_capabilities_user_id
  ON public.user_growth_capabilities (user_id);

-- Profile sort by last_seen (online / idle grids, leaderboards).
CREATE INDEX IF NOT EXISTS idx_profiles_last_seen
  ON public.profiles (last_seen DESC NULLS LAST);

-- Admin review queue: open cases ordered by creation.
-- Table only exists on projects that ran the security-risk-classifier migration.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'account_security_risk_cases'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_security_cases_status_created
             ON public.account_security_risk_cases (review_status, created_at DESC)';
  END IF;
END$$;
