CREATE TABLE IF NOT EXISTS public.e2e_device_keys (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  device_id text NOT NULL,
  public_key text NOT NULL,
  algorithm text NOT NULL DEFAULT 'ECDH-P256',
  fingerprint text NOT NULL,
  device_label text,
  revoked_at timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, device_id)
);

DROP TRIGGER IF EXISTS e2e_device_keys_updated_at ON public.e2e_device_keys;
CREATE TRIGGER e2e_device_keys_updated_at
  BEFORE UPDATE ON public.e2e_device_keys
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE INDEX IF NOT EXISTS e2e_device_keys_user_active_idx
  ON public.e2e_device_keys(user_id, revoked_at, updated_at);

ALTER TABLE public.e2e_device_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone authenticated can read device keys" ON public.e2e_device_keys;
CREATE POLICY "Anyone authenticated can read device keys"
  ON public.e2e_device_keys FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Users can publish own device keys" ON public.e2e_device_keys;
CREATE POLICY "Users can publish own device keys"
  ON public.e2e_device_keys FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own device keys" ON public.e2e_device_keys;
CREATE POLICY "Users can update own device keys"
  ON public.e2e_device_keys FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can revoke own device keys" ON public.e2e_device_keys;
CREATE POLICY "Users can revoke own device keys"
  ON public.e2e_device_keys FOR DELETE TO authenticated
  USING (user_id = auth.uid());

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.e2e_device_keys;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
