/*
  # Hard reset RLS for community/DM flow

  ## Why
  - Some existing policies can recurse on `community_members`.
  - DM creation can fail when policy checks read `direct_conversations`
    before membership rows exist.

  ## What
  - Rebuild helper functions with SECURITY DEFINER.
  - Drop/recreate policies on:
    - community_members
    - direct_conversations
    - direct_conversation_members
    - direct_messages
*/

-- ------------------------------------------------------------
-- Helper functions
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- community_members policies
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Members can view community members" ON public.community_members;
DROP POLICY IF EXISTS "Users can join communities" ON public.community_members;
DROP POLICY IF EXISTS "Users can leave communities" ON public.community_members;
DROP POLICY IF EXISTS "Admins can update member roles" ON public.community_members;
DROP POLICY IF EXISTS "Users can add themselves to communities" ON public.community_members;

CREATE POLICY "Members can view community members"
  ON public.community_members FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_community_member(community_id, auth.uid())
  );

CREATE POLICY "Users can join communities"
  ON public.community_members FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

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

-- ------------------------------------------------------------
-- direct_conversations policies
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Participants can view conversations" ON public.direct_conversations;
DROP POLICY IF EXISTS "Authenticated users can create conversations" ON public.direct_conversations;

CREATE POLICY "Participants can view conversations"
  ON public.direct_conversations FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR public.is_dm_participant(id, auth.uid())
  );

CREATE POLICY "Authenticated users can create conversations"
  ON public.direct_conversations FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by);

-- ------------------------------------------------------------
-- direct_conversation_members policies
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Participants can view DM members" ON public.direct_conversation_members;
DROP POLICY IF EXISTS "Users can join conversations" ON public.direct_conversation_members;
DROP POLICY IF EXISTS "Users can update own DM membership" ON public.direct_conversation_members;

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

CREATE POLICY "Users can update own DM membership"
  ON public.direct_conversation_members FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ------------------------------------------------------------
-- direct_messages policies
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Participants can view DMs" ON public.direct_messages;
DROP POLICY IF EXISTS "Participants can send DMs" ON public.direct_messages;
DROP POLICY IF EXISTS "Users can edit own DMs" ON public.direct_messages;
DROP POLICY IF EXISTS "Users can delete own DMs" ON public.direct_messages;

CREATE POLICY "Participants can view DMs"
  ON public.direct_messages FOR SELECT TO authenticated
  USING (public.is_dm_participant(conversation_id, auth.uid()));

CREATE POLICY "Participants can send DMs"
  ON public.direct_messages FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND public.is_dm_participant(conversation_id, auth.uid())
  );

CREATE POLICY "Users can edit own DMs"
  ON public.direct_messages FOR UPDATE TO authenticated
  USING (author_id = auth.uid())
  WITH CHECK (author_id = auth.uid());

CREATE POLICY "Users can delete own DMs"
  ON public.direct_messages FOR DELETE TO authenticated
  USING (author_id = auth.uid());
