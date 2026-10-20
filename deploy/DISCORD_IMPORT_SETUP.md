# Discord Import — owner setup

The social-graph import (Settings → Data Import → "Reconnect Your Discord
Friends") needs two owner actions before it works in production. Until both
are done the UI degrades cleanly: the edge function returns
`not_configured` (503) and the client shows "Discord import is not
configured on this server yet."

## 1. Apply the migration

`supabase/migrations/20260811090000_discord_import_graph.sql`

```bash
SUPABASE_ACCESS_TOKEN=<personal-access-token> npx supabase db push --linked
```

Verify with `npx supabase migration list --linked` (do not trust
hand-maintained lists — see MEMORY.md).

## 2. Set the pepper and deploy the hash function

The pepper is the HMAC key for Discord ID fingerprints. Treat it like a
signing key: **rotating it orphans every stored fingerprint** (all users
would need to re-import), so generate it once and keep it safe.

```bash
openssl rand -hex 32
SUPABASE_ACCESS_TOKEN=<token> npx supabase secrets set DISCORD_IMPORT_PEPPER=<value> --project-ref kxheuoaurlaociszyrof
SUPABASE_ACCESS_TOKEN=<token> npx supabase functions deploy discord-import-hash --use-api --project-ref kxheuoaurlaociszyrof
```

## What this feature stores (for support questions)

- One row per linked user: the HMAC fingerprint of their own Discord ID,
  their auto-reconnect preference, and counters.
- Fingerprint edges to friends / blocked users / servers. No usernames, no
  messages, no raw Discord IDs.
- Friendships restore only on **mutual** attestation (both people imported,
  both listed each other, both left auto-reconnect on). Blocks apply
  one-sided but never overwrite an existing relationship.
- "Unlink" deletes the identity row and edges (cascade). Already-restored
  relationships are real relationships and stay.

Guild edges are stored but unused for now — they feed the upcoming
community-migration matcher.
