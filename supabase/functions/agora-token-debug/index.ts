const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const headers: Record<string, string> = {};
    req.headers.forEach((v, k) => { headers[k] = v; });
    let body = null;
    try { body = await req.text(); } catch (e) { body = String(e); }

    const authHeader = req.headers.get('authorization') || null;
    let jwtPayload: any = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const jwt = authHeader.slice('Bearer '.length);
        const parts = jwt.split('.');
        if (parts.length >= 2) {
          const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
          const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
          const jsonPayload = decodeURIComponent(Array.prototype.map.call(atob(padded), (c: string) => '%'+('00'+c.charCodeAt(0).toString(16)).slice(-2)).join(''));
          jwtPayload = JSON.parse(jsonPayload);
        }
      } catch (e) {
        jwtPayload = { error: String(e) };
      }
    }

    const out = { headers, authHeaderPresent: Boolean(authHeader), authHeader, jwtPayload, body };
    return new Response(JSON.stringify(out, null, 2), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
