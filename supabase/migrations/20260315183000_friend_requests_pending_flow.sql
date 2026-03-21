/*
  # Pending friend request workflow

  1) Extend `user_relationships.relationship` to support pending states:
     - friend_pending_outgoing
     - friend_pending_incoming
  2) Add RPC helpers:
     - send_friend_request
     - respond_friend_request (accept/decline)
     - cancel_friend_request
  3) Keep set_user_relationship/remove_friend compatible while clearing pending state when ignore/block/remove occurs.
*/

ALTER TABLE public.user_relationships
  DROP CONSTRAINT IF EXISTS user_relationships_relationship_check;

ALTER TABLE public.user_relationships
  ADD CONSTRAINT user_relationships_relationship_check
  CHECK (
    relationship IN (
      'friend',
      'ignored',
      'blocked',
      'friend_pending_outgoing',
      'friend_pending_incoming'
    )
  );

CREATE OR REPLACE FUNCTION public.send_friend_request(p_target_user_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
  actor_rel text;
  target_rel text;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_target_user_id IS NULL OR p_target_user_id = actor_id THEN
    RAISE EXCEPTION 'Invalid target user';
  END IF;

  SELECT relationship
  INTO actor_rel
  FROM public.user_relationships
  WHERE user_id = actor_id
    AND target_user_id = p_target_user_id;

  SELECT relationship
  INTO target_rel
  FROM public.user_relationships
  WHERE user_id = p_target_user_id
    AND target_user_id = actor_id;

  IF actor_rel = 'friend' OR target_rel = 'friend' THEN
    RETURN 'already_friends';
  END IF;

  IF actor_rel = 'blocked' THEN
    RAISE EXCEPTION 'Unblock this user before sending a friend request';
  END IF;

  IF target_rel IN ('blocked', 'ignored') THEN
    RAISE EXCEPTION 'Cannot send friend request to this user';
  END IF;

  IF actor_rel = 'friend_pending_outgoing' THEN
    RETURN 'already_pending';
  END IF;

  IF actor_rel = 'friend_pending_incoming' OR target_rel = 'friend_pending_outgoing' THEN
    INSERT INTO public.user_relationships (user_id, target_user_id, relationship)
    VALUES (actor_id, p_target_user_id, 'friend')
    ON CONFLICT (user_id, target_user_id)
    DO UPDATE SET relationship = 'friend', updated_at = now();

    INSERT INTO public.user_relationships (user_id, target_user_id, relationship)
    VALUES (p_target_user_id, actor_id, 'friend')
    ON CONFLICT (user_id, target_user_id)
    DO UPDATE SET relationship = 'friend', updated_at = now();

    RETURN 'accepted';
  END IF;

  INSERT INTO public.user_relationships (user_id, target_user_id, relationship)
  VALUES (actor_id, p_target_user_id, 'friend_pending_outgoing')
  ON CONFLICT (user_id, target_user_id)
  DO UPDATE SET relationship = 'friend_pending_outgoing', updated_at = now();

  INSERT INTO public.user_relationships (user_id, target_user_id, relationship)
  VALUES (p_target_user_id, actor_id, 'friend_pending_incoming')
  ON CONFLICT (user_id, target_user_id)
  DO UPDATE SET relationship = 'friend_pending_incoming', updated_at = now();

  RETURN 'pending';
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_friend_request(p_target_user_id uuid, p_action text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
  actor_rel text;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_target_user_id IS NULL OR p_target_user_id = actor_id THEN
    RAISE EXCEPTION 'Invalid target user';
  END IF;

  IF p_action NOT IN ('accept', 'decline') THEN
    RAISE EXCEPTION 'Invalid friend request action';
  END IF;

  SELECT relationship
  INTO actor_rel
  FROM public.user_relationships
  WHERE user_id = actor_id
    AND target_user_id = p_target_user_id;

  IF actor_rel <> 'friend_pending_incoming' THEN
    RAISE EXCEPTION 'No incoming friend request from this user';
  END IF;

  IF p_action = 'accept' THEN
    INSERT INTO public.user_relationships (user_id, target_user_id, relationship)
    VALUES (actor_id, p_target_user_id, 'friend')
    ON CONFLICT (user_id, target_user_id)
    DO UPDATE SET relationship = 'friend', updated_at = now();

    INSERT INTO public.user_relationships (user_id, target_user_id, relationship)
    VALUES (p_target_user_id, actor_id, 'friend')
    ON CONFLICT (user_id, target_user_id)
    DO UPDATE SET relationship = 'friend', updated_at = now();
  ELSE
    DELETE FROM public.user_relationships
    WHERE (
      (user_id = actor_id AND target_user_id = p_target_user_id)
      OR (user_id = p_target_user_id AND target_user_id = actor_id)
    )
      AND relationship IN ('friend_pending_incoming', 'friend_pending_outgoing');
  END IF;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_friend_request(p_target_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
  actor_rel text;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_target_user_id IS NULL OR p_target_user_id = actor_id THEN
    RAISE EXCEPTION 'Invalid target user';
  END IF;

  SELECT relationship
  INTO actor_rel
  FROM public.user_relationships
  WHERE user_id = actor_id
    AND target_user_id = p_target_user_id;

  IF actor_rel <> 'friend_pending_outgoing' THEN
    RETURN false;
  END IF;

  DELETE FROM public.user_relationships
  WHERE (
    (user_id = actor_id AND target_user_id = p_target_user_id)
    OR (user_id = p_target_user_id AND target_user_id = actor_id)
  )
    AND relationship IN ('friend_pending_incoming', 'friend_pending_outgoing');

  RETURN true;
END;
$$;

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
      AND relationship IN ('friend', 'friend_pending_outgoing', 'friend_pending_incoming');
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
  WHERE relationship IN ('friend', 'friend_pending_outgoing', 'friend_pending_incoming')
    AND (
      (user_id = actor_id AND target_user_id = p_target_user_id)
      OR (user_id = p_target_user_id AND target_user_id = actor_id)
    );

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.send_friend_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_friend_request(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_friend_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_relationship(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_friend(uuid) TO authenticated;
