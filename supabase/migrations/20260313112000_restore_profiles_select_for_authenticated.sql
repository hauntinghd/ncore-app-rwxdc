/*
  # Restore profile discovery for authenticated users

  DM "New Message" user search relies on reading other users from `public.profiles`.
  Some environments are missing the authenticated SELECT policy, which causes
  authenticated users to only see themselves (or no other rows) under RLS.
*/

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'Profiles viewable by authenticated'
  ) THEN
    CREATE POLICY "Profiles viewable by authenticated"
      ON public.profiles
      FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END $$;
