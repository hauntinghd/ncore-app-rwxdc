-- Reconcile legacy calls schema (room/status/callee_id) with modern signaling fields.
-- This is safe on both fresh modern installs and older databases.

ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS conversation_id uuid REFERENCES public.direct_conversations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS callee_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'ringing',
  ADD COLUMN IF NOT EXISTS channel_name text,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

UPDATE public.calls
SET metadata = '{}'::jsonb
WHERE metadata IS NULL;

UPDATE public.calls
SET created_at = now()
WHERE created_at IS NULL;

UPDATE public.calls
SET callee_ids = ARRAY[]::text[]
WHERE callee_ids IS NULL;

DO $$
DECLARE
  has_room boolean;
  has_status boolean;
  has_callee_id boolean;
  has_accepted boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'calls' AND column_name = 'room'
  ) INTO has_room;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'calls' AND column_name = 'status'
  ) INTO has_status;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'calls' AND column_name = 'callee_id'
  ) INTO has_callee_id;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'calls' AND column_name = 'accepted'
  ) INTO has_accepted;

  -- Backfill conversation_id from legacy room when room is a UUID string.
  IF has_room THEN
    EXECUTE $q$
      UPDATE public.calls
      SET conversation_id = room::uuid
      WHERE conversation_id IS NULL
        AND COALESCE(room, '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    $q$;
  END IF;

  -- Backfill state from legacy status.
  IF has_status THEN
    EXECUTE $q$
      UPDATE public.calls
      SET state = CASE
        WHEN lower(COALESCE(status, '')) IN ('ringing', 'pending') THEN 'ringing'
        WHEN lower(COALESCE(status, '')) IN ('accepted', 'active', 'connected', 'in_progress', 'in-progress') THEN 'accepted'
        WHEN lower(COALESCE(status, '')) IN ('declined', 'rejected') THEN 'declined'
        WHEN lower(COALESCE(status, '')) IN ('ended', 'complete', 'completed', 'cancelled', 'canceled', 'timeout', 'timed_out', 'timed-out', 'expired', 'missed') THEN 'ended'
        ELSE state
      END
      WHERE COALESCE(status, '') <> ''
    $q$;
  END IF;

  -- Legacy accepted flag can upgrade ringing -> accepted.
  IF has_accepted THEN
    EXECUTE $q$
      UPDATE public.calls
      SET state = 'accepted'
      WHERE accepted IS TRUE
        AND state = 'ringing'
    $q$;
  END IF;

  -- Backfill callee_ids from legacy single callee_id if needed.
  IF has_callee_id THEN
    EXECUTE $q$
      UPDATE public.calls
      SET callee_ids = ARRAY[callee_id::text]
      WHERE COALESCE(array_length(callee_ids, 1), 0) = 0
        AND callee_id IS NOT NULL
    $q$;
  END IF;

  -- If metadata already tracks callee_ids, use it when array is still empty.
  EXECUTE $q$
    UPDATE public.calls
    SET callee_ids = ARRAY(
      SELECT jsonb_array_elements_text(metadata->'callee_ids')
    )
    WHERE COALESCE(array_length(callee_ids, 1), 0) = 0
      AND jsonb_typeof(metadata->'callee_ids') = 'array'
  $q$;

  -- Backfill channel_name.
  IF has_room THEN
    EXECUTE $q$
      UPDATE public.calls
      SET channel_name = COALESCE(
        NULLIF(channel_name, ''),
        CASE
          WHEN conversation_id IS NOT NULL THEN 'dm-' || conversation_id::text
          WHEN COALESCE(room, '') <> '' THEN 'dm-' || room
          ELSE 'dm-' || id::text
        END
      )
      WHERE channel_name IS NULL OR channel_name = ''
    $q$;
  ELSE
    EXECUTE $q$
      UPDATE public.calls
      SET channel_name = COALESCE(
        NULLIF(channel_name, ''),
        CASE
          WHEN conversation_id IS NOT NULL THEN 'dm-' || conversation_id::text
          ELSE 'dm-' || id::text
        END
      )
      WHERE channel_name IS NULL OR channel_name = ''
    $q$;
  END IF;

  -- Backfill expires_at for ringing calls.
  EXECUTE $q$
    UPDATE public.calls
    SET expires_at = created_at + interval '3 minutes'
    WHERE state = 'ringing'
      AND expires_at IS NULL
  $q$;
END $$;

ALTER TABLE public.calls
  ALTER COLUMN channel_name SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_calls_conversation_state_created_at
  ON public.calls(conversation_id, state, created_at DESC);
