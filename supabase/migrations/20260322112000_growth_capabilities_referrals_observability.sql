/*
  # Growth Capabilities + Referral Unlocks + Operator Metrics

  Adds:
  - user capability gating contract (trust tier + unlock source)
  - global referral/invite unlock flow with anti-abuse guards
  - growth event telemetry contract for funnel tracking
  - operator daily metrics (by date + source channel)
  - API-level enforcement triggers on gated actions
*/

-- ------------------------------------------------------------------
-- Capability model
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_growth_capabilities (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  trust_tier text NOT NULL DEFAULT 'limited'
    CHECK (trust_tier IN ('limited', 'member', 'trusted', 'operator')),
  can_create_server boolean NOT NULL DEFAULT false,
  can_start_high_volume_calls boolean NOT NULL DEFAULT false,
  can_use_marketplace boolean NOT NULL DEFAULT false,
  unlock_source text NOT NULL DEFAULT 'default_limited'
    CHECK (
      unlock_source IN (
        'default_limited',
        'trusted_invite',
        'admin_approved',
        'trust_promotion',
        'legacy_admin_seed',
        'manual_override'
      )
    ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_growth_capabilities_trust_tier
  ON public.user_growth_capabilities(trust_tier);

DROP TRIGGER IF EXISTS user_growth_capabilities_set_updated_at ON public.user_growth_capabilities;
CREATE TRIGGER user_growth_capabilities_set_updated_at
BEFORE UPDATE ON public.user_growth_capabilities
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE FUNCTION public.growth_trust_tier_rank(p_tier text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(coalesce(p_tier, 'limited'))
    WHEN 'operator' THEN 4
    WHEN 'trusted' THEN 3
    WHEN 'member' THEN 2
    ELSE 1
  END;
$$;

CREATE OR REPLACE FUNCTION public.growth_rank_to_trust_tier(p_rank integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN coalesce(p_rank, 1) >= 4 THEN 'operator'
    WHEN coalesce(p_rank, 1) = 3 THEN 'trusted'
    WHEN coalesce(p_rank, 1) = 2 THEN 'member'
    ELSE 'limited'
  END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_user_growth_capabilities_row(p_user_id uuid)
RETURNS public.user_growth_capabilities
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  role_value text;
  seeded public.user_growth_capabilities%ROWTYPE;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'User id is required';
  END IF;

  SELECT p.platform_role
  INTO role_value
  FROM public.profiles p
  WHERE p.id = p_user_id;

  IF role_value IS NULL THEN
    RAISE EXCEPTION 'Profile not found for user id %', p_user_id;
  END IF;

  INSERT INTO public.user_growth_capabilities (
    user_id,
    trust_tier,
    can_create_server,
    can_start_high_volume_calls,
    can_use_marketplace,
    unlock_source
  )
  VALUES (
    p_user_id,
    CASE
      WHEN role_value IN ('owner', 'admin') THEN 'operator'
      ELSE 'limited'
    END,
    CASE WHEN role_value IN ('owner', 'admin') THEN true ELSE false END,
    CASE WHEN role_value IN ('owner', 'admin') THEN true ELSE false END,
    CASE WHEN role_value IN ('owner', 'admin') THEN true ELSE false END,
    CASE
      WHEN role_value IN ('owner', 'admin') THEN 'legacy_admin_seed'
      ELSE 'default_limited'
    END
  )
  ON CONFLICT (user_id) DO NOTHING;

  SELECT ugc.*
  INTO seeded
  FROM public.user_growth_capabilities ugc
  WHERE ugc.user_id = p_user_id;

  RETURN seeded;
END;
$$;

CREATE OR REPLACE FUNCTION public.user_has_growth_capability(p_user_id uuid, p_capability text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  role_value text;
  capabilities_row public.user_growth_capabilities%ROWTYPE;
  capability text := lower(coalesce(p_capability, ''));
BEGIN
  IF p_user_id IS NULL OR capability = '' THEN
    RETURN false;
  END IF;

  SELECT p.platform_role
  INTO role_value
  FROM public.profiles p
  WHERE p.id = p_user_id;

  IF role_value IN ('owner', 'admin') THEN
    RETURN true;
  END IF;

  SELECT ugc.*
  INTO capabilities_row
  FROM public.user_growth_capabilities ugc
  WHERE ugc.user_id = p_user_id;

  IF capabilities_row.user_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN CASE capability
    WHEN 'can_create_server' THEN capabilities_row.can_create_server
    WHEN 'can_start_high_volume_calls' THEN capabilities_row.can_start_high_volume_calls
    WHEN 'can_use_marketplace' THEN capabilities_row.can_use_marketplace
    ELSE false
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_user_growth_capabilities(p_user_id uuid DEFAULT auth.uid())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
  target_user_id uuid := COALESCE(p_user_id, actor_id);
  row_data public.user_growth_capabilities%ROWTYPE;
BEGIN
  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF actor_id IS NOT NULL
     AND target_user_id <> actor_id
     AND NOT public.is_platform_admin(actor_id) THEN
    RAISE EXCEPTION 'Not authorized to inspect another user capability contract';
  END IF;

  SELECT *
  INTO row_data
  FROM public.ensure_user_growth_capabilities_row(target_user_id);

  RETURN jsonb_build_object(
    'trust_tier', row_data.trust_tier,
    'capabilities', jsonb_build_object(
      'can_create_server', row_data.can_create_server,
      'can_start_high_volume_calls', row_data.can_start_high_volume_calls,
      'can_use_marketplace', row_data.can_use_marketplace
    ),
    'unlock_source', row_data.unlock_source,
    'updated_at', row_data.updated_at
  );
END;
$$;

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
        'manual_override'
      )
        THEN lower(p_unlock_source)
      ELSE unlock_source
    END
  WHERE user_id = p_user_id;

  RETURN public.get_user_growth_capabilities(p_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_growth_capabilities_profile_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.ensure_user_growth_capabilities_row(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS growth_capabilities_profile_insert_trigger ON public.profiles;
CREATE TRIGGER growth_capabilities_profile_insert_trigger
AFTER INSERT ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.handle_growth_capabilities_profile_insert();

INSERT INTO public.user_growth_capabilities (
  user_id,
  trust_tier,
  can_create_server,
  can_start_high_volume_calls,
  can_use_marketplace,
  unlock_source
)
SELECT
  p.id AS user_id,
  CASE
    WHEN p.platform_role IN ('owner', 'admin') THEN 'operator'
    ELSE 'limited'
  END AS trust_tier,
  CASE WHEN p.platform_role IN ('owner', 'admin') THEN true ELSE false END AS can_create_server,
  CASE WHEN p.platform_role IN ('owner', 'admin') THEN true ELSE false END AS can_start_high_volume_calls,
  CASE WHEN p.platform_role IN ('owner', 'admin') THEN true ELSE false END AS can_use_marketplace,
  CASE
    WHEN p.platform_role IN ('owner', 'admin') THEN 'legacy_admin_seed'
    ELSE 'default_limited'
  END AS unlock_source
FROM public.profiles p
ON CONFLICT (user_id) DO NOTHING;

-- ------------------------------------------------------------------
-- Referral unlock model
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.growth_invite_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inviter_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  source_channel text NOT NULL DEFAULT 'organic',
  grant_trust_tier text NOT NULL DEFAULT 'member'
    CHECK (grant_trust_tier IN ('limited', 'member', 'trusted', 'operator')),
  grant_can_create_server boolean NOT NULL DEFAULT true,
  grant_can_start_high_volume_calls boolean NOT NULL DEFAULT false,
  grant_can_use_marketplace boolean NOT NULL DEFAULT true,
  max_uses integer NOT NULL DEFAULT 50 CHECK (max_uses > 0),
  use_count integer NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_growth_invite_codes_inviter
  ON public.growth_invite_codes(inviter_user_id, created_at DESC);

DROP TRIGGER IF EXISTS growth_invite_codes_set_updated_at ON public.growth_invite_codes;
CREATE TRIGGER growth_invite_codes_set_updated_at
BEFORE UPDATE ON public.growth_invite_codes
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();

CREATE TABLE IF NOT EXISTS public.growth_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_id uuid NOT NULL REFERENCES public.growth_invite_codes(id) ON DELETE CASCADE,
  inviter_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  invitee_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  source_channel text NOT NULL DEFAULT 'organic',
  activation_criteria jsonb NOT NULL DEFAULT jsonb_build_object(
    'requiresAnyOf',
    jsonb_build_array('create_server', 'start_call', 'paid_checkout')
  ),
  activated_at timestamptz,
  activation_event text,
  reward_eligible boolean NOT NULL DEFAULT false,
  reward_granted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (invitee_user_id),
  UNIQUE (code_id, invitee_user_id),
  CHECK (inviter_user_id <> invitee_user_id)
);

CREATE INDEX IF NOT EXISTS idx_growth_referrals_inviter
  ON public.growth_referrals(inviter_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_growth_referrals_invitee
  ON public.growth_referrals(invitee_user_id, created_at DESC);

DROP TRIGGER IF EXISTS growth_referrals_set_updated_at ON public.growth_referrals;
CREATE TRIGGER growth_referrals_set_updated_at
BEFORE UPDATE ON public.growth_referrals
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE FUNCTION public.create_growth_invite_code(
  p_code text DEFAULT NULL,
  p_max_uses integer DEFAULT 50,
  p_grant_trust_tier text DEFAULT 'member',
  p_grant_can_create_server boolean DEFAULT true,
  p_grant_can_start_high_volume_calls boolean DEFAULT false,
  p_grant_can_use_marketplace boolean DEFAULT true,
  p_source_channel text DEFAULT 'organic'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
  normalized_code text;
  attempt int := 0;
  inserted public.growth_invite_codes%ROWTYPE;
  normalized_tier text := lower(coalesce(p_grant_trust_tier, 'member'));
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF normalized_tier NOT IN ('limited', 'member', 'trusted', 'operator') THEN
    normalized_tier := 'member';
  END IF;

  normalized_code := lower(regexp_replace(coalesce(p_code, ''), '[^a-zA-Z0-9_-]', '', 'g'));

  IF normalized_code = '' THEN
    LOOP
      normalized_code := lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
      EXIT WHEN NOT EXISTS (
        SELECT 1
        FROM public.growth_invite_codes gic
        WHERE gic.code = normalized_code
      );
      attempt := attempt + 1;
      IF attempt > 5 THEN
        RAISE EXCEPTION 'Could not generate unique invite code';
      END IF;
    END LOOP;
  END IF;

  INSERT INTO public.growth_invite_codes (
    inviter_user_id,
    code,
    source_channel,
    grant_trust_tier,
    grant_can_create_server,
    grant_can_start_high_volume_calls,
    grant_can_use_marketplace,
    max_uses
  )
  VALUES (
    actor_id,
    normalized_code,
    lower(coalesce(nullif(trim(p_source_channel), ''), 'organic')),
    normalized_tier,
    coalesce(p_grant_can_create_server, true),
    coalesce(p_grant_can_start_high_volume_calls, false),
    coalesce(p_grant_can_use_marketplace, true),
    greatest(coalesce(p_max_uses, 50), 1)
  )
  RETURNING *
  INTO inserted;

  RETURN jsonb_build_object(
    'id', inserted.id,
    'code', inserted.code,
    'max_uses', inserted.max_uses,
    'use_count', inserted.use_count,
    'source_channel', inserted.source_channel,
    'grant_trust_tier', inserted.grant_trust_tier,
    'grants', jsonb_build_object(
      'can_create_server', inserted.grant_can_create_server,
      'can_start_high_volume_calls', inserted.grant_can_start_high_volume_calls,
      'can_use_marketplace', inserted.grant_can_use_marketplace
    ),
    'active', inserted.active
  );
END;
$$;

CREATE TABLE IF NOT EXISTS public.growth_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  event_name text NOT NULL,
  event_version integer NOT NULL DEFAULT 1,
  event_source text NOT NULL DEFAULT 'app',
  source_channel text NOT NULL DEFAULT 'organic',
  session_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_growth_events_user_created
  ON public.growth_events(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_growth_events_name_created
  ON public.growth_events(event_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_growth_events_source_created
  ON public.growth_events(source_channel, created_at DESC);

CREATE OR REPLACE FUNCTION public.redeem_growth_invite_code(
  p_code text,
  p_source_channel text DEFAULT 'organic'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
  invite_row public.growth_invite_codes%ROWTYPE;
  existing_referral public.growth_referrals%ROWTYPE;
  current_caps public.user_growth_capabilities%ROWTYPE;
  next_trust_rank integer;
  next_trust_tier text;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF coalesce(trim(p_code), '') = '' THEN
    RAISE EXCEPTION 'Invite code is required';
  END IF;

  SELECT *
  INTO invite_row
  FROM public.growth_invite_codes gic
  WHERE lower(gic.code) = lower(trim(p_code))
    AND gic.active = true
  FOR UPDATE;

  IF invite_row.id IS NULL THEN
    RAISE EXCEPTION 'Invite code is invalid or inactive';
  END IF;

  IF invite_row.inviter_user_id = actor_id THEN
    RAISE EXCEPTION 'Self-referral is not allowed';
  END IF;

  IF invite_row.use_count >= invite_row.max_uses THEN
    RAISE EXCEPTION 'Invite code has reached its usage limit';
  END IF;

  SELECT *
  INTO existing_referral
  FROM public.growth_referrals gr
  WHERE gr.invitee_user_id = actor_id
  LIMIT 1;

  IF existing_referral.id IS NOT NULL THEN
    RAISE EXCEPTION 'This account already redeemed a referral code';
  END IF;

  INSERT INTO public.growth_referrals (
    code_id,
    inviter_user_id,
    invitee_user_id,
    source_channel
  )
  VALUES (
    invite_row.id,
    invite_row.inviter_user_id,
    actor_id,
    lower(coalesce(nullif(trim(p_source_channel), ''), invite_row.source_channel, 'organic'))
  );

  UPDATE public.growth_invite_codes
  SET use_count = use_count + 1
  WHERE id = invite_row.id;

  SELECT *
  INTO current_caps
  FROM public.ensure_user_growth_capabilities_row(actor_id);

  next_trust_rank := GREATEST(
    public.growth_trust_tier_rank(current_caps.trust_tier),
    public.growth_trust_tier_rank(invite_row.grant_trust_tier)
  );
  next_trust_tier := public.growth_rank_to_trust_tier(next_trust_rank);

  UPDATE public.user_growth_capabilities
  SET
    trust_tier = next_trust_tier,
    can_create_server = current_caps.can_create_server OR invite_row.grant_can_create_server,
    can_start_high_volume_calls = current_caps.can_start_high_volume_calls OR invite_row.grant_can_start_high_volume_calls,
    can_use_marketplace = current_caps.can_use_marketplace OR invite_row.grant_can_use_marketplace,
    unlock_source = 'trusted_invite'
  WHERE user_id = actor_id;

  INSERT INTO public.growth_events (
    user_id,
    event_name,
    event_source,
    source_channel,
    payload
  )
  VALUES (
    actor_id,
    'referral_redeemed',
    'rpc',
    lower(coalesce(nullif(trim(p_source_channel), ''), invite_row.source_channel, 'organic')),
    jsonb_build_object(
      'code', invite_row.code,
      'inviter_user_id', invite_row.inviter_user_id
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'inviter_user_id', invite_row.inviter_user_id,
    'capability_contract', public.get_user_growth_capabilities(actor_id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_growth_referral_activation(
  p_event_name text DEFAULT 'activation_check'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
  referral_row public.growth_referrals%ROWTYPE;
  has_server boolean := false;
  has_call boolean := false;
  has_paid_checkout boolean := false;
  criteria_met boolean := false;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT *
  INTO referral_row
  FROM public.growth_referrals gr
  WHERE gr.invitee_user_id = actor_id
  ORDER BY gr.created_at DESC
  LIMIT 1;

  IF referral_row.id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'has_referral', false,
      'criteria_met', false
    );
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.communities c
    WHERE c.owner_id = actor_id
  ) INTO has_server;

  SELECT EXISTS (
    SELECT 1
    FROM public.calls call_row
    WHERE call_row.caller_id = actor_id
  ) INTO has_call;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_purchases up
    WHERE up.user_id = actor_id
      AND up.status = 'paid'
  ) INTO has_paid_checkout;

  criteria_met := has_server OR has_call OR has_paid_checkout;

  IF criteria_met THEN
    UPDATE public.growth_referrals
    SET
      activated_at = COALESCE(activated_at, now()),
      activation_event = COALESCE(activation_event, p_event_name),
      reward_eligible = true
    WHERE id = referral_row.id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'has_referral', true,
    'criteria_met', criteria_met,
    'activated_at', CASE WHEN criteria_met THEN now() ELSE referral_row.activated_at END,
    'signals', jsonb_build_object(
      'created_server', has_server,
      'started_call', has_call,
      'paid_checkout', has_paid_checkout
    )
  );
END;
$$;

-- ------------------------------------------------------------------
-- Growth telemetry + operator daily metrics
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.operator_daily_metrics (
  metric_date date NOT NULL,
  source_channel text NOT NULL DEFAULT 'organic',
  checkout_started_count integer NOT NULL DEFAULT 0,
  checkout_paid_count integer NOT NULL DEFAULT 0,
  checkout_failed_count integer NOT NULL DEFAULT 0,
  boost_mrr_cents bigint NOT NULL DEFAULT 0,
  marketplace_gmv_cents bigint NOT NULL DEFAULT 0,
  marketplace_fee_cents bigint NOT NULL DEFAULT 0,
  call_attempts_count integer NOT NULL DEFAULT 0,
  call_connected_count integer NOT NULL DEFAULT 0,
  call_drop_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (metric_date, source_channel)
);

CREATE OR REPLACE FUNCTION public.upsert_operator_daily_metrics(
  p_metric_date date DEFAULT (now() AT TIME ZONE 'utc')::date,
  p_source_channel text DEFAULT 'organic',
  p_delta_checkout_started integer DEFAULT 0,
  p_delta_checkout_paid integer DEFAULT 0,
  p_delta_checkout_failed integer DEFAULT 0,
  p_delta_boost_mrr_cents bigint DEFAULT 0,
  p_delta_marketplace_gmv_cents bigint DEFAULT 0,
  p_delta_marketplace_fee_cents bigint DEFAULT 0,
  p_delta_call_attempts integer DEFAULT 0,
  p_delta_call_connected integer DEFAULT 0,
  p_delta_call_drops integer DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
  metric_day date := COALESCE(p_metric_date, (now() AT TIME ZONE 'utc')::date);
  channel_value text := lower(coalesce(nullif(trim(p_source_channel), ''), 'organic'));
BEGIN
  IF actor_id IS NOT NULL AND NOT public.is_platform_admin(actor_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  INSERT INTO public.operator_daily_metrics (
    metric_date,
    source_channel,
    checkout_started_count,
    checkout_paid_count,
    checkout_failed_count,
    boost_mrr_cents,
    marketplace_gmv_cents,
    marketplace_fee_cents,
    call_attempts_count,
    call_connected_count,
    call_drop_count,
    updated_at
  )
  VALUES (
    metric_day,
    channel_value,
    GREATEST(coalesce(p_delta_checkout_started, 0), 0),
    GREATEST(coalesce(p_delta_checkout_paid, 0), 0),
    GREATEST(coalesce(p_delta_checkout_failed, 0), 0),
    coalesce(p_delta_boost_mrr_cents, 0),
    coalesce(p_delta_marketplace_gmv_cents, 0),
    coalesce(p_delta_marketplace_fee_cents, 0),
    GREATEST(coalesce(p_delta_call_attempts, 0), 0),
    GREATEST(coalesce(p_delta_call_connected, 0), 0),
    GREATEST(coalesce(p_delta_call_drops, 0), 0),
    now()
  )
  ON CONFLICT (metric_date, source_channel) DO UPDATE
  SET
    checkout_started_count = public.operator_daily_metrics.checkout_started_count + EXCLUDED.checkout_started_count,
    checkout_paid_count = public.operator_daily_metrics.checkout_paid_count + EXCLUDED.checkout_paid_count,
    checkout_failed_count = public.operator_daily_metrics.checkout_failed_count + EXCLUDED.checkout_failed_count,
    boost_mrr_cents = public.operator_daily_metrics.boost_mrr_cents + EXCLUDED.boost_mrr_cents,
    marketplace_gmv_cents = public.operator_daily_metrics.marketplace_gmv_cents + EXCLUDED.marketplace_gmv_cents,
    marketplace_fee_cents = public.operator_daily_metrics.marketplace_fee_cents + EXCLUDED.marketplace_fee_cents,
    call_attempts_count = public.operator_daily_metrics.call_attempts_count + EXCLUDED.call_attempts_count,
    call_connected_count = public.operator_daily_metrics.call_connected_count + EXCLUDED.call_connected_count,
    call_drop_count = public.operator_daily_metrics.call_drop_count + EXCLUDED.call_drop_count,
    updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.track_growth_event(
  p_event_name text,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_source_channel text DEFAULT 'organic',
  p_session_id text DEFAULT NULL,
  p_event_source text DEFAULT 'app',
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
  effective_user_id uuid := COALESCE(p_user_id, actor_id);
  normalized_event text := lower(coalesce(nullif(trim(p_event_name), ''), 'unknown'));
  normalized_source text := lower(coalesce(nullif(trim(p_source_channel), ''), 'organic'));
  inserted_id uuid;
BEGIN
  IF actor_id IS NOT NULL
     AND effective_user_id IS NOT NULL
     AND actor_id <> effective_user_id
     AND NOT public.is_platform_admin(actor_id) THEN
    RAISE EXCEPTION 'Not authorized to track events for another user';
  END IF;

  INSERT INTO public.growth_events (
    user_id,
    event_name,
    event_source,
    source_channel,
    session_id,
    payload
  )
  VALUES (
    effective_user_id,
    normalized_event,
    lower(coalesce(nullif(trim(p_event_source), ''), 'app')),
    normalized_source,
    nullif(trim(coalesce(p_session_id, '')), ''),
    coalesce(p_payload, '{}'::jsonb)
  )
  RETURNING id
  INTO inserted_id;

  IF normalized_event IN ('boost_checkout_started', 'marketplace_checkout_started', 'checkout_started') THEN
    PERFORM public.upsert_operator_daily_metrics(
      p_source_channel => normalized_source,
      p_delta_checkout_started => 1
    );
  ELSIF normalized_event IN ('boost_checkout_failed', 'marketplace_checkout_failed', 'checkout_failed') THEN
    PERFORM public.upsert_operator_daily_metrics(
      p_source_channel => normalized_source,
      p_delta_checkout_failed => 1
    );
  ELSIF normalized_event IN ('call_start_attempted', 'call_connect_attempted') THEN
    PERFORM public.upsert_operator_daily_metrics(
      p_source_channel => normalized_source,
      p_delta_call_attempts => 1
    );
  ELSIF normalized_event IN ('call_connected', 'call_joined') THEN
    PERFORM public.upsert_operator_daily_metrics(
      p_source_channel => normalized_source,
      p_delta_call_connected => 1
    );
  ELSIF normalized_event IN ('call_dropped', 'call_connection_dropped') THEN
    PERFORM public.upsert_operator_daily_metrics(
      p_source_channel => normalized_source,
      p_delta_call_drops => 1
    );
  END IF;

  RETURN inserted_id;
END;
$$;

CREATE OR REPLACE VIEW public.operator_revenue_30d AS
SELECT
  source_channel,
  SUM(checkout_started_count) AS checkout_started_count,
  SUM(checkout_paid_count) AS checkout_paid_count,
  SUM(checkout_failed_count) AS checkout_failed_count,
  SUM(boost_mrr_cents) AS boost_mrr_cents,
  SUM(marketplace_gmv_cents) AS marketplace_gmv_cents,
  SUM(marketplace_fee_cents) AS marketplace_fee_cents,
  SUM(call_attempts_count) AS call_attempts_count,
  SUM(call_connected_count) AS call_connected_count,
  SUM(call_drop_count) AS call_drop_count,
  MAX(updated_at) AS last_updated_at
FROM public.operator_daily_metrics
WHERE metric_date >= ((now() AT TIME ZONE 'utc')::date - 29)
GROUP BY source_channel;

-- ------------------------------------------------------------------
-- API-level action gate enforcement
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_server_create_capability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_owner uuid := NEW.owner_id;
BEGIN
  IF target_owner IS NULL THEN
    RAISE EXCEPTION 'Community owner is required';
  END IF;

  IF NOT public.user_has_growth_capability(target_owner, 'can_create_server') THEN
    RAISE EXCEPTION 'Server creation is locked for this account. Unlock via trusted invite, admin approval, or trust-tier promotion.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS communities_enforce_server_create_capability ON public.communities;
CREATE TRIGGER communities_enforce_server_create_capability
BEFORE INSERT ON public.communities
FOR EACH ROW
EXECUTE FUNCTION public.enforce_server_create_capability();

CREATE OR REPLACE FUNCTION public.enforce_high_volume_call_capability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recipient_count integer := COALESCE(cardinality(NEW.callee_ids), 0);
BEGIN
  IF NEW.caller_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF lower(coalesce(NEW.state, 'ringing')) = 'ringing'
     AND recipient_count > 2
     AND NOT public.user_has_growth_capability(NEW.caller_id, 'can_start_high_volume_calls') THEN
    RAISE EXCEPTION 'High-volume call starts are locked for this account. Unlock required.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS calls_enforce_high_volume_capability ON public.calls;
CREATE TRIGGER calls_enforce_high_volume_capability
BEFORE INSERT ON public.calls
FOR EACH ROW
EXECUTE FUNCTION public.enforce_high_volume_call_capability();

CREATE OR REPLACE FUNCTION public.enforce_marketplace_capability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid;
BEGIN
  IF TG_TABLE_NAME IN ('marketplace_service_listings', 'marketplace_game_listings') THEN
    actor_id := NEW.seller_id;
  ELSIF TG_TABLE_NAME IN ('marketplace_service_orders', 'marketplace_game_orders') THEN
    actor_id := NEW.buyer_id;
  ELSE
    RETURN NEW;
  END IF;

  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Marketplace actor is required';
  END IF;

  IF NOT public.user_has_growth_capability(actor_id, 'can_use_marketplace') THEN
    RAISE EXCEPTION 'Marketplace checkout/publishing is locked for this account pending trust unlock.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS marketplace_service_listings_enforce_capability ON public.marketplace_service_listings;
CREATE TRIGGER marketplace_service_listings_enforce_capability
BEFORE INSERT ON public.marketplace_service_listings
FOR EACH ROW
EXECUTE FUNCTION public.enforce_marketplace_capability();

DROP TRIGGER IF EXISTS marketplace_game_listings_enforce_capability ON public.marketplace_game_listings;
CREATE TRIGGER marketplace_game_listings_enforce_capability
BEFORE INSERT ON public.marketplace_game_listings
FOR EACH ROW
EXECUTE FUNCTION public.enforce_marketplace_capability();

DROP TRIGGER IF EXISTS marketplace_service_orders_enforce_capability ON public.marketplace_service_orders;
CREATE TRIGGER marketplace_service_orders_enforce_capability
BEFORE INSERT ON public.marketplace_service_orders
FOR EACH ROW
EXECUTE FUNCTION public.enforce_marketplace_capability();

DROP TRIGGER IF EXISTS marketplace_game_orders_enforce_capability ON public.marketplace_game_orders;
CREATE TRIGGER marketplace_game_orders_enforce_capability
BEFORE INSERT ON public.marketplace_game_orders
FOR EACH ROW
EXECUTE FUNCTION public.enforce_marketplace_capability();

-- ------------------------------------------------------------------
-- RLS + grants
-- ------------------------------------------------------------------
ALTER TABLE public.user_growth_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.growth_invite_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.growth_referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.growth_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operator_daily_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own growth capabilities" ON public.user_growth_capabilities;
CREATE POLICY "Users can view own growth capabilities"
  ON public.user_growth_capabilities FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can manage growth capabilities" ON public.user_growth_capabilities;
CREATE POLICY "Admins can manage growth capabilities"
  ON public.user_growth_capabilities FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Users can view own invite codes" ON public.growth_invite_codes;
CREATE POLICY "Users can view own invite codes"
  ON public.growth_invite_codes FOR SELECT TO authenticated
  USING (inviter_user_id = auth.uid() OR public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Users can create own invite codes" ON public.growth_invite_codes;
CREATE POLICY "Users can create own invite codes"
  ON public.growth_invite_codes FOR INSERT TO authenticated
  WITH CHECK (inviter_user_id = auth.uid() OR public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Users can update own invite codes" ON public.growth_invite_codes;
CREATE POLICY "Users can update own invite codes"
  ON public.growth_invite_codes FOR UPDATE TO authenticated
  USING (inviter_user_id = auth.uid() OR public.is_platform_admin(auth.uid()))
  WITH CHECK (inviter_user_id = auth.uid() OR public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Users can view related referrals" ON public.growth_referrals;
CREATE POLICY "Users can view related referrals"
  ON public.growth_referrals FOR SELECT TO authenticated
  USING (
    inviter_user_id = auth.uid()
    OR invitee_user_id = auth.uid()
    OR public.is_platform_admin(auth.uid())
  );

DROP POLICY IF EXISTS "Users can view own growth events" ON public.growth_events;
CREATE POLICY "Users can view own growth events"
  ON public.growth_events FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Users can insert own growth events" ON public.growth_events;
CREATE POLICY "Users can insert own growth events"
  ON public.growth_events FOR INSERT TO authenticated
  WITH CHECK (user_id IS NULL OR user_id = auth.uid() OR public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can view operator daily metrics" ON public.operator_daily_metrics;
CREATE POLICY "Admins can view operator daily metrics"
  ON public.operator_daily_metrics FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()));

GRANT EXECUTE ON FUNCTION public.get_user_growth_capabilities(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.track_growth_event(text, jsonb, text, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_growth_invite_code(text, integer, text, boolean, boolean, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_growth_invite_code(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_growth_referral_activation(text) TO authenticated;
