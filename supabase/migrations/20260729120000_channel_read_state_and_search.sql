-- Channel unread state, mention counting, and full-text message search.
--
-- Direct messages are deliberately NOT searchable server-side. Under the E2E
-- DM path, `direct_messages.content` holds a placeholder and the real text
-- lives in `ciphertext`, which the server cannot read. Indexing it would
-- either return nothing useful or quietly pressure us into weakening E2E.
-- DM search must stay client-side over the locally decrypted cache.

-- ============================================================
-- Read state
-- ============================================================

CREATE TABLE IF NOT EXISTS public.channel_read_state (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  last_read_message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_read_state_user
  ON public.channel_read_state (user_id);

ALTER TABLE public.channel_read_state ENABLE ROW LEVEL SECURITY;

-- Read state is private to its owner. There is no product reason for one
-- member to learn when another member last opened a channel.
DROP POLICY IF EXISTS channel_read_state_select_own ON public.channel_read_state;
CREATE POLICY channel_read_state_select_own ON public.channel_read_state
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS channel_read_state_insert_own ON public.channel_read_state;
CREATE POLICY channel_read_state_insert_own ON public.channel_read_state
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS channel_read_state_update_own ON public.channel_read_state;
CREATE POLICY channel_read_state_update_own ON public.channel_read_state
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS channel_read_state_delete_own ON public.channel_read_state;
CREATE POLICY channel_read_state_delete_own ON public.channel_read_state
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ============================================================
-- Mention detection
-- ============================================================

-- Mirrors the client-side rules in `src/lib/mentions.ts`: an explicit
-- `<@uuid>` / `<@!uuid>` reference, a broadcast `@everyone` / `@here`, or a
-- bare `@username` that is not part of a longer handle.
CREATE OR REPLACE FUNCTION public.message_mentions_user(
  p_content text,
  p_user_id uuid,
  p_username text
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_content IS NULL OR p_content = '' THEN false
    WHEN p_user_id IS NOT NULL
         AND (position('<@' || p_user_id::text || '>' in p_content) > 0
           OR position('<@!' || p_user_id::text || '>' in p_content) > 0) THEN true
    WHEN p_content ~* '(^|[^a-zA-Z0-9_])@(everyone|here)($|[^a-zA-Z0-9_])' THEN true
    WHEN p_username IS NOT NULL AND p_username <> ''
         AND p_content ~* ('(^|[^a-zA-Z0-9_])@'
              || regexp_replace(p_username, '([^a-zA-Z0-9_])', '\\\1', 'g')
              || '($|[^a-zA-Z0-9_.-])') THEN true
    ELSE false
  END;
$$;

GRANT EXECUTE ON FUNCTION public.message_mentions_user(text, uuid, text) TO authenticated;

-- ============================================================
-- Mark a channel read
-- ============================================================

-- Never moves the cursor backwards: a late-arriving realtime event or an
-- out-of-order tab must not resurrect already-read messages.
CREATE OR REPLACE FUNCTION public.mark_channel_read(
  p_channel_id uuid,
  p_read_at timestamptz DEFAULT now(),
  p_message_id uuid DEFAULT NULL
) RETURNS public.channel_read_state
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_community_id uuid;
  v_row public.channel_read_state;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT s.community_id INTO v_community_id
    FROM public.channels ch
    JOIN public.servers s ON s.id = ch.server_id
   WHERE ch.id = p_channel_id;

  IF v_community_id IS NULL THEN
    RAISE EXCEPTION 'Channel not found' USING ERRCODE = '23503';
  END IF;

  -- READ_MESSAGES (bit 1). Marking a channel you cannot read is meaningless
  -- and would leak channel existence through the read-state table.
  IF NOT public.community_member_has_permission(v_community_id, v_uid, 2, p_channel_id) THEN
    RAISE EXCEPTION 'You do not have permission to read this channel'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.channel_read_state AS crs (
    user_id, channel_id, last_read_at, last_read_message_id, updated_at
  ) VALUES (
    v_uid, p_channel_id, COALESCE(p_read_at, now()), p_message_id, now()
  )
  ON CONFLICT (user_id, channel_id) DO UPDATE
    SET last_read_at = GREATEST(crs.last_read_at, EXCLUDED.last_read_at),
        last_read_message_id = CASE
          WHEN EXCLUDED.last_read_at >= crs.last_read_at THEN EXCLUDED.last_read_message_id
          ELSE crs.last_read_message_id
        END,
        updated_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_channel_read(uuid, timestamptz, uuid) TO authenticated;

-- ============================================================
-- Unread summaries
-- ============================================================

-- Per-channel unread and mention counts for one community.
CREATE OR REPLACE FUNCTION public.community_unread_summary(p_community_id uuid)
RETURNS TABLE (
  channel_id uuid,
  unread_count integer,
  mention_count integer,
  last_message_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_username text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  SELECT p.username INTO v_username FROM public.profiles p WHERE p.id = v_uid;

  RETURN QUERY
  WITH visible AS (
    SELECT ch.id AS id
      FROM public.channels ch
      JOIN public.servers s ON s.id = ch.server_id
     WHERE s.community_id = p_community_id
       AND ch.channel_type <> 'voice'
       AND public.community_member_has_permission(s.community_id, v_uid, 2, ch.id)
  ),
  cutoff AS (
    SELECT v.id AS channel_id,
           COALESCE(crs.last_read_at, '-infinity'::timestamptz) AS last_read_at
      FROM visible v
      LEFT JOIN public.channel_read_state crs
             ON crs.channel_id = v.id AND crs.user_id = v_uid
  )
  SELECT c.channel_id,
         COUNT(m.id)::integer AS unread_count,
         COUNT(m.id) FILTER (
           WHERE public.message_mentions_user(m.content, v_uid, v_username)
         )::integer AS mention_count,
         MAX(m.created_at) AS last_message_at
    FROM cutoff c
    LEFT JOIN public.messages m
           ON m.channel_id = c.channel_id
          AND m.created_at > c.last_read_at
          -- Your own messages never count as unread to you.
          AND m.author_id IS DISTINCT FROM v_uid
   GROUP BY c.channel_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.community_unread_summary(uuid) TO authenticated;

-- Rolled up per community, for the server rail badges.
CREATE OR REPLACE FUNCTION public.user_unread_summary()
RETURNS TABLE (
  community_id uuid,
  unread_count integer,
  mention_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_username text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  SELECT p.username INTO v_username FROM public.profiles p WHERE p.id = v_uid;

  RETURN QUERY
  WITH visible AS (
    SELECT ch.id AS channel_id, s.community_id AS community_id
      FROM public.community_members cm
      JOIN public.servers s ON s.community_id = cm.community_id
      JOIN public.channels ch ON ch.server_id = s.id
     WHERE cm.user_id = v_uid
       AND ch.channel_type <> 'voice'
       AND public.community_member_has_permission(s.community_id, v_uid, 2, ch.id)
  ),
  cutoff AS (
    SELECT v.channel_id,
           v.community_id,
           COALESCE(crs.last_read_at, '-infinity'::timestamptz) AS last_read_at
      FROM visible v
      LEFT JOIN public.channel_read_state crs
             ON crs.channel_id = v.channel_id AND crs.user_id = v_uid
  )
  SELECT c.community_id,
         COUNT(m.id)::integer AS unread_count,
         COUNT(m.id) FILTER (
           WHERE public.message_mentions_user(m.content, v_uid, v_username)
         )::integer AS mention_count
    FROM cutoff c
    LEFT JOIN public.messages m
           ON m.channel_id = c.channel_id
          AND m.created_at > c.last_read_at
          AND m.author_id IS DISTINCT FROM v_uid
   GROUP BY c.community_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.user_unread_summary() TO authenticated;

-- ============================================================
-- Full-text search over channel messages
-- ============================================================

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(content, ''))) STORED;

CREATE INDEX IF NOT EXISTS idx_messages_search_vector
  ON public.messages USING gin (search_vector);

-- `websearch_to_tsquery` gives users quoted phrases, OR, and -exclusion
-- without letting a malformed query raise a syntax error.
CREATE OR REPLACE FUNCTION public.search_messages(
  p_query text,
  p_community_id uuid DEFAULT NULL,
  p_channel_id uuid DEFAULT NULL,
  p_author_id uuid DEFAULT NULL,
  p_has_attachment boolean DEFAULT NULL,
  p_before timestamptz DEFAULT NULL,
  p_after timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  channel_id uuid,
  channel_name text,
  community_id uuid,
  author_id uuid,
  author_username text,
  author_display_name text,
  author_avatar_url text,
  content text,
  created_at timestamptz,
  rank real,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tsquery tsquery;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  v_tsquery := websearch_to_tsquery('english', COALESCE(p_query, ''));
  IF v_tsquery IS NULL OR numnode(v_tsquery) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH visible AS (
    SELECT ch.id AS channel_id, ch.name AS channel_name, s.community_id AS community_id
      FROM public.community_members cm
      JOIN public.servers s ON s.community_id = cm.community_id
      JOIN public.channels ch ON ch.server_id = s.id
     WHERE cm.user_id = v_uid
       AND ch.channel_type <> 'voice'
       AND (p_community_id IS NULL OR s.community_id = p_community_id)
       AND (p_channel_id IS NULL OR ch.id = p_channel_id)
       AND public.community_member_has_permission(s.community_id, v_uid, 2, ch.id)
  ),
  matched AS (
    SELECT m.id,
           v.channel_id,
           v.channel_name,
           v.community_id,
           m.author_id,
           m.content,
           m.created_at,
           ts_rank(m.search_vector, v_tsquery) AS rank
      FROM public.messages m
      JOIN visible v ON v.channel_id = m.channel_id
     WHERE m.search_vector @@ v_tsquery
       AND (p_author_id IS NULL OR m.author_id = p_author_id)
       AND (p_before IS NULL OR m.created_at < p_before)
       AND (p_after IS NULL OR m.created_at > p_after)
       AND (
         p_has_attachment IS NULL
         OR p_has_attachment = EXISTS (
           SELECT 1 FROM public.message_attachments ma WHERE ma.message_id = m.id
         )
       )
  ),
  counted AS (
    SELECT COUNT(*) AS total FROM matched
  )
  SELECT mt.id,
         mt.channel_id,
         mt.channel_name,
         mt.community_id,
         mt.author_id,
         p.username,
         p.display_name,
         p.avatar_url,
         mt.content,
         mt.created_at,
         mt.rank,
         counted.total
    FROM matched mt
    CROSS JOIN counted
    LEFT JOIN public.profiles p ON p.id = mt.author_id
   ORDER BY mt.rank DESC, mt.created_at DESC
   LIMIT v_limit OFFSET v_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_messages(
  text, uuid, uuid, uuid, boolean, timestamptz, timestamptz, integer, integer
) TO authenticated;
