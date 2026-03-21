-- Add calls table for call signaling between participants
-- A simple table used to signal incoming calls, ring state, and acceptance
CREATE TABLE IF NOT EXISTS public.calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES public.direct_conversations(id) ON DELETE CASCADE,
  caller_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  callee_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
  state text NOT NULL DEFAULT 'ringing', -- ringing | accepted | declined | ended
  channel_name text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);

-- Index for quick lookup of active calls per conversation
CREATE INDEX IF NOT EXISTS idx_calls_conversation_id ON public.calls(conversation_id);
