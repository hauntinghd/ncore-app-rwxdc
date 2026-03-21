/*
  # Billing, Entitlements, and Progression Unlocks

  Adds:
  - Stripe billing tables
  - Store catalog and purchases
  - Entitlement materialization
  - Progression unlock tiers
  - RPCs: get_progression_level, get_effective_entitlements
*/

-- ------------------------------------------------------------------
-- Billing + store schema
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.billing_customers (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  stripe_customer_id text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.billing_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  plan_code text NOT NULL,
  status text NOT NULL,
  current_period_end timestamptz,
  stripe_subscription_id text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS billing_subscriptions_user_id_idx
  ON public.billing_subscriptions(user_id, status, current_period_end DESC);

CREATE TABLE IF NOT EXISTS public.store_products (
  sku text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  kind text NOT NULL,
  price_cents integer NOT NULL CHECK (price_cents > 0),
  currency text NOT NULL DEFAULT 'usd' CHECK (char_length(currency) = 3),
  active boolean NOT NULL DEFAULT true,
  grant_key text NOT NULL,
  grant_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  sku text NOT NULL REFERENCES public.store_products(sku) ON DELETE RESTRICT,
  stripe_payment_intent_id text,
  stripe_checkout_session_id text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, sku)
);

CREATE UNIQUE INDEX IF NOT EXISTS user_purchases_payment_intent_idx
  ON public.user_purchases(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS user_purchases_checkout_session_idx
  ON public.user_purchases(stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.user_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  entitlement_key text NOT NULL,
  entitlement_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text NOT NULL DEFAULT 'computed',
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, entitlement_key, source)
);

CREATE INDEX IF NOT EXISTS user_entitlements_user_key_idx
  ON public.user_entitlements(user_id, entitlement_key);

CREATE TABLE IF NOT EXISTS public.xp_unlock_tiers (
  tier integer PRIMARY KEY,
  required_level integer NOT NULL UNIQUE CHECK (required_level >= 1),
  unlock_key text NOT NULL,
  unlock_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.billing_webhook_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------
-- Updated-at triggers
-- ------------------------------------------------------------------
DROP TRIGGER IF EXISTS billing_customers_set_updated_at ON public.billing_customers;
CREATE TRIGGER billing_customers_set_updated_at
BEFORE UPDATE ON public.billing_customers
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS billing_subscriptions_set_updated_at ON public.billing_subscriptions;
CREATE TRIGGER billing_subscriptions_set_updated_at
BEFORE UPDATE ON public.billing_subscriptions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS store_products_set_updated_at ON public.store_products;
CREATE TRIGGER store_products_set_updated_at
BEFORE UPDATE ON public.store_products
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS user_purchases_set_updated_at ON public.user_purchases;
CREATE TRIGGER user_purchases_set_updated_at
BEFORE UPDATE ON public.user_purchases
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS user_entitlements_set_updated_at ON public.user_entitlements;
CREATE TRIGGER user_entitlements_set_updated_at
BEFORE UPDATE ON public.user_entitlements
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS xp_unlock_tiers_set_updated_at ON public.xp_unlock_tiers;
CREATE TRIGGER xp_unlock_tiers_set_updated_at
BEFORE UPDATE ON public.xp_unlock_tiers
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();

-- ------------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------------
ALTER TABLE public.billing_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.xp_unlock_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own billing customer" ON public.billing_customers;
CREATE POLICY "Users can view own billing customer"
  ON public.billing_customers FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Users can insert own billing customer" ON public.billing_customers;
CREATE POLICY "Users can insert own billing customer"
  ON public.billing_customers FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Users can update own billing customer" ON public.billing_customers;
CREATE POLICY "Users can update own billing customer"
  ON public.billing_customers FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.is_platform_admin(auth.uid()))
  WITH CHECK (user_id = auth.uid() OR public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Users can view own subscriptions" ON public.billing_subscriptions;
CREATE POLICY "Users can view own subscriptions"
  ON public.billing_subscriptions FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Users can view store products" ON public.store_products;
CREATE POLICY "Users can view store products"
  ON public.store_products FOR SELECT TO authenticated, anon
  USING (active = true OR public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Users can view own purchases" ON public.user_purchases;
CREATE POLICY "Users can view own purchases"
  ON public.user_purchases FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Users can view own entitlements" ON public.user_entitlements;
CREATE POLICY "Users can view own entitlements"
  ON public.user_entitlements FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Users can view unlock tiers" ON public.xp_unlock_tiers;
CREATE POLICY "Users can view unlock tiers"
  ON public.xp_unlock_tiers FOR SELECT TO authenticated, anon
  USING (active = true OR public.is_platform_admin(auth.uid()));

-- Intentionally no authenticated policies on billing_webhook_events.
-- Webhook processing should only happen with service role key.

-- ------------------------------------------------------------------
-- Seed product catalog + unlock tiers
-- ------------------------------------------------------------------
INSERT INTO public.store_products (sku, name, description, kind, price_cents, currency, active, grant_key, grant_payload)
VALUES
  (
    'profile_flair_pack',
    'Profile Flair Pack',
    'Unlocks premium profile flair accents.',
    'cosmetic_pack',
    199,
    'usd',
    true,
    'cosmetic.profile_flair_pack',
    '{"owned": true, "sku": "profile_flair_pack"}'::jsonb
  ),
  (
    'avatar_frame_pack',
    'Avatar Frame Pack',
    'Unlocks premium avatar frames.',
    'cosmetic_pack',
    299,
    'usd',
    true,
    'cosmetic.avatar_frame_pack',
    '{"owned": true, "sku": "avatar_frame_pack"}'::jsonb
  ),
  (
    'nameplate_color_pack',
    'Nameplate Color Pack',
    'Unlocks premium display name color themes.',
    'cosmetic_pack',
    199,
    'usd',
    true,
    'cosmetic.nameplate_color_pack',
    '{"owned": true, "sku": "nameplate_color_pack"}'::jsonb
  ),
  (
    'supporter_badge_pack',
    'Supporter Badge Pack',
    'Unlocks the NCore supporter profile badge.',
    'cosmetic_pack',
    299,
    'usd',
    true,
    'cosmetic.supporter_badge_pack',
    '{"owned": true, "sku": "supporter_badge_pack"}'::jsonb
  )
ON CONFLICT (sku) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  kind = EXCLUDED.kind,
  price_cents = EXCLUDED.price_cents,
  currency = EXCLUDED.currency,
  active = EXCLUDED.active,
  grant_key = EXCLUDED.grant_key,
  grant_payload = EXCLUDED.grant_payload,
  updated_at = now();

INSERT INTO public.xp_unlock_tiers (tier, required_level, unlock_key, unlock_payload, active)
VALUES
  (1, 5, 'status_presets_enabled', '{"value": true}'::jsonb, true),
  (2, 10, 'message_length_multiplier', '{"multiplier": 1.1}'::jsonb, true),
  (3, 20, 'upload_bytes_multiplier', '{"multiplier": 1.1}'::jsonb, true),
  (4, 35, 'screen_share_max_quality', '{"max_quality": "1080p120"}'::jsonb, true),
  (5, 50, 'group_dm_member_bonus', '{"bonus": 5}'::jsonb, true),
  (6, 70, 'ncore_labs_enabled', '{"value": true}'::jsonb, true)
ON CONFLICT (tier) DO UPDATE
SET
  required_level = EXCLUDED.required_level,
  unlock_key = EXCLUDED.unlock_key,
  unlock_payload = EXCLUDED.unlock_payload,
  active = EXCLUDED.active,
  updated_at = now();

-- ------------------------------------------------------------------
-- RPC helpers
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.screen_share_quality_rank(p_quality text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(coalesce(p_quality, ''))
    WHEN '4k60' THEN 3
    WHEN '1080p120' THEN 2
    ELSE 1
  END;
$$;

CREATE OR REPLACE FUNCTION public.screen_share_quality_max(p_current text, p_candidate text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN public.screen_share_quality_rank(p_candidate) >= public.screen_share_quality_rank(p_current)
      THEN lower(coalesce(p_candidate, '720p30'))
    ELSE lower(coalesce(p_current, '720p30'))
  END;
$$;

CREATE OR REPLACE FUNCTION public.is_active_boost_subscription(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.billing_subscriptions bs
    WHERE bs.user_id = p_user_id
      AND bs.plan_code = 'boost_monthly'
      AND bs.status IN ('trialing', 'active', 'past_due')
      AND (bs.current_period_end IS NULL OR bs.current_period_end > now())
  );
$$;

CREATE OR REPLACE FUNCTION public.get_progression_level(p_user_id uuid DEFAULT auth.uid())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
  target_user_id uuid := COALESCE(p_user_id, actor_id);
  raw_xp integer := 0;
  effective_xp integer := 0;
  progression_level integer := 0;
  boost_active boolean := false;
  next_required_level integer;
  next_required_effective_xp integer;
  unlocked_tiers jsonb := '[]'::jsonb;
BEGIN
  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF actor_id IS NOT NULL
     AND target_user_id <> actor_id
     AND NOT public.is_platform_admin(actor_id) THEN
    RAISE EXCEPTION 'Not authorized to read progression for another user';
  END IF;

  SELECT COALESCE(p.xp, 0)
  INTO raw_xp
  FROM public.profiles p
  WHERE p.id = target_user_id;

  boost_active := public.is_active_boost_subscription(target_user_id);

  effective_xp := CASE
    WHEN boost_active THEN FLOOR(raw_xp::numeric / 1.35)::integer
    ELSE raw_xp
  END;

  progression_level := GREATEST(FLOOR(effective_xp::numeric / 100)::integer, 0);

  SELECT t.required_level
  INTO next_required_level
  FROM public.xp_unlock_tiers t
  WHERE t.active = true
    AND t.required_level > progression_level
  ORDER BY t.required_level
  LIMIT 1;

  next_required_effective_xp := CASE
    WHEN next_required_level IS NULL THEN NULL
    ELSE next_required_level * 100
  END;

  SELECT COALESCE(jsonb_agg(t.tier ORDER BY t.tier), '[]'::jsonb)
  INTO unlocked_tiers
  FROM public.xp_unlock_tiers t
  WHERE t.active = true
    AND t.required_level <= progression_level;

  RETURN jsonb_build_object(
    'rawXp', raw_xp,
    'effectiveXp', effective_xp,
    'level', progression_level,
    'isBoost', boost_active,
    'nextRequiredLevel', next_required_level,
    'nextRequiredEffectiveXp', next_required_effective_xp,
    'unlockedTiers', unlocked_tiers
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.recalculate_user_entitlements(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
  target_user_id uuid := p_user_id;
  boost_active boolean := false;
  plan_code text := 'free';
  progression jsonb := '{}'::jsonb;
  progression_level integer := 0;
  raw_xp integer := 0;
  effective_xp integer := 0;
  next_required_level integer;
  message_length_cap bigint := 20000;
  upload_bytes_cap bigint := 10737418240; -- 10 GB
  max_screen_share_quality text := '720p30';
  status_presets_enabled boolean := false;
  group_dm_member_bonus integer := 0;
  ncore_labs_enabled boolean := false;
  message_length_multiplier numeric := 1.0;
  upload_bytes_multiplier numeric := 1.0;
  tier_row record;
BEGIN
  IF target_user_id IS NULL THEN
    target_user_id := actor_id;
  END IF;

  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF actor_id IS NOT NULL
     AND target_user_id <> actor_id
     AND NOT public.is_platform_admin(actor_id) THEN
    RAISE EXCEPTION 'Not authorized to recalculate another user';
  END IF;

  SELECT COALESCE(p.xp, 0)
  INTO raw_xp
  FROM public.profiles p
  WHERE p.id = target_user_id;

  boost_active := public.is_active_boost_subscription(target_user_id);
  IF boost_active THEN
    plan_code := 'boost_monthly';
    message_length_cap := 100000;
    upload_bytes_cap := 53687091200; -- 50 GB
    max_screen_share_quality := '4k60';
  END IF;

  progression := public.get_progression_level(target_user_id);
  progression_level := COALESCE((progression ->> 'level')::integer, 0);
  effective_xp := COALESCE((progression ->> 'effectiveXp')::integer, 0);
  next_required_level := (progression ->> 'nextRequiredLevel')::integer;

  FOR tier_row IN
    SELECT t.unlock_key, t.unlock_payload
    FROM public.xp_unlock_tiers t
    WHERE t.active = true
      AND t.required_level <= progression_level
    ORDER BY t.required_level ASC
  LOOP
    CASE tier_row.unlock_key
      WHEN 'status_presets_enabled' THEN
        status_presets_enabled := COALESCE((tier_row.unlock_payload ->> 'value')::boolean, true);
      WHEN 'message_length_multiplier' THEN
        message_length_multiplier := GREATEST(
          message_length_multiplier,
          COALESCE((tier_row.unlock_payload ->> 'multiplier')::numeric, 1.0)
        );
      WHEN 'upload_bytes_multiplier' THEN
        upload_bytes_multiplier := GREATEST(
          upload_bytes_multiplier,
          COALESCE((tier_row.unlock_payload ->> 'multiplier')::numeric, 1.0)
        );
      WHEN 'screen_share_max_quality' THEN
        max_screen_share_quality := public.screen_share_quality_max(
          max_screen_share_quality,
          COALESCE(tier_row.unlock_payload ->> 'max_quality', '720p30')
        );
      WHEN 'group_dm_member_bonus' THEN
        group_dm_member_bonus := GREATEST(
          group_dm_member_bonus,
          COALESCE((tier_row.unlock_payload ->> 'bonus')::integer, 0)
        );
      WHEN 'ncore_labs_enabled' THEN
        ncore_labs_enabled := COALESCE((tier_row.unlock_payload ->> 'value')::boolean, true);
    END CASE;
  END LOOP;

  message_length_cap := GREATEST(1, FLOOR(message_length_cap::numeric * message_length_multiplier)::bigint);
  upload_bytes_cap := GREATEST(1, FLOOR(upload_bytes_cap::numeric * upload_bytes_multiplier)::bigint);

  DELETE FROM public.user_entitlements ue
  WHERE ue.user_id = target_user_id
    AND (
      ue.source = 'computed'
      OR ue.source LIKE 'purchase:%'
    );

  INSERT INTO public.user_entitlements (user_id, entitlement_key, entitlement_value, source, expires_at)
  VALUES
    (target_user_id, 'plan_code', jsonb_build_object('value', plan_code), 'computed', NULL),
    (target_user_id, 'is_boost', jsonb_build_object('value', boost_active), 'computed', NULL),
    (target_user_id, 'message_length_cap', jsonb_build_object('value', message_length_cap), 'computed', NULL),
    (target_user_id, 'upload_bytes_cap', jsonb_build_object('value', upload_bytes_cap), 'computed', NULL),
    (target_user_id, 'max_screen_share_quality', jsonb_build_object('value', lower(max_screen_share_quality)), 'computed', NULL),
    (target_user_id, 'status_presets_enabled', jsonb_build_object('value', status_presets_enabled), 'computed', NULL),
    (target_user_id, 'group_dm_member_bonus', jsonb_build_object('value', group_dm_member_bonus), 'computed', NULL),
    (target_user_id, 'ncore_labs_enabled', jsonb_build_object('value', ncore_labs_enabled), 'computed', NULL),
    (target_user_id, 'progression_level', jsonb_build_object('value', progression_level), 'computed', NULL),
    (target_user_id, 'effective_xp', jsonb_build_object('value', effective_xp), 'computed', NULL),
    (target_user_id, 'raw_xp', jsonb_build_object('value', raw_xp), 'computed', NULL)
  ON CONFLICT (user_id, entitlement_key, source) DO UPDATE
  SET
    entitlement_value = EXCLUDED.entitlement_value,
    expires_at = EXCLUDED.expires_at,
    updated_at = now();

  INSERT INTO public.user_entitlements (user_id, entitlement_key, entitlement_value, source, expires_at)
  SELECT
    up.user_id,
    sp.grant_key,
    COALESCE(sp.grant_payload, '{}'::jsonb),
    CONCAT('purchase:', up.sku),
    NULL
  FROM public.user_purchases up
  JOIN public.store_products sp
    ON sp.sku = up.sku
  WHERE up.user_id = target_user_id
    AND up.status = 'paid'
  ON CONFLICT (user_id, entitlement_key, source) DO UPDATE
  SET
    entitlement_value = EXCLUDED.entitlement_value,
    expires_at = EXCLUDED.expires_at,
    updated_at = now();

  RETURN jsonb_build_object(
    'planCode', plan_code,
    'isBoost', boost_active,
    'messageLengthCap', message_length_cap,
    'uploadBytesCap', upload_bytes_cap,
    'maxScreenShareQuality', lower(max_screen_share_quality),
    'statusPresetsEnabled', status_presets_enabled,
    'groupDmMemberBonus', group_dm_member_bonus,
    'ncoreLabsEnabled', ncore_labs_enabled,
    'progressionLevel', progression_level,
    'effectiveXp', effective_xp,
    'rawXp', raw_xp,
    'nextRequiredLevel', next_required_level
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_effective_entitlements(p_user_id uuid DEFAULT auth.uid())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
  target_user_id uuid := COALESCE(p_user_id, actor_id);
  computed_map jsonb := '{}'::jsonb;
  purchased_map jsonb := '{}'::jsonb;
  owned_skus jsonb := '[]'::jsonb;
  progression jsonb := '{}'::jsonb;
BEGIN
  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF actor_id IS NOT NULL
     AND target_user_id <> actor_id
     AND NOT public.is_platform_admin(actor_id) THEN
    RAISE EXCEPTION 'Not authorized to read another user''s entitlements';
  END IF;

  PERFORM public.recalculate_user_entitlements(target_user_id);

  SELECT COALESCE(jsonb_object_agg(ue.entitlement_key, ue.entitlement_value), '{}'::jsonb)
  INTO computed_map
  FROM public.user_entitlements ue
  WHERE ue.user_id = target_user_id
    AND ue.source = 'computed'
    AND (ue.expires_at IS NULL OR ue.expires_at > now());

  SELECT COALESCE(jsonb_object_agg(ue.entitlement_key, ue.entitlement_value), '{}'::jsonb)
  INTO purchased_map
  FROM public.user_entitlements ue
  WHERE ue.user_id = target_user_id
    AND ue.source LIKE 'purchase:%'
    AND (ue.expires_at IS NULL OR ue.expires_at > now());

  SELECT COALESCE(jsonb_agg(up.sku ORDER BY up.sku), '[]'::jsonb)
  INTO owned_skus
  FROM public.user_purchases up
  WHERE up.user_id = target_user_id
    AND up.status = 'paid';

  progression := public.get_progression_level(target_user_id);

  RETURN jsonb_build_object(
    'planCode', COALESCE(computed_map -> 'plan_code' ->> 'value', 'free'),
    'isBoost', COALESCE((computed_map -> 'is_boost' ->> 'value')::boolean, false),
    'messageLengthCap', COALESCE((computed_map -> 'message_length_cap' ->> 'value')::integer, 20000),
    'uploadBytesCap', COALESCE((computed_map -> 'upload_bytes_cap' ->> 'value')::bigint, 10737418240),
    'maxScreenShareQuality', COALESCE(computed_map -> 'max_screen_share_quality' ->> 'value', '720p30'),
    'statusPresetsEnabled', COALESCE((computed_map -> 'status_presets_enabled' ->> 'value')::boolean, false),
    'groupDmMemberBonus', COALESCE((computed_map -> 'group_dm_member_bonus' ->> 'value')::integer, 0),
    'ncoreLabsEnabled', COALESCE((computed_map -> 'ncore_labs_enabled' ->> 'value')::boolean, false),
    'ownedSkus', owned_skus,
    'progression', progression,
    'purchaseEntitlements', purchased_map
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_progression_level(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_effective_entitlements(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_user_entitlements(uuid) TO authenticated;

GRANT SELECT ON public.store_products TO authenticated, anon;
GRANT SELECT ON public.xp_unlock_tiers TO authenticated, anon;

-- ------------------------------------------------------------------
-- Backfill current users
-- ------------------------------------------------------------------
DO $$
DECLARE
  profile_row record;
BEGIN
  FOR profile_row IN
    SELECT p.id
    FROM public.profiles p
  LOOP
    PERFORM public.recalculate_user_entitlements(profile_row.id);
  END LOOP;
END $$;
