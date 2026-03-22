import { supabase } from './supabase';
import type { Json } from './types';

export type GrowthEventName =
  | 'marketplace_viewed'
  | 'marketplace_checkout_started'
  | 'marketplace_checkout_session_created'
  | 'marketplace_checkout_failed'
  | 'boost_checkout_started'
  | 'boost_checkout_session_created'
  | 'boost_checkout_failed'
  | 'server_create_started'
  | 'server_create_succeeded'
  | 'server_create_failed'
  | 'capability_gate_blocked'
  | 'call_start_attempted'
  | 'call_start_failed'
  | 'call_connected'
  | 'call_dropped'
  | 'checkout_started'
  | 'checkout_failed'
  | 'checkout_paid'
  | string;

interface TrackGrowthEventOptions {
  userId?: string | null;
  sourceChannel?: string | null;
  sessionId?: string | null;
  eventSource?: string | null;
}

function normalizeSourceChannel(candidate?: string | null): string {
  const direct = String(candidate || '').trim().toLowerCase();
  if (direct) return direct;
  if (typeof window === 'undefined') return 'organic';
  const query = new URLSearchParams(window.location.search || '');
  return (
    String(query.get('utm_source') || query.get('source') || query.get('campaign') || '').trim().toLowerCase()
    || 'organic'
  );
}

export function resolveGrowthSourceChannel(candidate?: string | null): string {
  return normalizeSourceChannel(candidate);
}

export async function trackGrowthEvent(
  eventName: GrowthEventName,
  payload: Record<string, Json> = {},
  options: TrackGrowthEventOptions = {},
): Promise<void> {
  const normalizedEvent = String(eventName || '').trim().toLowerCase();
  if (!normalizedEvent) return;

  const sourceChannel = normalizeSourceChannel(options.sourceChannel);
  const sessionId = String(options.sessionId || '').trim() || null;
  const eventSource = String(options.eventSource || 'app').trim().toLowerCase() || 'app';

  let userId = options.userId ? String(options.userId) : '';
  if (!userId) {
    const { data: authData } = await supabase.auth.getUser();
    userId = String(authData.user?.id || '');
  }

  const rpcPayload = {
    p_event_name: normalizedEvent,
    p_payload: payload,
    p_source_channel: sourceChannel,
    p_session_id: sessionId,
    p_event_source: eventSource,
    p_user_id: userId || null,
  };

  const { error } = await (supabase as any).rpc('track_growth_event', rpcPayload);
  if (!error) return;

  // Fallback path if RPC is unavailable during partial rollout.
  const fallback = await supabase.from('growth_events').insert({
    user_id: userId || null,
    event_name: normalizedEvent,
    event_source: eventSource,
    source_channel: sourceChannel,
    session_id: sessionId,
    payload,
  } as any);

  if (fallback.error) {
    console.warn('Growth event tracking failed:', fallback.error);
  }
}
