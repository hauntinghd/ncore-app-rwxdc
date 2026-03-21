/*
  # Force reset recursive policies (communities + community_members)

  This migration is intentionally aggressive:
  - Drops ALL existing policies on `public.communities` and `public.community_members`
  - Recreates a known-good policy set that avoids recursive evaluation.
*/

-- Helper functions used by policies
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

-- Drop every policy on community_members
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

-- Drop every policy on communities
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

-- Recreate safe communities policies
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

-- Recreate safe community_members policies
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
