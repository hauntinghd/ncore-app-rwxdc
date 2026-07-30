/**
 * Message requests — client surface.
 *
 * Schema lives in `20260730140000_message_requests.sql`. A DM from someone you
 * have never spoken to lands here instead of in the conversation list, so the
 * defence against a stranger is not "block them after they interrupted you".
 *
 * That migration also fixed two long-standing bugs in
 * `create_or_get_direct_conversation`: it used to auto-friend both parties
 * without consent, and it never checked blocks in either direction.
 */
import { supabase } from './supabase';

export interface MessageRequest {
  conversationId: string;
  isGroup: boolean;
  senderId: string | null;
  senderUsername: string;
  senderDisplayName: string | null;
  senderAvatarUrl: string | null;
  messageCount: number;
  /** Shared servers — the most useful signal for an accept/ignore decision. */
  mutualCommunities: number;
  requestedAt: string;
  lastMessageAt: string | null;
}

interface RequestRow {
  conversation_id: string;
  is_group: boolean;
  sender_id: string | null;
  sender_username: string | null;
  sender_display_name: string | null;
  sender_avatar_url: string | null;
  message_count: number | string;
  mutual_communities: number | string;
  requested_at: string;
  last_message_at: string | null;
}

export async function fetchMessageRequests(): Promise<MessageRequest[]> {
  const { data, error } = await supabase.rpc('dm_request_list');
  if (error) throw error;

  return ((data ?? []) as RequestRow[]).map((row) => ({
    conversationId: row.conversation_id,
    isGroup: Boolean(row.is_group),
    senderId: row.sender_id,
    senderUsername: row.sender_username || 'unknown',
    senderDisplayName: row.sender_display_name,
    senderAvatarUrl: row.sender_avatar_url,
    messageCount: Number(row.message_count ?? 0),
    mutualCommunities: Number(row.mutual_communities ?? 0),
    requestedAt: row.requested_at,
    lastMessageAt: row.last_message_at,
  }));
}

export async function fetchMessageRequestCount(): Promise<number> {
  const { data, error } = await supabase.rpc('dm_request_count');
  if (error) return 0;
  return Number(data ?? 0);
}

export async function acceptMessageRequest(conversationId: string): Promise<void> {
  const { error } = await supabase.rpc('dm_request_accept', {
    p_conversation_id: conversationId,
  });
  if (error) throw error;
}

/**
 * Hides the conversation. The sender is told nothing — an "ignored" receipt
 * confirms to a spammer that the account is live and being read, which is the
 * one thing they are trying to learn.
 */
export async function ignoreMessageRequest(conversationId: string): Promise<void> {
  const { error } = await supabase.rpc('dm_request_ignore', {
    p_conversation_id: conversationId,
  });
  if (error) throw error;
}

/** Ignores and blocks every other participant. */
export async function blockMessageRequest(conversationId: string): Promise<void> {
  const { error } = await supabase.rpc('dm_request_block', {
    p_conversation_id: conversationId,
  });
  if (error) throw error;
}

/**
 * Conversation ids the user has accepted — what the DM list should show.
 *
 * Returns `null` rather than `[]` when the lookup fails, so callers can tell
 * "you have accepted nothing" apart from "the RPC is missing because the
 * migration has not been applied". Collapsing those two would hide every
 * conversation the user has on an un-migrated database.
 */
export async function fetchAcceptedConversationIds(): Promise<string[] | null> {
  const { data, error } = await supabase.rpc('get_my_accepted_dm_conversation_ids');
  if (error) return null;
  return ((data ?? []) as Array<{ conversation_id: string }>).map((row) =>
    String(row.conversation_id),
  );
}

export function requestSenderName(request: MessageRequest): string {
  return request.senderDisplayName || request.senderUsername;
}
