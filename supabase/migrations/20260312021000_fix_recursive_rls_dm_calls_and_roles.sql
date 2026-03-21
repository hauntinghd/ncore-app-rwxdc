/*
  # Fix recursive RLS, DM permissions, and non-owner role normalization

  ## Why
  - Some policies were querying the same table they protected (recursive RLS evaluation),
    which triggers "infinite recursion detected in policy".
  - DM membership checks could fail because recursive policy evaluation prevented reads/writes.
  - Non-owner elevated roles should be normalized when strict owner-only platform control is desired.

  ## What
  1) Add SECURITY DEFINER helper functions for membership/role checks.
  2) Replace recursive policies on `community_members` and `direct_conversation_members`.
  3) Normalize non-owner elevated platform roles to `user`.
*/

-- ------------------------------------------------------------
-- Helper functions (bypass RLS safely for policy checks)
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- Replace recursive policies
-- ------------------------------------------------------------

-- community_members
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

-- direct_conversation_members
DROP POLICY IF EXISTS "Participants can view DM members" ON direct_conversation_members;
CREATE POLICY "Participants can view DM members"
  ON direct_conversation_members FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_dm_participant(conversation_id, auth.uid())
  );

-- Keep insert/update behavior explicit and symmetric
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

-- ------------------------------------------------------------
-- Normalize non-owner elevated platform roles
-- ------------------------------------------------------------
UPDATE public.profiles
SET platform_role = 'user'
WHERE platform_role IN ('admin', 'moderator')
  AND id NOT IN (
    SELECT u.id
    FROM auth.users u
    WHERE lower(u.email) = 'omatic657@gmail.com'
  );
