/*
  # Message requests

  A DM from someone you have never spoken to should land in a request inbox,
  not in your conversation list with a notification attached. Without that, the
  only defence against a stranger is blocking them after they have already
  interrupted you.

  ## Two bugs this also fixes

  `create_or_get_direct_conversation` (20260313203000) has been doing two things
  it should not:

  1. **It auto-friends both parties.** Opening a DM inserts a mutual 'friend'
     relationship for both people, with no consent from the recipient. Anyone
     who messaged you became your friend. That is also why nothing resembling a
     message request could exist — by the time the conversation was queryable,
     the sender already counted as a friend.

  2. **It never checks blocks.** A blocked user could open a DM with the person
     who blocked them.

  Both are corrected below. Friendship now only comes from the explicit friend
  request flow in `20260315183000_friend_requests_pending_flow.sql`.

  ## State lives on the membership row
  `request_state` is per member, not per conversation: in a group DM, one person
  may have accepted while another still has it pending.

  ## Existing conversations default to 'accepted'
  The column default is 'accepted' precisely so applying this migration does not
  retroactively sweep every existing conversation into a request inbox.
*/

ALTER TABLE public.direct_conversation_members
  ADD COLUMN IF NOT EXISTS request_state text NOT NULL DEFAULT 'accepted'
    CHECK (request_state IN ('accepted', 'pending', 'ignored'));

CREATE INDEX IF NOT EXISTS idx_dcm_request_state
  ON public.direct_conversation_members (user_id, request_state)
  WHERE request_state <> 'accepted';

-- ---------------------------------------------------------------------------
-- Classification
-- ---------------------------------------------------------------------------

/*
  Whether `p_recipient` should have to approve a conversation started by
  `p_sender`.

  Accepted automatically when they are already friends, when the recipient has
  previously messaged the sender (they clearly know each other), or when the
  recipient is the one who created the conversation.

  Deliberately NOT auto-accepted on "shares a server with you": that is exactly
  the vector spam uses. Sharing a large public server says nothing about
  whether you want a DM from someone.
*/
CREATE OR REPLACE FUNCTION public.dm_requires_approval(
  p_sender uuid,
  p_recipient uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_sender IS NULL OR p_recipient IS NULL OR p_sender = p_recipient THEN
    RETURN false;
  END IF;

  -- Already friends in either direction.
  IF EXISTS (
    SELECT 1 FROM public.user_relationships ur
     WHERE ur.relationship = 'friend'
       AND ((ur.user_id = p_recipient AND ur.target_user_id = p_sender)
         OR (ur.user_id = p_sender AND ur.target_user_id = p_recipient))
  ) THEN
    RETURN false;
  END IF;

  -- The recipient has spoken to this person before, in any conversation.
  IF EXISTS (
    SELECT 1
      FROM public.direct_messages dm
      JOIN public.direct_conversation_members other
        ON other.conversation_id = dm.conversation_id
       AND other.user_id = p_sender
     WHERE dm.sender_id = p_recipient
     LIMIT 1
  ) THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

/*
  Stamps the request state as membership rows are created.

  A trigger rather than logic inside `create_or_get_direct_conversation`,
  because group DMs and invite flows insert membership rows directly and would
  otherwise bypass it entirely.
*/
CREATE OR REPLACE FUNCTION public.set_dm_request_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_creator uuid;
BEGIN
  -- An explicit value from a SECURITY DEFINER caller wins; only the default
  -- gets reclassified.
  IF NEW.request_state IS DISTINCT FROM 'accepted' THEN
    RETURN NEW;
  END IF;

  SELECT dc.created_by INTO v_creator
    FROM public.direct_conversations dc
   WHERE dc.id = NEW.conversation_id;

  -- You never have to approve a conversation you started, or one with no
  -- identifiable creator (legacy rows).
  IF v_creator IS NULL OR v_creator = NEW.user_id THEN
    RETURN NEW;
  END IF;

  IF public.dm_requires_approval(COALESCE(NEW.added_by, v_creator), NEW.user_id) THEN
    NEW.request_state := 'pending';
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Misclassifying toward 'accepted' is the safe failure: a request that
  -- should have been held is an annoyance, a conversation wrongly buried in a
  -- hidden inbox is a message the user never learns about.
  RAISE WARNING 'dm request classification failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS dcm_set_request_state ON public.direct_conversation_members;
CREATE TRIGGER dcm_set_request_state
  BEFORE INSERT ON public.direct_conversation_members
  FOR EACH ROW EXECUTE FUNCTION public.set_dm_request_state();

-- ---------------------------------------------------------------------------
-- Fixed conversation creation
-- ---------------------------------------------------------------------------

/*
  Replaces the version in `20260313203000_harden_dm_search_and_creation.sql`.

  Same behaviour, minus the two bugs: no automatic friendship, and blocks are
  honoured in both directions.
*/
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

  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_target_user_id) THEN
    RAISE EXCEPTION 'Target user does not exist';
  END IF;

  /*
    Blocks apply symmetrically. Someone you blocked must not be able to open a
    channel to you, and you should not be able to message someone who blocked
    you — the second half also avoids the confusing state where you send into a
    conversation that the other person will never see.
  */
  IF EXISTS (
    SELECT 1 FROM public.user_relationships ur
     WHERE ur.relationship = 'blocked'
       AND ((ur.user_id = actor_id AND ur.target_user_id = p_target_user_id)
         OR (ur.user_id = p_target_user_id AND ur.target_user_id = actor_id))
  ) THEN
    RAISE EXCEPTION 'You cannot start a conversation with this person'
      USING ERRCODE = '42501';
  END IF;

  SELECT dc.id INTO existing_conversation_id
    FROM public.direct_conversations dc
    JOIN public.direct_conversation_members me
      ON me.conversation_id = dc.id AND me.user_id = actor_id
    JOIN public.direct_conversation_members them
      ON them.conversation_id = dc.id AND them.user_id = p_target_user_id
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

  -- No automatic friendship. Messaging someone is not a friend request, and
  -- the explicit flow in 20260315183000 is the only thing that should create
  -- a 'friend' relationship.

  RETURN created_conversation_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_or_get_direct_conversation(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Acting on a request
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.dm_request_accept(p_conversation_id uuid)
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

  UPDATE public.direct_conversation_members
     SET request_state = 'accepted'
   WHERE conversation_id = p_conversation_id AND user_id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversation not found' USING ERRCODE = '23503';
  END IF;
END;
$$;

/*
  Hides the conversation without telling the sender.

  Silent on purpose: an "ignored" receipt tells a spammer the account is live
  and being read, which is the one thing they want to learn.
*/
CREATE OR REPLACE FUNCTION public.dm_request_ignore(p_conversation_id uuid)
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

  UPDATE public.direct_conversation_members
     SET request_state = 'ignored'
   WHERE conversation_id = p_conversation_id AND user_id = v_uid;
END;
$$;

/** Ignores the request and blocks every other participant. */
CREATE OR REPLACE FUNCTION public.dm_request_block(p_conversation_id uuid)
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

  IF NOT EXISTS (
    SELECT 1 FROM public.direct_conversation_members
     WHERE conversation_id = p_conversation_id AND user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'Conversation not found' USING ERRCODE = '23503';
  END IF;

  UPDATE public.direct_conversation_members
     SET request_state = 'ignored'
   WHERE conversation_id = p_conversation_id AND user_id = v_uid;

  INSERT INTO public.user_relationships (user_id, target_user_id, relationship)
  SELECT v_uid, other.user_id, 'blocked'
    FROM public.direct_conversation_members other
   WHERE other.conversation_id = p_conversation_id
     AND other.user_id <> v_uid
  ON CONFLICT (user_id, target_user_id) DO UPDATE
    SET relationship = 'blocked', updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.dm_request_accept(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dm_request_ignore(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dm_request_block(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------

/*
  Pending requests with the sender attached.

  No message preview. `direct_messages.content` is a placeholder under E2E and
  the real text is ciphertext the server cannot read — the same constraint that
  keeps DM search client-side. The client decrypts locally if it can; the
  server offers identity and timing, which is what the accept/ignore decision
  actually turns on.
*/
CREATE OR REPLACE FUNCTION public.dm_request_list()
RETURNS TABLE (
  conversation_id uuid,
  is_group boolean,
  sender_id uuid,
  sender_username text,
  sender_display_name text,
  sender_avatar_url text,
  message_count bigint,
  mutual_communities bigint,
  requested_at timestamptz,
  last_message_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT dc.id,
         dc.is_group,
         sender.id,
         sender.username,
         sender.display_name,
         sender.avatar_url,
         (SELECT count(*) FROM public.direct_messages dm WHERE dm.conversation_id = dc.id),
         -- Shared servers do not auto-accept a request, but they are the most
         -- useful signal a person has when deciding, so they are surfaced.
         (SELECT count(*)
            FROM public.community_members mine
            JOIN public.community_members theirs
              ON theirs.community_id = mine.community_id
           WHERE mine.user_id = v_uid AND theirs.user_id = sender.id),
         me.joined_at,
         (SELECT max(dm.created_at) FROM public.direct_messages dm WHERE dm.conversation_id = dc.id)
    FROM public.direct_conversation_members me
    JOIN public.direct_conversations dc ON dc.id = me.conversation_id
    LEFT JOIN public.profiles sender ON sender.id = COALESCE(me.added_by, dc.created_by)
   WHERE me.user_id = v_uid
     AND me.request_state = 'pending'
     -- A request with nothing in it is not worth showing; it is someone who
     -- opened a DM box and thought better of it.
     AND EXISTS (SELECT 1 FROM public.direct_messages dm WHERE dm.conversation_id = dc.id)
   ORDER BY me.joined_at DESC
   LIMIT 200;
END;
$$;

GRANT EXECUTE ON FUNCTION public.dm_request_list() TO authenticated;

CREATE OR REPLACE FUNCTION public.dm_request_count()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(count(*), 0)::integer
    FROM public.direct_conversation_members me
   WHERE me.user_id = auth.uid()
     AND me.request_state = 'pending'
     AND EXISTS (
       SELECT 1 FROM public.direct_messages dm WHERE dm.conversation_id = me.conversation_id
     );
$$;

GRANT EXECUTE ON FUNCTION public.dm_request_count() TO authenticated;

/*
  The conversation ids the user has actually accepted.

  `get_my_dm_conversation_ids` (20260313203000) returns everything, and the DM
  list is built from it. Rather than change that function's meaning — other
  callers rely on it — this is the filtered version the conversation list uses.
*/
CREATE OR REPLACE FUNCTION public.get_my_accepted_dm_conversation_ids()
RETURNS TABLE (conversation_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT me.conversation_id
    FROM public.direct_conversation_members me
   WHERE me.user_id = auth.uid()
     AND me.request_state = 'accepted';
$$;

GRANT EXECUTE ON FUNCTION public.get_my_accepted_dm_conversation_ids() TO authenticated;
