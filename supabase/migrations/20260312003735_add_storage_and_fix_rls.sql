/*
  # Add Storage Buckets and Fix RLS Policies

  1. Storage
    - Create `avatars` bucket for user profile pictures (public read, auth write)
    - Create `community-assets` bucket for community icons/banners (public read, auth write)

  2. RLS Fixes
    - Fix communities INSERT policy to allow any authenticated user to create a community
    - Fix community_members INSERT policy so owner can add themselves on creation
    - Fix servers INSERT policy for community owners
    - Fix channel_categories and channels INSERT policies

  3. Notes
    - Storage policies use storage.objects table
    - All buckets are public for reading (avatars/icons are non-sensitive)
*/

-- Create storage buckets
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES 
  ('avatars', 'avatars', true, 5242880, ARRAY['image/jpeg','image/png','image/gif','image/webp']),
  ('community-assets', 'community-assets', true, 10485760, ARRAY['image/jpeg','image/png','image/gif','image/webp'])
ON CONFLICT (id) DO NOTHING;

-- Storage policies for avatars bucket
CREATE POLICY "Avatar images are publicly viewable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

CREATE POLICY "Users can upload their own avatar"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can update their own avatar"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete their own avatar"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Storage policies for community-assets bucket
CREATE POLICY "Community assets are publicly viewable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'community-assets');

CREATE POLICY "Authenticated users can upload community assets"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'community-assets');

CREATE POLICY "Community asset owners can update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'community-assets' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Drop and recreate communities INSERT policy to allow any authenticated user
DROP POLICY IF EXISTS "Authenticated users can create communities" ON communities;
CREATE POLICY "Authenticated users can create communities"
  ON communities FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = owner_id);

-- Fix community_members INSERT - allow users to join (insert themselves)
DROP POLICY IF EXISTS "Community owners can manage members" ON community_members;
CREATE POLICY "Users can add themselves to communities"
  ON community_members FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Fix servers INSERT - allow community owners to create servers
DROP POLICY IF EXISTS "Community owners can create servers" ON servers;
CREATE POLICY "Community owners can create servers"
  ON servers FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = owner_id);

-- Fix channel_categories INSERT
DROP POLICY IF EXISTS "Server owners can manage categories" ON channel_categories;
CREATE POLICY "Server owners can create categories"
  ON channel_categories FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM servers
      WHERE servers.id = channel_categories.server_id
      AND servers.owner_id = auth.uid()
    )
  );

-- Fix channels INSERT
DROP POLICY IF EXISTS "Server owners can manage channels" ON channels;
CREATE POLICY "Server owners can create channels"
  ON channels FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM servers
      WHERE servers.id = channels.server_id
      AND servers.owner_id = auth.uid()
    )
  );
