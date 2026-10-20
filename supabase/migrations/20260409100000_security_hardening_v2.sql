-- =============================================================================
-- NCore Shield v2: Security Hardening Migration
-- Phase 3 of the 40000x plan
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Active Sessions Table (Token Architecture Hardening)
-- Tracks all active sessions per user for remote logout capability.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_fingerprint text NOT NULL DEFAULT '',
  ip_address inet,
  user_agent text DEFAULT '',
  browser text DEFAULT '',
  os text DEFAULT '',
  country_code text DEFAULT '',
  city text DEFAULT '',
  is_current boolean DEFAULT false,
  last_active_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX idx_user_sessions_user_id ON user_sessions(user_id, revoked_at);
CREATE INDEX idx_user_sessions_fingerprint ON user_sessions(device_fingerprint);

ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own sessions"
  ON user_sessions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can revoke own sessions"
  ON user_sessions FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 2. Login Anomaly Detection
-- Flags suspicious login attempts for 2FA challenge.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS login_anomalies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  anomaly_type text NOT NULL, -- 'new_device', 'new_location', 'new_ip', 'velocity_anomaly', 'brute_force'
  ip_address inet,
  device_fingerprint text DEFAULT '',
  country_code text DEFAULT '',
  city text DEFAULT '',
  risk_score int DEFAULT 0, -- 0-100
  resolved boolean DEFAULT false,
  resolved_by text, -- 'user_2fa', 'admin_dismiss', 'auto_expire'
  created_at timestamptz DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX idx_login_anomalies_user ON login_anomalies(user_id, created_at DESC);

ALTER TABLE login_anomalies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own anomalies"
  ON login_anomalies FOR SELECT
  USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 3. Community Audit Log
-- Tracks all admin/mod actions in a community for accountability.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS community_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL, -- 'member_ban', 'member_kick', 'role_change', 'channel_create', 'channel_delete', 'settings_update', 'invite_revoke', 'webhook_create', 'bot_add'
  target_type text, -- 'member', 'channel', 'role', 'invite', 'webhook', 'bot', 'settings'
  target_id text, -- ID of affected resource
  details jsonb DEFAULT '{}',
  ip_address inet,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_community_audit_community ON community_audit_log(community_id, created_at DESC);
CREATE INDEX idx_community_audit_actor ON community_audit_log(actor_id, created_at DESC);

ALTER TABLE community_audit_log ENABLE ROW LEVEL SECURITY;

-- Community admins and owners can view audit logs
CREATE POLICY "Community admins can view audit logs"
  ON community_audit_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM community_members cm
      WHERE cm.community_id = community_audit_log.community_id
        AND cm.user_id = auth.uid()
        AND cm.role IN ('owner', 'admin')
    )
  );

-- Platform admins can view all audit logs
CREATE POLICY "Platform admins can view all audit logs"
  ON community_audit_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.platform_role IN ('owner', 'admin')
    )
  );

-- ---------------------------------------------------------------------------
-- 4. URL Reputation Cache
-- Caches URL reputation checks for anti-phishing.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS url_reputation_cache (
  url_hash text PRIMARY KEY, -- SHA-256 of normalized URL
  url_domain text NOT NULL,
  is_malicious boolean DEFAULT false,
  threat_type text, -- 'phishing', 'malware', 'social_engineering', 'unwanted_software'
  source text DEFAULT 'manual', -- 'google_safe_browsing', 'manual', 'user_report'
  report_count int DEFAULT 0,
  checked_at timestamptz DEFAULT now(),
  expires_at timestamptz DEFAULT (now() + interval '24 hours')
);

CREATE INDEX idx_url_reputation_domain ON url_reputation_cache(url_domain);
CREATE INDEX idx_url_reputation_expires ON url_reputation_cache(expires_at);

-- ---------------------------------------------------------------------------
-- 5. Raid Protection
-- Tracks join velocity for anti-raid detection.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS community_join_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invite_code text,
  ip_address inet,
  joined_at timestamptz DEFAULT now()
);

CREATE INDEX idx_join_events_community_time ON community_join_events(community_id, joined_at DESC);

-- Raid detection function: returns true if join rate exceeds threshold
CREATE OR REPLACE FUNCTION detect_raid(
  p_community_id uuid,
  p_window_seconds int DEFAULT 60,
  p_threshold int DEFAULT 20
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  join_count int;
BEGIN
  SELECT count(*) INTO join_count
  FROM community_join_events
  WHERE community_id = p_community_id
    AND joined_at > now() - make_interval(secs => p_window_seconds);
  RETURN join_count >= p_threshold;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Server Verification System
-- Verified badge for legitimate communities.
-- ---------------------------------------------------------------------------
ALTER TABLE communities
  ADD COLUMN IF NOT EXISTS is_verified boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_by uuid REFERENCES auth.users(id);

-- ---------------------------------------------------------------------------
-- 7. 2FA Configuration
-- Store TOTP/WebAuthn configuration per user.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_2fa_config (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  totp_enabled boolean DEFAULT false,
  totp_secret_encrypted text, -- AES-encrypted TOTP secret
  webauthn_enabled boolean DEFAULT false,
  webauthn_credentials jsonb DEFAULT '[]', -- Array of WebAuthn credential descriptors
  recovery_codes_hash text, -- Hash of remaining recovery codes
  recovery_codes_remaining int DEFAULT 0,
  enforced boolean DEFAULT false, -- Whether 2FA is required for this account
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE user_2fa_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own 2FA"
  ON user_2fa_config FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 8. Bot Users Table (for Phase 5 - Bot Platform)
-- Pre-create the table so security policies can reference it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bot_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  username text NOT NULL UNIQUE,
  display_name text,
  avatar_url text,
  description text DEFAULT '',
  token_hash text NOT NULL, -- bcrypt hash of bot bearer token
  permissions jsonb DEFAULT '{}',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_bot_users_owner ON bot_users(owner_id);

ALTER TABLE bot_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Bot owners can manage their bots"
  ON bot_users FOR ALL
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Anyone can view active bots"
  ON bot_users FOR SELECT
  USING (is_active = true);

-- ---------------------------------------------------------------------------
-- 9. Community Webhooks Table (for Phase 5)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS community_webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  name text NOT NULL DEFAULT 'Webhook',
  url text NOT NULL,
  secret_hash text NOT NULL, -- HMAC-SHA256 signing secret hash
  events text[] DEFAULT '{}', -- 'message.create', 'member.join', etc.
  is_active boolean DEFAULT true,
  failure_count int DEFAULT 0,
  last_triggered_at timestamptz,
  last_failure_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_webhooks_community ON community_webhooks(community_id, is_active);

ALTER TABLE community_webhooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Community admins manage webhooks"
  ON community_webhooks FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM community_members cm
      WHERE cm.community_id = community_webhooks.community_id
        AND cm.user_id = auth.uid()
        AND cm.role IN ('owner', 'admin')
    )
  );
