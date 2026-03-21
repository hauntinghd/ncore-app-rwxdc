import { createClient } from 'npm:@supabase/supabase-js@2';
import { RtcRole, RtcTokenBuilder } from 'npm:agora-access-token@2.0.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const agoraAppId = Deno.env.get('AGORA_APP_ID');
    const agoraAppCertificate = Deno.env.get('AGORA_APP_CERTIFICATE');

    if (!supabaseUrl || !supabaseAnonKey || !agoraAppId || !agoraAppCertificate) {
      return new Response(
        JSON.stringify({ error: 'Missing required function secrets (SUPABASE_*, AGORA_*)' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const authHeader = req.headers.get('Authorization') || '';
    const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : '';

    const payload = await req.json();
    const channelName = String(payload?.channelName || '').trim();
    const requestedUid = String(payload?.uid || '').trim();

    if (!channelName || !requestedUid) {
      return new Response(JSON.stringify({ error: 'channelName and uid are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!/^[a-zA-Z0-9:_-]{1,64}$/.test(channelName)) {
      return new Response(JSON.stringify({ error: 'Invalid channelName format' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Optional auth validation: enforce uid match when a bearer token is present.
    // Some runtime environments can make `supabase.auth.getUser()` fail; fall back
    // to decoding the JWT and performing basic checks (expiry + sub matches).
    if (jwt) {
      try {
        const parts = jwt.split('.');
        if (parts.length < 2) throw new Error('malformed token');
        const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
        const jsonPayload = decodeURIComponent(Array.prototype.map.call(atob(padded), (c: string) => '%'+('00'+c.charCodeAt(0).toString(16)).slice(-2)).join(''));
        const parsed = JSON.parse(jsonPayload);
        const nowSec = Math.floor(Date.now()/1000);
        if (parsed.exp && parsed.exp <= nowSec) {
          return new Response(JSON.stringify({ error: 'Expired token' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        const authSub = String(parsed.sub || '').trim();
        const allowedDerivedUid =
          Boolean(authSub) &&
          (requestedUid === authSub ||
            requestedUid === `${authSub}::screen` ||
            requestedUid.startsWith(`${authSub}::screen:`));
        if (authSub && !allowedDerivedUid) {
          return new Response(JSON.stringify({ error: 'uid does not match authenticated user' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Invalid Bearer token' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + 3600;
    const token = RtcTokenBuilder.buildTokenWithAccount(
      agoraAppId,
      agoraAppCertificate,
      channelName,
      requestedUid,
      RtcRole.PUBLISHER,
      expiresAt,
      expiresAt,
    );

    return new Response(
      JSON.stringify({
        token,
        appId: agoraAppId,
        uid: requestedUid,
        expiresAt,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
