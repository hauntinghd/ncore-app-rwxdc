/*
  # Add profile custom status text + emoji

  Adds optional status text fields to profiles so users can show
  richer presence (e.g. short status phrase + emoji).
*/

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS custom_status text,
  ADD COLUMN IF NOT EXISTS custom_status_emoji text;

UPDATE public.profiles
SET
  custom_status = COALESCE(custom_status, ''),
  custom_status_emoji = COALESCE(custom_status_emoji, '')
WHERE custom_status IS NULL
   OR custom_status_emoji IS NULL;

ALTER TABLE public.profiles
  ALTER COLUMN custom_status SET DEFAULT '',
  ALTER COLUMN custom_status_emoji SET DEFAULT '',
  ALTER COLUMN custom_status SET NOT NULL,
  ALTER COLUMN custom_status_emoji SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_custom_status_length_check'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_custom_status_length_check
      CHECK (char_length(custom_status) <= 160);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_custom_status_emoji_length_check'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_custom_status_emoji_length_check
      CHECK (char_length(custom_status_emoji) <= 16);
  END IF;
END
$$;
