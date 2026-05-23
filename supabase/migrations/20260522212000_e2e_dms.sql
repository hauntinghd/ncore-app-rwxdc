/*
  # E2E direct messages (Path A)

  ## Summary
  Adds end-to-end encryption to direct messages without breaking existing
  clients. Path A trade-offs:
   - Each user has ONE published identity key per device install. Multi-
     device E2E (sender encrypts per-device) is deferred to Path B.
   - Senders always write to `direct_messages.content`. When E2E is
     enabled and we can resolve a recipient public key, `content` becomes
     a placeholder ('[NCore encrypted message]') and the real payload
     goes into `direct_messages.ciphertext` (jsonb).
   - Old / unsupported clients see the placeholder, which signals they
     need to update without breaking the message stream.

  ## Tables / columns
  - `e2e_identity_keys`              — published per-user public keys
  - `direct_messages.ciphertext`     — encrypted payload
  - `direct_messages.e2e_version`    — protocol version (1)

  ## RLS
  - Anyone authenticated can read public keys (they're public).
  - Users can only insert/update/delete their own key rows.
*/

-- ============================================================
-- Identity key directory
-- ============================================================
CREATE TABLE IF NOT EXISTS public.e2e_identity_keys (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  public_key text NOT NULL,           -- base64-encoded raw public key
  algorithm text NOT NULL DEFAULT 'ECDH-P256',
  fingerprint text NOT NULL,          -- short safety code (sha256 hex slice)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS e2e_identity_keys_updated_at ON public.e2e_identity_keys;
CREATE TRIGGER e2e_identity_keys_updated_at
  BEFORE UPDATE ON public.e2e_identity_keys
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.e2e_identity_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone authenticated can read identity keys" ON public.e2e_identity_keys;
CREATE POLICY "Anyone authenticated can read identity keys"
  ON public.e2e_identity_keys FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Users can publish own identity key" ON public.e2e_identity_keys;
CREATE POLICY "Users can publish own identity key"
  ON public.e2e_identity_keys FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can rotate own identity key" ON public.e2e_identity_keys;
CREATE POLICY "Users can rotate own identity key"
  ON public.e2e_identity_keys FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can revoke own identity key" ON public.e2e_identity_keys;
CREATE POLICY "Users can revoke own identity key"
  ON public.e2e_identity_keys FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- Realtime: clients want to know when a peer publishes/rotates a key.
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.e2e_identity_keys;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- ============================================================
-- direct_messages: ciphertext payload + version stamp
-- ============================================================
ALTER TABLE public.direct_messages
  ADD COLUMN IF NOT EXISTS ciphertext jsonb,
  ADD COLUMN IF NOT EXISTS e2e_version smallint;

CREATE INDEX IF NOT EXISTS idx_direct_messages_e2e_version
  ON public.direct_messages(e2e_version)
  WHERE e2e_version IS NOT NULL;

-- Existing RLS already covers the new columns: SELECT/INSERT/UPDATE/DELETE
-- policies don't reference column lists, so ciphertext flows through with
-- the message itself.
