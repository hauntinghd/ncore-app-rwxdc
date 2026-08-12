-- Enforce custom channel permissions at the database boundary.
-- UI controls are helpful, but they are never the authorization layer.

CREATE OR REPLACE FUNCTION public.enforce_channel_message_permission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_community_id uuid;
BEGIN
  IF NEW.author_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Messages must be authored by the authenticated user'
      USING ERRCODE = '42501';
  END IF;

  SELECT s.community_id INTO v_community_id
    FROM public.channels ch
    JOIN public.servers s ON s.id = ch.server_id
   WHERE ch.id = NEW.channel_id;

  IF v_community_id IS NULL THEN
    RAISE EXCEPTION 'Channel not found' USING ERRCODE = '23503';
  END IF;

  IF NOT public.community_member_has_permission(v_community_id, auth.uid(), 4, NEW.channel_id) THEN
    RAISE EXCEPTION 'You do not have permission to send messages in this channel'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_enforce_channel_permission ON public.messages;
CREATE TRIGGER messages_enforce_channel_permission
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.enforce_channel_message_permission();
