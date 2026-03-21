-- Combined migrations for NYPTID project
-- Generated: 2026-03-12
-- Run this file in Supabase SQL Editor or via psql to apply schema changes.

-- ==========================================================
-- FILE: 20260312001044_initial_schema.sql
-- ==========================================================
/*
  # NYPTID Platform - Initial Schema

  ## Overview
  Full database schema for the NYPTID unified learning and community platform.
  All tables are created first, then RLS is enabled, then policies are applied.
  This ensures foreign key references in policies are valid.

  ## Tables
  profiles, communities, community_members, courses, lessons, lesson_progress,
  servers, channel_categories, channels, messages, message_reactions,
  message_attachments, direct_conversations, direct_conversation_members,
  direct_messages, voice_sessions, notifications, achievements,
  user_achievements, platform_bans

  ## Security
  - RLS enabled on every table
  - Owner account (omatic657@gmail.com) gets platform_role = 'owner' via trigger
*/

-- ============================================================
-- UTILITY FUNCTION
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- CREATE ALL TABLES FIRST
-- ============================================================

CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username text UNIQUE NOT NULL,
  display_name text,
  avatar_url text,
  bio text DEFAULT '',
  platform_role text DEFAULT 'user' CHECK (platform_role IN ('owner', 'admin', 'moderator', 'user')),
  rank text DEFAULT 'Newcomer',
  xp integer DEFAULT 0,
  status text DEFAULT 'online' CHECK (status IN ('online', 'idle', 'dnd', 'invisible', 'offline')),
  last_seen timestamptz DEFAULT now(),
  is_banned boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS communities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  description text DEFAULT '',
  icon_url text,
  banner_url text,
  category text DEFAULT 'General',
  visibility text DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  owner_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  member_count integer DEFAULT 1,
  is_featured boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS community_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid REFERENCES communities(id) ON DELETE CASCADE,
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  role text DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'moderator', 'member')),
  joined_at timestamptz DEFAULT now(),
  UNIQUE(community_id, user_id)
);

CREATE TABLE IF NOT EXISTS courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid REFERENCES communities(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text DEFAULT '',
  thumbnail_url text,
  order_index integer DEFAULT 0,
  is_published boolean DEFAULT false,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid REFERENCES courses(id) ON DELETE CASCADE,
  title text NOT NULL,
  content_type text DEFAULT 'video' CHECK (content_type IN ('video', 'text', 'quiz')),
  content_url text,
  content_text text,
  order_index integer DEFAULT 0,
  duration_minutes integer DEFAULT 0,
  is_published boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lesson_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  lesson_id uuid REFERENCES lessons(id) ON DELETE CASCADE,
  completed boolean DEFAULT false,
  completed_at timestamptz,
  UNIQUE(user_id, lesson_id)
);

CREATE TABLE IF NOT EXISTS servers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid REFERENCES communities(id) ON DELETE CASCADE,
  name text NOT NULL,
  icon_url text,
  owner_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS channel_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id uuid REFERENCES servers(id) ON DELETE CASCADE,
  name text NOT NULL,
  order_index integer DEFAULT 0
);

CREATE TABLE IF NOT EXISTS channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id uuid REFERENCES servers(id) ON DELETE CASCADE,
  category_id uuid REFERENCES channel_categories(id) ON DELETE SET NULL,
  name text NOT NULL,
  channel_type text DEFAULT 'text' CHECK (channel_type IN ('text', 'voice', 'announcement')),
  description text DEFAULT '',
  order_index integer DEFAULT 0,
  is_private boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid REFERENCES channels(id) ON DELETE CASCADE,
  author_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  content text NOT NULL,
  is_edited boolean DEFAULT false,
  is_pinned boolean DEFAULT false,
  parent_message_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS message_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid REFERENCES messages(id) ON DELETE CASCADE,
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  emoji text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(message_id, user_id, emoji)
);

CREATE TABLE IF NOT EXISTS message_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid REFERENCES messages(id) ON DELETE CASCADE,
  file_url text NOT NULL,
  file_name text NOT NULL,
  file_type text DEFAULT '',
  file_size integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS direct_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  is_group boolean DEFAULT false,
  name text,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS direct_conversation_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES direct_conversations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  last_read_at timestamptz DEFAULT now(),
  UNIQUE(conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS direct_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES direct_conversations(id) ON DELETE CASCADE,
  author_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  content text NOT NULL,
  is_edited boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS voice_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid REFERENCES channels(id) ON DELETE CASCADE,
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  is_muted boolean DEFAULT false,
  is_deafened boolean DEFAULT false,
  is_camera_on boolean DEFAULT false,
  is_screen_sharing boolean DEFAULT false,
  joined_at timestamptz DEFAULT now(),
  UNIQUE(channel_id, user_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  body text DEFAULT '',
  data jsonb DEFAULT '{}'::jsonb,
  is_read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS achievements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text DEFAULT '',
  icon text DEFAULT 'trophy',
  xp_reward integer DEFAULT 100,
  criteria_type text DEFAULT 'manual',
  criteria_value integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_achievements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  achievement_id uuid REFERENCES achievements(id) ON DELETE CASCADE,
  earned_at timestamptz DEFAULT now(),
  UNIQUE(user_id, achievement_id)
);

CREATE TABLE IF NOT EXISTS platform_bans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  banned_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  reason text DEFAULT '',
  expires_at timestamptz,
  is_permanent boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS messages_channel_id_idx ON messages(channel_id);
CREATE INDEX IF NOT EXISTS messages_created_at_idx ON messages(created_at);
CREATE INDEX IF NOT EXISTS direct_messages_conversation_id_idx ON direct_messages(conversation_id);
CREATE INDEX IF NOT EXISTS notifications_user_id_idx ON notifications(user_id);
CREATE INDEX IF NOT EXISTS notifications_created_at_idx ON notifications(created_at);

-- ============================================================
-- TRIGGERS
-- ============================================================
DROP TRIGGER IF EXISTS profiles_updated_at ON profiles;
CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS communities_updated_at ON communities;
CREATE TRIGGER communities_updated_at
  BEFORE UPDATE ON communities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS courses_updated_at ON courses;
CREATE TRIGGER courses_updated_at
  BEFORE UPDATE ON courses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS messages_updated_at ON messages;
CREATE TRIGGER messages_updated_at
  BEFORE UPDATE ON messages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS direct_messages_updated_at ON direct_messages;
CREATE TRIGGER direct_messages_updated_at
  BEFORE UPDATE ON direct_messages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Auto-assign owner role based on email
CREATE OR REPLACE FUNCTION handle_new_profile()
RETURNS trigger AS $$
DECLARE
  user_email text;
BEGIN
  SELECT email INTO user_email FROM auth.users WHERE id = NEW.id;
  IF user_email = 'omatic657@gmail.com' THEN
    NEW.platform_role := 'owner';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS set_owner_role ON profiles;
CREATE TRIGGER set_owner_role
  BEFORE INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION handle_new_profile();

-- Update community member count
CREATE OR REPLACE FUNCTION update_community_member_count()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE communities SET member_count = member_count + 1 WHERE id = NEW.community_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE communities SET member_count = GREATEST(member_count - 1, 0) WHERE id = OLD.community_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS community_member_count_trigger ON community_members;
CREATE TRIGGER community_member_count_trigger
  AFTER INSERT OR DELETE ON community_members
  FOR EACH ROW EXECUTE FUNCTION update_community_member_count();

-- ============================================================
-- ENABLE RLS ON ALL TABLES
-- ============================================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE communities ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE lesson_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE servers ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE direct_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE direct_conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE direct_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_bans ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- RLS POLICIES
-- ============================================================

-- profiles
CREATE POLICY "Profiles viewable by authenticated"
  ON profiles FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE POLICY "Platform owners/admins can update any profile"
  ON profiles FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.platform_role IN ('owner', 'admin')));

-- communities
CREATE POLICY "Public communities viewable"
  ON communities FOR SELECT TO authenticated
  USING (
    visibility = 'public' OR owner_id = auth.uid() OR
    EXISTS (SELECT 1 FROM community_members cm WHERE cm.community_id = communities.id AND cm.user_id = auth.uid())
  );

CREATE POLICY "Authenticated users can create communities"
  ON communities FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Community owners/admins can update"
  ON communities FOR UPDATE TO authenticated
  USING (
    owner_id = auth.uid() OR
    EXISTS (SELECT 1 FROM community_members cm WHERE cm.community_id = communities.id AND cm.user_id = auth.uid() AND cm.role IN ('owner', 'admin')) OR
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.platform_role IN ('owner', 'admin'))
  );

CREATE POLICY "Platform owners can delete communities"
  ON communities FOR DELETE TO authenticated
  USING (
    owner_id = auth.uid() OR
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.platform_role IN ('owner', 'admin'))
  );

-- community_members
CREATE POLICY "Members can view community members"
  ON community_members FOR SELECT TO authenticated
  USING (
    user_id = auth.uid() OR
    EXISTS (SELECT 1 FROM community_members cm2 WHERE cm2.community_id = community_members.community_id AND cm2.user_id = auth.uid())
  );

CREATE POLICY "Users can join communities"
  ON community_members FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can leave communities"
  ON community_members FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Admins can update member roles"
  ON community_members FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM community_members cm WHERE cm.community_id = community_members.community_id AND cm.user_id = auth.uid() AND cm.role IN ('owner', 'admin'))
  );

-- courses
CREATE POLICY "Members can view published courses"
  ON courses FOR SELECT TO authenticated
  USING (
    is_published = true AND
    EXISTS (SELECT 1 FROM community_members cm WHERE cm.community_id = courses.community_id AND cm.user_id = auth.uid())
  );

CREATE POLICY "Admins can view all courses"
  ON courses FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM community_members cm WHERE cm.community_id = courses.community_id AND cm.user_id = auth.uid() AND cm.role IN ('owner', 'admin')) OR
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.platform_role IN ('owner', 'admin'))
  );

CREATE POLICY "Admins can create courses"
  ON courses FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM community_members cm WHERE cm.community_id = courses.community_id AND cm.user_id = auth.uid() AND cm.role IN ('owner', 'admin'))
  );

CREATE POLICY "Admins can update courses"
  ON courses FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM community_members cm WHERE cm.community_id = courses.community_id AND cm.user_id = auth.uid() AND cm.role IN ('owner', 'admin'))
  );

-- lessons
CREATE POLICY "Members can view published lessons"
  ON lessons FOR SELECT TO authenticated
  USING (
    is_published = true AND
    EXISTS (
      SELECT 1 FROM courses c
      JOIN community_members cm ON cm.community_id = c.community_id
      WHERE c.id = lessons.course_id AND cm.user_id = auth.uid()
    )
  );

CREATE POLICY "Admins can manage lessons"
  ON lessons FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM courses c
      JOIN community_members cm ON cm.community_id = c.community_id
      WHERE c.id = lessons.course_id AND cm.user_id = auth.uid() AND cm.role IN ('owner', 'admin')
    )
  );

CREATE POLICY "Admins can update lessons"
  ON lessons FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM courses c
      JOIN community_members cm ON cm.community_id = c.community_id
      WHERE c.id = lessons.course_id AND cm.user_id = auth.uid() AND cm.role IN ('owner', 'admin')
    )
  );

-- lesson_progress
CREATE POLICY "Users can view own progress"
  ON lesson_progress FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Users can insert own progress"
  ON lesson_progress FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own progress"
  ON lesson_progress FOR UPDATE TO authenticated USING (user_id = auth.uid());

-- servers
CREATE POLICY "Community members can view servers"
  ON servers FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM community_members cm WHERE cm.community_id = servers.community_id AND cm.user_id = auth.uid())
  );

CREATE POLICY "Community admins can create servers"
  ON servers FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM community_members cm WHERE cm.community_id = servers.community_id AND cm.user_id = auth.uid() AND cm.role IN ('owner', 'admin'))
  );

-- channel_categories
CREATE POLICY "Members can view channel categories"
  ON channel_categories FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM servers s
      JOIN community_members cm ON cm.community_id = s.community_id
      WHERE s.id = channel_categories.server_id AND cm.user_id = auth.uid()
    )
  );

CREATE POLICY "Admins can manage channel categories"
  ON channel_categories FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM servers s
      JOIN community_members cm ON cm.community_id = s.community_id
      WHERE s.id = channel_categories.server_id AND cm.user_id = auth.uid() AND cm.role IN ('owner', 'admin')
    )
  );

CREATE POLICY "Admins can update channel categories"
  ON channel_categories FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM servers s
      JOIN community_members cm ON cm.community_id = s.community_id
      WHERE s.id = channel_categories.server_id AND cm.user_id = auth.uid() AND cm.role IN ('owner', 'admin')
    )
  );

CREATE POLICY "Admins can delete channel categories"
  ON channel_categories FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM servers s
      JOIN community_members cm ON cm.community_id = s.community_id
      WHERE s.id = channel_categories.server_id AND cm.user_id = auth.uid() AND cm.role IN ('owner', 'admin')
    )
  );

-- channels
CREATE POLICY "Members can view channels"
  ON channels FOR SELECT TO authenticated
  USING (
    is_private = false AND
    EXISTS (
      SELECT 1 FROM servers s
      JOIN community_members cm ON cm.community_id = s.community_id
      WHERE s.id = channels.server_id AND cm.user_id = auth.uid()
    )
  );

CREATE POLICY "Admins can create channels"
  ON channels FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM servers s
      JOIN community_members cm ON cm.community_id = s.community_id
      WHERE s.id = channels.server_id AND cm.user_id = auth.uid() AND cm.role IN ('owner', 'admin')
    )
  );

CREATE POLICY "Admins can update channels"
  ON channels FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM servers s
      JOIN community_members cm ON cm.community_id = s.community_id
      WHERE s.id = channels.server_id AND cm.user_id = auth.uid() AND cm.role IN ('owner', 'admin')
    )
  );

CREATE POLICY "Admins can delete channels"
  ON channels FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM servers s
      JOIN community_members cm ON cm.community_id = s.community_id
      WHERE s.id = channels.server_id AND cm.user_id = auth.uid() AND cm.role IN ('owner', 'admin')
    )
  );

-- messages
CREATE POLICY "Members can view messages"
  ON messages FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM channels ch
      JOIN servers s ON s.id = ch.server_id
      JOIN community_members cm ON cm.community_id = s.community_id
      WHERE ch.id = messages.channel_id AND cm.user_id = auth.uid()
    )
  );

CREATE POLICY "Members can send messages"
  ON messages FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = author_id AND
    EXISTS (
      SELECT 1 FROM channels ch
      JOIN servers s ON s.id = ch.server_id
      JOIN community_members cm ON cm.community_id = s.community_id
      WHERE ch.id = messages.channel_id AND cm.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can edit own messages"
  ON messages FOR UPDATE TO authenticated USING (author_id = auth.uid()) WITH CHECK (author_id = auth.uid());

CREATE POLICY "Users or mods can delete messages"
  ON messages FOR DELETE TO authenticated
  USING (
    author_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM channels ch
      JOIN servers s ON s.id = ch.server_id
      JOIN community_members cm ON cm.community_id = s.community_id
      WHERE ch.id = messages.channel_id AND cm.user_id = auth.uid() AND cm.role IN ('owner', 'admin', 'moderator')
    )
  );

-- message_reactions
CREATE POLICY "Members can view reactions"
  ON message_reactions FOR SELECT TO authenticated USING (true);

CREATE POLICY "Members can add reactions"
  ON message_reactions FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can remove own reactions"
  ON message_reactions FOR DELETE TO authenticated USING (user_id = auth.uid());

-- message_attachments
CREATE POLICY "Members can view attachments"
  ON message_attachments FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can add attachments to own messages"
  ON message_attachments FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM messages m WHERE m.id = message_attachments.message_id AND m.author_id = auth.uid()));

-- direct_conversations
CREATE POLICY "Participants can view conversations"
  ON direct_conversations FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM direct_conversation_members dcm WHERE dcm.conversation_id = direct_conversations.id AND dcm.user_id = auth.uid()));

CREATE POLICY "Authenticated users can create conversations"
  ON direct_conversations FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);

-- direct_conversation_members
CREATE POLICY "Participants can view DM members"
  ON direct_conversation_members FOR SELECT TO authenticated
  USING (
    user_id = auth.uid() OR
    EXISTS (SELECT 1 FROM direct_conversation_members dcm2 WHERE dcm2.conversation_id = direct_conversation_members.conversation_id AND dcm2.user_id = auth.uid())
  );

CREATE POLICY "Users can join conversations"
  ON direct_conversation_members FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid() OR
    EXISTS (SELECT 1 FROM direct_conversations dc WHERE dc.id = direct_conversation_members.conversation_id AND dc.created_by = auth.uid())
  );

CREATE POLICY "Users can update own DM membership"
  ON direct_conversation_members FOR UPDATE TO authenticated USING (user_id = auth.uid());

-- direct_messages
CREATE POLICY "Participants can view DMs"
  ON direct_messages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM direct_conversation_members dcm WHERE dcm.conversation_id = direct_messages.conversation_id AND dcm.user_id = auth.uid()));

CREATE POLICY "Participants can send DMs"
  ON direct_messages FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid() AND
    EXISTS (SELECT 1 FROM direct_conversation_members dcm WHERE dcm.conversation_id = direct_messages.conversation_id AND dcm.user_id = auth.uid())
  );

CREATE POLICY "Users can edit own DMs"
  ON direct_messages FOR UPDATE TO authenticated USING (author_id = auth.uid());

CREATE POLICY "Users can delete own DMs"
  ON direct_messages FOR DELETE TO authenticated USING (author_id = auth.uid());

-- voice_sessions
CREATE POLICY "Members can view voice sessions"
  ON voice_sessions FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can join voice channels"
  ON voice_sessions FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own voice session"
  ON voice_sessions FOR UPDATE TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Users can leave voice channels"
  ON voice_sessions FOR DELETE TO authenticated USING (user_id = auth.uid());

-- notifications
CREATE POLICY "Users can view own notifications"
  ON notifications FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "System can create notifications"
  ON notifications FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Users can update own notifications"
  ON notifications FOR UPDATE TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Users can delete own notifications"
  ON notifications FOR DELETE TO authenticated USING (user_id = auth.uid());

-- achievements
CREATE POLICY "All users can view achievements"
  ON achievements FOR SELECT TO authenticated USING (true);

CREATE POLICY "Platform owners can manage achievements"
  ON achievements FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.platform_role IN ('owner', 'admin')));

CREATE POLICY "Platform owners can update achievements"
  ON achievements FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.platform_role IN ('owner', 'admin')));

-- user_achievements
CREATE POLICY "Users can view achievements"
  ON user_achievements FOR SELECT TO authenticated USING (true);

CREATE POLICY "System can award achievements"
  ON user_achievements FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- platform_bans
CREATE POLICY "Owners and admins can view bans"
  ON platform_bans FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.platform_role IN ('owner', 'admin')));

CREATE POLICY "Owners and admins can create bans"
  ON platform_bans FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.platform_role IN ('owner', 'admin')));

CREATE POLICY "Owners and admins can delete bans"
  ON platform_bans FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.platform_role IN ('owner', 'admin')));

-- ============================================================
-- ENABLE REALTIME
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE direct_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE voice_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE profiles;
ALTER PUBLICATION supabase_realtime ADD TABLE message_reactions;

-- ============================================================
-- SEED: Default achievements
-- ============================================================
INSERT INTO achievements (name, description, icon, xp_reward, criteria_type, criteria_value) VALUES
  ('First Steps', 'Complete your first lesson', 'book-open', 50, 'lessons_completed', 1),
  ('Getting Started', 'Complete 10 lessons', 'graduation-cap', 150, 'lessons_completed', 10),
  ('Scholar', 'Complete 50 lessons', 'award', 500, 'lessons_completed', 50),
  ('Community Builder', 'Join your first community', 'users', 25, 'communities_joined', 1),
  ('Social Butterfly', 'Send 100 messages', 'message-circle', 100, 'messages_sent', 100),
  ('Top Contributor', 'Reach 1000 XP', 'star', 200, 'xp_reached', 1000),
  ('Elite Member', 'Reach 5000 XP', 'crown', 500, 'xp_reached', 5000)
ON CONFLICT DO NOTHING;


-- ==========================================================
-- FILE: 20260312003735_add_storage_and_fix_rls.sql
-- ==========================================================
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
  ON communities FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = owner_id);

-- Fix community_members INSERT - allow users to join (insert themselves)
DROP POLICY IF EXISTS "Community owners can manage members" ON community_members;
CREATE POLICY "Users can add themselves to communities"
  ON community_members FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Fix servers INSERT - allow community owners to create servers
DROP POLICY IF EXISTS "Community owners can create servers" ON servers;
CREATE POLICY "Community owners can create servers"
  ON servers FOR INSERT TO authenticated
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


-- ==========================================================
-- FILE: 20260312011810_add_server_profiles_and_standing.sql
-- ==========================================================
/*
  # Add Per-Server Profiles and Account Standing

  ## New Tables

  ### `server_profiles`
  - Allows users to have custom display names, avatars, and bios per community/server
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


-- ==========================================================
-- FILE: 20260312013311_allow_public_stats_queries.sql
-- ==========================================================
CREATE POLICY "Public can count public communities"
  ON communities FOR SELECT
  TO anon
  USING (visibility = 'public');

CREATE POLICY "Public can count messages"
  ON messages FOR SELECT
  TO anon
  USING (true);


-- ==========================================================
-- FILE: 20260312013322_allow_anon_profile_count.sql
-- ==========================================================
CREATE POLICY "Public can count profiles"
  ON profiles FOR SELECT
  TO anon
  USING (true);


-- ==========================================================
-- FILE: 20260312021000_fix_recursive_rls_dm_calls_and_roles.sql
-- ==========================================================
CREATE OR REPLACE FUNCTION public.is_platform_admin(target_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = target_user_id
      AND p.platform_role IN ('owner', 'admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_community_member(target_community_id uuid, target_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.community_members cm
    WHERE cm.community_id = target_community_id
      AND cm.user_id = target_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.is_community_admin(target_community_id uuid, target_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.community_members cm
    WHERE cm.community_id = target_community_id
      AND cm.user_id = target_user_id
      AND cm.role IN ('owner', 'admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_dm_participant(target_conversation_id uuid, target_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.direct_conversation_members dcm
    WHERE dcm.conversation_id = target_conversation_id
      AND dcm.user_id = target_user_id
  );
$$;

DROP POLICY IF EXISTS "Members can view community members" ON community_members;
CREATE POLICY "Members can view community members"
  ON community_members FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_community_member(community_id, auth.uid())
  );

DROP POLICY IF EXISTS "Admins can update member roles" ON community_members;
CREATE POLICY "Admins can update member roles"
  ON community_members FOR UPDATE TO authenticated
  USING (public.is_community_admin(community_id, auth.uid()))
  WITH CHECK (public.is_community_admin(community_id, auth.uid()));

DROP POLICY IF EXISTS "Participants can view DM members" ON direct_conversation_members;
CREATE POLICY "Participants can view DM members"
  ON direct_conversation_members FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_dm_participant(conversation_id, auth.uid())
  );

DROP POLICY IF EXISTS "Users can join conversations" ON direct_conversation_members;
CREATE POLICY "Users can join conversations"
  ON direct_conversation_members FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM direct_conversations dc
      WHERE dc.id = direct_conversation_members.conversation_id
        AND dc.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update own DM membership" ON direct_conversation_members;
CREATE POLICY "Users can update own DM membership"
  ON direct_conversation_members FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

UPDATE public.profiles
SET platform_role = 'user'
WHERE platform_role IN ('admin', 'moderator')
  AND id NOT IN (
    SELECT u.id
    FROM auth.users u
    WHERE lower(u.email) = 'omatic657@gmail.com'
  );


-- ==========================================================
-- FILE: 20260312024500_hard_reset_community_dm_rls.sql
-- ==========================================================
CREATE OR REPLACE FUNCTION public.is_community_member(target_community_id uuid, target_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.community_members cm
    WHERE cm.community_id = target_community_id
      AND cm.user_id = target_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.is_community_admin(target_community_id uuid, target_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.community_members cm
    WHERE cm.community_id = target_community_id
      AND cm.user_id = target_user_id
      AND cm.role IN ('owner', 'admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_dm_participant(target_conversation_id uuid, target_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.direct_conversation_members dcm
    WHERE dcm.conversation_id = target_conversation_id
      AND dcm.user_id = target_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.is_dm_creator(target_conversation_id uuid, target_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.direct_conversations dc
    WHERE dc.id = target_conversation_id
      AND dc.created_by = target_user_id
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_community_member(uuid, uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_community_admin(uuid, uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_dm_participant(uuid, uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_dm_creator(uuid, uuid) TO authenticated, anon;

CREATE POLICY "Members can view community members"
  ON public.community_members FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_community_member(community_id, auth.uid())
  );

CREATE POLICY "Users can join conversations"
  ON public.direct_conversations FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Participants can view DM members"
  ON public.direct_conversation_members FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_dm_participant(conversation_id, auth.uid())
  );

CREATE POLICY "Users can join conversations"
  ON public.direct_conversation_members FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR public.is_dm_creator(conversation_id, auth.uid())
  );

CREATE POLICY "Participants can view DMs"
  ON public.direct_messages FOR SELECT TO authenticated
  USING (public.is_dm_participant(conversation_id, auth.uid()));


-- ==========================================================
-- FILE: 20260312032000_force_reset_recursive_policies.sql
-- ==========================================================
CREATE OR REPLACE FUNCTION public.is_community_member(target_community_id uuid, target_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.community_members cm
    WHERE cm.community_id = target_community_id
      AND cm.user_id = target_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.is_community_admin(target_community_id uuid, target_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.community_members cm
    WHERE cm.community_id = target_community_id
      AND cm.user_id = target_user_id
      AND cm.role IN ('owner', 'admin')
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_community_member(uuid, uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_community_admin(uuid, uuid) TO authenticated, anon;

DO $$
DECLARE
  p RECORD;
BEGIN
  FOR p IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'community_members'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.community_members', p.policyname);
  END LOOP;
END $$;

DO $$
DECLARE
  p RECORD;
BEGIN
  FOR p IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'communities'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.communities', p.policyname);
  END LOOP;
END $$;

CREATE POLICY "Public communities viewable"
  ON public.communities FOR SELECT TO authenticated
  USING (
    visibility = 'public'
    OR owner_id = auth.uid()
    OR public.is_community_member(id, auth.uid())
  );

CREATE POLICY "Authenticated users can create communities"
  ON public.communities FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Community owners/admins can update"
  ON public.communities FOR UPDATE TO authenticated
  USING (
    owner_id = auth.uid()
    OR public.is_community_admin(id, auth.uid())
  )
  WITH CHECK (
    owner_id = auth.uid()
    OR public.is_community_admin(id, auth.uid())
  );

CREATE POLICY "Platform owners can delete communities"
  ON public.communities FOR DELETE TO authenticated
  USING (owner_id = auth.uid());

CREATE POLICY "Members can view community members"
  ON public.community_members FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_community_member(community_id, auth.uid())
  );

CREATE POLICY "Users can join communities"
  ON public.community_members FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can leave communities"
  ON public.community_members FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_community_admin(community_id, auth.uid())
  );

CREATE POLICY "Admins can update member roles"
  ON public.community_members FOR UPDATE TO authenticated
  USING (public.is_community_admin(community_id, auth.uid()))
  WITH CHECK (public.is_community_admin(community_id, auth.uid()));


-- ==========================================================
-- FILE: 20260312034500_unblock_realtime_features_now.sql
-- ==========================================================
DO $$
DECLARE
  p RECORD;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'communities',
        'community_members',
        'direct_conversations',
        'direct_conversation_members',
        'direct_messages',
        'voice_sessions'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
  END LOOP;
END $$;

ALTER TABLE public.communities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.direct_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.direct_conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "communities_select"
  ON public.communities FOR SELECT TO authenticated
  USING (
    visibility = 'public'
    OR owner_id = auth.uid()
  );

CREATE POLICY "communities_insert"
  ON public.communities FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "communities_update_owner"
  ON public.communities FOR UPDATE TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "communities_delete_owner"
  ON public.communities FOR DELETE TO authenticated
  USING (owner_id = auth.uid());

CREATE POLICY "community_members_select"
  ON public.community_members FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "community_members_insert_self"
  ON public.community_members FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "community_members_update_self_or_owner"
  ON public.community_members FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.communities c
      WHERE c.id = community_id
        AND c.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.communities c
      WHERE c.id = community_id
        AND c.owner_id = auth.uid()
    )
  );

CREATE POLICY "community_members_delete_self_or_owner"
  ON public.community_members FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.communities c
      WHERE c.id = community_id
        AND c.owner_id = auth.uid()
    )
  );

CREATE POLICY "direct_conversations_select"
  ON public.direct_conversations FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.direct_conversation_members dcm
      WHERE dcm.conversation_id = id
        AND dcm.user_id = auth.uid()
    )
  );

CREATE POLICY "direct_conversations_insert"
  ON public.direct_conversations FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "direct_conversation_members_select"
  ON public.direct_conversation_members FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "direct_conversation_members_insert"
  ON public.direct_conversation_members FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.direct_conversations dc
      WHERE dc.id = conversation_id
        AND dc.created_by = auth.uid()
    )
  );

CREATE POLICY "direct_conversation_members_update_self"
  ON public.direct_conversation_members FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "direct_messages_select"
  ON public.direct_messages FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.direct_conversation_members dcm
      WHERE dcm.conversation_id = direct_messages.conversation_id
        AND dcm.user_id = auth.uid()
    )
  );

CREATE POLICY "direct_messages_insert"
  ON public.direct_messages FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.direct_conversation_members dcm
      WHERE dcm.conversation_id = direct_messages.conversation_id
        AND dcm.user_id = auth.uid()
    )
  );

CREATE POLICY "direct_messages_update_own"
  ON public.direct_messages FOR UPDATE TO authenticated
  USING (author_id = auth.uid())
  WITH CHECK (author_id = auth.uid());

CREATE POLICY "direct_messages_delete_own"
  ON public.direct_messages FOR DELETE TO authenticated
  USING (author_id = auth.uid());

CREATE POLICY "voice_sessions_select"
  ON public.voice_sessions FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "voice_sessions_insert_self"
  ON public.voice_sessions FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "voice_sessions_update_self"
  ON public.voice_sessions FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "voice_sessions_delete_self"
  ON public.voice_sessions FOR DELETE TO authenticated
  USING (user_id = auth.uid());


-- ==========================================================
-- FILE: 20260312041000_transfer_owner_to_caseyh6657.sql
-- ==========================================================
CREATE OR REPLACE FUNCTION public.handle_new_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_email text;
BEGIN
  SELECT email INTO user_email
  FROM auth.users
  WHERE id = NEW.id;

  IF lower(coalesce(user_email, '')) = 'caseyh6657@gmail.com' THEN
    NEW.platform_role := 'owner';
  ELSE
    IF NEW.platform_role = 'owner' THEN
      NEW.platform_role := 'user';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

UPDATE public.profiles
SET platform_role = CASE
  WHEN id IN (
    SELECT id
    FROM auth.users
    WHERE lower(email) = 'caseyh6657@gmail.com'
  ) THEN 'owner'
  WHEN platform_role = 'owner' THEN 'user'
  ELSE platform_role
END;


-- ==========================================================
-- FILE: 20260312120000_add_calls_table.sql
-- ==========================================================
-- Add calls table for call signaling between participants
-- A simple table used to signal incoming calls, ring state, and acceptance
CREATE TABLE IF NOT EXISTS public.calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES public.direct_conversations(id) ON DELETE CASCADE,
  caller_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  callee_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
  state text NOT NULL DEFAULT 'ringing', -- ringing | accepted | declined | ended
  channel_name text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_calls_conversation_id ON public.calls(conversation_id);


-- ==========================================================
-- FILE: 20260312121500_create_user_devices.sql
-- ==========================================================
-- Create user_devices table to store push tokens for users
CREATE TABLE IF NOT EXISTS public.user_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  token text NOT NULL,
  platform text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_devices_user_token ON public.user_devices(user_id, token);

-- ==========================================================
-- END OF COMBINED MIGRATIONS
-- ==========================================================
