/*
  # Server customization foundation + suspicious legacy account cleanup

  ## Adds
  - `community_server_customizations` table for advanced per-server customization.
  - RLS policies for member read + admin/owner writes.

  ## Cleanup
  - Removes legacy `omatic657` account/profile records that should not be present.
*/

CREATE TABLE IF NOT EXISTS public.community_server_customizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL UNIQUE REFERENCES public.communities(id) ON DELETE CASCADE,
  accent_color text NOT NULL DEFAULT '#00c8ff',
  gradient_start text NOT NULL DEFAULT '#0b1220',
  gradient_end text NOT NULL DEFAULT '#192338',
  server_tagline text NOT NULL DEFAULT '',
  welcome_message text NOT NULL DEFAULT '',
  rules_markdown text NOT NULL DEFAULT '',
  onboarding_steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  default_slowmode_seconds integer NOT NULL DEFAULT 0 CHECK (default_slowmode_seconds >= 0 AND default_slowmode_seconds <= 21600),
  max_upload_mb integer NOT NULL DEFAULT 10240 CHECK (max_upload_mb >= 1 AND max_upload_mb <= 10240),
  verification_level text NOT NULL DEFAULT 'low' CHECK (verification_level IN ('none', 'low', 'medium', 'high', 'very_high')),
  custom_role_labels jsonb NOT NULL DEFAULT '{"owner":"Owner","admin":"Admin","moderator":"Moderator","member":"Member"}'::jsonb,
  custom_theme_css text NOT NULL DEFAULT '',
  enable_animated_background boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS community_server_customizations_community_idx
  ON public.community_server_customizations(community_id);

DROP TRIGGER IF EXISTS community_server_customizations_updated_at ON public.community_server_customizations;
CREATE TRIGGER community_server_customizations_updated_at
  BEFORE UPDATE ON public.community_server_customizations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.community_server_customizations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Community customization visible to members" ON public.community_server_customizations;
CREATE POLICY "Community customization visible to members"
  ON public.community_server_customizations
  FOR SELECT
  TO authenticated
  USING (
    public.is_community_member(community_id, auth.uid())
    OR public.is_platform_admin(auth.uid())
  );

DROP POLICY IF EXISTS "Community customization insert by admins" ON public.community_server_customizations;
CREATE POLICY "Community customization insert by admins"
  ON public.community_server_customizations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_community_admin(community_id, auth.uid())
    OR public.is_platform_admin(auth.uid())
  );

DROP POLICY IF EXISTS "Community customization update by admins" ON public.community_server_customizations;
CREATE POLICY "Community customization update by admins"
  ON public.community_server_customizations
  FOR UPDATE
  TO authenticated
  USING (
    public.is_community_admin(community_id, auth.uid())
    OR public.is_platform_admin(auth.uid())
  )
  WITH CHECK (
    public.is_community_admin(community_id, auth.uid())
    OR public.is_platform_admin(auth.uid())
  );

DROP POLICY IF EXISTS "Community customization delete by admins" ON public.community_server_customizations;
CREATE POLICY "Community customization delete by admins"
  ON public.community_server_customizations
  FOR DELETE
  TO authenticated
  USING (
    public.is_community_admin(community_id, auth.uid())
    OR public.is_platform_admin(auth.uid())
  );

DO $$
DECLARE
  suspect_ids uuid[];
BEGIN
  SELECT coalesce(array_agg(id), ARRAY[]::uuid[])
    INTO suspect_ids
  FROM auth.users
  WHERE lower(email) = 'omatic657@gmail.com';

  suspect_ids := suspect_ids || coalesce(
    (SELECT array_agg(id) FROM public.profiles WHERE lower(username) = 'omatic657'),
    ARRAY[]::uuid[]
  );

  SELECT coalesce(array_agg(DISTINCT id), ARRAY[]::uuid[])
    INTO suspect_ids
  FROM unnest(suspect_ids) AS id;

  IF array_length(suspect_ids, 1) > 0 THEN
    DELETE FROM auth.users WHERE id = ANY (suspect_ids);
    DELETE FROM public.profiles WHERE id = ANY (suspect_ids);
  END IF;

  DELETE FROM public.profiles WHERE lower(username) = 'omatic657';
END $$;
