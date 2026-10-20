/*
  # Discord social-graph import

  Lets a user upload their Discord GDPR data package and have their friend /
  block graph reassemble on NCore as the people in it arrive — without the
  server ever learning the raw graph.

  ## Privacy model

  The client parses the package locally. The only thing that reaches the
  database is an HMAC-SHA256 fingerprint of each Discord snowflake, keyed by a
  server-side secret (`DISCORD_IMPORT_PEPPER`, applied by the
  `discord-import-hash` edge function). Consequences, all deliberate:

  - A database leak alone cannot confirm "is Discord user X on NCore" —
    checking membership requires the pepper, which lives only in function
    secrets.
  - We never store who someone's Discord friends ARE, only fingerprints that
    become meaningful when the counterpart also chooses to import.
  - Friendships are restored ONLY on mutual attestation: A's package lists B
    AND B's package lists A, and both left auto-reconnect enabled. One-sided
    claims do nothing, so a fabricated package cannot mint trust and — just as
    important — a user is never shown "N of your friends are already here" for
    friends who have not consented to being findable. Presence is only ever
    revealed by the act of restoring a mutual friendship.
  - Blocks are unilateral on NCore, so imported blocks apply one-sided, but
    they never overwrite a relationship the user already set here.

  ## Tables

  - `discord_identity_links` — one row per NCore user who linked a Discord
    identity (their own snowflake's fingerprint, unique: first come, first
    served).
  - `discord_import_edges` — fingerprint edges from the importing user to
    friends / blocked users / guilds. Guild edges are stored for the upcoming
    community-migration matcher and have no behaviour yet.
*/

CREATE TABLE IF NOT EXISTS public.discord_identity_links (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  discord_hash text NOT NULL UNIQUE CHECK (discord_hash ~ '^[0-9a-f]{64}$'),
  auto_friend boolean NOT NULL DEFAULT true,
  friends_imported integer NOT NULL DEFAULT 0,
  blocks_imported integer NOT NULL DEFAULT 0,
  guilds_imported integer NOT NULL DEFAULT 0,
  friendships_restored integer NOT NULL DEFAULT 0,
  blocks_applied integer NOT NULL DEFAULT 0,
  linked_at timestamptz NOT NULL DEFAULT now(),
  last_import_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.discord_import_edges (
  user_id uuid NOT NULL REFERENCES public.discord_identity_links(user_id) ON DELETE CASCADE,
  target_hash text NOT NULL CHECK (target_hash ~ '^[0-9a-f]{64}$'),
  edge_type text NOT NULL CHECK (edge_type IN ('friend', 'blocked', 'guild')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, target_hash, edge_type)
);

-- Reverse lookup: "who imported an edge pointing at this identity" is the hot
-- path of every matching run.
CREATE INDEX IF NOT EXISTS idx_discord_import_edges_target
  ON public.discord_import_edges (target_hash, edge_type);

ALTER TABLE public.discord_identity_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discord_import_edges ENABLE ROW LEVEL SECURITY;

-- Owner-readable; every write goes through the SECURITY DEFINER RPCs below so
-- caps and counters cannot drift.
CREATE POLICY "discord_identity_links_select_own"
  ON public.discord_identity_links FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "discord_import_edges_select_own"
  ON public.discord_import_edges FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Caps
-- ---------------------------------------------------------------------------

/*
  Discord caps friends at 1000; blocks are effectively unbounded but real
  blocklists are small; servers cap at 200. The limits are generous multiples
  so a legitimate package always fits while a hostile client cannot use the
  edges table as free storage.
*/
CREATE OR REPLACE FUNCTION public.discord_import_edge_cap(p_type text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_type
    WHEN 'friend' THEN 5000
    WHEN 'blocked' THEN 10000
    WHEN 'guild' THEN 500
    ELSE 0
  END;
$$;

-- ---------------------------------------------------------------------------
-- Linking and submitting
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.discord_import_begin(
  p_self_hash text,
  p_auto_friend boolean DEFAULT true
)
RETURNS void
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

  IF p_self_hash IS NULL OR p_self_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid identity fingerprint';
  END IF;

  -- First come, first served on a Discord identity. If someone claims an
  -- identity that is not theirs they gain nothing (matching needs the OTHER
  -- side's package to list them), but the rightful owner would be locked out,
  -- hence the explicit error instead of silent reassignment.
  IF EXISTS (
    SELECT 1 FROM public.discord_identity_links
     WHERE discord_hash = p_self_hash AND user_id <> v_uid
  ) THEN
    RAISE EXCEPTION 'This Discord account is already linked to a different NCore account';
  END IF;

  INSERT INTO public.discord_identity_links (user_id, discord_hash, auto_friend)
  VALUES (v_uid, p_self_hash, COALESCE(p_auto_friend, true))
  ON CONFLICT (user_id) DO UPDATE
    SET discord_hash = EXCLUDED.discord_hash,
        auto_friend = EXCLUDED.auto_friend;

  -- Re-importing replaces the edge set: the new package is the truth.
  DELETE FROM public.discord_import_edges WHERE user_id = v_uid;

  UPDATE public.discord_identity_links
     SET friends_imported = 0, blocks_imported = 0, guilds_imported = 0
   WHERE user_id = v_uid;
END;
$$;

/*
  p_edges: JSON array of { "h": "<64-hex fingerprint>", "t": "friend"|"blocked"|"guild" }.
  Batched by the client; each call is capped so one request cannot be huge.
*/
CREATE OR REPLACE FUNCTION public.discord_import_edges_submit(p_edges jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_self_hash text;
  v_type text;
  v_incoming integer;
  v_existing integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT discord_hash INTO v_self_hash
    FROM public.discord_identity_links WHERE user_id = v_uid;
  IF v_self_hash IS NULL THEN
    RAISE EXCEPTION 'Link a Discord identity before submitting edges';
  END IF;

  IF p_edges IS NULL OR jsonb_typeof(p_edges) <> 'array' THEN
    RAISE EXCEPTION 'Edges must be an array';
  END IF;
  IF jsonb_array_length(p_edges) > 2000 THEN
    RAISE EXCEPTION 'Too many edges in one batch';
  END IF;

  CREATE TEMP TABLE _incoming_edges (target_hash text, edge_type text)
    ON COMMIT DROP;

  INSERT INTO _incoming_edges (target_hash, edge_type)
  SELECT DISTINCT lower(trim(elem->>'h')), elem->>'t'
    FROM jsonb_array_elements(p_edges) AS elem
   WHERE (elem->>'h') IS DISTINCT FROM NULL
     AND lower(trim(elem->>'h')) ~ '^[0-9a-f]{64}$'
     AND (elem->>'t') IN ('friend', 'blocked', 'guild')
     -- Your own identity is not an edge.
     AND lower(trim(elem->>'h')) <> v_self_hash;

  FOR v_type IN SELECT DISTINCT edge_type FROM _incoming_edges LOOP
    SELECT count(*) INTO v_incoming FROM _incoming_edges WHERE edge_type = v_type;
    SELECT count(*) INTO v_existing
      FROM public.discord_import_edges
     WHERE user_id = v_uid AND edge_type = v_type;
    IF v_existing + v_incoming > public.discord_import_edge_cap(v_type) THEN
      RAISE EXCEPTION 'Too many % edges for one account', v_type;
    END IF;
  END LOOP;

  INSERT INTO public.discord_import_edges (user_id, target_hash, edge_type)
  SELECT v_uid, target_hash, edge_type FROM _incoming_edges
  ON CONFLICT DO NOTHING;

  UPDATE public.discord_identity_links dil
     SET friends_imported = (SELECT count(*) FROM public.discord_import_edges e
                              WHERE e.user_id = v_uid AND e.edge_type = 'friend'),
         blocks_imported = (SELECT count(*) FROM public.discord_import_edges e
                             WHERE e.user_id = v_uid AND e.edge_type = 'blocked'),
         guilds_imported = (SELECT count(*) FROM public.discord_import_edges e
                             WHERE e.user_id = v_uid AND e.edge_type = 'guild')
   WHERE dil.user_id = v_uid;

  DROP TABLE _incoming_edges;
END;
$$;

-- ---------------------------------------------------------------------------
-- Matching
-- ---------------------------------------------------------------------------

/*
  Runs the graph reconciliation from the perspective of one user. Called on
  finalize for the importer, which also covers the "I arrived later" direction
  for everyone who imported before them — each mutual pair is materialised by
  whichever side finalizes second.

  Not granted to clients; only reachable through discord_import_finalize().

  Concurrency note: two users finalizing at the same instant can both count a
  shared pair in their summary. The relationship inserts are ON CONFLICT
  DO NOTHING so the data stays correct; at worst a display counter is off by
  one, which is not worth a lock.
*/
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
  v_dummy integer;
BEGIN
  SELECT discord_hash, auto_friend INTO v_my_hash, v_auto
    FROM public.discord_identity_links WHERE user_id = p_user;
  IF v_my_hash IS NULL THEN
    RETURN;
  END IF;

  /*
    1. Blocks I imported, applied to people who have linked that identity.
       Never overwrites an existing relationship: if you already re-friended
       someone here, your old Discord blocklist should not undo that.
  */
  WITH applied AS (
    INSERT INTO public.user_relationships (user_id, target_user_id, relationship)
    SELECT p_user, dil.user_id, 'blocked'
      FROM public.discord_import_edges e
      JOIN public.discord_identity_links dil ON dil.discord_hash = e.target_hash
     WHERE e.user_id = p_user
       AND e.edge_type = 'blocked'
       AND dil.user_id <> p_user
    ON CONFLICT (user_id, target_user_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_blocks FROM applied;

  /*
    2. Blocks others imported that point at the identity I just linked.
       Their block, their side of the table.
  */
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

  /*
    3. Mutual friendships. Both packages attest the edge, both sides left
       auto-reconnect on, no existing relationship rows in either direction
       (so pending requests, ignores, and blocks all take precedence over the
       import).

       Restoring straight to 'friend' rather than a pending request is
       intentional and consistent with the "explicit flow only" rule from
       20260315183000: a mutual Discord friendship that both people uploaded
       IS the explicit consent, expressed once on Discord and again at import.
  */
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

  UPDATE public.discord_identity_links
     SET friendships_restored = friendships_restored + v_friends,
         blocks_applied = blocks_applied + v_blocks,
         last_import_at = now()
   WHERE user_id = p_user;
END;
$$;

CREATE OR REPLACE FUNCTION public.discord_import_finalize()
RETURNS TABLE (
  friendships_restored integer,
  blocks_applied integer,
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
         dil.friends_imported,
         dil.blocks_imported,
         dil.guilds_imported
    FROM public.discord_identity_links dil
   WHERE dil.user_id = v_uid;
END;
$$;

/*
  Unlink removes the identity and the fingerprint edges. Relationships that
  were already restored stay — they are real NCore relationships now, exactly
  as if both people had clicked through the friend-request flow.
*/
CREATE OR REPLACE FUNCTION public.discord_import_unlink()
RETURNS void
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
  DELETE FROM public.discord_identity_links WHERE user_id = v_uid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.discord_import_begin(text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.discord_import_edges_submit(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.discord_import_finalize() TO authenticated;
GRANT EXECUTE ON FUNCTION public.discord_import_unlink() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.discord_import_run_matching(uuid) FROM PUBLIC, anon, authenticated;
