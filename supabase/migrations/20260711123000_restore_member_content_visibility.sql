-- Restore member-visible records that were hidden by faulty RLS predicates.
-- Data was never removed: the prior direct-conversation policy compared the
-- member table's conversation_id to its own row id instead of the outer
-- direct_conversations.id, which filtered every participant-owned thread.

DROP POLICY IF EXISTS "direct_conversations_select" ON public.direct_conversations;
CREATE POLICY "direct_conversations_select"
  ON public.direct_conversations FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.direct_conversation_members AS dcm
      WHERE dcm.conversation_id = public.direct_conversations.id
        AND dcm.user_id = auth.uid()
    )
  );

-- A member must be able to see a private community they have joined. The
-- community_members read policy is deliberately non-recursive, so this is a
-- safe membership lookup without an RLS recursion loop.
DROP POLICY IF EXISTS "communities_select" ON public.communities;
CREATE POLICY "communities_select"
  ON public.communities FOR SELECT TO authenticated
  USING (
    visibility = 'public'
    OR owner_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.community_members AS cm
      WHERE cm.community_id = public.communities.id
        AND cm.user_id = auth.uid()
    )
  );
