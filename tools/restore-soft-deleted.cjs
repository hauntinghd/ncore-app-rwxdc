#!/usr/bin/env node
// Restore soft-deleted NCore auth.users rows in place.
// Bolt/StackBlitz's project-reset action renames real emails to
// `deleted_<uuid>@users.thumblab.local`. The row, UID, password hash, and
// every FK relationship still exist — only the email column is mangled.
// This script takes a mapping of UID -> original email and rewrites the
// email + email_confirm via Supabase's Admin API. Preserves everything.
//
// Usage:
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_SERVICE_ROLE=<service_role_jwt> \
//     node tools/restore-soft-deleted.cjs [--dry-run] [mapping.json]
//
// mapping.json: [{ "uid": "…", "email": "original@example.com" }, …]
// If no mapping file is provided, the built-in mapping for NCore's three
// known owner-era accounts is used.

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SRK = process.env.SUPABASE_SERVICE_ROLE;

if (!SUPABASE_URL) {
  console.error('Missing SUPABASE_URL env var (e.g. https://xxxxxx.supabase.co).');
  process.exit(2);
}
if (!SRK) {
  console.error('Missing SUPABASE_SERVICE_ROLE env var.');
  process.exit(2);
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const mappingArg = args.find((a) => !a.startsWith('--'));

const BUILTIN_MAPPING = [
  { uid: 'a2355909-5026-42a7-9458-61b696d8aa64', email: 'caseyh6657@gmail.com' },
  { uid: '0912a3e4-ccf4-42fd-9a44-50e6006488fb', email: 'ajhubbard18@icloud.com' },
  { uid: 'ef39048b-a5a1-46fb-823d-948f10635a1f', email: 'thewarmongerthefirst@gmail.com' },
];

function loadMapping() {
  if (!mappingArg) return BUILTIN_MAPPING;
  const resolved = path.resolve(process.cwd(), mappingArg);
  if (!fs.existsSync(resolved)) {
    console.error(`Mapping file not found: ${resolved}`);
    process.exit(2);
  }
  const parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  if (!Array.isArray(parsed)) {
    console.error('Mapping file must be a JSON array.');
    process.exit(2);
  }
  for (const entry of parsed) {
    if (!entry || typeof entry.uid !== 'string' || typeof entry.email !== 'string') {
      console.error('Each mapping entry must have string `uid` and `email`.');
      process.exit(2);
    }
  }
  return parsed;
}

async function fetchUser(uid) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
    headers: { apikey: SRK, Authorization: `Bearer ${SRK}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GET user ${uid} failed (${res.status}): ${body}`);
  }
  return res.json();
}

async function updateUser(uid, email) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
    method: 'PUT',
    headers: {
      apikey: SRK,
      Authorization: `Bearer ${SRK}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      email_confirm: true,
      user_metadata: { email, email_verified: true },
    }),
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`PUT user ${uid} failed (${res.status}): ${body}`);
  }
  return JSON.parse(body);
}

(async () => {
  const mapping = loadMapping();
  console.log(`Plan: ${dryRun ? '[DRY RUN] ' : ''}restore ${mapping.length} soft-deleted user(s).`);
  console.log('uid,old_email,new_email,status');

  let failures = 0;
  for (const entry of mapping) {
    let oldEmail = '(unknown)';
    try {
      const current = await fetchUser(entry.uid);
      oldEmail = current.email || '(none)';
      if (current.email === entry.email) {
        console.log(`${entry.uid},${oldEmail},${entry.email},skip_already_restored`);
        continue;
      }
      if (!dryRun) {
        await updateUser(entry.uid, entry.email);
      }
      console.log(`${entry.uid},${oldEmail},${entry.email},${dryRun ? 'dry_run_ok' : 'restored'}`);
    } catch (err) {
      failures += 1;
      const msg = String(err && err.message ? err.message : err).replace(/[\r\n,]+/g, ' ');
      console.log(`${entry.uid},${oldEmail},${entry.email},FAILED: ${msg}`);
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} user(s) failed to restore.`);
    process.exit(1);
  }
  console.log(`\nDone. ${dryRun ? '(No writes performed.)' : ''}`);
})();
