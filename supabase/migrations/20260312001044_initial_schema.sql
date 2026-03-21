
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
CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER communities_updated_at
  BEFORE UPDATE ON communities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER courses_updated_at
  BEFORE UPDATE ON courses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER messages_updated_at
  BEFORE UPDATE ON messages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

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
  ON messages FOR UPDATE TO authenticated
  USING (author_id = auth.uid()) WITH CHECK (author_id = auth.uid());

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
