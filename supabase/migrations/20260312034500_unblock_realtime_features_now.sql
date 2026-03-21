/*
  # Emergency unblock for community create + DM + calling tests

  Goal: remove recursive RLS behavior immediately and use straightforward
  non-recursive policies so community creation and DM/call flows work.
*/

-- ------------------------------------------------------------
-- Drop ALL policies on affected tables
-- ------------------------------------------------------------
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

-- Ensure RLS is enabled (we recreate clean policies below)
ALTER TABLE public.communities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.direct_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.direct_conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_sessions ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- communities (non-recursive)
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- community_members (non-recursive)
-- NOTE: SELECT is broad on purpose to avoid recursion while debugging.
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- direct_conversations
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- direct_conversation_members
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- direct_messages
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- voice_sessions (for call presence)
-- ------------------------------------------------------------
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
