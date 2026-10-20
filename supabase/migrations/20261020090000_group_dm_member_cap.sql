/*
  # Group DM member cap: 50, enforced server-side

  The cap used to exist only in DirectMessagePage (10 + a progression bonus).
  Members are inserted directly from the client into
  `direct_conversation_members`, so any client that skipped that check could
  grow a group without limit. This trigger is the one place every insert path
  goes through — group creation, "add member", invite flows.

  50 is flat for everyone for now (owner decision 2026-10-20). Change
  `group_dm_member_cap()` to raise it later; the client reads the same number.

  The conversation row is locked first so two people adding members at the
  same moment cannot both pass the count and overshoot. Within one multi-row
  INSERT, a BEFORE ROW trigger sees rows already inserted by that statement,
  so a single oversized insert is caught too.
*/

CREATE OR REPLACE FUNCTION public.group_dm_member_cap()
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$ SELECT 50 $$;

CREATE OR REPLACE FUNCTION public.enforce_group_dm_member_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_group boolean;
  v_count integer;
BEGIN
  SELECT dc.is_group INTO v_is_group
    FROM public.direct_conversations dc
   WHERE dc.id = NEW.conversation_id
   FOR UPDATE;

  IF NOT COALESCE(v_is_group, false) THEN
    RETURN NEW;
  END IF;

  -- Re-adding an existing member (ON CONFLICT paths) is not growth.
  IF EXISTS (
    SELECT 1 FROM public.direct_conversation_members
     WHERE conversation_id = NEW.conversation_id AND user_id = NEW.user_id
  ) THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_count
    FROM public.direct_conversation_members
   WHERE conversation_id = NEW.conversation_id;

  IF v_count >= public.group_dm_member_cap() THEN
    RAISE EXCEPTION 'Group chats are limited to % members', public.group_dm_member_cap()
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS dcm_enforce_group_cap ON public.direct_conversation_members;
CREATE TRIGGER dcm_enforce_group_cap
  BEFORE INSERT ON public.direct_conversation_members
  FOR EACH ROW EXECUTE FUNCTION public.enforce_group_dm_member_cap();
