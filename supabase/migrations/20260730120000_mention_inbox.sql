/*
  # Mention inbox

  "Where was I mentioned?" is the question that decides whether you can stop
  reading every channel. Without an answer, catching up means opening every
  server you are in.

  ## Why a table instead of a query
  `20260729120000` added `message_mentions_user(content, user_id, username)`,
  which is enough to count unread mentions in one channel. It is not enough for
  an inbox: answering "mentions of me anywhere, newest first" that way means
  scanning every message in every community the user belongs to on every load.

  So mentions are resolved once, at insert time, into a row per (message,
  user). The inbox then becomes an index scan on `(user_id, created_at DESC)`.

  ## @everyone is not fanned out
  A trigger that inserted one row per member for every @everyone would turn a
  single message in a large server into thousands of writes. Those rows are
  recorded once with `is_broadcast = true` and no `user_id`, and the read path
  unions them in scoped to the reader's communities.
*/

CREATE TABLE IF NOT EXISTS public.message_mentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  community_id uuid REFERENCES public.communities(id) ON DELETE CASCADE,
  -- NULL for @everyone / @here, which address a channel rather than a person.
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  author_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  is_broadcast boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_message_mentions_unique_direct
  ON public.message_mentions (message_id, user_id)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_message_mentions_unique_broadcast
  ON public.message_mentions (message_id)
  WHERE user_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_message_mentions_user_recent
  ON public.message_mentions (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_message_mentions_broadcast_recent
  ON public.message_mentions (community_id, created_at DESC)
  WHERE user_id IS NULL;

ALTER TABLE public.message_mentions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read mentions addressed to them" ON public.message_mentions;
CREATE POLICY "Users can read mentions addressed to them"
  ON public.message_mentions FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR (
      user_id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.community_members cm
         WHERE cm.community_id = message_mentions.community_id
           AND cm.user_id = auth.uid()
      )
    )
  );

-- Rows are written by the trigger below, running as definer. No client writes.

-- ---------------------------------------------------------------------------
-- Resolution
-- ---------------------------------------------------------------------------

/*
  Extracts mentions from a message and records them.

  Only `<@uuid>` / `<@!uuid>` forms produce a direct mention row. Bare
  `@username` is deliberately excluded here even though
  `message_mentions_user` accepts it: matching a plain word against every
  username in the database on every insert is both slow and wrong the moment
  two people have similar names. The composer already rewrites a picked
  mention into the id form, so this is what real mentions look like on the wire.
*/
CREATE OR REPLACE FUNCTION public.record_message_mentions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_community_id uuid;
  v_mentioned uuid;
BEGIN
  IF NEW.content IS NULL OR NEW.content = '' THEN
    RETURN NEW;
  END IF;

  SELECT s.community_id INTO v_community_id
    FROM public.channels ch
    JOIN public.servers s ON s.id = ch.server_id
   WHERE ch.id = NEW.channel_id;

  FOR v_mentioned IN
    SELECT DISTINCT (match_row[1])::uuid
      FROM regexp_matches(
             NEW.content,
             '<@!?([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})>',
             'g'
           ) AS match_row
  LOOP
    -- Mentioning yourself should not fill your own inbox.
    CONTINUE WHEN v_mentioned = NEW.author_id;

    INSERT INTO public.message_mentions
      (message_id, channel_id, community_id, user_id, author_id, is_broadcast, created_at)
    VALUES
      (NEW.id, NEW.channel_id, v_community_id, v_mentioned, NEW.author_id, false, NEW.created_at)
    ON CONFLICT DO NOTHING;
  END LOOP;

  IF NEW.content ~* '(^|[^a-zA-Z0-9_])@(everyone|here)($|[^a-zA-Z0-9_])' THEN
    INSERT INTO public.message_mentions
      (message_id, channel_id, community_id, user_id, author_id, is_broadcast, created_at)
    VALUES
      (NEW.id, NEW.channel_id, v_community_id, NULL, NEW.author_id, true, NEW.created_at)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Indexing a mention must never be the reason a message fails to send.
  RAISE WARNING 'mention indexing failed for message %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_record_mentions ON public.messages;
CREATE TRIGGER messages_record_mentions
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.record_message_mentions();

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------

/*
  Seeds the index from recent history so the inbox is not empty on day one.

  Scoped to 30 days on purpose: the whole message table would be a long lock on
  a busy instance, and an inbox is a "what did I miss" tool, not an archive.
  Re-runnable — the unique indexes make it idempotent.
*/
DO $backfill$
DECLARE
  v_cutoff timestamptz := now() - interval '30 days';
BEGIN
  INSERT INTO public.message_mentions
    (message_id, channel_id, community_id, user_id, author_id, is_broadcast, created_at)
  SELECT m.id, m.channel_id, s.community_id, (match_row[1])::uuid, m.author_id, false, m.created_at
    FROM public.messages m
    JOIN public.channels ch ON ch.id = m.channel_id
    JOIN public.servers s ON s.id = ch.server_id
   CROSS JOIN LATERAL regexp_matches(
     m.content,
     '<@!?([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})>',
     'g'
   ) AS match_row
   WHERE m.created_at >= v_cutoff
     AND m.content IS NOT NULL
     AND m.content LIKE '%<@%'
     AND (match_row[1])::uuid IS DISTINCT FROM m.author_id
     AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (match_row[1])::uuid)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.message_mentions
    (message_id, channel_id, community_id, user_id, author_id, is_broadcast, created_at)
  SELECT m.id, m.channel_id, s.community_id, NULL, m.author_id, true, m.created_at
    FROM public.messages m
    JOIN public.channels ch ON ch.id = m.channel_id
    JOIN public.servers s ON s.id = ch.server_id
   WHERE m.created_at >= v_cutoff
     AND m.content ~* '(^|[^a-zA-Z0-9_])@(everyone|here)($|[^a-zA-Z0-9_])'
  ON CONFLICT DO NOTHING;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'mention backfill skipped: %', SQLERRM;
END;
$backfill$;

-- ---------------------------------------------------------------------------
-- Read path
-- ---------------------------------------------------------------------------

/*
  The inbox feed: mentions of you, newest first, with enough context attached
  to render a row without a second round trip.

  Permission is re-checked per row rather than trusted from insert time — a
  channel can be restricted after a message lands in it, and the inbox must not
  become a way to read a channel you have since lost access to.
*/
CREATE OR REPLACE FUNCTION public.user_mention_feed(
  p_limit integer DEFAULT 50,
  p_before timestamptz DEFAULT NULL,
  p_include_broadcast boolean DEFAULT true
)
RETURNS TABLE (
  message_id uuid,
  channel_id uuid,
  channel_name text,
  community_id uuid,
  community_name text,
  author_id uuid,
  author_username text,
  author_display_name text,
  author_avatar_url text,
  content text,
  is_broadcast boolean,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT m.id,
         mm.channel_id,
         ch.name,
         mm.community_id,
         c.name,
         m.author_id,
         author.username,
         author.display_name,
         author.avatar_url,
         m.content,
         mm.is_broadcast,
         mm.created_at
    FROM public.message_mentions mm
    JOIN public.messages m ON m.id = mm.message_id
    JOIN public.channels ch ON ch.id = mm.channel_id
    LEFT JOIN public.communities c ON c.id = mm.community_id
    LEFT JOIN public.profiles author ON author.id = m.author_id
   WHERE (
           mm.user_id = v_uid
           OR (
             COALESCE(p_include_broadcast, true)
             AND mm.user_id IS NULL
             AND EXISTS (
               SELECT 1 FROM public.community_members cm
                WHERE cm.community_id = mm.community_id AND cm.user_id = v_uid
             )
           )
         )
     AND (p_before IS NULL OR mm.created_at < p_before)
     AND public.community_member_has_permission(mm.community_id, v_uid, 2, mm.channel_id)
   ORDER BY mm.created_at DESC
   LIMIT v_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.user_mention_feed(integer, timestamptz, boolean) TO authenticated;

/*
  How many mentions arrived since the reader last read each channel.

  Reuses `channel_read_state` rather than tracking a separate "seen" flag, so
  reading a channel clears its mentions from the inbox badge — one notion of
  read, not two that drift apart.
*/
CREATE OR REPLACE FUNCTION public.user_mention_unread_count()
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_count integer;
BEGIN
  IF v_uid IS NULL THEN
    RETURN 0;
  END IF;

  SELECT count(*) INTO v_count
    FROM public.message_mentions mm
    LEFT JOIN public.channel_read_state crs
           ON crs.channel_id = mm.channel_id AND crs.user_id = v_uid
   WHERE mm.user_id = v_uid
     AND mm.created_at > COALESCE(crs.last_read_at, 'epoch'::timestamptz)
     AND public.community_member_has_permission(mm.community_id, v_uid, 2, mm.channel_id);

  RETURN COALESCE(v_count, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.user_mention_unread_count() TO authenticated;
