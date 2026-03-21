/*
  # Group DM member management policies

  Expands DM membership policies so group-chat members can manage roster
  (add/remove participants), while preserving direct-DM and creator flows.
*/

DROP POLICY IF EXISTS "direct_conversation_members_insert" ON public.direct_conversation_members;
CREATE POLICY "direct_conversation_members_insert"
  ON public.direct_conversation_members FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR public.is_dm_creator(conversation_id, auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.direct_conversations dc
      WHERE dc.id = conversation_id
        AND dc.is_group = true
        AND public.is_dm_participant(dc.id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "direct_conversation_members_delete" ON public.direct_conversation_members;
CREATE POLICY "direct_conversation_members_delete"
  ON public.direct_conversation_members FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_dm_creator(conversation_id, auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.direct_conversations dc
      WHERE dc.id = direct_conversation_members.conversation_id
        AND dc.is_group = true
        AND public.is_dm_participant(dc.id, auth.uid())
    )
  );
