/*
  # Harden DM search + creation flow

  Problem addressed:
  - Some environments still return empty DM user search or DM membership rows due
    to policy drift or partial migration state.
  - Client-side DM creation can fail mid-flight if RLS blocks one insert step.

  This migration adds SECURITY DEFINER RPC helpers so the app can reliably:
  1) search profiles for DM composer
  2) get current user's DM conversation ids
  3) create-or-get a direct (1:1) conversation atomically
*/

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.direct_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.direct_conversation_members ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'Profiles viewable by authenticated'
  ) THEN
    CREATE POLICY "Profiles viewable by authenticated"
      ON public.profiles
      FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'direct_conversation_members'
      AND policyname = 'dm_members_select_self_or_participant'
  ) THEN
    CREATE POLICY "dm_members_select_self_or_participant"
      ON public.direct_conversation_members
      FOR SELECT
      TO authenticated
      USING (
        user_id = auth.uid()
        OR public.is_dm_participant(conversation_id, auth.uid())
      );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.search_profiles_for_dm(
  p_query text,
  p_limit integer DEFAULT 10
)
RETURNS SETOF public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
  safe_query text := btrim(coalesce(p_query, ''));
  safe_limit integer := LEAST(GREATEST(coalesce(p_limit, 10), 1), 25);
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF length(safe_query) < 2 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT p.*
  FROM public.profiles p
  WHERE p.id <> actor_id
    AND (
      p.username ILIKE '%' || safe_query || '%'
      OR p.display_name ILIKE '%' || safe_query || '%'
    )
  ORDER BY
    CASE WHEN lower(p.username) = lower(safe_query) THEN 0 ELSE 1 END,
    CASE WHEN lower(coalesce(p.display_name, '')) = lower(safe_query) THEN 0 ELSE 1 END,
    p.username ASC
  LIMIT safe_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_dm_conversation_ids()
RETURNS TABLE(conversation_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT dcm.conversation_id
  FROM public.direct_conversation_members dcm
  WHERE dcm.user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.create_or_get_direct_conversation(
  p_target_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
  existing_conversation_id uuid;
  created_conversation_id uuid;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_target_user_id IS NULL OR p_target_user_id = actor_id THEN
    RAISE EXCEPTION 'Invalid target user';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = p_target_user_id
  ) THEN
    RAISE EXCEPTION 'Target user does not exist';
  END IF;

  SELECT dc.id
  INTO existing_conversation_id
  FROM public.direct_conversations dc
  JOIN public.direct_conversation_members me
    ON me.conversation_id = dc.id
   AND me.user_id = actor_id
  JOIN public.direct_conversation_members them
    ON them.conversation_id = dc.id
   AND them.user_id = p_target_user_id
  WHERE dc.is_group = false
  ORDER BY COALESCE(dc.updated_at, dc.created_at) DESC
  LIMIT 1;

  IF existing_conversation_id IS NOT NULL THEN
    RETURN existing_conversation_id;
  END IF;

  INSERT INTO public.direct_conversations (created_by, is_group)
  VALUES (actor_id, false)
  RETURNING id INTO created_conversation_id;

  INSERT INTO public.direct_conversation_members (conversation_id, user_id, role, added_by)
  VALUES
    (created_conversation_id, actor_id, 'member', actor_id),
    (created_conversation_id, p_target_user_id, 'member', actor_id)
  ON CONFLICT (conversation_id, user_id) DO NOTHING;

  INSERT INTO public.user_relationships (user_id, target_user_id, relationship)
  VALUES
    (actor_id, p_target_user_id, 'friend'),
    (p_target_user_id, actor_id, 'friend')
  ON CONFLICT (user_id, target_user_id) DO UPDATE
    SET relationship = 'friend',
        updated_at = now();

  RETURN created_conversation_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_profiles_for_dm(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_dm_conversation_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_or_get_direct_conversation(uuid) TO authenticated;
