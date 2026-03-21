/*
  # Reliable owned-server deletion RPC

  Problem:
  - Deleting from the client with a direct `DELETE` against `communities` can fail
    depending on policy/cascade context.

  Solution:
  - Add a SECURITY DEFINER RPC that verifies ownership and performs the delete
    server-side, allowing FK cascades to run from one trusted path.
*/

CREATE OR REPLACE FUNCTION public.delete_owned_community(p_community_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
  community_owner_id uuid;
  actor_platform_role text;
  rows_deleted integer := 0;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_community_id IS NULL THEN
    RAISE EXCEPTION 'Community id is required';
  END IF;

  SELECT c.owner_id
  INTO community_owner_id
  FROM public.communities c
  WHERE c.id = p_community_id;

  IF community_owner_id IS NULL THEN
    RAISE EXCEPTION 'Community not found';
  END IF;

  SELECT p.platform_role
  INTO actor_platform_role
  FROM public.profiles p
  WHERE p.id = actor_id;

  IF actor_id <> community_owner_id AND COALESCE(actor_platform_role, '') <> 'owner' THEN
    RAISE EXCEPTION 'Only the server owner can delete this server';
  END IF;

  DELETE FROM public.communities c
  WHERE c.id = p_community_id;

  GET DIAGNOSTICS rows_deleted = ROW_COUNT;
  IF rows_deleted = 0 THEN
    RAISE EXCEPTION 'Could not delete this server';
  END IF;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_owned_community(uuid) TO authenticated;
