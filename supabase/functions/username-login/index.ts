/**
 * Username Login — Supabase Edge Function
 *
 * Request body:  { username: string, password: string }
 * Response:      { access_token, refresh_token } | { error }
 *
 * Supabase Auth only signs in by email. Resolving username -> email in the
 * browser would need an endpoint that hands out email addresses for
 * usernames, which is an enumeration and doxxing primitive. So the lookup and
 * the password check both happen here: the email never leaves the server, and
 * every failure — unknown username, wrong password, unconfirmed account —
 * returns the same message, so the endpoint cannot be used to test whether a
 * username exists.
 *
 * The client then calls `supabase.auth.setSession()` with the returned tokens.
 *
 * Note on rate limiting: GoTrue rate-limits password grants per source IP,
 * and every call from here shares this function's egress IP. The client-side
 * throttle in AuthContext still applies per device; if abuse appears, add a
 * per-username counter table before raising GoTrue's limit.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';

const USERNAME_PATTERN = /^[a-zA-Z0-9_.-]{2,32}$/;
const GENERIC_ERROR = 'Invalid username or password.';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });

  try {
    if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

    const body = await req.json().catch(() => ({}));
    const username = String(body?.username ?? '').trim();
    const password = String(body?.password ?? '');
    if (!USERNAME_PATTERN.test(username) || !password || password.length > 512) {
      return json({ error: GENERIC_ERROR }, 400);
    }

    // profiles.username -> user id (case-insensitive, exact match).
    const profileRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?select=id&username=ilike.${encodeURIComponent(
        username.replace(/[%_\\]/g, (c) => `\\${c}`),
      )}&limit=1`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    );
    const profiles = profileRes.ok ? ((await profileRes.json()) as Array<{ id: string }>) : [];
    const userId = profiles[0]?.id;
    if (!userId) return json({ error: GENERIC_ERROR }, 401);

    // user id -> email, via the admin API (service role only).
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    });
    const email = userRes.ok ? String((await userRes.json())?.email || '') : '';
    if (!email) return json({ error: GENERIC_ERROR }, 401);

    // Normal password grant, exactly what signInWithPassword does.
    const tokenRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!tokenRes.ok) {
      if (tokenRes.status === 429) {
        return json({ error: 'Too many sign-in attempts. Wait a minute and try again.' }, 429);
      }
      return json({ error: GENERIC_ERROR }, 401);
    }
    const session = await tokenRes.json();
    return json({ access_token: session.access_token, refresh_token: session.refresh_token });
  } catch (error) {
    console.error('username-login error:', error);
    return json({ error: 'Sign-in is temporarily unavailable.' }, 500);
  }
});
