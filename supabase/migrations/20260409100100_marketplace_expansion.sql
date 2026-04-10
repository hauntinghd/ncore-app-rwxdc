-- =============================================================================
-- Marketplace Expansion: QuickDraw (The Real World) + Games (Steam)
-- Phase 4 of the 40000x plan
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Job Board / Briefs System (The Real World mirror)
-- Buyers post job briefs, sellers apply with proposals.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketplace_briefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poster_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category_id uuid REFERENCES marketplace_service_categories(id),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  budget_min_cents int,
  budget_max_cents int,
  deadline timestamptz,
  skills_required text[] DEFAULT '{}',
  visibility text DEFAULT 'open' CHECK (visibility IN ('open', 'invite_only')),
  status text DEFAULT 'active' CHECK (status IN ('active', 'paused', 'filled', 'cancelled', 'expired')),
  max_applications int DEFAULT 50,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_briefs_poster ON marketplace_briefs(poster_id, status);
CREATE INDEX idx_briefs_status_created ON marketplace_briefs(status, created_at DESC);
CREATE INDEX idx_briefs_category ON marketplace_briefs(category_id, status);

ALTER TABLE marketplace_briefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active briefs"
  ON marketplace_briefs FOR SELECT
  USING (status = 'active' OR poster_id = auth.uid());

CREATE POLICY "Authenticated users can create briefs"
  ON marketplace_briefs FOR INSERT
  WITH CHECK (auth.uid() = poster_id);

CREATE POLICY "Poster can update own briefs"
  ON marketplace_briefs FOR UPDATE
  USING (auth.uid() = poster_id);

-- ---------------------------------------------------------------------------
-- 2. Brief Applications
-- Sellers apply to open briefs.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketplace_brief_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_id uuid NOT NULL REFERENCES marketplace_briefs(id) ON DELETE CASCADE,
  seller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cover_letter text DEFAULT '',
  proposed_price_cents int,
  proposed_delivery_days int,
  portfolio_urls text[] DEFAULT '{}',
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'shortlisted', 'accepted', 'rejected', 'withdrawn')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(brief_id, seller_id)
);

CREATE INDEX idx_applications_brief ON marketplace_brief_applications(brief_id, status);
CREATE INDEX idx_applications_seller ON marketplace_brief_applications(seller_id, status);

ALTER TABLE marketplace_brief_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Brief poster can view applications"
  ON marketplace_brief_applications FOR SELECT
  USING (
    seller_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM marketplace_briefs mb
      WHERE mb.id = marketplace_brief_applications.brief_id
        AND mb.poster_id = auth.uid()
    )
  );

CREATE POLICY "Sellers can apply to briefs"
  ON marketplace_brief_applications FOR INSERT
  WITH CHECK (auth.uid() = seller_id);

CREATE POLICY "Sellers can update own applications"
  ON marketplace_brief_applications FOR UPDATE
  USING (auth.uid() = seller_id);

-- ---------------------------------------------------------------------------
-- 3. Skill Verification & Certifications
-- ---------------------------------------------------------------------------
ALTER TABLE marketplace_seller_profiles
  ADD COLUMN IF NOT EXISTS verified_skills text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS certifications jsonb DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS average_rating numeric(3,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_reviews int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS completion_rate numeric(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS average_response_hours numeric(6,2);

-- ---------------------------------------------------------------------------
-- 4. Service Reviews
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketplace_service_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES marketplace_service_orders(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  seller_id uuid NOT NULL REFERENCES auth.users(id),
  overall_rating int NOT NULL CHECK (overall_rating BETWEEN 1 AND 5),
  quality_rating int CHECK (quality_rating BETWEEN 1 AND 5),
  communication_rating int CHECK (communication_rating BETWEEN 1 AND 5),
  response_time_rating int CHECK (response_time_rating BETWEEN 1 AND 5),
  content text DEFAULT '',
  seller_response text,
  seller_responded_at timestamptz,
  is_verified_purchase boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE(order_id, reviewer_id)
);

CREATE INDEX idx_service_reviews_seller ON marketplace_service_reviews(seller_id, created_at DESC);

ALTER TABLE marketplace_service_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view reviews"
  ON marketplace_service_reviews FOR SELECT
  USING (true);

CREATE POLICY "Buyers can create reviews"
  ON marketplace_service_reviews FOR INSERT
  WITH CHECK (auth.uid() = reviewer_id);

CREATE POLICY "Sellers can respond to reviews"
  ON marketplace_service_reviews FOR UPDATE
  USING (auth.uid() = seller_id)
  WITH CHECK (auth.uid() = seller_id);

-- Trigger to update seller average rating
CREATE OR REPLACE FUNCTION update_seller_rating()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE marketplace_seller_profiles
  SET
    average_rating = (
      SELECT ROUND(AVG(overall_rating)::numeric, 2)
      FROM marketplace_service_reviews
      WHERE seller_id = NEW.seller_id
    ),
    total_reviews = (
      SELECT COUNT(*)
      FROM marketplace_service_reviews
      WHERE seller_id = NEW.seller_id
    )
  WHERE user_id = NEW.seller_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_update_seller_rating
  AFTER INSERT OR UPDATE ON marketplace_service_reviews
  FOR EACH ROW EXECUTE FUNCTION update_seller_rating();

-- ---------------------------------------------------------------------------
-- 5. Game Marketplace Expansion (Steam features)
-- ---------------------------------------------------------------------------

-- Game categories
CREATE TABLE IF NOT EXISTS game_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text DEFAULT '',
  icon_url text,
  sort_order int DEFAULT 0,
  active boolean DEFAULT true
);

-- Game-category junction
CREATE TABLE IF NOT EXISTS game_listing_categories (
  game_listing_id uuid NOT NULL REFERENCES marketplace_game_listings(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES game_categories(id) ON DELETE CASCADE,
  PRIMARY KEY (game_listing_id, category_id)
);

-- Wishlists
CREATE TABLE IF NOT EXISTS game_wishlists (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  game_listing_id uuid NOT NULL REFERENCES marketplace_game_listings(id) ON DELETE CASCADE,
  added_at timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, game_listing_id)
);

ALTER TABLE game_wishlists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own wishlists"
  ON game_wishlists FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Game reviews
CREATE TABLE IF NOT EXISTS marketplace_game_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_listing_id uuid NOT NULL REFERENCES marketplace_game_listings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recommended boolean NOT NULL,
  content text DEFAULT '',
  hours_played numeric(8,1) DEFAULT 0,
  helpful_votes int DEFAULT 0,
  is_verified_purchase boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(game_listing_id, user_id)
);

CREATE INDEX idx_game_reviews_game ON marketplace_game_reviews(game_listing_id, created_at DESC);

ALTER TABLE marketplace_game_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view game reviews"
  ON marketplace_game_reviews FOR SELECT
  USING (true);

CREATE POLICY "Verified buyers can review"
  ON marketplace_game_reviews FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Sale pricing
ALTER TABLE marketplace_game_listings
  ADD COLUMN IF NOT EXISTS discount_percent int DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS sale_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS total_reviews int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS positive_review_pct numeric(5,2) DEFAULT 0;

-- Game bundles
CREATE TABLE IF NOT EXISTS game_bundles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text DEFAULT '',
  cover_url text,
  bundle_price_cents int NOT NULL,
  status text DEFAULT 'active' CHECK (status IN ('active', 'paused', 'expired')),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  starts_at timestamptz DEFAULT now(),
  ends_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS game_bundle_items (
  bundle_id uuid NOT NULL REFERENCES game_bundles(id) ON DELETE CASCADE,
  game_listing_id uuid NOT NULL REFERENCES marketplace_game_listings(id) ON DELETE CASCADE,
  PRIMARY KEY (bundle_id, game_listing_id)
);

-- Workshop / Mod support
CREATE TABLE IF NOT EXISTS game_mods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_listing_id uuid NOT NULL REFERENCES marketplace_game_listings(id) ON DELETE CASCADE,
  creator_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text DEFAULT '',
  download_url text NOT NULL,
  version text DEFAULT '1.0.0',
  download_count int DEFAULT 0,
  rating_sum int DEFAULT 0,
  rating_count int DEFAULT 0,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'removed')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_game_mods_game ON game_mods(game_listing_id, status);

ALTER TABLE game_mods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view approved mods"
  ON game_mods FOR SELECT
  USING (status = 'approved' OR creator_id = auth.uid());

CREATE POLICY "Users can upload mods"
  ON game_mods FOR INSERT
  WITH CHECK (auth.uid() = creator_id);

-- ---------------------------------------------------------------------------
-- 6. Tiered Commission Structure
-- Override the flat 4% with seller-level-based fees.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_seller_commission_bps(p_user_id uuid)
RETURNS int LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_clearance text;
  v_trust_tier text;
BEGIN
  SELECT clearance_level INTO v_clearance
  FROM marketplace_seller_profiles
  WHERE user_id = p_user_id;

  SELECT trust_tier INTO v_trust_tier
  FROM user_growth_capabilities
  WHERE user_id = p_user_id;

  -- Operator/Trusted: 3%
  IF v_trust_tier IN ('operator', 'trusted') THEN
    RETURN 300;
  END IF;

  -- Level III: 4%
  IF v_clearance = 'level_iii' THEN
    RETURN 400;
  END IF;

  -- Level II: 7%
  IF v_clearance = 'level_ii' THEN
    RETURN 700;
  END IF;

  -- Level I or default: 10%
  RETURN 1000;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Forum Channels (Phase 7 pre-work)
-- Extend channel types to support forums.
-- ---------------------------------------------------------------------------
ALTER TABLE channels
  DROP CONSTRAINT IF EXISTS channels_type_check;

ALTER TABLE channels
  ADD CONSTRAINT channels_type_check
  CHECK (type IN ('text', 'voice', 'announcement', 'forum', 'stage'));

-- Forum post tags
CREATE TABLE IF NOT EXISTS forum_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text DEFAULT '#6366f1',
  sort_order int DEFAULT 0,
  UNIQUE(channel_id, name)
);

-- Forum post-tag junction (posts are messages with parent_message_id = NULL in forum channels)
CREATE TABLE IF NOT EXISTS forum_post_tags (
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES forum_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (message_id, tag_id)
);

-- Scheduled events
CREATE TABLE IF NOT EXISTS scheduled_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  channel_id uuid REFERENCES channels(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  title text NOT NULL,
  description text DEFAULT '',
  cover_url text,
  start_time timestamptz NOT NULL,
  end_time timestamptz,
  recurrence text, -- 'daily', 'weekly', 'monthly', null
  status text DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'active', 'completed', 'cancelled')),
  rsvp_count int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_events_community ON scheduled_events(community_id, start_time);

ALTER TABLE scheduled_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Community members can view events"
  ON scheduled_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM community_members cm
      WHERE cm.community_id = scheduled_events.community_id
        AND cm.user_id = auth.uid()
    )
  );

CREATE POLICY "Community admins can manage events"
  ON scheduled_events FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM community_members cm
      WHERE cm.community_id = scheduled_events.community_id
        AND cm.user_id = auth.uid()
        AND cm.role IN ('owner', 'admin', 'moderator')
    )
  );

-- Event RSVPs
CREATE TABLE IF NOT EXISTS event_rsvps (
  event_id uuid NOT NULL REFERENCES scheduled_events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text DEFAULT 'going' CHECK (status IN ('going', 'maybe', 'not_going')),
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);

ALTER TABLE event_rsvps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own RSVPs"
  ON event_rsvps FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
