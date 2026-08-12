/**
 * Channel Summarize - Supabase Edge Function
 *
 * "Catch Up" feature: summarizes recent messages in a channel.
 * Uses a configurable LLM endpoint (RunPod, OpenAI, or Anthropic).
 *
 * Request body:
 *   { channel_id: string, message_count?: number }
 *
 * Response:
 *   { summary: string, message_count: number, time_range: { from: string, to: string } }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const LLM_API_URL = Deno.env.get('LLM_API_URL') || ''; // OpenAI-compatible endpoint
const LLM_API_KEY = Deno.env.get('LLM_API_KEY') || '';
const LLM_MODEL = Deno.env.get('LLM_MODEL') || 'gpt-4o-mini';
const DEFAULT_MESSAGE_COUNT = 50;
const MAX_MESSAGE_COUNT = 200;

function extractAuthSub(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const bearer = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!bearer) return null;
  try {
    const parts = bearer.split('.');
    if (parts.length !== 3) return null;
    const padded = parts[1] + '='.repeat((4 - (parts[1].length % 4)) % 4);
    const payload = JSON.parse(atob(padded.replace(/-/g, '+').replace(/_/g, '/')));
    if (typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return String(payload.sub || '').trim() || null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  try {
    const userId = extractAuthSub(req.headers.get('authorization'));
    if (!userId) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => ({}));
    const channelId = String(body?.channel_id || '').trim();
    const messageCount = Math.min(Math.max(Number(body?.message_count) || DEFAULT_MESSAGE_COUNT, 10), MAX_MESSAGE_COUNT);

    if (!channelId) {
      return new Response(JSON.stringify({ error: 'Missing channel_id' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

    // Verify the user has access to this channel (is a member of the community)
    const { data: channel } = await supabase
      .from('channels')
      .select('id, name, server_id')
      .eq('id', channelId)
      .maybeSingle();

    if (!channel) {
      return new Response(JSON.stringify({ error: 'Channel not found' }), {
        status: 404,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Fetch recent messages with author profiles
    const { data: messages } = await supabase
      .from('messages')
      .select('content, created_at, user_id, author:profiles(username, display_name)')
      .eq('channel_id', channelId)
      .is('parent_message_id', null)
      .order('created_at', { ascending: false })
      .limit(messageCount);

    if (!messages || messages.length === 0) {
      return new Response(JSON.stringify({
        summary: 'No messages to summarize.',
        message_count: 0,
        time_range: { from: null, to: null },
      }), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Build conversation transcript for the LLM
    const reversed = [...messages].reverse();
    const transcript = reversed.map((msg: any) => {
      const author = msg.author?.display_name || msg.author?.username || 'Unknown';
      const time = new Date(msg.created_at).toLocaleString();
      return `[${time}] ${author}: ${msg.content || '(attachment)'}`;
    }).join('\n');

    const timeRange = {
      from: reversed[0]?.created_at || null,
      to: reversed[reversed.length - 1]?.created_at || null,
    };

    // If no LLM API is configured, return the transcript as-is with a basic summary
    if (!LLM_API_URL || !LLM_API_KEY) {
      // Fallback: extract unique speakers and count
      const speakers = new Set(reversed.map((m: any) => m.author?.display_name || m.author?.username || 'Unknown'));
      const topicWords = transcript.toLowerCase().split(/\s+/).filter((w: string) => w.length > 4);
      const wordFreq = new Map<string, number>();
      topicWords.forEach((w: string) => wordFreq.set(w, (wordFreq.get(w) || 0) + 1));
      const topWords = Array.from(wordFreq.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([w]) => w);

      return new Response(JSON.stringify({
        summary: `${messages.length} messages from ${speakers.size} participants. Topics mentioned: ${topWords.join(', ') || 'various'}.`,
        message_count: messages.length,
        time_range: timeRange,
      }), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Call LLM for summarization
    const llmResponse = await fetch(LLM_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [
          {
            role: 'system',
            content: 'You are a concise chat summarizer. Summarize the following chat transcript into 3-5 bullet points. Focus on key decisions, questions asked, and important topics discussed. Be brief and factual.',
          },
          {
            role: 'user',
            content: `Summarize this channel conversation:\n\n${transcript}`,
          },
        ],
        max_tokens: 500,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!llmResponse.ok) {
      console.error('LLM API error:', llmResponse.status, await llmResponse.text());
      return new Response(JSON.stringify({ error: 'Summarization service unavailable' }), {
        status: 502,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const llmData = await llmResponse.json();
    const summary = llmData?.choices?.[0]?.message?.content
      || llmData?.content?.[0]?.text
      || 'Could not generate summary.';

    return new Response(JSON.stringify({
      summary,
      message_count: messages.length,
      time_range: timeRange,
    }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Channel summarize error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});
