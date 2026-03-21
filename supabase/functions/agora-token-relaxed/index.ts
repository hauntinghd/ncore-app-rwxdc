import { RtcRole, RtcTokenBuilder } from 'npm:agora-access-token@2.0.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Dev-only relaxed agora-token: does not require Authorization and will issue
// an Agora token for any requested uid. DO NOT use in production.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const agoraAppId = Deno.env.get('AGORA_APP_ID');
    const agoraAppCertificate = Deno.env.get('AGORA_APP_CERTIFICATE');

    if (!agoraAppId || !agoraAppCertificate) {
      return new Response(JSON.stringify({ error: 'Missing AGORA_* secrets' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const payload = await req.json().catch(() => ({}));
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

    return new Response(JSON.stringify({ token, appId: agoraAppId, uid: requestedUid, expiresAt }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
