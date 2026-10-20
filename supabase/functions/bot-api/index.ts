/**
 * Bot API - Supabase Edge Function
 *
 * REST API for NCore bots to interact with communities.
 *
 * Authentication: Bearer token (bot token from bot_users table)
 *
 * Endpoints:
 *   POST /messages     - Send a message to a channel
 *   GET  /channels     - List channels in a community the bot has access to
 *   POST /reactions    - Add a reaction to a message
 *   GET  /members      - List community members
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

// Rate limiting: simple in-memory counter per bot
const rateLimits = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30; // 30 requests per minute per bot

function checkRateLimit(botId: string): boolean {
  const now = Date.now();
  const entry = rateLimits.get(botId);
  if (!entry || now > entry.resetAt) {
    rateLimits.set(botId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

interface BotUser {
  id: string;
  owner_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  permissions: Record<string, any>;
  is_active: boolean;
}

async function authenticateBot(authHeader: string | null): Promise<BotUser | null> {
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

  // Hash the token and compare against stored hashes.
  // For simplicity, we use a direct lookup. In production,
  // this should use bcrypt comparison.
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(token));
  const tokenHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const { data } = await supabase
    .from('bot_users')
    .select('*')
    .eq('token_hash', tokenHash)
    .eq('is_active', true)
    .maybeSingle();

  return data as BotUser | null;
}

function parseEndpoint(url: URL): { action: string; params: Record<string, string> } {
  const path = url.pathname.replace(/^\/bot-api\/?/, '').replace(/^\//, '').replace(/\/$/, '');
  const segments = path.split('/').filter(Boolean);

  if (segments[0] === 'messages') return { action: 'messages', params: {} };
  if (segments[0] === 'channels') return { action: 'channels', params: {} };
  if (segments[0] === 'reactions') return { action: 'reactions', params: {} };
  if (segments[0] === 'members') return { action: 'members', params: {} };
  return { action: segments[0] || '', params: {} };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
      return new Response(JSON.stringify({ error: 'Service not configured' }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const bot = await authenticateBot(req.headers.get('authorization'));
    if (!bot) {
      return new Response(JSON.stringify({ error: 'Invalid or missing bot token' }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    if (!checkRateLimit(bot.id)) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded. Max 30 requests/minute.' }), {
        status: 429,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Retry-After': '60' },
      });
    }

    const url = new URL(req.url);
    const { action } = parseEndpoint(url);
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

    // -----------------------------------------------------------------------
    // POST /messages - Send a message to a channel
    // -----------------------------------------------------------------------
    if (action === 'messages' && req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const channelId = String(body?.channel_id || '').trim();
      const content = String(body?.content || '').trim();

      if (!channelId || !content) {
        return new Response(JSON.stringify({ error: 'Missing channel_id or content' }), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }

      if (content.length > 4000) {
        return new Response(JSON.stringify({ error: 'Content exceeds 4000 character limit' }), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }

      const { data: message, error } = await supabase
        .from('messages')
        .insert({
          channel_id: channelId,
          user_id: bot.owner_id, // Messages are attributed to bot owner with bot metadata
          content,
          metadata: {
            bot_id: bot.id,
            bot_username: bot.username,
            bot_avatar_url: bot.avatar_url,
            is_bot_message: true,
          },
        })
        .select()
        .single();

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ message }), {
        status: 201,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // -----------------------------------------------------------------------
    // GET /channels?community_id=xxx - List channels
    // -----------------------------------------------------------------------
    if (action === 'channels' && req.method === 'GET') {
      const communityId = url.searchParams.get('community_id');
      if (!communityId) {
        return new Response(JSON.stringify({ error: 'Missing community_id query parameter' }), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }

      const { data: server } = await supabase
        .from('servers')
        .select('id')
        .eq('community_id', communityId)
        .limit(1)
        .maybeSingle();

      if (!server) {
        return new Response(JSON.stringify({ channels: [] }), {
          status: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }

      const { data: channels } = await supabase
        .from('channels')
        .select('id, name, channel_type, description, category_id, order_index')
        .eq('server_id', server.id)
        .order('order_index');

      return new Response(JSON.stringify({ channels: channels || [] }), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // -----------------------------------------------------------------------
    // POST /reactions - Add a reaction
    // -----------------------------------------------------------------------
    if (action === 'reactions' && req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const messageId = String(body?.message_id || '').trim();
      const emoji = String(body?.emoji || '').trim();

      if (!messageId || !emoji) {
        return new Response(JSON.stringify({ error: 'Missing message_id or emoji' }), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }

      const { error } = await supabase
        .from('message_reactions')
        .upsert({
          message_id: messageId,
          user_id: bot.owner_id,
          emoji,
        });

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // -----------------------------------------------------------------------
    // GET /members?community_id=xxx - List members
    // -----------------------------------------------------------------------
    if (action === 'members' && req.method === 'GET') {
      const communityId = url.searchParams.get('community_id');
      if (!communityId) {
        return new Response(JSON.stringify({ error: 'Missing community_id' }), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }

      const { data: members } = await supabase
        .from('community_members')
        .select('user_id, role, joined_at, profile:profiles(id, username, display_name, avatar_url, status)')
        .eq('community_id', communityId)
        .order('joined_at')
        .limit(200);

      return new Response(JSON.stringify({ members: members || [] }), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Unknown endpoint' }), {
      status: 404,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Bot API error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});
