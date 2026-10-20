/*
  # One-sided Discord attestations become friend requests

  The mutual-attestation rule (both packages list each other) assumed both
  people can produce a data package. Discord delivers packages by email and
  requires the OLD email to change your email — so anyone locked out of
  their account email can never produce one. Their graph would be
  unreachable forever even though every friend who imports carries an edge
  pointing at them.

  Fix: a user can link their identity by Discord User ID alone (no edges),
  and a one-sided friend attestation now materialises as a normal PENDING
  friend request from the attesting user, through the exact rows the
  explicit flow in 20260315183000 creates. Trust math is unchanged:

  - Instant friendship still requires mutual attestation. A one-sided claim
    yields only what the claimant could do by hand anyway — send a request
    the other person must accept.
  - Both sides must have auto-reconnect on: the claimant opted in to
    reaching out at import time, the target opted in to being findable at
    link time.
  - Any existing relationship row in either direction (friend, pending,
    ignored, blocked) suppresses the request entirely.

  Also adds `requests_created` (requests sent on a user's behalf from their
  imported edges) and returns it from finalize.
*/

ALTER TABLE public.discord_identity_links
  ADD COLUMN IF NOT EXISTS requests_created integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.discord_import_run_matching(p_user uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_my_hash text;
  v_auto boolean;
  v_blocks integer := 0;
  v_friends integer := 0;
  v_requests integer := 0;
  v_dummy integer;
BEGIN
  SELECT discord_hash, auto_friend INTO v_my_hash, v_auto
    FROM public.discord_identity_links WHERE user_id = p_user;
  IF v_my_hash IS NULL THEN
    RETURN;
  END IF;

  /* 1. Blocks I imported, applied to people who have linked that identity. */
  WITH applied AS (
    INSERT INTO public.user_relationships (user_id, target_user_id, relationship)
    SELECT p_user, dil.user_id, 'blocked'
      FROM public.discord_import_edges e
      JOIN public.discord_identity_links dil ON dil.discord_hash = e.target_hash
     WHERE e.user_id = p_user
       AND e.edge_type = 'blocked'
       AND dil.user_id <> p_user
    ON CONFLICT (user_id, target_user_id) DO NOTHING
    RETURNING user_relationships.user_id AS blocker
  )
  SELECT count(*) INTO v_blocks FROM applied;

  /* 2. Blocks others imported that point at the identity I just linked. */
  WITH applied AS (
    INSERT INTO public.user_relationships (user_id, target_user_id, relationship)
    SELECT e.user_id, p_user, 'blocked'
      FROM public.discord_import_edges e
     WHERE e.edge_type = 'blocked'
       AND e.target_hash = v_my_hash
       AND e.user_id <> p_user
    ON CONFLICT (user_id, target_user_id) DO NOTHING
    RETURNING user_relationships.user_id AS blocker
  ), bumped AS (
    UPDATE public.discord_identity_links dil
       SET blocks_applied = dil.blocks_applied + sub.n
      FROM (SELECT blocker, count(*) AS n FROM applied GROUP BY blocker) sub
     WHERE dil.user_id = sub.blocker
    RETURNING 1
  )
  SELECT count(*) INTO v_dummy FROM bumped;

  /* 3. Mutual friendships — unchanged: instant, both sides attested. */
  IF v_auto THEN
    WITH eligible AS (
      SELECT other.user_id AS other_user
        FROM public.discord_import_edges mine
        JOIN public.discord_identity_links other
          ON other.discord_hash = mine.target_hash
         AND other.auto_friend
        JOIN public.discord_import_edges theirs
          ON theirs.user_id = other.user_id
         AND theirs.edge_type = 'friend'
         AND theirs.target_hash = v_my_hash
       WHERE mine.user_id = p_user
         AND mine.edge_type = 'friend'
         AND other.user_id <> p_user
         AND NOT EXISTS (
           SELECT 1 FROM public.user_relationships ur
            WHERE (ur.user_id = p_user AND ur.target_user_id = other.user_id)
               OR (ur.user_id = other.user_id AND ur.target_user_id = p_user)
         )
    ), ins_mine AS (
      INSERT INTO public.user_relationships (user_id, target_user_id, relationship)
      SELECT p_user, other_user, 'friend' FROM eligible
      ON CONFLICT (user_id, target_user_id) DO NOTHING
    ), ins_theirs AS (
      INSERT INTO public.user_relationships (user_id, target_user_id, relationship)
      SELECT other_user, p_user, 'friend' FROM eligible
      ON CONFLICT (user_id, target_user_id) DO NOTHING
    ), bump_theirs AS (
      UPDATE public.discord_identity_links dil
         SET friendships_restored = dil.friendships_restored + 1
        FROM eligible e
       WHERE dil.user_id = e.other_user
    )
    SELECT count(*) INTO v_friends FROM eligible;
  END IF;

  /*
    4. One-sided: MY friend edges to linked people who did not (or could
       not) attest back. Runs after step 3, so mutual pairs already hold
       'friend' rows and are excluded by NOT EXISTS.
  */
  IF v_auto THEN
    WITH targets AS (
      SELECT other.user_id AS other_user
        FROM public.discord_import_edges mine
        JOIN public.discord_identity_links other
          ON other.discord_hash = mine.target_hash
         AND other.auto_friend
       WHERE mine.user_id = p_user
         AND mine.edge_type = 'friend'
         AND other.user_id <> p_user
         AND NOT EXISTS (
           SELECT 1 FROM public.user_relationships ur
            WHERE (ur.user_id = p_user AND ur.target_user_id = other.user_id)
               OR (ur.user_id = other.user_id AND ur.target_user_id = p_user)
         )
    ), ins_out AS (
      INSERT INTO public.user_relationships (user_id, target_user_id, relationship)
      SELECT p_user, other_user, 'friend_pending_outgoing' FROM targets
      ON CONFLICT (user_id, target_user_id) DO NOTHING
    ), ins_in AS (
      INSERT INTO public.user_relationships (user_id, target_user_id, relationship)
      SELECT other_user, p_user, 'friend_pending_incoming' FROM targets
      ON CONFLICT (user_id, target_user_id) DO NOTHING
    )
    SELECT count(*) INTO v_requests FROM targets;
  END IF;

  /*
    5. One-sided the other way: edges OTHERS imported that point at me.
       Each becomes a request FROM the attesting user TO me. My auto flag
       is the "findable" consent; theirs is the "reach out" consent.
  */
  IF v_auto THEN
    WITH claimants AS (
      SELECT e.user_id AS other_user
        FROM public.discord_import_edges e
        JOIN public.discord_identity_links owner_link
          ON owner_link.user_id = e.user_id
         AND owner_link.auto_friend
       WHERE e.edge_type = 'friend'
         AND e.target_hash = v_my_hash
         AND e.user_id <> p_user
         AND NOT EXISTS (
           SELECT 1 FROM public.user_relationships ur
            WHERE (ur.user_id = p_user AND ur.target_user_id = e.user_id)
               OR (ur.user_id = e.user_id AND ur.target_user_id = p_user)
         )
    ), ins_out AS (
      INSERT INTO public.user_relationships (user_id, target_user_id, relationship)
      SELECT other_user, p_user, 'friend_pending_outgoing' FROM claimants
      ON CONFLICT (user_id, target_user_id) DO NOTHING
    ), ins_in AS (
      INSERT INTO public.user_relationships (user_id, target_user_id, relationship)
      SELECT p_user, other_user, 'friend_pending_incoming' FROM claimants
      ON CONFLICT (user_id, target_user_id) DO NOTHING
    ), bump AS (
      UPDATE public.discord_identity_links dil
         SET requests_created = dil.requests_created + 1
        FROM claimants c
       WHERE dil.user_id = c.other_user
      RETURNING 1
    )
    SELECT count(*) INTO v_dummy FROM bump;
  END IF;

  UPDATE public.discord_identity_links
     SET friendships_restored = friendships_restored + v_friends,
         blocks_applied = blocks_applied + v_blocks,
         requests_created = requests_created + v_requests,
         last_import_at = now()
   WHERE user_id = p_user;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.discord_import_run_matching(uuid) FROM PUBLIC, anon, authenticated;

-- Return signature changes, so drop-and-recreate rather than replace.
DROP FUNCTION IF EXISTS public.discord_import_finalize();

CREATE FUNCTION public.discord_import_finalize()
RETURNS TABLE (
  friendships_restored integer,
  blocks_applied integer,
  requests_created integer,
  friends_imported integer,
  blocks_imported integer,
  guilds_imported integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  PERFORM public.discord_import_run_matching(v_uid);

  RETURN QUERY
  SELECT dil.friendships_restored,
         dil.blocks_applied,
         dil.requests_created,
         dil.friends_imported,
         dil.blocks_imported,
         dil.guilds_imported
    FROM public.discord_identity_links dil
   WHERE dil.user_id = v_uid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.discord_import_finalize() TO authenticated;
