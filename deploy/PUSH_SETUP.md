# Mobile Push Setup (FCM + APNs)

The `notify-mobile` Edge Function handles all message-driven push fanout
for NCore. It is **already deployed** by `npm run release:update`, but
will refuse to send notifications until you provision the platform
credentials below. Until that happens it returns `{ ok: true, sent: 0 }`
on every call — partial setup never breaks message sending.

## Architecture

```
direct_messages INSERT
  └─> notify_mobile_dm() trigger        (in 20260522210000_mobile_push.sql)
        └─> _notify_mobile_invoke()
              └─> pg_net HTTP POST
                    └─> /functions/v1/notify-mobile  (Supabase Edge Function)
                          ├─> FCM HTTP v1   (Android + Web push)
                          └─> APNs HTTP/2   (iOS)
```

The trigger only fires for **direct messages** today. Channel-mention
notifications are deferred to a future migration that adds a
`mentioned_user_ids uuid[]` column to `messages`.

## Required Postgres GUCs

The trigger reads two settings via `current_setting('app.*', true)`:

```sql
-- In the Supabase Dashboard SQL Editor, replace with your actual values:
ALTER DATABASE postgres
  SET app.notify_mobile_url = 'https://kxheuoaurlaociszyrof.supabase.co/functions/v1/notify-mobile';

-- The service-role JWT. Required: without it the trigger no-ops.
ALTER DATABASE postgres
  SET app.service_role_key = 'eyJ...your-service-role-jwt...';
```

Yes, putting the service-role key on the database role is unusual — but
it is the only way for `pg_net.http_post` to authenticate to an Edge
Function from inside a trigger. The key never leaves Postgres; the GUC
is read with the `missing_ok=true` form, so a misconfigured role just
silently disables push.

## Required Edge Function secrets

Set these in **Supabase Dashboard → Edge Functions → notify-mobile → Secrets**
(or via `supabase secrets set …`):

### FCM (Android + Web push)

Google retired the legacy "server key" auth in June 2024. Use **HTTP v1**:

1. In the **Firebase Console**, go to *Project Settings* → *Service Accounts* → *Generate new private key*. Download the JSON file.
2. Copy the entire JSON contents (one line, no whitespace).
3. Set:

   ```
   FCM_SERVICE_ACCOUNT_JSON  =  {"type":"service_account","project_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n…","client_email":"...@...iam.gserviceaccount.com",…}
   ```

The `notify-mobile` function caches the OAuth access token for ~55 minutes;
you don't need a separate access-token store.

### APNs (iOS)

Available only after an iOS Capacitor build is shipped (no `ios/` directory
in this repo yet — Track this in the v12 backlog). When you do:

1. In **Apple Developer → Certificates, Identifiers & Profiles → Keys**, create a new APNs auth key. Save the `.p8` file.
2. Note the **Key ID**, **Team ID**, and your **iOS Bundle ID** (likely `com.nyptid.ncore`).
3. Set:

   ```
   APNS_KEY_ID       =  ABCD1234EF
   APNS_TEAM_ID      =  XYZ9876543
   APNS_BUNDLE_ID    =  com.nyptid.ncore
   APNS_PRIVATE_KEY  =  -----BEGIN PRIVATE KEY-----\n<contents of the .p8 file with literal \n line breaks>\n-----END PRIVATE KEY-----
   APNS_USE_SANDBOX  =  false   # set to "true" for development builds
   ```

   When pasting the key, replace literal newlines with `\n` so the value fits on a single line in the secrets UI. The function unescapes them before importing.

### VITE_FCM_VAPID_PUBLIC_KEY (browser web-push only)

If you want plain-browser push (no Capacitor), set the public VAPID key
on the Vercel project as a build-time env var:

```
VITE_FCM_VAPID_PUBLIC_KEY  =  BNxa…your-vapid-public-key…
```

This is the public half — safe to expose. The matching private key is
implicit in `FCM_SERVICE_ACCOUNT_JSON`.

## Capacitor (Android)

The web build already calls `autoRegisterPushToken()` from `AuthContext`
on every sign-in. To make it work inside the Android shell:

```bash
cd project
npm i @capacitor/push-notifications
npx cap sync android
```

Then add to `android/app/google-services.json` (download from Firebase
Console → Project Settings → General → Your apps → Android app → Download).

Rebuild the APK with `npm run build:apk:release`. The plugin will
register the FCM token on first launch and `user_devices` will pick it up.

## Verifying

1. Sign in on a device that has push enabled. Check that a row appears
   in `user_devices` with the right `platform`.
2. Send a DM **from another account** to the test user.
3. In the **Supabase Dashboard → Logs → Edge Functions → notify-mobile**,
   you should see a log line like:

   ```
   { recipients: 1, devices: 1, sent: 1, errors: [] }
   ```

4. The push should arrive on the device. Tap it and the deep link should
   open the conversation (handled by `App.tsx` `onDesktopNotificationClick`
   and the Capacitor `pushNotificationActionPerformed` listener).

## Cross-device mute

The migration also adds a `notification_preferences` table so users can
mute conversations/channels server-side. The `notify-mobile` function
respects `mode = 'none'` and `muted_until > now()` rows scoped to a DM.
The Settings UI for managing these mutes is part of the v12 backlog.
