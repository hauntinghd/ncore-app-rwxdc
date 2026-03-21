-- RLS for calls table (ensure callers can create calls and callees can view/accept)
-- Idempotent: drop policies if they exist before creating

ALTER TABLE IF EXISTS public.calls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Calls insert by caller" ON public.calls;
CREATE POLICY "Calls insert by caller"
  ON public.calls FOR INSERT TO authenticated
  WITH CHECK (caller_id = auth.uid());

DROP POLICY IF EXISTS "Calls view for involved" ON public.calls;
CREATE POLICY "Calls view for involved"
  ON public.calls FOR SELECT TO authenticated
  USING (
    caller_id = auth.uid() OR
    auth.uid() = ANY(callee_ids)
  );

DROP POLICY IF EXISTS "Calls update state by involved" ON public.calls;
CREATE POLICY "Calls update state by involved"
  ON public.calls FOR UPDATE TO authenticated
  USING (
    caller_id = auth.uid() OR
    auth.uid() = ANY(callee_ids)
  )
  WITH CHECK (
    NEW.state IN ('ringing','accepted','declined','ended')
  );

-- Optional: allow service_role to bypass RLS via server-side operations
