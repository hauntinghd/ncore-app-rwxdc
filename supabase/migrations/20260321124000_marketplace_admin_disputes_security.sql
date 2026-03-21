/*
  Marketplace phase-2: admin vetting + disputes + escrow processing + game security review
*/

-- ------------------------------------------------------------
-- Add moderation/security metadata on listings
-- ------------------------------------------------------------
ALTER TABLE public.marketplace_service_listings
  ADD COLUMN IF NOT EXISTS review_note text,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

ALTER TABLE public.marketplace_game_listings
  ADD COLUMN IF NOT EXISTS review_note text,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS security_status text NOT NULL DEFAULT 'pending' CHECK (security_status IN ('pending', 'passed', 'failed', 'needs_changes')),
  ADD COLUMN IF NOT EXISTS security_notes text;

ALTER TABLE public.marketplace_service_orders
  ADD COLUMN IF NOT EXISTS seller_delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS buyer_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS disputed_at timestamptz;

-- ------------------------------------------------------------
-- Disputes
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.marketplace_service_disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES public.marketplace_service_orders(id) ON DELETE CASCADE,
  opened_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason text NOT NULL,
  evidence_url text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'rejected', 'refunded')),
  resolution text,
  admin_note text,
  resolved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketplace_service_disputes_status_idx
  ON public.marketplace_service_disputes(status, created_at DESC);

DROP TRIGGER IF EXISTS marketplace_service_disputes_set_updated_at ON public.marketplace_service_disputes;
CREATE TRIGGER marketplace_service_disputes_set_updated_at
BEFORE UPDATE ON public.marketplace_service_disputes
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();

-- ------------------------------------------------------------
-- Optional security review snapshots (admin-managed)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.marketplace_listing_security_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_type text NOT NULL CHECK (listing_type IN ('service', 'game')),
  listing_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'passed', 'failed', 'needs_changes')),
  scanner text NOT NULL DEFAULT 'manual',
  report_url text,
  notes text,
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(listing_type, listing_id)
);

DROP TRIGGER IF EXISTS marketplace_listing_security_reviews_set_updated_at ON public.marketplace_listing_security_reviews;
CREATE TRIGGER marketplace_listing_security_reviews_set_updated_at
BEFORE UPDATE ON public.marketplace_listing_security_reviews
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();

-- ------------------------------------------------------------
-- Internal helper for service escrow release (no auth guard)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.marketplace_internal_release_service_order(p_order_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  order_row record;
  fee_cents bigint;
  seller_net_cents bigint;
BEGIN
  SELECT *
  INTO order_row
  FROM public.marketplace_service_orders
  WHERE id = p_order_id;

  IF order_row.id IS NULL THEN
    RAISE EXCEPTION 'Service order not found.';
  END IF;

  IF order_row.status NOT IN ('delivered', 'funded', 'in_progress') THEN
    RETURN order_row.status;
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
    buyer_confirmed_at = coalesce(buyer_confirmed_at, now()),
    updated_at = now()
  WHERE id = p_order_id;

  RETURN 'released';
END;
$$;

-- ------------------------------------------------------------
-- Actor-guarded release wrapper (buyer/seller/admin)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.marketplace_release_service_order(p_order_id uuid)
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

  IF actor_id = order_row.buyer_id THEN
    UPDATE public.marketplace_service_orders
    SET buyer_confirmed_at = now(), updated_at = now()
    WHERE id = p_order_id;
  END IF;

  RETURN public.marketplace_internal_release_service_order(p_order_id);
END;
$$;

-- ------------------------------------------------------------
-- Dispute + admin vetting/review RPCs
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.marketplace_open_service_dispute(
  p_order_id uuid,
  p_reason text,
  p_evidence_url text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
  order_row record;
  dispute_id uuid;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO order_row
  FROM public.marketplace_service_orders
  WHERE id = p_order_id;

  IF order_row.id IS NULL THEN
    RAISE EXCEPTION 'Service order not found.';
  END IF;

  IF actor_id <> order_row.buyer_id
     AND actor_id <> order_row.seller_id
     AND NOT public.is_platform_admin(actor_id) THEN
    RAISE EXCEPTION 'Not authorized to dispute this order.';
  END IF;

  IF order_row.status NOT IN ('funded', 'in_progress', 'delivered') THEN
    RAISE EXCEPTION 'Order cannot be disputed in current state.';
  END IF;

  INSERT INTO public.marketplace_service_disputes (
    order_id,
    opened_by,
    reason,
    evidence_url,
    status
  )
  VALUES (
    p_order_id,
    actor_id,
    trim(coalesce(p_reason, '')),
    nullif(trim(coalesce(p_evidence_url, '')), ''),
    'open'
  )
  ON CONFLICT (order_id) DO UPDATE
  SET
    reason = EXCLUDED.reason,
    evidence_url = EXCLUDED.evidence_url,
    status = 'open',
    resolution = NULL,
    admin_note = NULL,
    resolved_by = NULL,
    resolved_at = NULL,
    updated_at = now()
  RETURNING id INTO dispute_id;

  UPDATE public.marketplace_service_orders
  SET
    status = 'disputed',
    disputed_at = now(),
    updated_at = now()
  WHERE id = p_order_id;

  RETURN dispute_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_marketplace_set_seller_clearance(
  p_user_id uuid,
  p_clearance_level text,
  p_clearance_status text,
  p_quickdraw_enabled boolean,
  p_can_publish_games boolean,
  p_admin_note text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
BEGIN
  IF actor_id IS NULL OR NOT public.is_platform_admin(actor_id) THEN
    RAISE EXCEPTION 'Only platform admins can update seller clearance.';
  END IF;

  UPDATE public.marketplace_seller_profiles
  SET
    clearance_level = CASE lower(trim(coalesce(p_clearance_level, 'none')))
      WHEN 'level_i' THEN 'level_i'
      WHEN 'level_ii' THEN 'level_ii'
      WHEN 'level_iii' THEN 'level_iii'
      ELSE 'none'
    END,
    clearance_status = CASE lower(trim(coalesce(p_clearance_status, 'pending')))
      WHEN 'approved' THEN 'approved'
      WHEN 'rejected' THEN 'rejected'
      WHEN 'suspended' THEN 'suspended'
      ELSE 'pending'
    END,
    quickdraw_enabled = coalesce(p_quickdraw_enabled, false),
    can_publish_games = coalesce(p_can_publish_games, false),
    bio = CASE
      WHEN coalesce(nullif(trim(coalesce(p_admin_note, '')), ''), '') = '' THEN bio
      ELSE bio
    END,
    updated_at = now()
  WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Seller profile not found for target user.';
  END IF;

  RETURN 'updated';
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_marketplace_review_service_listing(
  p_listing_id uuid,
  p_next_status text,
  p_review_note text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
  listing_row record;
  next_status text;
BEGIN
  IF actor_id IS NULL OR NOT public.is_platform_admin(actor_id) THEN
    RAISE EXCEPTION 'Only platform admins can review service listings.';
  END IF;

  SELECT * INTO listing_row
  FROM public.marketplace_service_listings
  WHERE id = p_listing_id;

  IF listing_row.id IS NULL THEN
    RAISE EXCEPTION 'Service listing not found.';
  END IF;

  next_status := CASE lower(trim(coalesce(p_next_status, 'pending_review')))
    WHEN 'approved' THEN 'approved'
    WHEN 'rejected' THEN 'rejected'
    WHEN 'paused' THEN 'paused'
    ELSE 'pending_review'
  END;

  IF next_status = 'approved' AND coalesce(listing_row.listing_fee_paid, false) = false THEN
    RAISE EXCEPTION 'Cannot approve listing before listing fee is paid.';
  END IF;

  UPDATE public.marketplace_service_listings
  SET
    status = next_status,
    review_note = nullif(trim(coalesce(p_review_note, '')), ''),
    rejection_reason = CASE WHEN next_status = 'rejected' THEN nullif(trim(coalesce(p_review_note, '')), '') ELSE NULL END,
    reviewed_by = actor_id,
    reviewed_at = now(),
    updated_at = now()
  WHERE id = p_listing_id;

  RETURN next_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_marketplace_review_game_listing(
  p_listing_id uuid,
  p_next_status text,
  p_security_status text DEFAULT NULL,
  p_review_note text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
  listing_row record;
  next_status text;
  next_security text;
BEGIN
  IF actor_id IS NULL OR NOT public.is_platform_admin(actor_id) THEN
    RAISE EXCEPTION 'Only platform admins can review game listings.';
  END IF;

  SELECT * INTO listing_row
  FROM public.marketplace_game_listings
  WHERE id = p_listing_id;

  IF listing_row.id IS NULL THEN
    RAISE EXCEPTION 'Game listing not found.';
  END IF;

  next_status := CASE lower(trim(coalesce(p_next_status, 'pending_review')))
    WHEN 'approved' THEN 'approved'
    WHEN 'rejected' THEN 'rejected'
    WHEN 'paused' THEN 'paused'
    ELSE 'pending_review'
  END;

  next_security := CASE lower(trim(coalesce(p_security_status, listing_row.security_status)))
    WHEN 'passed' THEN 'passed'
    WHEN 'failed' THEN 'failed'
    WHEN 'needs_changes' THEN 'needs_changes'
    ELSE 'pending'
  END;

  IF next_status = 'approved' AND coalesce(listing_row.listing_fee_paid, false) = false THEN
    RAISE EXCEPTION 'Cannot approve game listing before listing fee is paid.';
  END IF;

  IF next_status = 'approved' AND next_security <> 'passed' THEN
    RAISE EXCEPTION 'Game listing requires security_status=passed before approval.';
  END IF;

  UPDATE public.marketplace_game_listings
  SET
    status = next_status,
    security_status = next_security,
    security_notes = CASE WHEN next_security IN ('failed', 'needs_changes') THEN nullif(trim(coalesce(p_review_note, '')), '') ELSE security_notes END,
    review_note = nullif(trim(coalesce(p_review_note, '')), ''),
    rejection_reason = CASE WHEN next_status = 'rejected' THEN nullif(trim(coalesce(p_review_note, '')), '') ELSE NULL END,
    reviewed_by = actor_id,
    reviewed_at = now(),
    updated_at = now()
  WHERE id = p_listing_id;

  INSERT INTO public.marketplace_listing_security_reviews (
    listing_type,
    listing_id,
    status,
    scanner,
    notes,
    reviewed_by
  )
  VALUES (
    'game',
    p_listing_id,
    next_security,
    'manual_admin_review',
    nullif(trim(coalesce(p_review_note, '')), ''),
    actor_id
  )
  ON CONFLICT (listing_type, listing_id) DO UPDATE
  SET
    status = EXCLUDED.status,
    scanner = EXCLUDED.scanner,
    notes = EXCLUDED.notes,
    reviewed_by = EXCLUDED.reviewed_by,
    updated_at = now();

  RETURN next_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_marketplace_resolve_dispute(
  p_dispute_id uuid,
  p_resolution text,
  p_admin_note text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
  dispute_row record;
  order_row record;
  fee_cents bigint;
  seller_net_cents bigint;
  normalized_resolution text;
  result_status text;
BEGIN
  IF actor_id IS NULL OR NOT public.is_platform_admin(actor_id) THEN
    RAISE EXCEPTION 'Only platform admins can resolve disputes.';
  END IF;

  SELECT * INTO dispute_row
  FROM public.marketplace_service_disputes
  WHERE id = p_dispute_id;

  IF dispute_row.id IS NULL THEN
    RAISE EXCEPTION 'Dispute not found.';
  END IF;

  SELECT * INTO order_row
  FROM public.marketplace_service_orders
  WHERE id = dispute_row.order_id;

  IF order_row.id IS NULL THEN
    RAISE EXCEPTION 'Associated service order not found.';
  END IF;

  normalized_resolution := CASE lower(trim(coalesce(p_resolution, '')))
    WHEN 'release_seller' THEN 'release_seller'
    WHEN 'refund_buyer' THEN 'refund_buyer'
    ELSE 'reject_dispute'
  END;

  IF normalized_resolution = 'release_seller' THEN
    PERFORM public.marketplace_internal_release_service_order(order_row.id);
    result_status := 'resolved';
  ELSIF normalized_resolution = 'refund_buyer' THEN
    fee_cents := FLOOR(order_row.amount_cents::numeric * order_row.platform_fee_bps::numeric / 10000.0)::bigint;
    seller_net_cents := GREATEST(order_row.amount_cents::bigint - fee_cents, 0);

    PERFORM public.marketplace_ensure_wallet(order_row.seller_id);

    UPDATE public.ncore_wallet_accounts
    SET
      pending_balance_cents = GREATEST(pending_balance_cents - seller_net_cents, 0),
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
      'service_dispute_refund',
      -seller_net_cents,
      'usd',
      'marketplace_service_order',
      order_row.id,
      'Dispute resolved as refund to buyer'
    );

    UPDATE public.marketplace_service_orders
    SET
      status = 'refunded',
      updated_at = now()
    WHERE id = order_row.id;

    result_status := 'refunded';
  ELSE
    UPDATE public.marketplace_service_orders
    SET
      status = CASE
        WHEN status = 'disputed' THEN 'delivered'
        ELSE status
      END,
      updated_at = now()
    WHERE id = order_row.id;

    result_status := 'rejected';
  END IF;

  UPDATE public.marketplace_service_disputes
  SET
    status = result_status,
    resolution = normalized_resolution,
    admin_note = nullif(trim(coalesce(p_admin_note, '')), ''),
    resolved_by = actor_id,
    resolved_at = now(),
    updated_at = now()
  WHERE id = p_dispute_id;

  RETURN result_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.marketplace_process_due_escrow_releases(p_limit integer DEFAULT 100)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
  processed_count integer := 0;
  order_row record;
BEGIN
  IF actor_id IS NOT NULL AND NOT public.is_platform_admin(actor_id) THEN
    RAISE EXCEPTION 'Only platform admins can trigger escrow sweep.';
  END IF;

  FOR order_row IN
    SELECT id
    FROM public.marketplace_service_orders
    WHERE status = 'delivered'
      AND escrow_release_due_at IS NOT NULL
      AND escrow_release_due_at <= now()
    ORDER BY escrow_release_due_at ASC
    LIMIT GREATEST(coalesce(p_limit, 100), 1)
  LOOP
    PERFORM public.marketplace_internal_release_service_order(order_row.id);
    processed_count := processed_count + 1;
  END LOOP;

  RETURN processed_count;
END;
$$;

-- ------------------------------------------------------------
-- Grants
-- ------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.marketplace_open_service_dispute(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_marketplace_set_seller_clearance(uuid, text, text, boolean, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_marketplace_review_service_listing(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_marketplace_review_game_listing(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_marketplace_resolve_dispute(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.marketplace_process_due_escrow_releases(integer) TO authenticated;

-- ------------------------------------------------------------
-- RLS for new tables
-- ------------------------------------------------------------
ALTER TABLE public.marketplace_service_disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_listing_security_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service disputes visible to participants" ON public.marketplace_service_disputes;
CREATE POLICY "Service disputes visible to participants"
  ON public.marketplace_service_disputes FOR SELECT TO authenticated
  USING (
    public.is_platform_admin(auth.uid())
    OR opened_by = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.marketplace_service_orders o
      WHERE o.id = order_id
        AND (o.buyer_id = auth.uid() OR o.seller_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Service disputes insert by participants" ON public.marketplace_service_disputes;
CREATE POLICY "Service disputes insert by participants"
  ON public.marketplace_service_disputes FOR INSERT TO authenticated
  WITH CHECK (
    public.is_platform_admin(auth.uid())
    OR opened_by = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.marketplace_service_orders o
      WHERE o.id = order_id
        AND (o.buyer_id = auth.uid() OR o.seller_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Service disputes update admin only" ON public.marketplace_service_disputes;
CREATE POLICY "Service disputes update admin only"
  ON public.marketplace_service_disputes FOR UPDATE TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Security reviews visible to listing owners" ON public.marketplace_listing_security_reviews;
CREATE POLICY "Security reviews visible to listing owners"
  ON public.marketplace_listing_security_reviews FOR SELECT TO authenticated
  USING (
    public.is_platform_admin(auth.uid())
    OR (
      listing_type = 'service'
      AND EXISTS (
        SELECT 1 FROM public.marketplace_service_listings s
        WHERE s.id = listing_id
          AND s.seller_id = auth.uid()
      )
    )
    OR (
      listing_type = 'game'
      AND EXISTS (
        SELECT 1 FROM public.marketplace_game_listings g
        WHERE g.id = listing_id
          AND g.seller_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "Security reviews admin write" ON public.marketplace_listing_security_reviews;
CREATE POLICY "Security reviews admin write"
  ON public.marketplace_listing_security_reviews FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));
