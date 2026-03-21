/*
  # Add profile banner support

  Adds a nullable `banner_url` column to `public.profiles` so users can upload
  and display profile banners in Settings/Profile pages.
*/

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS banner_url text;
