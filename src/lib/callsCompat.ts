export type CallState = 'ringing' | 'accepted' | 'declined' | 'ended';

const ACTIVE_STATES = new Set<CallState>(['ringing', 'accepted']);

const CALL_STATE_ALIASES: Record<string, CallState> = {
  ringing: 'ringing',
  pending: 'ringing',
  accepted: 'accepted',
  active: 'accepted',
  connected: 'accepted',
  in_progress: 'accepted',
  'in-progress': 'accepted',
  declined: 'declined',
  rejected: 'declined',
  ended: 'ended',
  complete: 'ended',
  completed: 'ended',
  cancelled: 'ended',
  canceled: 'ended',
  timeout: 'ended',
  timed_out: 'ended',
  'timed-out': 'ended',
  expired: 'ended',
  missed: 'ended',
};

export interface NormalizedCallRow {
  id: string;
  conversation_id: string;
  caller_id: string | null;
  callee_ids: string[];
  state: CallState;
  metadata: Record<string, any>;
  created_at: string | null;
  expires_at: string | null;
  video: boolean;
  raw: any;
}

function toIsoOrNull(value: unknown): string | null {
  const str = String(value || '').trim();
  if (!str) return null;
  const date = new Date(str);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function normalizeCalleeIdsFromMetadata(metadata: Record<string, any>): string[] {
  const raw = (metadata as any)?.callee_ids;
  if (!Array.isArray(raw)) return [];
  return raw.map((value) => String(value || '').trim()).filter(Boolean);
}

export function normalizeCallConversationId(row: any): string {
  return String(row?.conversation_id || row?.room || '').trim();
}

export function normalizeCallStateFromRow(row: any): CallState | null {
  const rawState = String(row?.state || row?.status || '').trim().toLowerCase();
  if (rawState && CALL_STATE_ALIASES[rawState]) {
    return CALL_STATE_ALIASES[rawState];
  }
  if (row?.accepted === true) return 'accepted';
  if (row?.accepted === false) return 'ringing';
  return null;
}

export function normalizeCallCalleeIds(row: any): string[] {
  const modern = Array.isArray(row?.callee_ids)
    ? row.callee_ids.map((value: any) => String(value || '').trim()).filter(Boolean)
    : [];
  const metadata = normalizeCalleeIdsFromMetadata((row?.metadata && typeof row.metadata === 'object') ? row.metadata : {});
  const legacy = row?.callee_id ? [String(row.callee_id).trim()] : [];
  return Array.from(new Set([...modern, ...metadata, ...legacy].filter(Boolean)));
}

export function normalizeCallExpiresAt(row: any, joinWindowMs = 3 * 60 * 1000): string | null {
  const explicit = toIsoOrNull(row?.expires_at);
  if (explicit) return explicit;
  const state = normalizeCallStateFromRow(row);
  if (state !== 'ringing') return null;
  const createdAt = toIsoOrNull(row?.created_at);
  if (!createdAt) return null;
  const expiresMs = new Date(createdAt).getTime() + joinWindowMs;
  if (!Number.isFinite(expiresMs) || expiresMs <= 0) return null;
  return new Date(expiresMs).toISOString();
}

export function normalizeCallVideo(row: any): boolean {
  if (typeof row?.video === 'boolean') return row.video;
  return Boolean((row?.metadata as any)?.video);
}

export function normalizeCallRow(row: any, joinWindowMs = 3 * 60 * 1000): NormalizedCallRow | null {
  if (!row || typeof row !== 'object') return null;
  const id = String(row.id || '').trim();
  const conversationId = normalizeCallConversationId(row);
  const state = normalizeCallStateFromRow(row);
  if (!id || !conversationId || !state) return null;
  const metadata = (row.metadata && typeof row.metadata === 'object') ? row.metadata : {};
  return {
    id,
    conversation_id: conversationId,
    caller_id: row.caller_id ? String(row.caller_id) : null,
    callee_ids: normalizeCallCalleeIds(row),
    state,
    metadata,
    created_at: toIsoOrNull(row.created_at),
    expires_at: normalizeCallExpiresAt(row, joinWindowMs),
    video: normalizeCallVideo(row),
    raw: row,
  };
}

export function isActiveCallState(state: string | null | undefined): boolean {
  if (!state) return false;
  return ACTIVE_STATES.has(String(state).toLowerCase() as CallState);
}

export function isCallsModernSchemaMissingError(error: any): boolean {
  if (!error) return false;
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || '').toLowerCase();
  const details = String(error?.details || '').toLowerCase();
  const hint = String(error?.hint || '').toLowerCase();
  const blob = `${message} ${details} ${hint}`;
  const mentionsModernColumn = (
    blob.includes('conversation_id')
    || blob.includes('callee_ids')
    || blob.includes('state')
    || blob.includes('expires_at')
    || blob.includes('channel_name')
    || blob.includes('room')
    || blob.includes('status')
  );
  return (
    code === '42703'
    || code === 'PGRST204'
    || (mentionsModernColumn && blob.includes('column') && blob.includes('does not exist'))
    || (code === 'PGRST200' && blob.includes('column'))
  );
}

export function buildLegacyCallInsertPayload(params: {
  conversationId: string;
  callerId: string;
  calleeIds: string[];
  video: boolean;
  metadata?: Record<string, any>;
}) {
  const calleeIds = Array.from(new Set((params.calleeIds || []).map((id) => String(id || '').trim()).filter(Boolean)));
  return {
    room: params.conversationId,
    caller_id: params.callerId,
    callee_id: calleeIds[0] || null,
    status: 'ringing',
    accepted: false,
    metadata: {
      ...(params.metadata || {}),
      video: params.video,
      callee_ids: calleeIds,
    },
  };
}

export function buildLegacyCallStateUpdate(nextState: CallState): Record<string, any> {
  if (nextState === 'accepted') {
    return {
      status: 'accepted',
      accepted: true,
    };
  }
  if (nextState === 'declined') {
    return {
      status: 'declined',
      accepted: false,
    };
  }
  if (nextState === 'ended') {
    return {
      status: 'ended',
      accepted: false,
    };
  }
  return {
    status: 'ringing',
    accepted: false,
  };
}
