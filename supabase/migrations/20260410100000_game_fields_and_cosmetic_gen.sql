-- Game marketplace enhancements (Steam-like)
ALTER TABLE marketplace_game_listings
  ADD COLUMN IF NOT EXISTS screenshots text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS system_requirements jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS short_description text DEFAULT '',
  ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}';

-- Cosmetic auto-generation tracking
ALTER TABLE store_products
  ADD COLUMN IF NOT EXISTS auto_generated boolean DEFAULT false;
