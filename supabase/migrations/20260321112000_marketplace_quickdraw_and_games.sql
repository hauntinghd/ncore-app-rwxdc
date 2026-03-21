/*
  # Marketplace Overhaul Foundation (Quickdraw + Games)

  Adds:
  - Seller clearance/vetting profile (Level II workflow)
  - Quickdraw service categories, listings, and escrow-style orders
  - Game marketplace listings and orders
  - NCore wallet ledger foundation for payout accounting
  - RPC helpers for seller onboarding and listing creation
*/

-- ------------------------------------------------------------------
-- Seller profile + vetting
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.marketplace_seller_profiles (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  primary_niche text NOT NULL DEFAULT '',
  bio text NOT NULL DEFAULT '',
  clearance_level text NOT NULL DEFAULT 'none' CHECK (
    clearance_level IN ('none', 'level_i', 'level_ii', 'level_iii')
  ),
  clearance_status text NOT NULL DEFAULT 'pending' CHECK (
    clearance_status IN ('pending', 'approved', 'rejected', 'suspended')
  ),
  verified_earnings_cents bigint NOT NULL DEFAULT 0 CHECK (verified_earnings_cents >= 0),
  proof_url text,
  stripe_account_id text,
  quickdraw_enabled boolean NOT NULL DEFAULT false,
  can_publish_games boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS marketplace_seller_profiles_set_updated_at ON public.marketplace_seller_profiles;
CREATE TRIGGER marketplace_seller_profiles_set_updated_at
BEFORE UPDATE ON public.marketplace_seller_profiles
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();

-- ------------------------------------------------------------------
-- Service marketplace (Quickdraw)
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.marketplace_service_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  listing_fee_min_cents integer NOT NULL DEFAULT 25000 CHECK (listing_fee_min_cents >= 0),
  listing_fee_max_cents integer NOT NULL DEFAULT 100000 CHECK (listing_fee_max_cents >= listing_fee_min_cents),
  min_verified_earnings_cents bigint NOT NULL DEFAULT 100000 CHECK (min_verified_earnings_cents >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS marketplace_service_categories_set_updated_at ON public.marketplace_service_categories;
CREATE TRIGGER marketplace_service_categories_set_updated_at
BEFORE UPDATE ON public.marketplace_service_categories
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();

CREATE TABLE IF NOT EXISTS public.marketplace_service_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.marketplace_service_categories(id) ON DELETE RESTRICT,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  portfolio_url text,
  base_price_cents integer NOT NULL CHECK (base_price_cents > 0),
  delivery_days integer NOT NULL DEFAULT 3 CHECK (delivery_days >= 1),
  listing_fee_cents integer NOT NULL CHECK (listing_fee_cents >= 0),
  listing_fee_paid boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending_fee' CHECK (
    status IN ('draft', 'pending_fee', 'pending_review', 'approved', 'paused', 'rejected')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketplace_service_listings_status_idx
  ON public.marketplace_service_listings(status, created_at DESC);
CREATE INDEX IF NOT EXISTS marketplace_service_listings_seller_idx
  ON public.marketplace_service_listings(seller_id, updated_at DESC);

DROP TRIGGER IF EXISTS marketplace_service_listings_set_updated_at ON public.marketplace_service_listings;
CREATE TRIGGER marketplace_service_listings_set_updated_at
BEFORE UPDATE ON public.marketplace_service_listings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();

CREATE TABLE IF NOT EXISTS public.marketplace_service_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES public.marketplace_service_listings(id) ON DELETE RESTRICT,
  buyer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  seller_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  platform_fee_bps integer NOT NULL DEFAULT 400 CHECK (platform_fee_bps >= 0 AND platform_fee_bps <= 10000),
  status text NOT NULL DEFAULT 'pending_payment' CHECK (
    status IN ('pending_payment', 'funded', 'in_progress', 'delivered', 'released', 'disputed', 'refunded', 'cancelled')
  ),
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  escrow_release_due_at timestamptz,
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS marketplace_service_orders_checkout_session_idx
  ON public.marketplace_service_orders(stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS marketplace_service_orders_seller_idx
  ON public.marketplace_service_orders(seller_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS marketplace_service_orders_buyer_idx
  ON public.marketplace_service_orders(buyer_id, status, created_at DESC);

DROP TRIGGER IF EXISTS marketplace_service_orders_set_updated_at ON public.marketplace_service_orders;
CREATE TRIGGER marketplace_service_orders_set_updated_at
BEFORE UPDATE ON public.marketplace_service_orders
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();

-- ------------------------------------------------------------------
-- Game marketplace
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.marketplace_game_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  cover_url text,
  installer_url text,
  price_cents integer NOT NULL CHECK (price_cents > 0),
  listing_fee_cents integer NOT NULL DEFAULT 10000 CHECK (listing_fee_cents >= 0),
  listing_fee_paid boolean NOT NULL DEFAULT false,
  platform_fee_bps integer NOT NULL DEFAULT 400 CHECK (platform_fee_bps >= 0 AND platform_fee_bps <= 10000),
  provenance_type text NOT NULL DEFAULT 'self_developed' CHECK (provenance_type IN ('self_developed', 'steam_authorized')),
  provenance_proof_url text,
  status text NOT NULL DEFAULT 'pending_fee' CHECK (
    status IN ('draft', 'pending_fee', 'pending_review', 'approved', 'paused', 'rejected')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketplace_game_listings_status_idx
  ON public.marketplace_game_listings(status, created_at DESC);
CREATE INDEX IF NOT EXISTS marketplace_game_listings_seller_idx
  ON public.marketplace_game_listings(seller_id, updated_at DESC);

DROP TRIGGER IF EXISTS marketplace_game_listings_set_updated_at ON public.marketplace_game_listings;
CREATE TRIGGER marketplace_game_listings_set_updated_at
BEFORE UPDATE ON public.marketplace_game_listings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();

CREATE TABLE IF NOT EXISTS public.marketplace_game_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_listing_id uuid NOT NULL REFERENCES public.marketplace_game_listings(id) ON DELETE RESTRICT,
  buyer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  seller_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  platform_fee_bps integer NOT NULL DEFAULT 400 CHECK (platform_fee_bps >= 0 AND platform_fee_bps <= 10000),
  status text NOT NULL DEFAULT 'pending_payment' CHECK (
    status IN ('pending_payment', 'paid', 'fulfilled', 'refunded', 'cancelled')
  ),
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  download_token text,
  download_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS marketplace_game_orders_checkout_session_idx
  ON public.marketplace_game_orders(stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS marketplace_game_orders_buyer_idx
  ON public.marketplace_game_orders(buyer_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS marketplace_game_orders_seller_idx
  ON public.marketplace_game_orders(seller_id, status, created_at DESC);

DROP TRIGGER IF EXISTS marketplace_game_orders_set_updated_at ON public.marketplace_game_orders;
CREATE TRIGGER marketplace_game_orders_set_updated_at
BEFORE UPDATE ON public.marketplace_game_orders
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();

-- ------------------------------------------------------------------
-- Wallet ledger foundation
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ncore_wallet_accounts (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  pending_balance_cents bigint NOT NULL DEFAULT 0 CHECK (pending_balance_cents >= 0),
  available_balance_cents bigint NOT NULL DEFAULT 0 CHECK (available_balance_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS ncore_wallet_accounts_set_updated_at ON public.ncore_wallet_accounts;
CREATE TRIGGER ncore_wallet_accounts_set_updated_at
BEFORE UPDATE ON public.ncore_wallet_accounts
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();

CREATE TABLE IF NOT EXISTS public.ncore_wallet_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  entry_type text NOT NULL,
  amount_cents bigint NOT NULL,
  currency text NOT NULL DEFAULT 'usd',
  reference_type text,
  reference_id uuid,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ncore_wallet_ledger_user_idx
  ON public.ncore_wallet_ledger(user_id, created_at DESC);

-- ------------------------------------------------------------------
-- Helper functions
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clearance_level_rank(p_level text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(coalesce(p_level, 'none'))
    WHEN 'level_iii' THEN 3
    WHEN 'level_ii' THEN 2
    WHEN 'level_i' THEN 1
    ELSE 0
  END;
$$;

CREATE OR REPLACE FUNCTION public.marketplace_ensure_wallet(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.ncore_wallet_accounts (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_marketplace_clearance(
  p_primary_niche text,
  p_bio text DEFAULT '',
  p_proof_url text DEFAULT NULL,
  p_verified_earnings_cents bigint DEFAULT 0
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO public.marketplace_seller_profiles (
    user_id,
    primary_niche,
    bio,
    proof_url,
    verified_earnings_cents,
    clearance_status
  )
  VALUES (
    actor_id,
    trim(coalesce(p_primary_niche, '')),
    trim(coalesce(p_bio, '')),
    nullif(trim(coalesce(p_proof_url, '')), ''),
    GREATEST(coalesce(p_verified_earnings_cents, 0), 0),
    'pending'
  )
  ON CONFLICT (user_id) DO UPDATE
  SET
    primary_niche = EXCLUDED.primary_niche,
    bio = EXCLUDED.bio,
    proof_url = EXCLUDED.proof_url,
    verified_earnings_cents = EXCLUDED.verified_earnings_cents,
    clearance_status = CASE
      WHEN public.marketplace_seller_profiles.clearance_status = 'approved'
        THEN public.marketplace_seller_profiles.clearance_status
      ELSE 'pending'
    END,
    updated_at = now();

  PERFORM public.marketplace_ensure_wallet(actor_id);

  RETURN 'submitted';
END;
$$;

CREATE OR REPLACE FUNCTION public.create_marketplace_service_listing(
  p_category_slug text,
  p_title text,
  p_description text,
  p_base_price_cents integer,
  p_delivery_days integer DEFAULT 3,
  p_portfolio_url text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
  seller_row record;
  category_row record;
  listing_id uuid;
  listing_fee integer;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT *
  INTO seller_row
  FROM public.marketplace_seller_profiles
  WHERE user_id = actor_id;

  IF seller_row.user_id IS NULL THEN
    RAISE EXCEPTION 'Create and submit a seller profile first.';
  END IF;

  IF seller_row.clearance_status <> 'approved'
     OR public.clearance_level_rank(seller_row.clearance_level) < public.clearance_level_rank('level_ii') THEN
    RAISE EXCEPTION 'Level II clearance approval is required before listing services.';
  END IF;

  SELECT *
  INTO category_row
  FROM public.marketplace_service_categories
  WHERE slug = lower(trim(coalesce(p_category_slug, '')))
    AND active = true
  LIMIT 1;

  IF category_row.id IS NULL THEN
    RAISE EXCEPTION 'Unknown marketplace category.';
  END IF;

  IF coalesce(seller_row.verified_earnings_cents, 0) < coalesce(category_row.min_verified_earnings_cents, 0) THEN
    RAISE EXCEPTION 'Verified earnings threshold for this category is not met.';
  END IF;

  IF coalesce(p_base_price_cents, 0) < 100 THEN
    RAISE EXCEPTION 'Service price must be at least $1.00.';
  END IF;

  listing_fee := GREATEST(
    category_row.listing_fee_min_cents,
    LEAST(category_row.listing_fee_max_cents, category_row.listing_fee_min_cents)
  );

  INSERT INTO public.marketplace_service_listings (
    seller_id,
    category_id,
    title,
    description,
    portfolio_url,
    base_price_cents,
    delivery_days,
    listing_fee_cents,
    listing_fee_paid,
    status
  )
  VALUES (
    actor_id,
    category_row.id,
    trim(coalesce(p_title, '')),
    trim(coalesce(p_description, '')),
    nullif(trim(coalesce(p_portfolio_url, '')), ''),
    p_base_price_cents,
    GREATEST(coalesce(p_delivery_days, 3), 1),
    listing_fee,
    false,
    'pending_fee'
  )
  RETURNING id INTO listing_id;

  RETURN listing_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_marketplace_game_listing(
  p_title text,
  p_slug text,
  p_description text,
  p_price_cents integer,
  p_installer_url text DEFAULT NULL,
  p_cover_url text DEFAULT NULL,
  p_provenance_type text DEFAULT 'self_developed',
  p_provenance_proof_url text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
  seller_row record;
  listing_id uuid;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT *
  INTO seller_row
  FROM public.marketplace_seller_profiles
  WHERE user_id = actor_id;

  IF seller_row.user_id IS NULL THEN
    RAISE EXCEPTION 'Create and submit a seller profile first.';
  END IF;

  IF seller_row.clearance_status <> 'approved'
     OR public.clearance_level_rank(seller_row.clearance_level) < public.clearance_level_rank('level_ii') THEN
    RAISE EXCEPTION 'Level II clearance approval is required before publishing games.';
  END IF;

  IF coalesce(seller_row.can_publish_games, false) = false THEN
    RAISE EXCEPTION 'Game publishing is not enabled for this seller profile yet.';
  END IF;

  IF coalesce(p_price_cents, 0) < 100 THEN
    RAISE EXCEPTION 'Game price must be at least $1.00.';
  END IF;

  INSERT INTO public.marketplace_game_listings (
    seller_id,
    title,
    slug,
    description,
    price_cents,
    installer_url,
    cover_url,
    provenance_type,
    provenance_proof_url,
    listing_fee_paid,
    status
  )
  VALUES (
    actor_id,
    trim(coalesce(p_title, '')),
    lower(trim(coalesce(p_slug, ''))),
    trim(coalesce(p_description, '')),
    p_price_cents,
    nullif(trim(coalesce(p_installer_url, '')), ''),
    nullif(trim(coalesce(p_cover_url, '')), ''),
    CASE
      WHEN lower(trim(coalesce(p_provenance_type, ''))) = 'steam_authorized' THEN 'steam_authorized'
      ELSE 'self_developed'
    END,
    nullif(trim(coalesce(p_provenance_proof_url, '')), ''),
    false,
    'pending_fee'
  )
  RETURNING id INTO listing_id;

  RETURN listing_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.marketplace_mark_service_delivered(p_order_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
  order_row record;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT *
  INTO order_row
  FROM public.marketplace_service_orders
  WHERE id = p_order_id;

  IF order_row.id IS NULL THEN
    RAISE EXCEPTION 'Service order not found.';
  END IF;

  IF actor_id <> order_row.seller_id AND NOT public.is_platform_admin(actor_id) THEN
    RAISE EXCEPTION 'Not authorized to mark this order delivered.';
  END IF;

  IF order_row.status NOT IN ('funded', 'in_progress') THEN
    RETURN order_row.status;
  END IF;

  UPDATE public.marketplace_service_orders
  SET
    status = 'delivered',
    escrow_release_due_at = COALESCE(escrow_release_due_at, now() + interval '7 days'),
    updated_at = now()
  WHERE id = p_order_id;

  RETURN 'delivered';
END;
$$;

CREATE OR REPLACE FUNCTION public.marketplace_release_service_order(p_order_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
  order_row record;
  fee_cents bigint;
  seller_net_cents bigint;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT *
  INTO order_row
  FROM public.marketplace_service_orders
  WHERE id = p_order_id;

  IF order_row.id IS NULL THEN
    RAISE EXCEPTION 'Service order not found.';
  END IF;

  IF actor_id <> order_row.seller_id
     AND actor_id <> order_row.buyer_id
     AND NOT public.is_platform_admin(actor_id) THEN
    RAISE EXCEPTION 'Not authorized to release this order.';
  END IF;

  IF order_row.status NOT IN ('delivered', 'funded', 'in_progress') THEN
    RETURN order_row.status;
  END IF;

  IF actor_id = order_row.seller_id
     AND NOT public.is_platform_admin(actor_id)
     AND order_row.escrow_release_due_at IS NOT NULL
     AND order_row.escrow_release_due_at > now() THEN
    RAISE EXCEPTION 'Escrow release window is still active.';
  END IF;

  fee_cents := FLOOR(order_row.amount_cents::numeric * order_row.platform_fee_bps::numeric / 10000.0)::bigint;
  seller_net_cents := GREATEST(order_row.amount_cents::bigint - fee_cents, 0);

  PERFORM public.marketplace_ensure_wallet(order_row.seller_id);

  UPDATE public.ncore_wallet_accounts
  SET
    pending_balance_cents = GREATEST(pending_balance_cents - seller_net_cents, 0),
    available_balance_cents = available_balance_cents + seller_net_cents,
    updated_at = now()
  WHERE user_id = order_row.seller_id;

  INSERT INTO public.ncore_wallet_ledger (
    user_id,
    entry_type,
    amount_cents,
    currency,
    reference_type,
    reference_id,
    note
  )
  VALUES (
    order_row.seller_id,
    'service_escrow_release',
    seller_net_cents,
    'usd',
    'marketplace_service_order',
    order_row.id,
    'Escrow auto/manual release'
  );

  UPDATE public.marketplace_service_orders
  SET
    status = 'released',
    released_at = now(),
    updated_at = now()
  WHERE id = p_order_id;

  RETURN 'released';
END;
$$;

GRANT EXECUTE ON FUNCTION public.marketplace_ensure_wallet(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_marketplace_clearance(text, text, text, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_marketplace_service_listing(text, text, text, integer, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_marketplace_game_listing(text, text, text, integer, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.marketplace_mark_service_delivered(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.marketplace_release_service_order(uuid) TO authenticated;

-- ------------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------------
ALTER TABLE public.marketplace_seller_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_service_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_service_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_service_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_game_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_game_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ncore_wallet_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ncore_wallet_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Marketplace categories read active" ON public.marketplace_service_categories;
CREATE POLICY "Marketplace categories read active"
  ON public.marketplace_service_categories FOR SELECT TO authenticated, anon
  USING (active = true OR public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Seller profiles readable for marketplace" ON public.marketplace_seller_profiles;
CREATE POLICY "Seller profiles readable for marketplace"
  ON public.marketplace_seller_profiles FOR SELECT TO authenticated, anon
  USING (true);

DROP POLICY IF EXISTS "Seller profile insert own" ON public.marketplace_seller_profiles;
CREATE POLICY "Seller profile insert own"
  ON public.marketplace_seller_profiles FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Seller profile update own or admin" ON public.marketplace_seller_profiles;
CREATE POLICY "Seller profile update own or admin"
  ON public.marketplace_seller_profiles FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.is_platform_admin(auth.uid()))
  WITH CHECK (user_id = auth.uid() OR public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Service listings visible approved or own" ON public.marketplace_service_listings;
CREATE POLICY "Service listings visible approved or own"
  ON public.marketplace_service_listings FOR SELECT TO authenticated, anon
  USING (status = 'approved' OR seller_id = auth.uid() OR public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Service listings insert own" ON public.marketplace_service_listings;
CREATE POLICY "Service listings insert own"
  ON public.marketplace_service_listings FOR INSERT TO authenticated
  WITH CHECK (seller_id = auth.uid() OR public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Service listings update own or admin" ON public.marketplace_service_listings;
CREATE POLICY "Service listings update own or admin"
  ON public.marketplace_service_listings FOR UPDATE TO authenticated
  USING (seller_id = auth.uid() OR public.is_platform_admin(auth.uid()))
  WITH CHECK (seller_id = auth.uid() OR public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Service orders visible for participants" ON public.marketplace_service_orders;
CREATE POLICY "Service orders visible for participants"
  ON public.marketplace_service_orders FOR SELECT TO authenticated
  USING (
    buyer_id = auth.uid()
    OR seller_id = auth.uid()
    OR public.is_platform_admin(auth.uid())
  );

DROP POLICY IF EXISTS "Service orders insert buyer" ON public.marketplace_service_orders;
CREATE POLICY "Service orders insert buyer"
  ON public.marketplace_service_orders FOR INSERT TO authenticated
  WITH CHECK (buyer_id = auth.uid() OR public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Service orders update participants" ON public.marketplace_service_orders;
CREATE POLICY "Service orders update participants"
  ON public.marketplace_service_orders FOR UPDATE TO authenticated
  USING (
    buyer_id = auth.uid()
    OR seller_id = auth.uid()
    OR public.is_platform_admin(auth.uid())
  )
  WITH CHECK (
    buyer_id = auth.uid()
    OR seller_id = auth.uid()
    OR public.is_platform_admin(auth.uid())
  );

DROP POLICY IF EXISTS "Game listings visible approved or own" ON public.marketplace_game_listings;
CREATE POLICY "Game listings visible approved or own"
  ON public.marketplace_game_listings FOR SELECT TO authenticated, anon
  USING (status = 'approved' OR seller_id = auth.uid() OR public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Game listings insert own" ON public.marketplace_game_listings;
CREATE POLICY "Game listings insert own"
  ON public.marketplace_game_listings FOR INSERT TO authenticated
  WITH CHECK (seller_id = auth.uid() OR public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Game listings update own or admin" ON public.marketplace_game_listings;
CREATE POLICY "Game listings update own or admin"
  ON public.marketplace_game_listings FOR UPDATE TO authenticated
  USING (seller_id = auth.uid() OR public.is_platform_admin(auth.uid()))
  WITH CHECK (seller_id = auth.uid() OR public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Game orders visible for participants" ON public.marketplace_game_orders;
CREATE POLICY "Game orders visible for participants"
  ON public.marketplace_game_orders FOR SELECT TO authenticated
  USING (
    buyer_id = auth.uid()
    OR seller_id = auth.uid()
    OR public.is_platform_admin(auth.uid())
  );

DROP POLICY IF EXISTS "Game orders insert buyer" ON public.marketplace_game_orders;
CREATE POLICY "Game orders insert buyer"
  ON public.marketplace_game_orders FOR INSERT TO authenticated
  WITH CHECK (buyer_id = auth.uid() OR public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Game orders update participants" ON public.marketplace_game_orders;
CREATE POLICY "Game orders update participants"
  ON public.marketplace_game_orders FOR UPDATE TO authenticated
  USING (
    buyer_id = auth.uid()
    OR seller_id = auth.uid()
    OR public.is_platform_admin(auth.uid())
  )
  WITH CHECK (
    buyer_id = auth.uid()
    OR seller_id = auth.uid()
    OR public.is_platform_admin(auth.uid())
  );

DROP POLICY IF EXISTS "Wallet account read own" ON public.ncore_wallet_accounts;
CREATE POLICY "Wallet account read own"
  ON public.ncore_wallet_accounts FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Wallet ledger read own" ON public.ncore_wallet_ledger;
CREATE POLICY "Wallet ledger read own"
  ON public.ncore_wallet_ledger FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_platform_admin(auth.uid()));

-- ------------------------------------------------------------------
-- Seeds
-- ------------------------------------------------------------------
INSERT INTO public.marketplace_service_categories (
  slug,
  name,
  description,
  listing_fee_min_cents,
  listing_fee_max_cents,
  min_verified_earnings_cents,
  active
)
VALUES
  ('video_editing', 'Video Editing', 'Short-form, long-form, trailer, and cinematic production services.', 25000, 100000, 100000, true),
  ('graphics_branding', 'Graphics + Branding', 'Brand kits, thumbnails, visual identity, and ad creative.', 25000, 85000, 75000, true),
  ('automation_development', 'Automation + Development', 'Bot automation, web builds, backend integrations, and tools.', 40000, 100000, 100000, true),
  ('copywriting', 'Copywriting', 'Sales copy, scripts, ad copy, offer pages, and positioning.', 25000, 75000, 50000, true),
  ('media_buying', 'Media Buying', 'Paid ads strategy, campaign buildout, and optimization.', 35000, 100000, 100000, true)
ON CONFLICT (slug) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  listing_fee_min_cents = EXCLUDED.listing_fee_min_cents,
  listing_fee_max_cents = EXCLUDED.listing_fee_max_cents,
  min_verified_earnings_cents = EXCLUDED.min_verified_earnings_cents,
  active = EXCLUDED.active,
  updated_at = now();
