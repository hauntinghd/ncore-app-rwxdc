/*
  # Transfer platform owner to caseyh6657@gmail.com

  - Makes `caseyh6657@gmail.com` the owner account.
  - Ensures future profile inserts auto-assign owner to this email.
  - Removes owner role from other accounts so control is centralized.
*/

CREATE OR REPLACE FUNCTION public.handle_new_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_email text;
BEGIN
  SELECT email INTO user_email
  FROM auth.users
  WHERE id = NEW.id;

  IF lower(coalesce(user_email, '')) = 'caseyh6657@gmail.com' THEN
    NEW.platform_role := 'owner';
  ELSE
    IF NEW.platform_role = 'owner' THEN
      NEW.platform_role := 'user';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

UPDATE public.profiles
SET platform_role = CASE
  WHEN id IN (
    SELECT id
    FROM auth.users
    WHERE lower(email) = 'caseyh6657@gmail.com'
  ) THEN 'owner'
  WHEN platform_role = 'owner' THEN 'user'
  ELSE platform_role
END;
