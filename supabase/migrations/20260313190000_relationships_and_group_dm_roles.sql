/*
  # Relationships + Group DM role controls

  1) Adds role metadata to direct conversation members:
     - role: owner | admin | member
     - added_by
  2) Tightens group DM membership policies so only owner/admin can add/remove others.
  3) Adds user relationship backend for friend/ignore/block actions.
  4) Adds RPC helpers for:
     - set_user_relationship
     - remove_friend
     - set_group_dm_member_role
     - remove_group_dm_member
*/

-- -------------------------------------------------------------------
-- Group DM member roles
-- -------------------------------------------------------------------
ALTER TABLE public.direct_conversation_members
ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'member'
CHECK (role IN ('owner', 'admin', 'member'));

ALTER TABLE public.direct_conversation_members
ADD COLUMN IF NOT EXISTS added_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Backfill: group creators become owners.
UPDATE public.direct_conversation_members AS dcm
SET role = 'owner'
FROM public.direct_conversations AS dc
WHERE dcm.conversation_id = dc.id
  AND dc.is_group = true
  AND dc.created_by IS NOT NULL
  AND dcm.user_id = dc.created_by;

-- Safety: ensure each existing group has at least one owner.
WITH missing_owner_groups AS (
  SELECT dc.id AS conversation_id
  FROM public.direct_conversations dc
  WHERE dc.is_group = true
    AND NOT EXISTS (
      SELECT 1
      FROM public.direct_conversation_members m
      WHERE m.conversation_id = dc.id
        AND m.role = 'owner'
    )
),
fallback_owner AS (
  SELECT DISTINCT ON (m.conversation_id) m.id
  FROM public.direct_conversation_members m
  JOIN missing_owner_groups g ON g.conversation_id = m.conversation_id
  ORDER BY m.conversation_id, m.id
)
UPDATE public.direct_conversation_members m
SET role = 'owner'
FROM fallback_owner fo
WHERE m.id = fo.id;

CREATE INDEX IF NOT EXISTS direct_conversation_members_conversation_role_idx
  ON public.direct_conversation_members (conversation_id, role);

CREATE OR REPLACE FUNCTION public.is_group_dm_owner(target_conversation_id uuid, target_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.direct_conversations dc
    JOIN public.direct_conversation_members dcm
      ON dcm.conversation_id = dc.id
    WHERE dc.id = target_conversation_id
      AND dc.is_group = true
      AND dcm.user_id = target_user_id
      AND dcm.role = 'owner'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_group_dm_admin(target_conversation_id uuid, target_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.direct_conversations dc
    JOIN public.direct_conversation_members dcm
      ON dcm.conversation_id = dc.id
    WHERE dc.id = target_conversation_id
      AND dc.is_group = true
      AND dcm.user_id = target_user_id
      AND dcm.role IN ('owner', 'admin')
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_group_dm_owner(uuid, uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_group_dm_admin(uuid, uuid) TO authenticated, anon;

DROP POLICY IF EXISTS "direct_conversation_members_insert" ON public.direct_conversation_members;
CREATE POLICY "direct_conversation_members_insert"
  ON public.direct_conversation_members FOR INSERT TO authenticated
  WITH CHECK (
    public.is_dm_creator(conversation_id, auth.uid())
    OR public.is_group_dm_admin(conversation_id, auth.uid())
  );

DROP POLICY IF EXISTS "direct_conversation_members_delete" ON public.direct_conversation_members;
CREATE POLICY "direct_conversation_members_delete"
  ON public.direct_conversation_members FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    OR (
      public.is_group_dm_admin(conversation_id, auth.uid())
      AND (
        role = 'member'
        OR public.is_group_dm_owner(conversation_id, auth.uid())
      )
    )
  );

-- -------------------------------------------------------------------
-- Relationships backend
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  target_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  relationship text NOT NULL CHECK (relationship IN ('friend', 'ignored', 'blocked')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, target_user_id),
  CHECK (user_id <> target_user_id)
);

CREATE INDEX IF NOT EXISTS user_relationships_user_id_idx
  ON public.user_relationships(user_id);
CREATE INDEX IF NOT EXISTS user_relationships_target_user_id_idx
  ON public.user_relationships(target_user_id);
CREATE INDEX IF NOT EXISTS user_relationships_relationship_idx
  ON public.user_relationships(relationship);

-- Backfill friendships for existing 1:1 DM conversations.
WITH direct_pairs AS (
  SELECT DISTINCT
    LEAST(m1.user_id, m2.user_id) AS user_a,
    GREATEST(m1.user_id, m2.user_id) AS user_b
  FROM public.direct_conversations dc
  JOIN public.direct_conversation_members m1 ON m1.conversation_id = dc.id
  JOIN public.direct_conversation_members m2 ON m2.conversation_id = dc.id
  WHERE dc.is_group = false
    AND m1.user_id < m2.user_id
)
INSERT INTO public.user_relationships (user_id, target_user_id, relationship)
SELECT user_a, user_b, 'friend' FROM direct_pairs
UNION ALL
SELECT user_b, user_a, 'friend' FROM direct_pairs
ON CONFLICT (user_id, target_user_id) DO UPDATE
SET relationship = 'friend',
    updated_at = now();

ALTER TABLE public.user_relationships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_relationships_select_own" ON public.user_relationships;
CREATE POLICY "user_relationships_select_own"
  ON public.user_relationships FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "user_relationships_insert_own" ON public.user_relationships;
CREATE POLICY "user_relationships_insert_own"
  ON public.user_relationships FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "user_relationships_update_own" ON public.user_relationships;
CREATE POLICY "user_relationships_update_own"
  ON public.user_relationships FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "user_relationships_delete_own" ON public.user_relationships;
CREATE POLICY "user_relationships_delete_own"
  ON public.user_relationships FOR DELETE TO authenticated
  USING (user_id = auth.uid());

DROP TRIGGER IF EXISTS user_relationships_updated_at ON public.user_relationships;
CREATE TRIGGER user_relationships_updated_at
  BEFORE UPDATE ON public.user_relationships
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE FUNCTION public.set_user_relationship(p_target_user_id uuid, p_next_relationship text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_target_user_id IS NULL OR p_target_user_id = actor_id THEN
    RAISE EXCEPTION 'Invalid target user';
  END IF;

  IF p_next_relationship NOT IN ('friend', 'ignored', 'blocked') THEN
    RAISE EXCEPTION 'Invalid relationship type';
  END IF;

  INSERT INTO public.user_relationships (user_id, target_user_id, relationship)
  VALUES (actor_id, p_target_user_id, p_next_relationship)
  ON CONFLICT (user_id, target_user_id)
  DO UPDATE SET
    relationship = EXCLUDED.relationship,
    updated_at = now();

  IF p_next_relationship = 'friend' THEN
    INSERT INTO public.user_relationships (user_id, target_user_id, relationship)
    VALUES (p_target_user_id, actor_id, 'friend')
    ON CONFLICT (user_id, target_user_id)
    DO UPDATE SET
      relationship = EXCLUDED.relationship,
      updated_at = now();
  ELSE
    DELETE FROM public.user_relationships
    WHERE user_id = p_target_user_id
      AND target_user_id = actor_id
      AND relationship = 'friend';
  END IF;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_friend(p_target_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_target_user_id IS NULL OR p_target_user_id = actor_id THEN
    RAISE EXCEPTION 'Invalid target user';
  END IF;

  DELETE FROM public.user_relationships
  WHERE relationship = 'friend'
    AND (
      (user_id = actor_id AND target_user_id = p_target_user_id)
      OR (user_id = p_target_user_id AND target_user_id = actor_id)
    );

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_group_dm_member_role(
  p_target_conversation_id uuid,
  p_target_user_id uuid,
  p_next_role text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
  actor_role text;
  member_role text;
  group_exists boolean;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_next_role NOT IN ('admin', 'member') THEN
    RAISE EXCEPTION 'Only admin/member role assignment is supported';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.direct_conversations dc
    WHERE dc.id = p_target_conversation_id
      AND dc.is_group = true
  )
  INTO group_exists;

  IF NOT group_exists THEN
    RAISE EXCEPTION 'Conversation is not a group chat';
  END IF;

  SELECT dcm.role
  INTO actor_role
  FROM public.direct_conversation_members dcm
  WHERE dcm.conversation_id = p_target_conversation_id
    AND dcm.user_id = actor_id;

  IF actor_role IS NULL THEN
    RAISE EXCEPTION 'You are not a group member';
  END IF;

  IF actor_role <> 'owner' THEN
    RAISE EXCEPTION 'Only group owner can update member roles';
  END IF;

  IF p_target_user_id = actor_id THEN
    RAISE EXCEPTION 'Owner cannot change own role here';
  END IF;

  SELECT dcm.role
  INTO member_role
  FROM public.direct_conversation_members dcm
  WHERE dcm.conversation_id = p_target_conversation_id
    AND dcm.user_id = p_target_user_id;

  IF member_role IS NULL THEN
    RAISE EXCEPTION 'Target user is not in this group';
  END IF;

  UPDATE public.direct_conversation_members dcm
  SET role = p_next_role
  WHERE dcm.conversation_id = p_target_conversation_id
    AND dcm.user_id = p_target_user_id;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_group_dm_member(
  p_target_conversation_id uuid,
  p_target_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
  actor_role text;
  member_role text;
  replacement_owner uuid;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT dcm.role
  INTO actor_role
  FROM public.direct_conversation_members dcm
  JOIN public.direct_conversations dc
    ON dc.id = dcm.conversation_id
  WHERE dcm.conversation_id = p_target_conversation_id
    AND dcm.user_id = actor_id
    AND dc.is_group = true;

  IF actor_role IS NULL THEN
    RAISE EXCEPTION 'You are not a member of this group';
  END IF;

  SELECT dcm.role
  INTO member_role
  FROM public.direct_conversation_members dcm
  WHERE dcm.conversation_id = p_target_conversation_id
    AND dcm.user_id = p_target_user_id;

  IF member_role IS NULL THEN
    RAISE EXCEPTION 'Target member not found';
  END IF;

  IF actor_id <> p_target_user_id THEN
    IF actor_role NOT IN ('owner', 'admin') THEN
      RAISE EXCEPTION 'You do not have permission to remove this member';
    END IF;
    IF actor_role = 'admin' AND member_role <> 'member' THEN
      RAISE EXCEPTION 'Admins can only remove members';
    END IF;
  END IF;

  IF member_role = 'owner' AND actor_role <> 'owner' THEN
    RAISE EXCEPTION 'Only owner can remove owner';
  END IF;

  IF actor_id = p_target_user_id AND actor_role = 'owner' THEN
    SELECT dcm.user_id
    INTO replacement_owner
    FROM public.direct_conversation_members dcm
    WHERE dcm.conversation_id = p_target_conversation_id
      AND dcm.user_id <> actor_id
    ORDER BY
      CASE dcm.role
        WHEN 'admin' THEN 0
        WHEN 'member' THEN 1
        ELSE 2
      END,
      dcm.id
    LIMIT 1;

    IF replacement_owner IS NOT NULL THEN
      UPDATE public.direct_conversation_members dcm
      SET role = 'owner'
      WHERE dcm.conversation_id = p_target_conversation_id
        AND dcm.user_id = replacement_owner;
    END IF;
  END IF;

  DELETE FROM public.direct_conversation_members dcm
  WHERE dcm.conversation_id = p_target_conversation_id
    AND dcm.user_id = p_target_user_id;

  DELETE FROM public.direct_conversations dc
  WHERE dc.id = p_target_conversation_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.direct_conversation_members dcm
      WHERE dcm.conversation_id = dc.id
    );

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_user_relationship(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_friend(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_group_dm_member_role(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_group_dm_member(uuid, uuid) TO authenticated;
