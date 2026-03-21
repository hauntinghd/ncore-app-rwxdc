/*
  # Group DM metadata + edit policy

  1) Adds group-chat metadata fields:
     - direct_conversations.icon_url
     - direct_conversations.updated_at
  2) Ensures updated_at auto-refreshes on UPDATE.
  3) Allows authenticated group members to update group DM metadata.
*/

ALTER TABLE public.direct_conversations
ADD COLUMN IF NOT EXISTS icon_url text;

ALTER TABLE public.direct_conversations
ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

DROP TRIGGER IF EXISTS update_direct_conversations_updated_at ON public.direct_conversations;
CREATE TRIGGER update_direct_conversations_updated_at
  BEFORE UPDATE ON public.direct_conversations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP POLICY IF EXISTS "direct_conversations_update_group_members" ON public.direct_conversations;
CREATE POLICY "direct_conversations_update_group_members"
  ON public.direct_conversations FOR UPDATE TO authenticated
  USING (
    is_group = true
    AND EXISTS (
      SELECT 1
      FROM public.direct_conversation_members dcm
      WHERE dcm.conversation_id = direct_conversations.id
        AND dcm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    is_group = true
    AND EXISTS (
      SELECT 1
      FROM public.direct_conversation_members dcm
      WHERE dcm.conversation_id = direct_conversations.id
        AND dcm.user_id = auth.uid()
    )
  );
