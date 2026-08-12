-- Custom per-community emoji.
--
-- Messages and reactions store the stable form `<:name:uuid>` rather than
-- `:name:`. The id is what actually resolves the image, so renaming an emoji
-- never breaks history and two communities can both own a `:shipit:`.

CREATE TABLE IF NOT EXISTS public.community_emojis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  name text NOT NULL,
  image_url text NOT NULL,
  storage_path text,
  is_animated boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT community_emojis_name_format CHECK (name ~ '^[a-zA-Z0-9_]{2,32}$')
);

-- Names are case-insensitively unique per community: `:Shipit:` and
-- `:shipit:` in the same server would be indistinguishable when typed.
CREATE UNIQUE INDEX IF NOT EXISTS community_emojis_community_name_key
  ON public.community_emojis (community_id, lower(name));

CREATE INDEX IF NOT EXISTS idx_community_emojis_community
  ON public.community_emojis (community_id);

ALTER TABLE public.community_emojis ENABLE ROW LEVEL SECURITY;

-- Any member of the community can see and use its emoji.
DROP POLICY IF EXISTS community_emojis_select_members ON public.community_emojis;
CREATE POLICY community_emojis_select_members ON public.community_emojis
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.community_members cm
       WHERE cm.community_id = community_emojis.community_id
         AND cm.user_id = auth.uid()
    )
  );

-- Writes go through the RPCs below, which gate on MANAGE_COMMUNITY.
DROP POLICY IF EXISTS community_emojis_no_direct_write ON public.community_emojis;

-- ============================================================
-- Limits
-- ============================================================

-- A cap keeps one community from turning the shared storage bucket into its
-- own CDN. Raise it deliberately, ideally tied to a boost entitlement.
CREATE OR REPLACE FUNCTION public.community_emoji_limit(p_community_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT 100;
$$;

-- ============================================================
-- RPCs
-- ============================================================

CREATE OR REPLACE FUNCTION public.community_emoji_create(
  p_community_id uuid,
  p_name text,
  p_image_url text,
  p_storage_path text DEFAULT NULL,
  p_is_animated boolean DEFAULT false
) RETURNS public.community_emojis
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_name text := trim(COALESCE(p_name, ''));
  v_count integer;
  v_limit integer;
  v_row public.community_emojis;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  -- MANAGE_COMMUNITY (bit 17).
  IF NOT public.community_member_has_permission(p_community_id, v_uid, 131072) THEN
    RAISE EXCEPTION 'You do not have permission to manage emoji in this community'
      USING ERRCODE = '42501';
  END IF;

  IF v_name !~ '^[a-zA-Z0-9_]{2,32}$' THEN
    RAISE EXCEPTION 'Emoji names must be 2-32 characters of letters, numbers, or underscores';
  END IF;

  SELECT COUNT(*) INTO v_count
    FROM public.community_emojis ce
   WHERE ce.community_id = p_community_id;

  v_limit := public.community_emoji_limit(p_community_id);
  IF v_count >= v_limit THEN
    RAISE EXCEPTION 'This community has reached its % emoji limit', v_limit;
  END IF;

  INSERT INTO public.community_emojis (
    community_id, name, image_url, storage_path, is_animated, created_by
  ) VALUES (
    p_community_id, v_name, p_image_url, p_storage_path, COALESCE(p_is_animated, false), v_uid
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.community_emoji_create(uuid, text, text, text, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.community_emoji_rename(
  p_emoji_id uuid,
  p_name text
) RETURNS public.community_emojis
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_name text := trim(COALESCE(p_name, ''));
  v_community_id uuid;
  v_row public.community_emojis;
BEGIN
  SELECT ce.community_id INTO v_community_id
    FROM public.community_emojis ce WHERE ce.id = p_emoji_id;

  IF v_community_id IS NULL THEN
    RAISE EXCEPTION 'Emoji not found' USING ERRCODE = '23503';
  END IF;

  IF NOT public.community_member_has_permission(v_community_id, v_uid, 131072) THEN
    RAISE EXCEPTION 'You do not have permission to manage emoji in this community'
      USING ERRCODE = '42501';
  END IF;

  IF v_name !~ '^[a-zA-Z0-9_]{2,32}$' THEN
    RAISE EXCEPTION 'Emoji names must be 2-32 characters of letters, numbers, or underscores';
  END IF;

  UPDATE public.community_emojis
     SET name = v_name
   WHERE id = p_emoji_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.community_emoji_rename(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.community_emoji_delete(p_emoji_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_community_id uuid;
BEGIN
  SELECT ce.community_id INTO v_community_id
    FROM public.community_emojis ce WHERE ce.id = p_emoji_id;

  IF v_community_id IS NULL THEN
    RETURN;
  END IF;

  IF NOT public.community_member_has_permission(v_community_id, v_uid, 131072) THEN
    RAISE EXCEPTION 'You do not have permission to manage emoji in this community'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.community_emojis WHERE id = p_emoji_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.community_emoji_delete(uuid) TO authenticated;

-- Every custom emoji the caller can use, across all their communities.
-- The client needs this to render `<:name:id>` in any context, including DMs
-- where there is no community scope to look one up from.
CREATE OR REPLACE FUNCTION public.usable_community_emojis()
RETURNS TABLE (
  id uuid,
  community_id uuid,
  community_name text,
  name text,
  image_url text,
  is_animated boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ce.id,
         ce.community_id,
         c.name,
         ce.name,
         ce.image_url,
         ce.is_animated
    FROM public.community_emojis ce
    JOIN public.communities c ON c.id = ce.community_id
    JOIN public.community_members cm
      ON cm.community_id = ce.community_id AND cm.user_id = auth.uid()
   ORDER BY c.name, ce.name;
$$;

GRANT EXECUTE ON FUNCTION public.usable_community_emojis() TO authenticated;
