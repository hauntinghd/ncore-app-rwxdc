/*
  # Link embeds (Open Graph previews)

  Caches unfurled metadata for links posted in messages, so a URL renders as a
  card instead of bare text.

  ## Why the cache is server-owned
  Clients cannot fetch arbitrary third-party pages (CORS), and we would not want
  them to: unfurling from the client would leak every reader's IP to whatever
  host was linked. The `link-preview` edge function does the fetch with SSRF
  guards and writes here with the service role. Clients only ever read.

  ## Why rows are keyed by a hash
  URLs can exceed the 2704-byte btree index limit. `url_hash` is the SHA-256 of
  the normalized URL and is stable across clients because normalization rules
  live in `src/lib/linkEmbeds.ts` and are mirrored by the edge function.

  ## Failures are cached too
  A host that 404s, blocks us, or times out should not be re-fetched on every
  render. Failed lookups are stored with `status <> 'ok'` and a shorter
  `expires_at` so a transient outage recovers on its own.
*/

CREATE TABLE IF NOT EXISTS public.link_embeds (
  url_hash text PRIMARY KEY,
  url text NOT NULL,
  canonical_url text,
  site_name text,
  title text,
  description text,
  image_url text,
  favicon_url text,
  embed_type text NOT NULL DEFAULT 'link'
    CHECK (embed_type IN ('link', 'image', 'video', 'article')),
  media_width integer,
  media_height integer,
  status text NOT NULL DEFAULT 'ok'
    CHECK (status IN ('ok', 'error', 'blocked', 'unsupported')),
  error_reason text,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days')
);

CREATE INDEX IF NOT EXISTS idx_link_embeds_expires
  ON public.link_embeds (expires_at);

ALTER TABLE public.link_embeds ENABLE ROW LEVEL SECURITY;

-- Anyone signed in can read the cache. The contents are public web metadata
-- for URLs that were already posted in chat, so there is nothing to scope.
DROP POLICY IF EXISTS "Authenticated users can read link embeds" ON public.link_embeds;
CREATE POLICY "Authenticated users can read link embeds"
  ON public.link_embeds FOR SELECT
  TO authenticated
  USING (true);

-- Deliberately no INSERT/UPDATE/DELETE policy. Writes are service-role only,
-- from the `link-preview` edge function. A client-writable cache would let one
-- user poison the preview every other user sees.

-- ---------------------------------------------------------------------------
-- Lookup helper
-- ---------------------------------------------------------------------------

/*
  Returns only unexpired rows for the requested hashes. Callers treat a missing
  row as "ask the edge function", which means expiry and cache-miss are the
  same code path on the client.
*/
CREATE OR REPLACE FUNCTION public.link_embeds_lookup(p_hashes text[])
RETURNS SETOF public.link_embeds
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT *
  FROM public.link_embeds
  WHERE url_hash = ANY(coalesce(p_hashes, ARRAY[]::text[]))
    AND expires_at > now()
  LIMIT 200;
$$;

GRANT EXECUTE ON FUNCTION public.link_embeds_lookup(text[]) TO authenticated;

-- ---------------------------------------------------------------------------
-- Housekeeping
-- ---------------------------------------------------------------------------

/*
  Drops expired rows. Not scheduled here — wire it to pg_cron if the table ever
  grows enough to matter. Expired rows are already invisible to
  `link_embeds_lookup`, so this is purely about disk.
*/
CREATE OR REPLACE FUNCTION public.link_embeds_prune()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.link_embeds WHERE expires_at < now() - interval '1 day';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- ---------------------------------------------------------------------------
-- Per-user preference
-- ---------------------------------------------------------------------------

/*
  Some people do not want link previews at all — they are a bandwidth cost and,
  for anyone screen-sharing, an unpredictable image on screen. Default on,
  matching what people expect coming from Discord.
*/
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS link_previews_enabled boolean NOT NULL DEFAULT true;
