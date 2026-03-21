import { createClient } from 'npm:@supabase/supabase-js@2';
import fetch from 'npm:node-fetch@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Minimal edge function that attempts to send push via FCM when environment is configured.
// If no FCM key is present this function still succeeds (noop) so client flows continue.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const fcmServerKey = Deno.env.get('FCM_SERVER_KEY') || '';

    if (!supabaseUrl || !supabaseAnonKey) {
      return new Response(JSON.stringify({ error: 'Missing SUPABASE_* env' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const body = await req.json().catch(() => ({}));
    const targets: string[] = Array.isArray(body?.deviceTokens) ? body.deviceTokens : [];
    const userIds: string[] = Array.isArray(body?.userIds) ? body.userIds : [];
    const notification = body?.notification || {};

    // If userIds are provided, fetch tokens from DB
    let finalTargets = Array.from(new Set(targets));
    if (userIds.length > 0) {
      const supabase = createClient(supabaseUrl, supabaseAnonKey);
      const { data: rows } = await supabase.from('user_devices').select('token').in('user_id', userIds as any[]);
      if (rows && rows.length > 0) {
        for (const r of rows as any[]) {
          if (r?.token) finalTargets.push(r.token);
        }
      }
    }

    finalTargets = Array.from(new Set(finalTargets));

    // If no FCM key or no targets, return success (no-op) so callers don't fail.
    if (!fcmServerKey || finalTargets.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0 }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Build FCM v1 request payload (legacy HTTP v1 simple payload works for many tokens)
    const payload = {
      registration_ids: finalTargets,
      notification: {
        title: notification.title || 'Incoming call',
        body: notification.body || 'You have an incoming call',
        sound: 'default',
      },
      data: notification.data || {},
    };

    const resp = await fetch('https://fcm.googleapis.com/fcm/send', {
      method: 'POST',
      headers: {
        Authorization: `key=${fcmServerKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const text = await resp.text();
    return new Response(JSON.stringify({ ok: true, status: resp.status, info: text }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
