-- Ensure direct-call signaling on public.calls works for authenticated DM participants.

ALTER TABLE IF EXISTS public.calls ENABLE ROW LEVEL SECURITY;

-- Normalize/replace older policy names if present.
DROP POLICY IF EXISTS "Calls insert by caller" ON public.calls;
DROP POLICY IF EXISTS "Calls view for involved" ON public.calls;
DROP POLICY IF EXISTS "Calls update state by involved" ON public.calls;
DROP POLICY IF EXISTS "calls_insert_by_caller" ON public.calls;
DROP POLICY IF EXISTS "calls_select_for_participants" ON public.calls;
DROP POLICY IF EXISTS "calls_update_for_participants" ON public.calls;

CREATE POLICY "calls_insert_by_caller"
  ON public.calls
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "calls_select_for_participants"
  ON public.calls
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "calls_update_for_participants"
  ON public.calls
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Enable realtime updates for call state transitions (ringing/accepted/ended).
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.calls;
  EXCEPTION
    WHEN duplicate_object THEN
      NULL;
  END;
END $$;
