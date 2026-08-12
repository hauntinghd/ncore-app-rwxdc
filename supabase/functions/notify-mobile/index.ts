// supabase/functions/notify-mobile/index.ts
//
// Mobile push fanout for NCore.
//
// Called by the `notify_mobile_dm` Postgres trigger after a new direct
// message is inserted. Loads recipient device tokens, groups them by
// platform, and dispatches:
//   - Android / Web: FCM HTTP v1 (Google's current API; legacy FCM is
//     end-of-life). Requires FCM_SERVICE_ACCOUNT_JSON.
//   - iOS:           APNs JWT-token auth. Requires APNS_KEY_ID,
//                    APNS_TEAM_ID, APNS_BUNDLE_ID, APNS_PRIVATE_KEY (p8 contents).
//
// All credentials are optional. If a platform's creds are missing the
// function logs and skips that platform, so a partial setup still works.
// On total failure (no creds at all) the function returns 200 with
// `sent: 0` so the trigger doesn't blow up.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface IncomingPayload {
  kind: 'dm' | 'mention';
  message_id: string;
  conversation_id?: string | null;
  channel_id?: string | null;
  sender_id: string;
  content_preview: string;
  created_at: string;
}

interface DeviceRow {
  user_id: string;
  token: string;
  platform: string | null;
  push_enabled: boolean | null;
}

interface ProfileRow {
  id: string;
  username: string | null;
  display_name: string | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return json({ error: 'POST only' }, 405);
  }

  const body = (await req.json().catch(() => null)) as IncomingPayload | null;
  if (!body || !body.kind || !body.sender_id) {
    return json({ error: 'invalid payload' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: 'function misconfigured' }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ------------------------------------------------------------------
  // 1. Resolve recipients (everyone in the conversation except sender,
  //    minus muted users)
  // ------------------------------------------------------------------
  const recipientIds = await resolveRecipients(admin, body);
  if (recipientIds.length === 0) {
    return json({ ok: true, sent: 0, reason: 'no recipients' });
  }

  // ------------------------------------------------------------------
  // 2. Fetch device tokens
  // ------------------------------------------------------------------
  const { data: devices, error: devicesError } = await admin
    .from('user_devices')
    .select('user_id, token, platform, push_enabled')
    .in('user_id', recipientIds);

  if (devicesError) {
    return json({ error: 'devices lookup failed', detail: devicesError.message }, 500);
  }

  const usableDevices = ((devices ?? []) as DeviceRow[]).filter(
    (d) => d.push_enabled !== false && typeof d.token === 'string' && d.token.length > 0,
  );
  if (usableDevices.length === 0) {
    return json({ ok: true, sent: 0, reason: 'no tokens' });
  }

  // ------------------------------------------------------------------
  // 3. Resolve sender display
  // ------------------------------------------------------------------
  const { data: senderRows } = await admin
    .from('profiles')
    .select('id, username, display_name')
    .eq('id', body.sender_id)
    .limit(1);
  const sender = (senderRows?.[0] ?? null) as ProfileRow | null;
  const senderName = (sender?.display_name || sender?.username || 'Someone').toString();

  const title = body.kind === 'dm' ? senderName : `${senderName} mentioned you`;
  const subtitle = body.content_preview || 'New message';

  // ------------------------------------------------------------------
  // 4. Dispatch by platform
  // ------------------------------------------------------------------
  const fcmTokens: DeviceRow[] = [];
  const apnsTokens: DeviceRow[] = [];
  for (const d of usableDevices) {
    const platform = String(d.platform || '').toLowerCase();
    if (platform === 'ios' || platform === 'apns') apnsTokens.push(d);
    else fcmTokens.push(d); // android, web, default
  }

  const results = await Promise.allSettled([
    fcmTokens.length > 0 ? dispatchFcm(fcmTokens, { title, body: subtitle, payload: body }) : Promise.resolve({ sent: 0, errors: [] }),
    apnsTokens.length > 0 ? dispatchApns(apnsTokens, { title, body: subtitle, payload: body }) : Promise.resolve({ sent: 0, errors: [] }),
  ]);

  const summary = results.map((r) => (r.status === 'fulfilled' ? r.value : { sent: 0, errors: [String((r as PromiseRejectedResult).reason)] }));
  const sent = summary.reduce((acc, r) => acc + (r.sent || 0), 0);
  const errors = summary.flatMap((r) => r.errors || []);

  return json({
    ok: true,
    recipients: recipientIds.length,
    devices: usableDevices.length,
    sent,
    errors,
  });
});

// ===========================================================================
// Recipient resolution
// ===========================================================================

async function resolveRecipients(
  admin: ReturnType<typeof createClient>,
  body: IncomingPayload,
): Promise<string[]> {
  const exclude = new Set<string>([String(body.sender_id || '')]);

  if (body.kind === 'dm' && body.conversation_id) {
    const { data: members } = await admin
      .from('direct_conversation_members')
      .select('user_id')
      .eq('conversation_id', body.conversation_id);
    const ids = (members ?? [])
      .map((row: { user_id: string | null }) => String(row.user_id || ''))
      .filter((id) => id && !exclude.has(id));

    // Filter out users who muted this conversation
    if (ids.length > 0) {
      const { data: muted } = await admin
        .from('notification_preferences')
        .select('user_id, mode, muted_until')
        .in('user_id', ids)
        .eq('scope_kind', 'dm')
        .eq('scope_id', body.conversation_id);
      const muteSet = new Set(
        ((muted ?? []) as Array<{ user_id: string; mode: string; muted_until: string | null }>)
          .filter((row) => {
            if (row.mode === 'none') return true;
            if (row.muted_until && new Date(row.muted_until).getTime() > Date.now()) return true;
            return false;
          })
          .map((row) => String(row.user_id)),
      );
      return ids.filter((id) => !muteSet.has(id));
    }
    return ids;
  }

  return [];
}

// ===========================================================================
// FCM HTTP v1
// ===========================================================================

interface FcmServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

interface DispatchInput {
  title: string;
  body: string;
  payload: IncomingPayload;
}

let cachedFcmAccessToken: { token: string; expiresAt: number } | null = null;

async function dispatchFcm(devices: DeviceRow[], input: DispatchInput): Promise<{ sent: number; errors: string[] }> {
  const raw = Deno.env.get('FCM_SERVICE_ACCOUNT_JSON');
  if (!raw) {
    return { sent: 0, errors: ['FCM_SERVICE_ACCOUNT_JSON not configured'] };
  }
  let account: FcmServiceAccount;
  try {
    account = JSON.parse(raw);
  } catch (err) {
    return { sent: 0, errors: [`FCM_SERVICE_ACCOUNT_JSON parse error: ${err}`] };
  }
  const accessToken = await getFcmAccessToken(account);

  let sent = 0;
  const errors: string[] = [];

  for (const device of devices) {
    try {
      const resp = await fetch(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            token: device.token,
            notification: { title: input.title, body: input.body },
            data: {
              kind: input.payload.kind,
              message_id: input.payload.message_id,
              conversation_id: input.payload.conversation_id ?? '',
              channel_id: input.payload.channel_id ?? '',
              sender_id: input.payload.sender_id,
            },
            android: { priority: 'HIGH', notification: { sound: 'default' } },
            webpush: { headers: { Urgency: 'high' } },
          },
        }),
      });
      if (resp.ok) {
        sent += 1;
      } else {
        const detail = await resp.text();
        errors.push(`fcm ${device.token.slice(0, 8)}…: ${resp.status} ${detail.slice(0, 200)}`);
        // 404 / UNREGISTERED -> token is dead, retire it
        if (resp.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/i.test(detail)) {
          // best-effort cleanup; ignore failure
          await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/user_devices?token=eq.${encodeURIComponent(device.token)}`, {
            method: 'DELETE',
            headers: {
              Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''}`,
              apikey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
            },
          }).catch(() => undefined);
        }
      }
    } catch (err) {
      errors.push(`fcm ${device.token.slice(0, 8)}…: ${err}`);
    }
  }

  return { sent, errors };
}

async function getFcmAccessToken(account: FcmServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedFcmAccessToken && cachedFcmAccessToken.expiresAt > now + 60) {
    return cachedFcmAccessToken.token;
  }

  const header = base64UrlJson({ alg: 'RS256', typ: 'JWT' });
  const payload = base64UrlJson({
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  });

  const toSign = `${header}.${payload}`;
  const signature = await rsaSignSha256(toSign, account.private_key);
  const assertion = `${toSign}.${signature}`;

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!resp.ok) {
    throw new Error(`FCM token exchange failed: ${resp.status} ${await resp.text()}`);
  }
  const data = (await resp.json()) as { access_token: string; expires_in: number };
  cachedFcmAccessToken = { token: data.access_token, expiresAt: now + data.expires_in };
  return data.access_token;
}

// ===========================================================================
// APNs (HTTP/2 with JWT auth)
// ===========================================================================

let cachedApnsJwt: { token: string; issuedAt: number } | null = null;

async function dispatchApns(devices: DeviceRow[], input: DispatchInput): Promise<{ sent: number; errors: string[] }> {
  const keyId = Deno.env.get('APNS_KEY_ID');
  const teamId = Deno.env.get('APNS_TEAM_ID');
  const bundleId = Deno.env.get('APNS_BUNDLE_ID');
  const privateKey = Deno.env.get('APNS_PRIVATE_KEY');
  const useSandbox = (Deno.env.get('APNS_USE_SANDBOX') ?? '').toLowerCase() === 'true';

  if (!keyId || !teamId || !bundleId || !privateKey) {
    return { sent: 0, errors: ['APNs creds incomplete'] };
  }

  const jwt = await getApnsJwt({ keyId, teamId, privateKey });
  const host = useSandbox ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';

  let sent = 0;
  const errors: string[] = [];

  for (const device of devices) {
    try {
      const resp = await fetch(`https://${host}:443/3/device/${device.token}`, {
        method: 'POST',
        headers: {
          Authorization: `bearer ${jwt}`,
          'apns-topic': bundleId,
          'apns-push-type': 'alert',
          'apns-priority': '10',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          aps: {
            alert: { title: input.title, body: input.body },
            sound: 'default',
            'mutable-content': 1,
          },
          ncore: {
            kind: input.payload.kind,
            message_id: input.payload.message_id,
            conversation_id: input.payload.conversation_id ?? '',
            channel_id: input.payload.channel_id ?? '',
            sender_id: input.payload.sender_id,
          },
        }),
      });
      if (resp.ok || resp.status === 200) {
        sent += 1;
      } else {
        const detail = await resp.text();
        errors.push(`apns ${device.token.slice(0, 8)}…: ${resp.status} ${detail.slice(0, 200)}`);
      }
    } catch (err) {
      errors.push(`apns ${device.token.slice(0, 8)}…: ${err}`);
    }
  }

  return { sent, errors };
}

async function getApnsJwt(opts: { keyId: string; teamId: string; privateKey: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  // APNs JWTs must be refreshed every 20-60 min; we refresh at 50 min.
  if (cachedApnsJwt && now - cachedApnsJwt.issuedAt < 50 * 60) {
    return cachedApnsJwt.token;
  }
  const header = base64UrlJson({ alg: 'ES256', typ: 'JWT', kid: opts.keyId });
  const payload = base64UrlJson({ iss: opts.teamId, iat: now });
  const toSign = `${header}.${payload}`;
  const signature = await ecdsaSignSha256(toSign, opts.privateKey);
  const token = `${toSign}.${signature}`;
  cachedApnsJwt = { token, issuedAt: now };
  return token;
}

// ===========================================================================
// Crypto helpers
// ===========================================================================

function base64UrlJson(value: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function rsaSignSha256(input: string, pemPrivateKey: string): Promise<string> {
  const key = await importPem(pemPrivateKey, 'RSASSA-PKCS1-v1_5', 'SHA-256');
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(input));
  return base64UrlEncode(new Uint8Array(sig));
}

async function ecdsaSignSha256(input: string, pemPrivateKey: string): Promise<string> {
  const key = await importPem(pemPrivateKey, { name: 'ECDSA', namedCurve: 'P-256' }, 'SHA-256');
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(input));
  return base64UrlEncode(new Uint8Array(sig));
}

async function importPem(pem: string, algorithm: AlgorithmIdentifier | EcKeyImportParams, hash: string): Promise<CryptoKey> {
  const cleaned = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\\n/g, '\n')
    .replace(/\s+/g, '');
  const der = Uint8Array.from(atob(cleaned), (c) => c.charCodeAt(0));
  const algParam: AlgorithmIdentifier | RsaHashedImportParams | EcKeyImportParams =
    typeof algorithm === 'string'
      ? ({ name: algorithm, hash } as RsaHashedImportParams)
      : algorithm;
  return crypto.subtle.importKey('pkcs8', der.buffer, algParam as RsaHashedImportParams | EcKeyImportParams, false, ['sign']);
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
