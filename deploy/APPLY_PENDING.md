# Applying the pending migrations

As of 2026-07-30 there are **thirteen** unapplied migrations plus **two** edge
functions to deploy. Nothing built in the 2026-07-29 or 2026-07-30 sessions
exists in production until this runs.

## Why an agent could not do this

The Supabase CLI on this machine is authenticated as **crypticmobiledetailing@gmail.com**,
which has access to exactly one project:

```
qvtnnavxfbvtkwslnvrs   crypticmobiledetailing@gmail.com's Project
```

NCore is a **different** project in a **different** organisation:

```
kxheuoaurlaociszyrof   hauntinghd@gmail.com's Project   (org eumksaipdrfuaycohqqc)
```

`supabase migration list --linked` against it returns:

```
403 — Your account does not have the necessary privileges to access this endpoint
```

`.env` holds only `VITE_SUPABASE_ANON_KEY`, which is a public, RLS-guarded key
and cannot run DDL by design. So there is no path to the NCore database from
this machine without re-authenticating.

## Fix the access first

Pick one:

**A. Log in as the account that owns the project** (simplest)

```
npx supabase login
```

Sign in as **hauntinghd@gmail.com**. Then `npx supabase projects list` should
show `kxheuoaurlaociszyrof`.

**B. Use an access token from the owning account**

Create one at <https://supabase.com/dashboard/account/tokens> while signed in as
hauntinghd@gmail.com, then:

```
export SUPABASE_ACCESS_TOKEN=sbp_...
```

**C. Go direct with the database password**

From Dashboard → Project Settings → Database → Connection string. Then every
command below takes `--db-url "postgresql://postgres:<password>@db.kxheuoaurlaociszyrof.supabase.co:5432/postgres"`
instead of `--linked`.

## Then apply

```
cd project
npx supabase db push --linked
```

`db push` applies in filename order, which is the correct order — see the
constraints below.

### Ordering constraints that matter

The filenames already encode these, but if you apply anything by hand:

| Migration | Constraint |
|---|---|
| `20260711090000_enforce_channel_permissions.sql` | Must land **before** `20260730110000_moderation.sql`, which redefines its `enforce_channel_message_permission` function. Applying them out of order silently drops the timeout check. |
| `20260729120000_channel_read_state_and_search.sql` | Adds a **generated column to `messages`**, which rewrites the table. Run in a quiet window. |
| `20260730120000_mention_inbox.sql` | Backfills 30 days of mentions. Bounded on purpose; re-runnable. |
| `20260730130000_notification_preferences_surface.sql` | Redeclares `notification_preferences` idempotently, so it is safe either side of `20260522210000_mobile_push.sql`. |
| `20260730140000_message_requests.sql` | Replaces `create_or_get_direct_conversation` from `20260313203000`. Must land after it. |

### The full pending list

```
20260522210000_mobile_push.sql
20260522211000_custom_roles.sql
20260522212000_e2e_dms.sql
20260701090000_e2e_dm_attachments.sql
20260701100000_e2e_device_keys.sql
20260711090000_enforce_channel_permissions.sql
20260711123000_restore_member_content_visibility.sql
20260729120000_channel_read_state_and_search.sql
20260729130000_community_emojis.sql
20260730100000_link_embeds.sql
20260730110000_moderation.sql
20260730120000_mention_inbox.sql
20260730130000_notification_preferences_surface.sql
20260730140000_message_requests.sql
20260730150000_voice_telemetry.sql
```

## Edge functions

```
npx supabase functions deploy link-preview
npx supabase functions deploy gif-search
```

`link-preview` needs no configuration — `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` are injected by the platform.

`gif-search` needs a Tenor key, which is a **server secret**, not a `VITE_`
variable:

```
npx supabase secrets set TENOR_API_KEY=<key>
```

Get one at <https://developers.google.com/tenor/guides/quickstart>. Until it is
set, the GIF button is simply absent rather than broken.

## Verifying

After applying, these should all return without error:

```sql
select count(*) from public.channel_read_state;
select count(*) from public.community_emojis;
select count(*) from public.link_embeds;
select count(*) from public.community_bans;
select count(*) from public.message_mentions;
select count(*) from public.notification_preferences;
select count(*) from public.voice_session_metrics;
select request_state from public.direct_conversation_members limit 1;
```

And this should return `true` — it is the check that the moderation migration
landed after the permissions one rather than before:

```sql
select prosrc like '%timed_out_until%'
  from pg_proc
 where proname = 'enforce_channel_message_permission';
```

## Things to watch after applying

- **Message requests**: existing conversations default to `accepted`, so
  nobody's history moves. New DMs from strangers start landing in the requests
  inbox instead of the conversation list — that is the intended change, but it
  is the one users will notice first.
- **DM auto-friending stops.** `create_or_get_direct_conversation` no longer
  inserts a mutual `friend` row on every new DM. Existing friendships are
  untouched; this only stops new ones being created without consent. Anyone
  relying on "I messaged them so they are my friend" will see different
  behaviour.
- **Link previews** start firing outbound fetches from the edge function the
  first time each URL is seen. Expect a burst as history is scrolled.
