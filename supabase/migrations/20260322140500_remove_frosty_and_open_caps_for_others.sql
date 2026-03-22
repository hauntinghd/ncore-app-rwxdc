/*
  # Hotfix: Remove Frosty + Keep Capability Gates Non-Blocking For Everyone Else

  User request:
  - Remove @frosty from platform and free username.
  - Ensure growth capability gating does not affect other users (including owner).
*/

-- ------------------------------------------------------------------
-- Remove frosty account(s) from auth + profiles.
-- Deleting from auth.users cascades to public.profiles.
-- ------------------------------------------------------------------
DO $$
DECLARE
  target_ids uuid[];
BEGIN
  SELECT COALESCE(array_agg(p.id), ARRAY[]::uuid[])
  INTO target_ids
  FROM public.profiles p
  WHERE lower(coalesce(p.username, '')) = 'frosty';

  IF array_length(target_ids, 1) IS NOT NULL THEN
    DELETE FROM auth.users
    WHERE id = ANY(target_ids);

    -- Safety fallback if any profile row remains.
    DELETE FROM public.profiles
    WHERE id = ANY(target_ids);
  END IF;
END;
$$;

-- ------------------------------------------------------------------
-- Make capability model permissive by default for non-admin users,
-- so rollout rules do not block normal usage.
-- ------------------------------------------------------------------
ALTER TABLE public.user_growth_capabilities
  ALTER COLUMN trust_tier SET DEFAULT 'trusted',
  ALTER COLUMN can_create_server SET DEFAULT true,
  ALTER COLUMN can_start_high_volume_calls SET DEFAULT true,
  ALTER COLUMN can_use_marketplace SET DEFAULT true,
  ALTER COLUMN unlock_source SET DEFAULT 'manual_override';

UPDATE public.user_growth_capabilities ugc
SET
  trust_tier = CASE
    WHEN p.platform_role IN ('owner', 'admin') THEN 'operator'
    ELSE 'trusted'
  END,
  can_create_server = true,
  can_start_high_volume_calls = true,
  can_use_marketplace = true,
  unlock_source = CASE
    WHEN p.platform_role IN ('owner', 'admin') THEN 'legacy_admin_seed'
    ELSE 'manual_override'
  END
FROM public.profiles p
WHERE p.id = ugc.user_id
  AND lower(coalesce(p.username, '')) <> 'frosty';

-- ------------------------------------------------------------------
-- Recreate seed function so new users are also non-blocked by default.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_user_growth_capabilities_row(p_user_id uuid)
RETURNS public.user_growth_capabilities
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  role_value text;
  seeded public.user_growth_capabilities%ROWTYPE;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'User id is required';
  END IF;

  SELECT p.platform_role
  INTO role_value
  FROM public.profiles p
  WHERE p.id = p_user_id;

  IF role_value IS NULL THEN
    RAISE EXCEPTION 'Profile not found for user id %', p_user_id;
  END IF;

  INSERT INTO public.user_growth_capabilities (
    user_id,
    trust_tier,
    can_create_server,
    can_start_high_volume_calls,
    can_use_marketplace,
    unlock_source
  )
  VALUES (
    p_user_id,
    CASE
      WHEN role_value IN ('owner', 'admin') THEN 'operator'
      ELSE 'trusted'
    END,
    true,
    true,
    true,
    CASE
      WHEN role_value IN ('owner', 'admin') THEN 'legacy_admin_seed'
      ELSE 'manual_override'
    END
  )
  ON CONFLICT (user_id) DO NOTHING;

  SELECT ugc.*
  INTO seeded
  FROM public.user_growth_capabilities ugc
  WHERE ugc.user_id = p_user_id;

  RETURN seeded;
END;
$$;

