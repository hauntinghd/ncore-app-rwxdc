-- Reconcile stale auth.identities emails left behind by the Bolt/StackBlitz
-- soft-delete incident.
--
-- Background: when a project was reset, rows in auth.users had their `email`
-- column renamed to `deleted_<uuid>@users.thumblab.local`. The Admin API
-- restore (PUT /auth/v1/admin/users/{uid}) fixes the auth.users email but
-- does NOT cascade into auth.identities.identity_data->>'email' for the
-- corresponding provider rows. Sign-in still works (Supabase matches on
-- identity_id, not email), but the per-provider email is visibly stale in
-- the dashboard.
--
-- Affected users this session: caseyh6657, ajhubbard18, thewarmongerthefirst.
-- (If the 3 unmapped users — reta, evade, cold — are later restored, running
-- this again will pick them up too. Idempotent.)
--
-- How to apply:
--   1. Open https://supabase.com/dashboard/project/kxheuoaurlaociszyrof/sql/new
--   2. Paste the statements below
--   3. Run
--   4. Re-run the SELECT to confirm 0 stale rows remain.
--
-- Scope: auth.identities only. Does NOT touch auth.users, profiles, or any
-- public-schema table. Safe to re-run.

-- 1) Preview which identity rows are stale (read-only).
SELECT
  ai.id                                   AS identity_id,
  ai.user_id                              AS user_id,
  ai.provider                             AS provider,
  ai.identity_data ->> 'email'            AS stale_identity_email,
  au.email                                AS live_user_email
FROM auth.identities ai
JOIN auth.users au ON au.id = ai.user_id
WHERE (ai.identity_data ->> 'email') LIKE 'deleted_%@users.thumblab.local'
  AND au.email IS NOT NULL
  AND au.email NOT LIKE 'deleted_%@users.thumblab.local'
ORDER BY ai.user_id, ai.provider;

-- 2) Patch identity_data.email to match the current auth.users.email.
UPDATE auth.identities ai
SET identity_data = jsonb_set(
      ai.identity_data,
      '{email}',
      to_jsonb(au.email)
    )
FROM auth.users au
WHERE ai.user_id = au.id
  AND (ai.identity_data ->> 'email') LIKE 'deleted_%@users.thumblab.local'
  AND au.email IS NOT NULL
  AND au.email NOT LIKE 'deleted_%@users.thumblab.local';

-- 3) Some Supabase versions also expose a top-level `email` column on
-- auth.identities. Patch it too, when present. Guarded so this file still
-- runs on instances without the column.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'auth'
      AND table_name   = 'identities'
      AND column_name  = 'email'
  ) THEN
    EXECUTE $sql$
      UPDATE auth.identities ai
      SET email = au.email
      FROM auth.users au
      WHERE ai.user_id = au.id
        AND (ai.email IS NULL OR ai.email LIKE 'deleted_%@users.thumblab.local')
        AND au.email IS NOT NULL
        AND au.email NOT LIKE 'deleted_%@users.thumblab.local'
    $sql$;
  END IF;
END$$;

-- 4) Verify: expect 0 rows.
SELECT COUNT(*) AS remaining_stale_identity_rows
FROM auth.identities ai
JOIN auth.users au ON au.id = ai.user_id
WHERE (ai.identity_data ->> 'email') LIKE 'deleted_%@users.thumblab.local'
  AND au.email IS NOT NULL
  AND au.email NOT LIKE 'deleted_%@users.thumblab.local';
