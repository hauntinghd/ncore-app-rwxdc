/*
  # Add Per-Server Profiles and Account Standing

  ## New Tables

  ### `server_profiles`
  - Allows users to have custom display names, avatars, and bios per community/server
  - `id` (uuid, primary key)
  - `user_id` (uuid, FK to auth.users)
  - `community_id` (uuid, FK to communities)
  - `display_name` (text, nullable) - server-specific display name
  - `avatar_url` (text, nullable) - server-specific avatar
  - `bio` (text) - server-specific bio
  - `pronouns` (text) - optional pronouns field
  - `banner_url` (text, nullable) - profile banner
  - `created_at`, `updated_at` timestamps

  ### `account_standing_events`
  - Tracks warnings, violations, and positive notes for account standing
  - `id` (uuid, primary key)
  - `user_id` (uuid, FK to profiles)
  - `type` (text) - 'warning', 'violation', 'appeal_approved', 'note'
  - `title` (text) - short description
  - `description` (text) - full details
  - `issued_by` (uuid, nullable) - admin who issued it
  - `resolved` (boolean)
  - `created_at` timestamp

  ## Security
  - RLS enabled on both tables
  - Users can read/write their own server profiles
  - Users can only read their own standing events
  - Only admins/owners can write standing events
*/

CREATE TABLE IF NOT EXISTS server_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  display_name text,
  avatar_url text,
  bio text DEFAULT '',
  pronouns text DEFAULT '',
  banner_url text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, community_id)
);

ALTER TABLE server_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view server profiles in their communities"
  ON server_profiles FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM community_members
      WHERE community_members.community_id = server_profiles.community_id
      AND community_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert their own server profile"
  ON server_profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own server profile"
  ON server_profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS account_standing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'note' CHECK (type IN ('warning', 'violation', 'appeal_approved', 'note', 'restriction')),
  title text NOT NULL,
  description text DEFAULT '',
  issued_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE account_standing_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own standing events"
  ON account_standing_events FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Platform admins can insert standing events"
  ON account_standing_events FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.platform_role IN ('owner', 'admin', 'moderator')
    )
  );

CREATE POLICY "Platform admins can update standing events"
  ON account_standing_events FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.platform_role IN ('owner', 'admin', 'moderator')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.platform_role IN ('owner', 'admin', 'moderator')
    )
  );

CREATE INDEX IF NOT EXISTS idx_server_profiles_user_id ON server_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_server_profiles_community_id ON server_profiles(community_id);
CREATE INDEX IF NOT EXISTS idx_account_standing_user_id ON account_standing_events(user_id);
