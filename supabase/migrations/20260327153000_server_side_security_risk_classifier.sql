/*
  # Server-side phishing/account risk classifier + automated containment

  Adds:
  - server-side phishing/content classifier on channel + direct messages
  - account risk signal + case tables for admin review
  - automated containment through the existing growth capability gates
  - admin review RPCs to release or mark cases reviewed
*/

-- ------------------------------------------------------------------
-- Extend capability unlock source for automated containment
-- ------------------------------------------------------------------
ALTER TABLE public.user_growth_capabilities
  DROP CONSTRAINT IF EXISTS user_growth_capabilities_unlock_source_check;

ALTER TABLE public.user_growth_capabilities
  ADD CONSTRAINT user_growth_capabilities_unlock_source_check
  CHECK (
    unlock_source IN (
      'default_limited',
      'trusted_invite',
      'admin_approved',
      'trust_promotion',
      'legacy_admin_seed',
      'manual_override',
      'security_contained'
    )
  );

-- ------------------------------------------------------------------
-- Risk signals + aggregated account cases
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.account_security_risk_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  source_kind text NOT NULL
    CHECK (source_kind IN ('channel_message', 'direct_message', 'growth_event', 'admin_manual')),
  source_ref text NOT NULL,
  signal_key text NOT NULL,
  risk_score integer NOT NULL DEFAULT 0 CHECK (risk_score >= 0),
  risk_level text NOT NULL DEFAULT 'low'
    CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  excerpt text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_kind, source_ref, signal_key)
);

CREATE INDEX IF NOT EXISTS idx_account_security_risk_signals_user_created
  ON public.account_security_risk_signals(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_account_security_risk_signals_level_created
  ON public.account_security_risk_signals(risk_level, created_at DESC);

CREATE TABLE IF NOT EXISTS public.account_security_risk_cases (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  risk_level text NOT NULL DEFAULT 'none'
    CHECK (risk_level IN ('none', 'low', 'medium', 'high', 'critical')),
  risk_score integer NOT NULL DEFAULT 0 CHECK (risk_score >= 0),
  containment_state text NOT NULL DEFAULT 'none'
    CHECK (containment_state IN ('none', 'observe', 'limited_mode', 'quarantined')),
  auto_contained boolean NOT NULL DEFAULT false,
  review_status text NOT NULL DEFAULT 'pending_review'
    CHECK (review_status IN ('pending_review', 'reviewed', 'dismissed')),
  previous_growth_contract jsonb,
  signal_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  risk_factors jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_event_name text,
  last_event_at timestamptz,
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_account_security_risk_cases_level
  ON public.account_security_risk_cases(risk_level, last_event_at DESC);

CREATE INDEX IF NOT EXISTS idx_account_security_risk_cases_containment
  ON public.account_security_risk_cases(containment_state, updated_at DESC);

DROP TRIGGER IF EXISTS account_security_risk_cases_set_updated_at ON public.account_security_risk_cases;
CREATE TRIGGER account_security_risk_cases_set_updated_at
BEFORE UPDATE ON public.account_security_risk_cases
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();

-- ------------------------------------------------------------------
-- Classifier helpers
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.classify_account_security_text(p_content text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  normalized_content text := lower(coalesce(p_content, ''));
  reasons text[] := ARRAY[]::text[];
  score integer := 0;
  has_url boolean := normalized_content ~ '(https?://|www\.)';
  normalized_score integer;
  risk_level text := 'none';
BEGIN
  IF btrim(normalized_content) = '' THEN
    RETURN jsonb_build_object(
      'score', 0,
      'risk_level', 'none',
      'has_url', false,
      'reasons', '[]'::jsonb
    );
  END IF;

  IF normalized_content ~ '(verify( your)? (account|wallet|email)|confirm your (account|login)|security alert|session expired|re-?authenticate|login again|support team|help desk)' THEN
    score := score + 30;
    reasons := array_append(reasons, 'credential_challenge_language');
  END IF;

  IF normalized_content ~ '(seed phrase|recovery phrase|mnemonic|private key|api key|access token|session token|auth token|2fa code|one-time code|otp)' THEN
    score := score + 40;
    reasons := array_append(reasons, 'secret_request_language');
  END IF;

  IF normalized_content ~ '(download|install|run|open|execute).*(https?://|www\.|\.exe\b|\.scr\b|\.bat\b|\.cmd\b|\.ps1\b|\.jar\b)' THEN
    score := score + 25;
    reasons := array_append(reasons, 'malware_delivery_language');
  END IF;

  IF normalized_content ~ '(wallet connect|connect your wallet|claim now|gift link|free boost|free nitro|claim reward|claim airdrop)' THEN
    score := score + 35;
    reasons := array_append(reasons, 'phishing_reward_language');
  END IF;

  IF has_url AND normalized_content ~ '(verify|login|signin|security|update|claim|gift|download|install|wallet|support)' THEN
    score := score + 20;
    reasons := array_append(reasons, 'risky_url_with_social_engineering');
  END IF;

  IF normalized_content ~ '(xn--|bit\.ly|tinyurl\.com|t\.co/)' THEN
    score := score + 18;
    reasons := array_append(reasons, 'obfuscated_or_shortened_link');
  END IF;

  IF normalized_content ~ '(@everyone|@here)' AND has_url THEN
    score := score + 12;
    reasons := array_append(reasons, 'broadcast_with_external_link');
  END IF;

  normalized_score := LEAST(score, 100);
  risk_level := CASE
    WHEN normalized_score >= 75 THEN 'critical'
    WHEN normalized_score >= 45 THEN 'high'
    WHEN normalized_score >= 25 THEN 'medium'
    WHEN normalized_score > 0 THEN 'low'
    ELSE 'none'
  END;

  RETURN jsonb_build_object(
    'score', normalized_score,
    'risk_level', risk_level,
    'has_url', has_url,
    'reasons', to_jsonb(reasons)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_account_security_risk_case(
  p_user_id uuid,
  p_last_event_name text DEFAULT NULL,
  p_last_event_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  role_value text;
  existing_case public.account_security_risk_cases%ROWTYPE;
  capability_row public.user_growth_capabilities%ROWTYPE;
  effective_last_event_name text := lower(coalesce(nullif(trim(p_last_event_name), ''), 'security_signal'));
  effective_last_event_at timestamptz := coalesce(p_last_event_at, now());
  recent_signal_count integer := 0;
  critical_count integer := 0;
  high_count integer := 0;
  medium_count integer := 0;
  low_count integer := 0;
  aggregated_score integer := 0;
  latest_signal_at timestamptz;
  next_risk_level text := 'none';
  next_containment_state text := 'none';
  next_review_status text := 'dismissed';
  should_auto_contain boolean := false;
  risk_factors jsonb := '[]'::jsonb;
  signal_summary jsonb := '{}'::jsonb;
  previous_growth_contract jsonb;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('user_id', NULL, 'risk_level', 'none', 'risk_score', 0);
  END IF;

  SELECT p.platform_role
  INTO role_value
  FROM public.profiles p
  WHERE p.id = p_user_id;

  IF role_value IS NULL THEN
    RAISE EXCEPTION 'Profile not found for security risk refresh: %', p_user_id;
  END IF;

  SELECT *
  INTO existing_case
  FROM public.account_security_risk_cases
  WHERE user_id = p_user_id;

  PERFORM public.ensure_user_growth_capabilities_row(p_user_id);

  SELECT *
  INTO capability_row
  FROM public.user_growth_capabilities
  WHERE user_id = p_user_id;

  SELECT
    LEAST(
      100,
      COALESCE(SUM(
        CASE
          WHEN created_at >= now() - interval '7 days' THEN risk_score
          ELSE GREATEST(5, ROUND(risk_score * 0.5))::integer
        END
      ), 0)
      + CASE WHEN COUNT(*) >= 3 THEN 10 ELSE 0 END
      + CASE WHEN COUNT(*) FILTER (WHERE created_at >= now() - interval '24 hours') >= 2 THEN 10 ELSE 0 END
    )::integer,
    COUNT(*)::integer,
    COALESCE(SUM(CASE WHEN risk_level = 'critical' THEN 1 ELSE 0 END), 0)::integer,
    COALESCE(SUM(CASE WHEN risk_level = 'high' THEN 1 ELSE 0 END), 0)::integer,
    COALESCE(SUM(CASE WHEN risk_level = 'medium' THEN 1 ELSE 0 END), 0)::integer,
    COALESCE(SUM(CASE WHEN risk_level = 'low' THEN 1 ELSE 0 END), 0)::integer,
    MAX(created_at),
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'signal_key', signal_key,
          'risk_level', risk_level,
          'risk_score', risk_score,
          'source_kind', source_kind,
          'excerpt', excerpt,
          'metadata', metadata,
          'created_at', created_at
        )
        ORDER BY risk_score DESC, created_at DESC
      ) FILTER (WHERE signal_key IS NOT NULL),
      '[]'::jsonb
    )
  INTO aggregated_score, recent_signal_count, critical_count, high_count, medium_count, low_count, latest_signal_at, risk_factors
  FROM public.account_security_risk_signals
  WHERE user_id = p_user_id
    AND created_at >= now() - interval '30 days';

  effective_last_event_at := COALESCE(latest_signal_at, effective_last_event_at, now());

  next_risk_level := CASE
    WHEN aggregated_score >= 75 OR critical_count > 0 THEN 'critical'
    WHEN aggregated_score >= 45 THEN 'high'
    WHEN aggregated_score >= 25 THEN 'medium'
    WHEN aggregated_score > 0 THEN 'low'
    ELSE 'none'
  END;

  next_containment_state := CASE
    WHEN role_value IN ('owner', 'admin') THEN 'none'
    WHEN next_risk_level = 'critical' THEN 'quarantined'
    WHEN next_risk_level = 'high' THEN 'limited_mode'
    WHEN next_risk_level = 'medium' THEN 'observe'
    ELSE 'none'
  END;

  IF coalesce(existing_case.auto_contained, false)
     AND coalesce(existing_case.containment_state, 'none') IN ('limited_mode', 'quarantined')
     AND role_value NOT IN ('owner', 'admin') THEN
    next_containment_state := existing_case.containment_state;
  END IF;

  should_auto_contain := next_containment_state IN ('limited_mode', 'quarantined');

  signal_summary := jsonb_build_object(
    'signal_count', recent_signal_count,
    'critical_count', critical_count,
    'high_count', high_count,
    'medium_count', medium_count,
    'low_count', low_count,
    'latest_signal_at', latest_signal_at
  );

  IF next_risk_level = 'none' AND existing_case.user_id IS NULL THEN
    RETURN jsonb_build_object(
      'user_id', p_user_id,
      'risk_level', 'none',
      'risk_score', 0,
      'containment_state', 'none'
    );
  END IF;

  IF next_risk_level = 'none' THEN
    next_review_status := COALESCE(existing_case.review_status, 'dismissed');
  ELSIF existing_case.reviewed_at IS NOT NULL AND effective_last_event_at <= existing_case.reviewed_at THEN
    next_review_status := COALESCE(existing_case.review_status, 'reviewed');
  ELSE
    next_review_status := 'pending_review';
  END IF;

  IF should_auto_contain AND role_value NOT IN ('owner', 'admin') THEN
    IF coalesce(existing_case.auto_contained, false) THEN
      previous_growth_contract := existing_case.previous_growth_contract;
    ELSE
      previous_growth_contract := jsonb_build_object(
        'trust_tier', capability_row.trust_tier,
        'can_create_server', capability_row.can_create_server,
        'can_start_high_volume_calls', capability_row.can_start_high_volume_calls,
        'can_use_marketplace', capability_row.can_use_marketplace,
        'unlock_source', capability_row.unlock_source
      );
    END IF;

    UPDATE public.user_growth_capabilities
    SET
      trust_tier = 'limited',
      can_create_server = false,
      can_start_high_volume_calls = false,
      can_use_marketplace = false,
      unlock_source = 'security_contained',
      updated_at = now()
    WHERE user_id = p_user_id;
  ELSE
    previous_growth_contract := existing_case.previous_growth_contract;
  END IF;

  INSERT INTO public.account_security_risk_cases (
    user_id,
    risk_level,
    risk_score,
    containment_state,
    auto_contained,
    review_status,
    previous_growth_contract,
    signal_summary,
    risk_factors,
    last_event_name,
    last_event_at
  )
  VALUES (
    p_user_id,
    next_risk_level,
    aggregated_score,
    next_containment_state,
    should_auto_contain AND role_value NOT IN ('owner', 'admin'),
    next_review_status,
    previous_growth_contract,
    signal_summary,
    risk_factors,
    effective_last_event_name,
    effective_last_event_at
  )
  ON CONFLICT (user_id) DO UPDATE
  SET
    risk_level = EXCLUDED.risk_level,
    risk_score = EXCLUDED.risk_score,
    containment_state = EXCLUDED.containment_state,
    auto_contained = EXCLUDED.auto_contained,
    review_status = EXCLUDED.review_status,
    previous_growth_contract = COALESCE(EXCLUDED.previous_growth_contract, public.account_security_risk_cases.previous_growth_contract),
    signal_summary = EXCLUDED.signal_summary,
    risk_factors = EXCLUDED.risk_factors,
    last_event_name = EXCLUDED.last_event_name,
    last_event_at = EXCLUDED.last_event_at,
    updated_at = now();

  IF should_auto_contain
     AND role_value NOT IN ('owner', 'admin')
     AND NOT coalesce(existing_case.auto_contained, false) THEN
    INSERT INTO public.growth_events (
      user_id,
      event_name,
      event_source,
      source_channel,
      payload
    )
    VALUES (
      p_user_id,
      'security_auto_contained',
      'server',
      'security',
      jsonb_build_object(
        'risk_level', next_risk_level,
        'risk_score', aggregated_score,
        'containment_state', next_containment_state
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'user_id', p_user_id,
    'risk_level', next_risk_level,
    'risk_score', aggregated_score,
    'containment_state', next_containment_state,
    'review_status', next_review_status,
    'auto_contained', should_auto_contain AND role_value NOT IN ('owner', 'admin'),
    'signal_summary', signal_summary,
    'risk_factors', risk_factors
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_account_security_signal(
  p_user_id uuid,
  p_source_kind text,
  p_source_ref text,
  p_signal_key text,
  p_risk_score integer,
  p_risk_level text,
  p_excerpt text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_created_at timestamptz DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_id uuid;
  normalized_source_kind text := lower(coalesce(nullif(trim(p_source_kind), ''), 'growth_event'));
  normalized_source_ref text := coalesce(nullif(trim(p_source_ref), ''), gen_random_uuid()::text);
  normalized_signal_key text := lower(coalesce(nullif(trim(p_signal_key), ''), 'security_signal'));
  normalized_risk_level text := lower(coalesce(nullif(trim(p_risk_level), ''), 'low'));
  normalized_excerpt text := NULLIF(left(regexp_replace(coalesce(p_excerpt, ''), '[\r\n\t]+', ' ', 'g'), 220), '');
  normalized_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  normalized_created_at timestamptz := coalesce(p_created_at, now());
BEGIN
  IF p_user_id IS NULL OR greatest(coalesce(p_risk_score, 0), 0) < 1 THEN
    RETURN NULL;
  END IF;

  IF normalized_source_kind NOT IN ('channel_message', 'direct_message', 'growth_event', 'admin_manual') THEN
    normalized_source_kind := 'growth_event';
  END IF;

  IF normalized_risk_level NOT IN ('low', 'medium', 'high', 'critical') THEN
    normalized_risk_level := CASE
      WHEN greatest(coalesce(p_risk_score, 0), 0) >= 75 THEN 'critical'
      WHEN greatest(coalesce(p_risk_score, 0), 0) >= 45 THEN 'high'
      WHEN greatest(coalesce(p_risk_score, 0), 0) >= 25 THEN 'medium'
      ELSE 'low'
    END;
  END IF;

  INSERT INTO public.account_security_risk_signals (
    user_id,
    source_kind,
    source_ref,
    signal_key,
    risk_score,
    risk_level,
    excerpt,
    metadata,
    created_at
  )
  VALUES (
    p_user_id,
    normalized_source_kind,
    normalized_source_ref,
    normalized_signal_key,
    GREATEST(coalesce(p_risk_score, 0), 0),
    normalized_risk_level,
    normalized_excerpt,
    normalized_metadata,
    normalized_created_at
  )
  ON CONFLICT (source_kind, source_ref, signal_key) DO UPDATE
  SET
    risk_score = GREATEST(public.account_security_risk_signals.risk_score, EXCLUDED.risk_score),
    risk_level = EXCLUDED.risk_level,
    excerpt = COALESCE(EXCLUDED.excerpt, public.account_security_risk_signals.excerpt),
    metadata = public.account_security_risk_signals.metadata || EXCLUDED.metadata
  RETURNING id INTO inserted_id;

  PERFORM public.refresh_account_security_risk_case(
    p_user_id,
    normalized_signal_key,
    normalized_created_at
  );

  RETURN inserted_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_message_security_signal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  classification jsonb;
  signal_score integer;
  signal_level text;
  signal_excerpt text;
  source_kind text := lower(coalesce(nullif(TG_ARGV[0], ''), 'channel_message'));
  source_id text := NEW.id::text;
  metadata_payload jsonb := '{}'::jsonb;
  row_payload jsonb := to_jsonb(NEW);
BEGIN
  IF NEW.author_id IS NULL OR btrim(coalesce(NEW.content, '')) = '' THEN
    RETURN NEW;
  END IF;

  classification := public.classify_account_security_text(NEW.content);
  signal_score := COALESCE((classification ->> 'score')::integer, 0);
  IF signal_score < 25 THEN
    RETURN NEW;
  END IF;

  signal_level := lower(coalesce(classification ->> 'risk_level', 'medium'));
  signal_excerpt := left(regexp_replace(coalesce(NEW.content, ''), '[\r\n\t]+', ' ', 'g'), 220);

  IF source_kind = 'direct_message' THEN
    metadata_payload := jsonb_build_object(
      'conversation_id', row_payload ->> 'conversation_id',
      'reasons', classification -> 'reasons'
    );
  ELSE
    metadata_payload := jsonb_build_object(
      'channel_id', row_payload ->> 'channel_id',
      'reasons', classification -> 'reasons'
    );
  END IF;

  PERFORM public.record_account_security_signal(
    NEW.author_id,
    source_kind,
    source_id,
    'phishing_message_content',
    signal_score,
    signal_level,
    signal_excerpt,
    metadata_payload,
    coalesce(NEW.created_at, now())
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_security_signal_trigger ON public.messages;
CREATE TRIGGER messages_security_signal_trigger
AFTER INSERT ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.handle_message_security_signal('channel_message');

DROP TRIGGER IF EXISTS direct_messages_security_signal_trigger ON public.direct_messages;
CREATE TRIGGER direct_messages_security_signal_trigger
AFTER INSERT ON public.direct_messages
FOR EACH ROW
EXECUTE FUNCTION public.handle_message_security_signal('direct_message');

CREATE OR REPLACE FUNCTION public.handle_growth_event_security_signal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized_event text := lower(coalesce(NEW.event_name, ''));
  signal_score integer := 0;
  signal_level text := 'low';
BEGIN
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  CASE normalized_event
    WHEN 'shield_message_blocked' THEN
      signal_score := 28;
      signal_level := 'high';
    WHEN 'shield_message_warned' THEN
      signal_score := 12;
      signal_level := 'medium';
    WHEN 'shield_external_open_blocked' THEN
      signal_score := 24;
      signal_level := 'high';
    WHEN 'shield_external_open_warned' THEN
      signal_score := 10;
      signal_level := 'medium';
    WHEN 'auth_signin_throttled' THEN
      signal_score := 18;
      signal_level := 'medium';
    WHEN 'auth_signin_failed' THEN
      signal_score := 6;
      signal_level := 'low';
    ELSE
      RETURN NEW;
  END CASE;

  PERFORM public.record_account_security_signal(
    NEW.user_id,
    'growth_event',
    NEW.id::text,
    normalized_event,
    signal_score,
    signal_level,
    NULL,
    NEW.payload || jsonb_build_object('event_name', normalized_event),
    NEW.created_at
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS growth_events_security_signal_trigger ON public.growth_events;
CREATE TRIGGER growth_events_security_signal_trigger
AFTER INSERT ON public.growth_events
FOR EACH ROW
EXECUTE FUNCTION public.handle_growth_event_security_signal();

CREATE OR REPLACE FUNCTION public.admin_review_account_security_risk(
  p_user_id uuid,
  p_review_status text DEFAULT 'reviewed',
  p_review_note text DEFAULT NULL,
  p_release_containment boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
  normalized_review_status text := lower(coalesce(nullif(trim(p_review_status), ''), 'reviewed'));
  existing_case public.account_security_risk_cases%ROWTYPE;
  restored_unlock_source text;
BEGIN
  IF actor_id IS NULL OR NOT public.is_platform_admin(actor_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF normalized_review_status NOT IN ('pending_review', 'reviewed', 'dismissed') THEN
    normalized_review_status := 'reviewed';
  END IF;

  SELECT *
  INTO existing_case
  FROM public.account_security_risk_cases
  WHERE user_id = p_user_id;

  IF existing_case.user_id IS NULL THEN
    RAISE EXCEPTION 'Security risk case not found for user %', p_user_id;
  END IF;

  IF coalesce(p_release_containment, false)
     AND coalesce(existing_case.auto_contained, false)
     AND coalesce(existing_case.previous_growth_contract, '{}'::jsonb) <> '{}'::jsonb THEN
    restored_unlock_source := NULLIF(existing_case.previous_growth_contract ->> 'unlock_source', '');

    UPDATE public.user_growth_capabilities
    SET
      trust_tier = COALESCE(existing_case.previous_growth_contract ->> 'trust_tier', trust_tier),
      can_create_server = COALESCE((existing_case.previous_growth_contract ->> 'can_create_server')::boolean, can_create_server),
      can_start_high_volume_calls = COALESCE((existing_case.previous_growth_contract ->> 'can_start_high_volume_calls')::boolean, can_start_high_volume_calls),
      can_use_marketplace = COALESCE((existing_case.previous_growth_contract ->> 'can_use_marketplace')::boolean, can_use_marketplace),
      unlock_source = COALESCE(restored_unlock_source, 'admin_approved'),
      updated_at = now()
    WHERE user_id = p_user_id;

    INSERT INTO public.growth_events (
      user_id,
      event_name,
      event_source,
      source_channel,
      payload
    )
    VALUES (
      p_user_id,
      'security_containment_released',
      'server',
      'security',
      jsonb_build_object(
        'review_status', normalized_review_status,
        'reviewed_by', actor_id
      )
    );
  END IF;

  UPDATE public.account_security_risk_cases
  SET
    review_status = normalized_review_status,
    review_note = CASE
      WHEN p_review_note IS NULL THEN review_note
      ELSE NULLIF(trim(p_review_note), '')
    END,
    reviewed_by = actor_id,
    reviewed_at = now(),
    containment_state = CASE
      WHEN coalesce(p_release_containment, false) THEN 'none'
      ELSE containment_state
    END,
    auto_contained = CASE
      WHEN coalesce(p_release_containment, false) THEN false
      ELSE auto_contained
    END,
    previous_growth_contract = CASE
      WHEN coalesce(p_release_containment, false) THEN NULL
      ELSE previous_growth_contract
    END,
    updated_at = now()
  WHERE user_id = p_user_id;

  RETURN (
    SELECT jsonb_build_object(
      'user_id', c.user_id,
      'risk_level', c.risk_level,
      'risk_score', c.risk_score,
      'containment_state', c.containment_state,
      'auto_contained', c.auto_contained,
      'review_status', c.review_status,
      'reviewed_at', c.reviewed_at,
      'review_note', c.review_note
    )
    FROM public.account_security_risk_cases c
    WHERE c.user_id = p_user_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_refresh_account_security_risk(
  p_user_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
  refreshed_count integer := 0;
  risk_user record;
BEGIN
  IF actor_id IS NULL OR NOT public.is_platform_admin(actor_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_user_id IS NOT NULL THEN
    PERFORM public.refresh_account_security_risk_case(p_user_id, 'admin_refresh', now());
    RETURN 1;
  END IF;

  FOR risk_user IN
    SELECT user_id
    FROM (
      SELECT s.user_id, MAX(s.created_at) AS last_signal_at
      FROM public.account_security_risk_signals s
      GROUP BY s.user_id
      ORDER BY MAX(s.created_at) DESC
      LIMIT GREATEST(coalesce(p_limit, 100), 1)
    ) ranked
  LOOP
    PERFORM public.refresh_account_security_risk_case(risk_user.user_id, 'admin_refresh', now());
    refreshed_count := refreshed_count + 1;
  END LOOP;

  RETURN refreshed_count;
END;
$$;

-- Keep admin overrides aware of the new security containment source.
CREATE OR REPLACE FUNCTION public.admin_set_user_growth_capabilities(
  p_user_id uuid,
  p_trust_tier text,
  p_can_create_server boolean,
  p_can_start_high_volume_calls boolean,
  p_can_use_marketplace boolean,
  p_unlock_source text DEFAULT 'admin_approved'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
BEGIN
  IF actor_id IS NULL OR NOT public.is_platform_admin(actor_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  PERFORM public.ensure_user_growth_capabilities_row(p_user_id);

  UPDATE public.user_growth_capabilities
  SET
    trust_tier = CASE
      WHEN lower(coalesce(p_trust_tier, '')) IN ('limited', 'member', 'trusted', 'operator')
        THEN lower(p_trust_tier)
      ELSE trust_tier
    END,
    can_create_server = COALESCE(p_can_create_server, can_create_server),
    can_start_high_volume_calls = COALESCE(p_can_start_high_volume_calls, can_start_high_volume_calls),
    can_use_marketplace = COALESCE(p_can_use_marketplace, can_use_marketplace),
    unlock_source = CASE
      WHEN lower(coalesce(p_unlock_source, '')) IN (
        'default_limited',
        'trusted_invite',
        'admin_approved',
        'trust_promotion',
        'legacy_admin_seed',
        'manual_override',
        'security_contained'
      )
        THEN lower(p_unlock_source)
      ELSE unlock_source
    END
  WHERE user_id = p_user_id;

  RETURN public.get_user_growth_capabilities(p_user_id);
END;
$$;

-- ------------------------------------------------------------------
-- RLS + grants
-- ------------------------------------------------------------------
ALTER TABLE public.account_security_risk_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_security_risk_cases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view account security risk signals" ON public.account_security_risk_signals;
CREATE POLICY "Admins can view account security risk signals"
  ON public.account_security_risk_signals FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can manage account security risk signals" ON public.account_security_risk_signals;
CREATE POLICY "Admins can manage account security risk signals"
  ON public.account_security_risk_signals FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can view account security risk cases" ON public.account_security_risk_cases;
CREATE POLICY "Admins can view account security risk cases"
  ON public.account_security_risk_cases FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can manage account security risk cases" ON public.account_security_risk_cases;
CREATE POLICY "Admins can manage account security risk cases"
  ON public.account_security_risk_cases FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

GRANT EXECUTE ON FUNCTION public.admin_review_account_security_risk(uuid, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_refresh_account_security_risk(uuid, integer) TO authenticated;
