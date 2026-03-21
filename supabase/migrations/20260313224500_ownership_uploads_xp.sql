/*
  Ownership transfer, DM attachments, uploads bucket, and starter XP events.
*/

-- -------------------------------------------------------------------
-- Rank helper + XP event ledger
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rank_from_xp(p_xp integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_xp >= 50000 THEN 'Legend'
    WHEN p_xp >= 15000 THEN 'Elite'
    WHEN p_xp >= 5000 THEN 'Master'
    WHEN p_xp >= 1500 THEN 'Expert'
    WHEN p_xp >= 500 THEN 'Contributor'
    WHEN p_xp >= 100 THEN 'Apprentice'
    ELSE 'Newcomer'
  END;
$$;

CREATE TABLE IF NOT EXISTS public.xp_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('channel_message', 'direct_message')),
  source_id uuid NOT NULL,
  xp_awarded integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_type, source_id)
);

CREATE INDEX IF NOT EXISTS xp_events_user_id_idx ON public.xp_events(user_id);
CREATE INDEX IF NOT EXISTS xp_events_created_at_idx ON public.xp_events(created_at DESC);

ALTER TABLE public.xp_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "xp_events_select_own" ON public.xp_events;
CREATE POLICY "xp_events_select_own"
  ON public.xp_events FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "xp_events_insert_own" ON public.xp_events;
CREATE POLICY "xp_events_insert_own"
  ON public.xp_events FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.award_xp_for_activity(
  p_source_type text,
  p_source_id uuid,
  p_points integer DEFAULT 4
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
  points integer := LEAST(GREATEST(COALESCE(p_points, 0), 1), 50);
  inserted_id uuid;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_source_type NOT IN ('channel_message', 'direct_message') THEN
    RAISE EXCEPTION 'Unsupported source type';
  END IF;

  IF p_source_type = 'channel_message' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.messages m
      WHERE m.id = p_source_id
        AND m.author_id = actor_id
    ) THEN
      RAISE EXCEPTION 'Source message not owned by current user';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1
      FROM public.direct_messages dm
      WHERE dm.id = p_source_id
        AND dm.author_id = actor_id
    ) THEN
      RAISE EXCEPTION 'Source DM not owned by current user';
    END IF;
  END IF;

  INSERT INTO public.xp_events (user_id, source_type, source_id, xp_awarded)
  VALUES (actor_id, p_source_type, p_source_id, points)
  ON CONFLICT (source_type, source_id) DO NOTHING
  RETURNING id INTO inserted_id;

  IF inserted_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.profiles p
  SET
    xp = COALESCE(p.xp, 0) + points,
    rank = public.rank_from_xp(COALESCE(p.xp, 0) + points),
    updated_at = now()
  WHERE p.id = actor_id;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.award_xp_for_activity(text, uuid, integer) TO authenticated;

-- -------------------------------------------------------------------
-- Group DM ownership transfer
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.transfer_group_dm_ownership(
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
  target_role text;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_target_user_id IS NULL OR p_target_user_id = actor_id THEN
    RAISE EXCEPTION 'Invalid target user';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.direct_conversations dc
    WHERE dc.id = p_target_conversation_id
      AND dc.is_group = true
  ) THEN
    RAISE EXCEPTION 'Conversation is not a group chat';
  END IF;

  SELECT dcm.role
  INTO actor_role
  FROM public.direct_conversation_members dcm
  WHERE dcm.conversation_id = p_target_conversation_id
    AND dcm.user_id = actor_id;

  IF actor_role <> 'owner' THEN
    RAISE EXCEPTION 'Only group owner can transfer ownership';
  END IF;

  SELECT dcm.role
  INTO target_role
  FROM public.direct_conversation_members dcm
  WHERE dcm.conversation_id = p_target_conversation_id
    AND dcm.user_id = p_target_user_id;

  IF target_role IS NULL THEN
    RAISE EXCEPTION 'Target user is not in this group';
  END IF;

  UPDATE public.direct_conversation_members dcm
  SET role = 'owner'
  WHERE dcm.conversation_id = p_target_conversation_id
    AND dcm.user_id = p_target_user_id;

  UPDATE public.direct_conversation_members dcm
  SET role = 'admin'
  WHERE dcm.conversation_id = p_target_conversation_id
    AND dcm.user_id = actor_id;

  UPDATE public.direct_conversations dc
  SET updated_at = now()
  WHERE dc.id = p_target_conversation_id;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.transfer_group_dm_ownership(uuid, uuid) TO authenticated;

-- -------------------------------------------------------------------
-- Community/server ownership transfer
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.transfer_community_ownership(
  p_community_id uuid,
  p_target_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
  current_owner uuid;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_target_user_id IS NULL OR p_target_user_id = actor_id THEN
    RAISE EXCEPTION 'Invalid target user';
  END IF;

  SELECT c.owner_id
  INTO current_owner
  FROM public.communities c
  WHERE c.id = p_community_id;

  IF current_owner IS NULL THEN
    RAISE EXCEPTION 'Community not found';
  END IF;

  IF current_owner <> actor_id THEN
    RAISE EXCEPTION 'Only community owner can transfer ownership';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.community_members cm
    WHERE cm.community_id = p_community_id
      AND cm.user_id = p_target_user_id
  ) THEN
    RAISE EXCEPTION 'Target user must already be a community member';
  END IF;

  UPDATE public.communities c
  SET owner_id = p_target_user_id,
      updated_at = now()
  WHERE c.id = p_community_id;

  UPDATE public.community_members cm
  SET role = 'admin'
  WHERE cm.community_id = p_community_id
    AND cm.user_id = actor_id;

  UPDATE public.community_members cm
  SET role = 'owner'
  WHERE cm.community_id = p_community_id
    AND cm.user_id = p_target_user_id;

  UPDATE public.servers s
  SET owner_id = p_target_user_id
  WHERE s.community_id = p_community_id;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.transfer_community_ownership(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.transfer_server_ownership(
  p_server_id uuid,
  p_target_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
  owning_community_id uuid;
  server_owner_id uuid;
  community_owner_id uuid;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_target_user_id IS NULL OR p_target_user_id = actor_id THEN
    RAISE EXCEPTION 'Invalid target user';
  END IF;

  SELECT s.community_id, s.owner_id, c.owner_id
  INTO owning_community_id, server_owner_id, community_owner_id
  FROM public.servers s
  JOIN public.communities c ON c.id = s.community_id
  WHERE s.id = p_server_id;

  IF owning_community_id IS NULL THEN
    RAISE EXCEPTION 'Server not found';
  END IF;

  IF actor_id <> server_owner_id AND actor_id <> community_owner_id THEN
    RAISE EXCEPTION 'Only server/community owner can transfer server ownership';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.community_members cm
    WHERE cm.community_id = owning_community_id
      AND cm.user_id = p_target_user_id
  ) THEN
    RAISE EXCEPTION 'Target user must be a member of this community';
  END IF;

  UPDATE public.servers s
  SET owner_id = p_target_user_id
  WHERE s.id = p_server_id;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.transfer_server_ownership(uuid, uuid) TO authenticated;

-- -------------------------------------------------------------------
-- DM attachments + upload bucket
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.direct_message_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  direct_message_id uuid NOT NULL REFERENCES public.direct_messages(id) ON DELETE CASCADE,
  file_url text NOT NULL,
  file_name text NOT NULL,
  file_type text NOT NULL,
  file_size bigint NOT NULL CHECK (file_size >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS direct_message_attachments_message_id_idx
  ON public.direct_message_attachments(direct_message_id);

ALTER TABLE public.direct_message_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "direct_message_attachments_select" ON public.direct_message_attachments;
CREATE POLICY "direct_message_attachments_select"
  ON public.direct_message_attachments FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.direct_messages dm
      JOIN public.direct_conversation_members dcm
        ON dcm.conversation_id = dm.conversation_id
      WHERE dm.id = direct_message_attachments.direct_message_id
        AND dcm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "direct_message_attachments_insert_own" ON public.direct_message_attachments;
CREATE POLICY "direct_message_attachments_insert_own"
  ON public.direct_message_attachments FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.direct_messages dm
      WHERE dm.id = direct_message_attachments.direct_message_id
        AND dm.author_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "direct_message_attachments_delete_own" ON public.direct_message_attachments;
CREATE POLICY "direct_message_attachments_delete_own"
  ON public.direct_message_attachments FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.direct_messages dm
      WHERE dm.id = direct_message_attachments.direct_message_id
        AND dm.author_id = auth.uid()
    )
  );

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.direct_message_attachments;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
  END;
END $$;

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('message-uploads', 'message-uploads', true, 10737418240)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit;

DROP POLICY IF EXISTS "message_uploads_select" ON storage.objects;
CREATE POLICY "message_uploads_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'message-uploads');

DROP POLICY IF EXISTS "message_uploads_insert_own" ON storage.objects;
CREATE POLICY "message_uploads_insert_own"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'message-uploads' AND owner = auth.uid());

DROP POLICY IF EXISTS "message_uploads_update_own" ON storage.objects;
CREATE POLICY "message_uploads_update_own"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'message-uploads' AND owner = auth.uid())
  WITH CHECK (bucket_id = 'message-uploads' AND owner = auth.uid());

DROP POLICY IF EXISTS "message_uploads_delete_own" ON storage.objects;
CREATE POLICY "message_uploads_delete_own"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'message-uploads' AND owner = auth.uid());

