/**
 * Webhook Dispatch - Supabase Edge Function
 *
 * Dispatches events to registered community webhooks.
 * Called internally by database triggers or other edge functions.
 *
 * Events: message.create, message.update, message.delete,
 *         member.join, member.leave, voice.join, voice.leave
 *
 * Request body:
 *   { community_id: string, event: string, payload: object }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

async function signPayload(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
      return new Response(JSON.stringify({ error: 'Service role not configured' }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => ({}));
    const communityId = String(body?.community_id || '').trim();
    const event = String(body?.event || '').trim();
    const payload = body?.payload || {};

    if (!communityId || !event) {
      return new Response(JSON.stringify({ error: 'Missing community_id or event' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

    // Fetch active webhooks for this community that subscribe to this event
    const { data: webhooks, error: webhookError } = await supabase
      .from('community_webhooks')
      .select('id, url, secret_hash, events')
      .eq('community_id', communityId)
      .eq('is_active', true);

    if (webhookError) {
      console.error('Failed to fetch webhooks:', webhookError);
      return new Response(JSON.stringify({ error: 'Failed to fetch webhooks' }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    if (!webhooks || webhooks.length === 0) {
      return new Response(JSON.stringify({ dispatched: 0 }), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const matchingWebhooks = webhooks.filter((wh: any) => {
      const events = Array.isArray(wh.events) ? wh.events : [];
      return events.includes(event) || events.includes('*');
    });

    const timestamp = new Date().toISOString();
    const webhookPayload = JSON.stringify({
      event,
      timestamp,
      community_id: communityId,
      data: payload,
    });

    const results = await Promise.allSettled(
      matchingWebhooks.map(async (wh: any) => {
        const signature = wh.secret_hash
          ? await signPayload(webhookPayload, wh.secret_hash)
          : '';

        const response = await fetch(wh.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-NCore-Event': event,
            'X-NCore-Timestamp': timestamp,
            'X-NCore-Signature': signature ? `sha256=${signature}` : '',
            'User-Agent': 'NCore-Webhook/1.0',
          },
          body: webhookPayload,
          signal: AbortSignal.timeout(10000), // 10s timeout
        });

        if (!response.ok) {
          // Track failure
          await supabase
            .from('community_webhooks')
            .update({
              failure_count: (wh.failure_count || 0) + 1,
              last_failure_at: new Date().toISOString(),
            })
            .eq('id', wh.id);

          // Auto-disable after 10 consecutive failures
          if ((wh.failure_count || 0) >= 9) {
            await supabase
              .from('community_webhooks')
              .update({ is_active: false })
              .eq('id', wh.id);
          }

          throw new Error(`HTTP ${response.status}`);
        }

        // Reset failure count on success
        await supabase
          .from('community_webhooks')
          .update({
            failure_count: 0,
            last_triggered_at: new Date().toISOString(),
          })
          .eq('id', wh.id);

        return { id: wh.id, status: response.status };
      }),
    );

    const dispatched = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    return new Response(JSON.stringify({ dispatched, failed }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Webhook dispatch error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});
