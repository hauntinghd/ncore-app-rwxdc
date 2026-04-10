import { useCallback, useState, useEffect, useRef, useMemo, type ChangeEvent, type ClipboardEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useLocation, useParams, useNavigate } from 'react-router-dom';
import {
  Search,
  Plus,
  Send,
  Video,
  Phone,
  Users,
  Check,
  X,
  MoreHorizontal,
  Upload,
  ChevronLeft,
  ChevronRight,
  VolumeX,
  Paperclip,
} from 'lucide-react';
import { AppShell } from '../components/layout/AppShell';
import { SidebarUserDock, type SidebarVoiceDockState } from '../components/layout/SidebarUserDock';
import { Avatar } from '../components/ui/Avatar';
import { Modal } from '../components/ui/Modal';
import { useAuth } from '../contexts/AuthContext';
import { useEntitlements } from '../lib/entitlements';
import { getCapabilityLockReason, useGrowthCapabilities } from '../lib/growthCapabilities';
import { trackGrowthEvent } from '../lib/growthEvents';
import { ensureFreshAuthSession } from '../lib/authSession';
import { supabase } from '../lib/supabase';
import {
  buildLegacyCallInsertPayload,
  isActiveCallState,
  isCallsModernSchemaMissingError,
  normalizeCallRow,
} from '../lib/callsCompat';
import {
  buildMentionSuggestions,
  getActiveMentionQuery,
  hasBroadcastMention,
  insertMentionSuggestion,
  resolveMentionTargetIds,
  splitMentionText,
  type MentionSuggestion,
} from '../lib/mentions';
import { analyzeMessageShield, describeShieldAssessment } from '../lib/securityShield';
import { runServerVoiceAction, useServerVoiceShellState } from '../lib/serverVoiceShell';
import { loadCallSettings } from '../lib/callSettings';
import { directCallSession, useDirectCallSession, type ScreenShareQuality } from '../lib/directCallSession';
import { queueRuntimeEvent } from '../lib/runtimeTelemetry';
import type { DirectConversation, DirectMessage, DirectMessageAttachment, Profile } from '../lib/types';
import { formatFileSize, formatRelativeTime } from '../lib/utils';

type NewDmMode = 'direct' | 'group';

interface ConversationContextMenuState {
  conversation: DirectConversation;
  x: number;
  y: number;
  targetUser: Profile | null;
}

type GroupMemberRole = 'owner' | 'admin' | 'member';

interface ActiveConversationCall {
  id: string;
  conversationId: string;
  callerId: string | null;
  calleeIds: string[];
  state: 'ringing' | 'accepted';
  expiresAt: string | null;
  video: boolean;
  participantNames: string[];
}

const CALL_JOIN_WINDOW_MS = 3 * 60 * 1000;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROFILE_SELECT_COLUMNS = 'id, username, display_name, avatar_url, status, last_seen, bio, banner_url, platform_role, rank, xp, is_banned, created_at, updated_at';
const DM_LIST_PROFILE_SELECT_COLUMNS = 'id, username, display_name, avatar_url, status, last_seen';
const MAX_BOOTSTRAP_DM_CONVERSATIONS = 80;
const MAX_ACTIVE_CALL_SYNC_CONVERSATIONS = 40;

interface LightweightDirectMessageAuthor {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  status?: string | null;
}

function buildDirectMessageAuthorMap(conversation: DirectConversation | null, currentProfile: Profile | null) {
  const map = new Map<string, LightweightDirectMessageAuthor>();
  for (const member of conversation?.members || []) {
    const id = String(member?.user_id || '').trim();
    if (!id) continue;
    map.set(id, {
      id,
      username: member?.profile?.username || null,
      display_name: member?.profile?.display_name || null,
      avatar_url: member?.profile?.avatar_url || null,
      status: member?.profile?.status || null,
    });
  }
  const currentId = String(currentProfile?.id || '').trim();
  if (currentId) {
    map.set(currentId, {
      id: currentId,
      username: currentProfile?.username || null,
      display_name: currentProfile?.display_name || null,
      avatar_url: currentProfile?.avatar_url || null,
      status: currentProfile?.status || null,
    });
  }
  return map;
}

function buildRealtimeDirectMessage(row: any, authorMap: Map<string, LightweightDirectMessageAuthor>): DirectMessage {
  const authorId = String(row?.author_id || '').trim();
  return {
    id: String(row?.id || ''),
    conversation_id: String(row?.conversation_id || ''),
    author_id: authorId,
    content: String(row?.content || ''),
    is_edited: Boolean(row?.is_edited),
    created_at: String(row?.created_at || new Date().toISOString()),
    updated_at: String(row?.updated_at || row?.created_at || new Date().toISOString()),
    author: (authorMap.get(authorId) || {
      id: authorId,
      username: 'unknown',
      display_name: 'Unknown',
      avatar_url: null,
    }) as any,
    attachments: [],
  };
}

function renderDirectMessageContent(content: string) {
  return splitMentionText(content).map((segment, index) => (
    segment.isMention ? (
      <span
        key={`${segment.text}:${index}`}
        className="rounded-md bg-nyptid-300/18 px-1 py-0.5 font-medium text-nyptid-200"
      >
        {segment.text}
      </span>
    ) : (
      <span key={`${segment.text}:${index}`}>{segment.text}</span>
    )
  ));
}

function isUuid(value: unknown): boolean {
  return UUID_REGEX.test(String(value || '').trim());
}

export function DirectMessagePage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const { profile } = useAuth();
  const voiceShell = useServerVoiceShellState();
  const directCallState = useDirectCallSession();
  const { capabilities, contract } = useGrowthCapabilities();
  const { entitlements } = useEntitlements();
  const maxMessageLength = entitlements.messageLengthCap;
  const maxUploadBytes = entitlements.uploadBytesCap;
  const maxGroupDmMembers = 10 + Math.max(entitlements.groupDmMemberBonus || 0, 0);
  const directCallMaxScreenShareQuality = entitlements.maxScreenShareQuality as ScreenShareQuality;
  const navigate = useNavigate();
  const location = useLocation();
  const [conversations, setConversations] = useState<DirectConversation[]>([]);
  const [activeConversation, setActiveConversation] = useState<DirectConversation | null>(null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [input, setInput] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [showNewDM, setShowNewDM] = useState(false);
  const [newDmMode, setNewDmMode] = useState<NewDmMode>('direct');
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupMemberIds, setNewGroupMemberIds] = useState<string[]>([]);
  const [searchUsers, setSearchUsers] = useState('');
  const [userResults, setUserResults] = useState<Profile[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [searchUsersError, setSearchUsersError] = useState('');
  const [creatingConversation, setCreatingConversation] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [conversationContextMenu, setConversationContextMenu] = useState<ConversationContextMenuState | null>(null);
  const [closedConversationIds, setClosedConversationIds] = useState<string[]>([]);
  const [mutedConversationIds, setMutedConversationIds] = useState<string[]>([]);
  const [friendNicknames, setFriendNicknames] = useState<Record<string, string>>({});
  const [friendNotes, setFriendNotes] = useState<Record<string, string>>({});
  const [userRelationships, setUserRelationships] = useState<Record<string, 'friend' | 'ignored' | 'blocked'>>({});

  const [showEditGroupModal, setShowEditGroupModal] = useState(false);
  const [groupDraftName, setGroupDraftName] = useState('');
  const [groupDraftIconUrl, setGroupDraftIconUrl] = useState<string | null>(null);
  const [uploadingGroupIcon, setUploadingGroupIcon] = useState(false);
  const [savingGroupMeta, setSavingGroupMeta] = useState(false);
  const [groupMemberSearch, setGroupMemberSearch] = useState('');
  const [groupMemberResults, setGroupMemberResults] = useState<Profile[]>([]);
  const [loadingGroupMemberSearch, setLoadingGroupMemberSearch] = useState(false);
  const [addingGroupMemberId, setAddingGroupMemberId] = useState<string | null>(null);
  const [removingGroupMemberId, setRemovingGroupMemberId] = useState<string | null>(null);
  const [updatingGroupRoleUserId, setUpdatingGroupRoleUserId] = useState<string | null>(null);
  const [transferringGroupOwnerId, setTransferringGroupOwnerId] = useState<string | null>(null);

  const [typingUserIds, setTypingUserIds] = useState<string[]>([]);
  const [incomingInvite, setIncomingInvite] = useState<{
    conversationId: string;
    video: boolean;
    callerName?: string;
    fallbackJoin?: boolean;
  } | null>(null);
  const [activeCallsByConversationId, setActiveCallsByConversationId] = useState<Record<string, ActiveConversationCall>>({});
  const [isCompactLayout, setIsCompactLayout] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 1023px)').matches;
  });
  const [composerSelectionStart, setComposerSelectionStart] = useState(0);
  const [mentionSuggestionIndex, setMentionSuggestionIndex] = useState(0);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dmPresenceChannelRef = useRef<any>(null);
  const dmInviteChannelRef = useRef<any>(null);
  const callsSignalingUnavailableRef = useRef(false);
  const callsSignalingWarnedRef = useRef(false);
  const participantProfileCacheRef = useRef<Map<string, Profile>>(new Map());
  const trackedConversationIdsRef = useRef<Set<string>>(new Set());
  const trackedConversationMemberIdsRef = useRef<Set<string>>(new Set());
  const callRefreshTimersRef = useRef<Record<string, number>>({});
  const autoCallAttemptKeyRef = useRef<string>('');
  const conversationMembershipRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messageRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesRef = useRef<DirectMessage[]>([]);
  const messageScrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const groupIconInputRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);

  const nicknamesStorageKey = profile ? `ncore.dm.nicknames.${profile.id}` : null;
  const notesStorageKey = profile ? `ncore.dm.notes.${profile.id}` : null;
  const closedStorageKey = profile ? `ncore.dm.closed.${profile.id}` : null;
  const closedSessionStorageKey = profile ? `ncore.dm.closed.session.${profile.id}` : null;
  const mutedStorageKey = profile ? `ncore.dm.muted.${profile.id}` : null;
  const conversationsCacheKey = profile ? `ncore.dm.cache.conversations.${profile.id}` : null;
  const trackedConversationIds = useMemo(
    () => Array.from(new Set(conversations.map((conv) => String(conv.id)).filter((id) => isUuid(id)))),
    [conversations]
  );
  const conversationIdsForActiveCallSync = useMemo(
    () => trackedConversationIds.slice(0, MAX_ACTIVE_CALL_SYNC_CONVERSATIONS),
    [trackedConversationIds]
  );
  const conversationIdsSignature = useMemo(
    () => conversationIdsForActiveCallSync.join('|'),
    [conversationIdsForActiveCallSync]
  );
  const dmMentionTargets = useMemo(() => {
    const deduped = new Map<string, {
      id: string;
      username: string;
      display_name: string | null;
      avatar_url: string | null;
      status: string | null;
    }>();

    for (const member of activeConversation?.members || []) {
      const id = String(member?.user_id || '').trim();
      const username = String(member?.profile?.username || '').trim();
      if (!id || !username || id === String(profile?.id || '')) continue;
      deduped.set(id, {
        id,
        username,
        display_name: member?.profile?.display_name || null,
        avatar_url: member?.profile?.avatar_url || null,
        status: member?.profile?.status || null,
      });
    }

    return Array.from(deduped.values());
  }, [activeConversation?.members, profile?.id]);
  const dmAuthorMap = useMemo(
    () => buildDirectMessageAuthorMap(activeConversation, profile || null),
    [activeConversation, profile],
  );
  const activeMentionQuery = useMemo(
    () => getActiveMentionQuery(input, composerSelectionStart),
    [composerSelectionStart, input],
  );
  const mentionSuggestions = useMemo(
    () => (activeMentionQuery ? buildMentionSuggestions(dmMentionTargets, activeMentionQuery.query) : []),
    [activeMentionQuery, dmMentionTargets],
  );
  const visibleConversations = useMemo(() => {
    if (closedConversationIds.length === 0) return conversations;
    const hidden = new Set(closedConversationIds.map((id) => String(id)));
    return conversations.filter((conversation) => !hidden.has(String(conversation.id)));
  }, [closedConversationIds, conversations]);

  useEffect(() => {
    setMentionSuggestionIndex(0);
  }, [activeMentionQuery?.query, activeMentionQuery?.start, conversationId]);

  const isNearBottom = useCallback(() => {
    const container = messageScrollRef.current;
    if (!container) return true;
    const remaining = container.scrollHeight - container.scrollTop - container.clientHeight;
    return remaining < 140;
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior, block: 'end' });
    });
  }, []);

  const upsertDirectMessage = useCallback((message: DirectMessage) => {
    setMessages((prev) => {
      const next = [...prev];
      const existingIndex = next.findIndex((entry) => entry.id === message.id);
      if (existingIndex >= 0) {
        const incomingAttachments = Array.isArray(message.attachments) ? message.attachments : [];
        next[existingIndex] = {
          ...next[existingIndex],
          ...message,
          attachments: incomingAttachments.length > 0 ? incomingAttachments : (next[existingIndex].attachments || []),
        };
      } else {
        next.push(message);
      }
      next.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      return next;
    });
  }, []);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    trackedConversationIdsRef.current = new Set(trackedConversationIds);
  }, [trackedConversationIds]);

  useEffect(() => {
    const memberIds = new Set<string>();
    for (const conversation of conversations) {
      for (const member of (conversation.members || [])) {
        const id = String((member as any)?.user_id || '').trim();
        if (id) memberIds.add(id);
      }
    }
    trackedConversationMemberIdsRef.current = memberIds;
  }, [conversations]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia('(max-width: 1023px)');
    const onChange = () => {
      setIsCompactLayout(media.matches);
    };
    onChange();
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    }
    media.addListener(onChange);
    return () => media.removeListener(onChange);
  }, []);

  function getMessagesCacheKey(convId?: string) {
    if (!profile || !convId) return null;
    return `ncore.dm.cache.messages.${profile.id}.${convId}`;
  }

  function scheduleConversationMembershipRefresh(delayMs = 140) {
    if (conversationMembershipRefreshTimerRef.current) {
      clearTimeout(conversationMembershipRefreshTimerRef.current);
    }
    conversationMembershipRefreshTimerRef.current = setTimeout(() => {
      conversationMembershipRefreshTimerRef.current = null;
      void loadConversations();
    }, delayMs);
  }

  function scheduleActiveConversationRefresh(targetConversationId: string, delayMs = 180) {
    const normalizedConversationId = String(targetConversationId || '').trim();
    if (!normalizedConversationId || normalizedConversationId !== String(conversationId || '')) return;
    if (messageRefreshTimerRef.current) {
      clearTimeout(messageRefreshTimerRef.current);
    }
    messageRefreshTimerRef.current = setTimeout(() => {
      messageRefreshTimerRef.current = null;
      void loadMessages(normalizedConversationId);
    }, delayMs);
  }

  function buildCallRoute(
    targetConversationId: string,
    video: boolean,
    fallbackJoin = false,
    outgoing = false,
  ): string {
    const params = new URLSearchParams();
    if (video) params.set('video', '1');
    if (fallbackJoin) params.set('fallback', '1');
    if (outgoing) params.set('outgoing', '1');
    const query = params.toString();
    return `/app/dm/${targetConversationId}/call${query ? `?${query}` : ''}`;
  }

  function promoteConversationActivity(targetConversationId: string, activityAtIso = new Date().toISOString()) {
    const targetId = String(targetConversationId || '').trim();
    if (!targetId) return;
    setConversations((prev) => {
      const next = prev.map((conversation: any) => (
        String(conversation.id) === targetId
          ? { ...conversation, updated_at: activityAtIso }
          : conversation
      ));
      next.sort((a: any, b: any) => {
        const aTime = new Date(a.updated_at || a.created_at || 0).getTime();
        const bTime = new Date(b.updated_at || b.created_at || 0).getTime();
        return bTime - aTime;
      });
      return next as DirectConversation[];
    });
  }

  function isMissingRpcFunctionError(error: any): boolean {
    const message = String(error?.message || '').toLowerCase();
    const code = String(error?.code || '').toUpperCase();
    return (
      code === 'PGRST202'
      || (message.includes('function') && message.includes('does not exist'))
    );
  }

  function isMissingEmbedRelationshipError(error: any): boolean {
    const message = String(error?.message || '').toLowerCase();
    const code = String(error?.code || '').toUpperCase();
    return (
      code === 'PGRST200'
      || code === 'PGRST201'
      || (message.includes('relationship') && message.includes('not found'))
      || message.includes('could not find a relationship')
    );
  }

  function isAuthOrJwtError(error: any): boolean {
    const message = String(error?.message || '').toLowerCase();
    const code = String(error?.code || '').toUpperCase();
    const status = Number(error?.status || error?.statusCode || 0);
    return (
      status === 401
      || status === 403
      || code === 'PGRST301'
      || code === 'PGRST302'
      || message.includes('invalid jwt')
      || message.includes('jwt')
      || message.includes('unauthorized')
      || message.includes('permission denied')
    );
  }

  function shouldDisableCallsSignaling(error: any): boolean {
    if (!error) return false;
    if (isAuthOrJwtError(error)) return false;
    const message = String(error?.message || '').toLowerCase();
    const code = String(error?.code || '').toUpperCase();
    const status = Number(error?.status || error?.statusCode || 0);
    return (
      status === 404
      || code === '42P01'
      || code === 'PGRST200'
      || code === 'PGRST201'
      || message.includes('relation') && message.includes('does not exist')
      || message.includes('could not find a relationship')
    );
  }

  async function insertNotificationsWithRetry(rows: any[]) {
    if (!rows || rows.length === 0) return null;
    let { error } = await supabase.from('notifications').insert(rows as any);
    if (error && isAuthOrJwtError(error)) {
      const refreshed = await ensureFreshAuthSession(60, { forceRefresh: true, verifyOnServer: false });
      if (refreshed.ok) {
        const retry = await supabase.from('notifications').insert(rows as any);
        error = retry.error;
      }
    }
    return error || null;
  }

  async function fetchActiveCallRowWithRetry(targetConversationId: string) {
    const runModern = () => supabase
      .from('calls')
      .select('id, conversation_id, caller_id, callee_ids, state, metadata, created_at, expires_at')
      .eq('conversation_id', targetConversationId)
      .in('state', ['ringing', 'accepted'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const runLegacy = () => supabase
      .from('calls')
      .select('id, room, caller_id, callee_id, status, accepted, metadata, created_at, updated_at')
      .eq('room', targetConversationId)
      .in('status', ['ringing', 'accepted'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let response = await runModern();
    let usingLegacy = false;
    if (response.error && isCallsModernSchemaMissingError(response.error)) {
      usingLegacy = true;
      response = await runLegacy();
    }
    if (response.error && isAuthOrJwtError(response.error)) {
      const refreshed = await ensureFreshAuthSession(60, { forceRefresh: true, verifyOnServer: false });
      if (refreshed.ok) {
        response = usingLegacy ? await runLegacy() : await runModern();
        if (!usingLegacy && response.error && isCallsModernSchemaMissingError(response.error)) {
          usingLegacy = true;
          response = await runLegacy();
        }
      }
    }
    const normalized = response.data ? normalizeCallRow(response.data, CALL_JOIN_WINDOW_MS) : null;
    return {
      ...response,
      data: normalized,
    };
  }

  async function insertCallRowWithRetry(modernPayload: Record<string, any>, legacyPayload: Record<string, any>) {
    const runModern = () => supabase
      .from('calls')
      .insert(modernPayload as any)
      .select('id, conversation_id, caller_id, callee_ids, state, metadata, created_at, expires_at')
      .maybeSingle();
    const runLegacy = () => supabase
      .from('calls')
      .insert(legacyPayload as any)
      .select('id, room, caller_id, callee_id, status, accepted, metadata, created_at, updated_at')
      .maybeSingle();

    let response = await runModern();
    let usingLegacy = false;
    if (response.error && isCallsModernSchemaMissingError(response.error)) {
      usingLegacy = true;
      response = await runLegacy();
    }
    if (response.error && isAuthOrJwtError(response.error)) {
      const refreshed = await ensureFreshAuthSession(60, { forceRefresh: true, verifyOnServer: false });
      if (refreshed.ok) {
        response = usingLegacy ? await runLegacy() : await runModern();
        if (!usingLegacy && response.error && isCallsModernSchemaMissingError(response.error)) {
          usingLegacy = true;
          response = await runLegacy();
        }
      }
    }
    const normalized = response.data ? normalizeCallRow(response.data, CALL_JOIN_WINDOW_MS) : null;
    return {
      ...response,
      data: normalized || response.data,
    };
  }

  async function fetchHydratedDirectMessage(messageId: string) {
    const withAttachments = await supabase
      .from('direct_messages')
      .select(`id, conversation_id, author_id, content, is_edited, created_at, updated_at, author:profiles(${PROFILE_SELECT_COLUMNS}), attachments:direct_message_attachments(*)`)
      .eq('id', messageId)
      .maybeSingle();
    if (!withAttachments.error) return withAttachments.data as DirectMessage | null;
    if (!isMissingEmbedRelationshipError(withAttachments.error)) {
      console.warn('Primary direct message hydration failed:', withAttachments.error);
    }

    const fallback = await supabase
      .from('direct_messages')
      .select(`id, conversation_id, author_id, content, is_edited, created_at, updated_at, author:profiles(${PROFILE_SELECT_COLUMNS})`)
      .eq('id', messageId)
      .maybeSingle();
    if (fallback.error) {
      console.warn('Fallback direct message hydration failed:', fallback.error);
      return null;
    }
    if (!fallback.data) return null;
    return {
      ...(fallback.data as DirectMessage),
      attachments: [],
    } as DirectMessage;
  }

  useEffect(() => {
    if (!nicknamesStorageKey || !notesStorageKey || !mutedStorageKey) return;
    try {
      const rawNicknames = localStorage.getItem(nicknamesStorageKey);
      const rawNotes = localStorage.getItem(notesStorageKey);
      const rawMuted = localStorage.getItem(mutedStorageKey);
      const rawClosed = closedStorageKey ? localStorage.getItem(closedStorageKey) : null;
      setFriendNicknames(rawNicknames ? JSON.parse(rawNicknames) : {});
      setFriendNotes(rawNotes ? JSON.parse(rawNotes) : {});
      setClosedConversationIds(rawClosed ? JSON.parse(rawClosed) : []);
      setMutedConversationIds(rawMuted ? JSON.parse(rawMuted) : []);
      // Also clean up legacy sessionStorage key
      if (closedSessionStorageKey) {
        try { window.sessionStorage.removeItem(closedSessionStorageKey); } catch { /* noop */ }
      }
    } catch {
      setFriendNicknames({});
      setFriendNotes({});
      setClosedConversationIds([]);
      setMutedConversationIds([]);
    }
  }, [nicknamesStorageKey, notesStorageKey, closedSessionStorageKey, closedStorageKey, mutedStorageKey]);

  useEffect(() => {
    if (!nicknamesStorageKey) return;
    localStorage.setItem(nicknamesStorageKey, JSON.stringify(friendNicknames));
  }, [friendNicknames, nicknamesStorageKey]);

  useEffect(() => {
    if (!notesStorageKey) return;
    localStorage.setItem(notesStorageKey, JSON.stringify(friendNotes));
  }, [friendNotes, notesStorageKey]);

  useEffect(() => {
    if (!mutedStorageKey) return;
    localStorage.setItem(mutedStorageKey, JSON.stringify(mutedConversationIds));
  }, [mutedConversationIds, mutedStorageKey]);

  useEffect(() => {
    if (!closedStorageKey) return;
    try {
      localStorage.setItem(closedStorageKey, JSON.stringify(closedConversationIds));
    } catch {
      // best-effort persistence
    }
  }, [closedConversationIds, closedStorageKey]);

  useEffect(() => {
    if (!conversationsCacheKey) return;
    try {
      const raw = localStorage.getItem(conversationsCacheKey);
      if (!raw) return;
      const cached = JSON.parse(raw) as DirectConversation[];
      if (!Array.isArray(cached) || cached.length === 0) return;
      const sanitized = cached.filter((conv: any) => isUuid(conv?.id));
      if (sanitized.length === 0) return;
      setConversations((prev) => (prev.length > 0 ? prev : sanitized));
    } catch {
      // Ignore malformed cache and continue with live fetch.
    }
  }, [conversationsCacheKey]);

  useEffect(() => {
    if (!conversationsCacheKey || conversations.length === 0) return;
    try {
      localStorage.setItem(conversationsCacheKey, JSON.stringify(conversations));
    } catch {
      // best-effort cache
    }
  }, [conversations, conversationsCacheKey]);

  useEffect(() => {
    const cacheKey = getMessagesCacheKey(conversationId);
    if (!cacheKey) return;
    try {
      const raw = localStorage.getItem(cacheKey);
      if (!raw) return;
      const cached = JSON.parse(raw) as DirectMessage[];
      if (!Array.isArray(cached) || cached.length === 0) return;
      setMessages((prev) => (prev.length > 0 ? prev : cached));
    } catch {
      // Ignore malformed cache and continue with live fetch.
    }
  }, [conversationId, profile?.id]);

  useEffect(() => {
    const cacheKey = getMessagesCacheKey(conversationId);
    if (!cacheKey || messages.length === 0) return;
    try {
      localStorage.setItem(cacheKey, JSON.stringify(messages.slice(-300)));
    } catch {
      // best-effort cache
    }
  }, [conversationId, messages, profile?.id]);

  useEffect(() => {
    if (!profile?.id) return;
    void loadConversations();

    let idleId: number | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const requestIdle = (window as any).requestIdleCallback as
      | ((cb: () => void, opts?: { timeout: number }) => number)
      | undefined;

    if (typeof requestIdle === 'function') {
      idleId = requestIdle(() => {
        void loadUserRelationships();
      }, { timeout: 1400 });
    } else {
      timeoutId = setTimeout(() => {
        void loadUserRelationships();
      }, 500);
    }

    return () => {
      if (idleId !== null) {
        const cancelIdle = (window as any).cancelIdleCallback as ((id: number) => void) | undefined;
        if (typeof cancelIdle === 'function') cancelIdle(idleId);
      }
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [profile?.id]);

  useEffect(() => {
    if (!profile?.id) return;
    const channel = supabase
      .channel(`dm:memberships:${profile.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'direct_conversation_members',
        },
        (payload) => {
          const changedConversationId = String((payload.new as any)?.conversation_id || (payload.old as any)?.conversation_id || '').trim();
          const changedUserId = String((payload.new as any)?.user_id || (payload.old as any)?.user_id || '').trim();
          const affectsCurrentUser = changedUserId === String(profile.id);
          const affectsTrackedConversation = Boolean(
            changedConversationId
            && trackedConversationIdsRef.current.has(changedConversationId),
          );
          if (!affectsCurrentUser && !affectsTrackedConversation) return;
          scheduleConversationMembershipRefresh();
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'direct_conversations',
        },
        (payload) => {
          const changedConversationId = String((payload.new as any)?.id || '').trim();
          if (!changedConversationId || !trackedConversationIdsRef.current.has(changedConversationId)) return;
          scheduleConversationMembershipRefresh();
        },
      )
      .subscribe();

    return () => {
      if (conversationMembershipRefreshTimerRef.current) {
        clearTimeout(conversationMembershipRefreshTimerRef.current);
        conversationMembershipRefreshTimerRef.current = null;
      }
      supabase.removeChannel(channel);
    };
  }, [profile?.id]);

  useEffect(() => {
    if (!profile) return;
    void refreshActiveCalls(conversationIdsForActiveCallSync);
  }, [profile?.id, conversationIdsSignature]);

  useEffect(() => {
    if (!profile) return;
    const channel = supabase
      .channel(`dm:activity:${profile.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'direct_messages',
        },
        (payload) => {
          const changedConversationId = String((payload.new as any)?.conversation_id || '').trim();
          if (!changedConversationId || !trackedConversationIdsRef.current.has(changedConversationId)) return;
          const createdAtIso = String((payload.new as any)?.created_at || '').trim() || new Date().toISOString();
          promoteConversationActivity(changedConversationId, createdAtIso);
          scheduleActiveConversationRefresh(changedConversationId, 120);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, profile?.id]);

  useEffect(() => {
    if (!conversationId) {
      setActiveConversation(null);
      return;
    }
    const found = conversations.find((c) => c.id === conversationId) || null;
    setActiveConversation(found);
  }, [conversationId, conversations]);

  useEffect(() => {
    if (!conversationId || closedConversationIds.length === 0) return;
    const active = conversations.find((conversation) => conversation.id === conversationId);
    if (!active) return;
    const activeTargetUserId = !active.is_group
      ? String((active.members || []).find((member: any) => String(member.user_id) !== String(profile?.id))?.user_id || '')
      : '';
    setClosedConversationIds((prev) => {
      if (prev.length === 0) return prev;
      const next = prev.filter((id) => {
        if (String(id) === String(conversationId)) return false;
        if (!activeTargetUserId) return true;
        const existingConversation = conversations.find((conversation) => String(conversation.id) === String(id));
        if (!existingConversation || existingConversation.is_group) return true;
        const existingTargetUserId = String(
          (existingConversation.members || []).find((member: any) => String(member.user_id) !== String(profile?.id))?.user_id || ''
        );
        return existingTargetUserId !== activeTargetUserId;
      });
      return next.length === prev.length ? prev : next;
    });
  }, [closedConversationIds.length, conversationId, conversations, profile?.id]);

  useEffect(() => {
    if (!conversationId || !profile?.id) return;
    const params = new URLSearchParams(location.search || '');
    const shouldAutoCall = ['1', 'true', 'yes'].includes(String(params.get('autocall') || '').toLowerCase());
    if (!shouldAutoCall) return;

    const shouldStartVideo = ['1', 'true', 'yes'].includes(String(params.get('video') || '').toLowerCase());
    const attemptKey = `${conversationId}:${shouldStartVideo ? 'video' : 'voice'}`;
    if (autoCallAttemptKeyRef.current === attemptKey) return;
    autoCallAttemptKeyRef.current = attemptKey;

    void (async () => {
      try {
        await startCallForConversation(conversationId, shouldStartVideo);
      } finally {
        const cleanParams = new URLSearchParams(location.search || '');
        cleanParams.delete('autocall');
        const nextQuery = cleanParams.toString();
        const nextRoute = `/app/dm/${conversationId}${nextQuery ? `?${nextQuery}` : ''}`;
        navigate(nextRoute, { replace: true });
      }
    })();
  }, [conversationId, location.search, navigate, profile?.id]);

  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      return;
    }
    void loadMessages(conversationId);
  }, [conversationId]);

  useEffect(() => () => {
    if (messageRefreshTimerRef.current) {
      clearTimeout(messageRefreshTimerRef.current);
      messageRefreshTimerRef.current = null;
    }
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) return;
    const hydrateRealtimeMessage = (row: any, shouldStickToBottom: boolean) => {
      const fallbackMessage = buildRealtimeDirectMessage(row, dmAuthorMap);
      upsertDirectMessage(fallbackMessage);
      if (shouldStickToBottom) {
        scrollToBottom('auto');
      }

      const messageId = String(row?.id || '').trim();
      if (!messageId) {
        scheduleActiveConversationRefresh(conversationId);
        return;
      }

      void fetchHydratedDirectMessage(messageId).then((hydratedMessage) => {
        if (hydratedMessage) {
          upsertDirectMessage(hydratedMessage);
          if (shouldStickToBottom) {
            scrollToBottom('auto');
          }
          return;
        }
        scheduleActiveConversationRefresh(conversationId);
      }).catch(() => {
        scheduleActiveConversationRefresh(conversationId);
      });
    };

    const channel = supabase
      .channel(`dm:${conversationId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'direct_messages',
        filter: `conversation_id=eq.${conversationId}`,
      }, (payload) => {
        const shouldStickToBottom = isNearBottom();
        hydrateRealtimeMessage(payload.new, shouldStickToBottom);
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'direct_messages',
        filter: `conversation_id=eq.${conversationId}`,
      }, (payload) => {
        hydrateRealtimeMessage(payload.new, false);
      })
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'direct_message_attachments',
      }, (payload) => {
        const attachment = payload.new as DirectMessageAttachment;
        const hasAttachmentTarget = messagesRef.current.some((message) => message.id === attachment.direct_message_id);
        setMessages((prev) => {
          const next = prev.map((msg) => {
            if (msg.id !== attachment.direct_message_id) return msg;
            const existing = msg.attachments || [];
            if (existing.some((item) => item.id === attachment.id)) return msg;
            return {
              ...msg,
              attachments: [...existing, attachment],
            };
          });
          return next;
        });
        if (!hasAttachmentTarget) {
          scheduleActiveConversationRefresh(conversationId, 80);
        }
      })
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'direct_messages',
        filter: `conversation_id=eq.${conversationId}`,
      }, (payload) => {
        setMessages((prev) => prev.filter((message) => message.id !== String(payload.old.id)));
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, dmAuthorMap, isNearBottom, scrollToBottom, upsertDirectMessage]);

  useEffect(() => {
    if (!profile) return;
    const channel = supabase
      .channel(`dm:calls:${profile.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'calls' },
        (payload) => {
          const changedConversationId = String(
            (payload.new as any)?.conversation_id
            || (payload.old as any)?.conversation_id
            || (payload.new as any)?.room
            || (payload.old as any)?.room
            || ''
          );
          if (!changedConversationId || !isUuid(changedConversationId)) return;
          if (!trackedConversationIdsRef.current.has(changedConversationId)) return;
          const existingTimer = callRefreshTimersRef.current[changedConversationId];
          if (existingTimer) {
            window.clearTimeout(existingTimer);
          }
          callRefreshTimersRef.current[changedConversationId] = window.setTimeout(() => {
            delete callRefreshTimersRef.current[changedConversationId];
            void refreshActiveCalls([changedConversationId]);
          }, 220);
        },
      )
      .subscribe();

    return () => {
      Object.values(callRefreshTimersRef.current).forEach((timerId) => window.clearTimeout(timerId));
      callRefreshTimersRef.current = {};
      supabase.removeChannel(channel);
    };
  }, [profile?.id]);

  const syncTypingUsersFromPresence = useCallback((channel: any) => {
    const state = channel.presenceState() as Record<string, Array<{ typing?: boolean; user_id?: string }>>;
    const others = Object.entries(state)
      .filter(([key]) => key !== String(profile?.id || ''))
      .flatMap(([, presences]) => presences)
      .filter((presence) => presence?.typing)
      .map((presence) => presence.user_id)
      .filter(Boolean) as string[];
    setTypingUserIds(Array.from(new Set(others)));
  }, [profile?.id]);

  useEffect(() => {
    if (!conversationId || !profile) {
      setTypingUserIds([]);
      return;
    }

    const channel = supabase.channel(`dm-typing:${conversationId}`, {
      config: { presence: { key: profile.id } },
    });
    dmPresenceChannelRef.current = channel;

    channel
      .on('presence', { event: 'sync' }, () => syncTypingUsersFromPresence(channel))
      .on('presence', { event: 'join' }, () => syncTypingUsersFromPresence(channel))
      .on('presence', { event: 'leave' }, () => syncTypingUsersFromPresence(channel))
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ user_id: profile.id, typing: false, ts: Date.now() });
        }
      });

    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
      setTypingUserIds([]);
      supabase.removeChannel(channel);
      dmPresenceChannelRef.current = null;
    };
  }, [conversationId, profile?.id, syncTypingUsersFromPresence]);

  useEffect(() => {
    if (!conversationId || !profile) return;

    const channel = supabase
      .channel(`dm-invite:${conversationId}`)
      .on('broadcast', { event: 'incoming-call' }, (payload) => {
        const data = (payload.payload || {}) as any;
        if (data.to_user_id !== profile.id) return;
        setIncomingInvite({
          conversationId,
          video: Boolean(data.video),
          callerName: data.caller_name,
          fallbackJoin: Boolean(data.fallback_join || !data.call_id),
        });
      })
      .subscribe();

    dmInviteChannelRef.current = channel;
    return () => {
      setIncomingInvite(null);
      supabase.removeChannel(channel);
      dmInviteChannelRef.current = null;
    };
  }, [conversationId, profile?.id]);

  useEffect(() => {
    const channel = supabase
      .channel('dm:profile-status')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
        },
        (payload) => {
          const updated = payload.new as Partial<Profile> & { id: string };
          if (!updated?.id) return;
          const updatedUserId = String(updated.id);
          if (!trackedConversationMemberIdsRef.current.has(updatedUserId)) return;

          setConversations((prev) =>
            prev.map((conv: any) => ({
              ...conv,
              members: (conv.members || []).map((m: any) =>
                m.user_id === updatedUserId
                  ? { ...m, profile: { ...(m.profile || {}), ...updated } }
                  : m
              ),
            }))
          );

          setUserResults((prev) =>
            prev.map((u) => (u.id === updatedUserId ? { ...u, ...updated } : u))
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (!conversationContextMenu) return;
    const onWindowClick = () => setConversationContextMenu(null);
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setConversationContextMenu(null);
      }
    };
    window.addEventListener('click', onWindowClick);
    window.addEventListener('contextmenu', onWindowClick);
    window.addEventListener('keydown', onEscape);
    return () => {
      window.removeEventListener('click', onWindowClick);
      window.removeEventListener('contextmenu', onWindowClick);
      window.removeEventListener('keydown', onEscape);
    };
  }, [conversationContextMenu]);

  function isCallRowActive(row: any): boolean {
    const normalized = normalizeCallRow(row, CALL_JOIN_WINDOW_MS);
    if (!normalized) return false;
    if (!isActiveCallState(normalized.state)) return false;
    if (normalized.state === 'ringing') {
      const createdAtMs = Date.parse(String(normalized.created_at || ''));
      if (Number.isFinite(createdAtMs) && createdAtMs > 0 && createdAtMs + CALL_JOIN_WINDOW_MS <= Date.now()) {
        return false;
      }
    }
    if (!normalized.expires_at) return true;
    const expires = new Date(String(normalized.expires_at));
    if (Number.isNaN(expires.getTime())) return true;
    return expires.getTime() > Date.now();
  }

  async function refreshActiveCalls(targetConversationIds?: string[]) {
    if (!profile) return;
    if (callsSignalingUnavailableRef.current) {
      if (!targetConversationIds || targetConversationIds.length === 0) {
        setActiveCallsByConversationId({});
      } else {
        setActiveCallsByConversationId((prev) => {
          const next = { ...prev };
          for (const id of targetConversationIds) {
            delete next[String(id)];
          }
          return next;
        });
      }
      return;
    }

    const requestedIds = (targetConversationIds && targetConversationIds.length > 0)
      ? Array.from(new Set(targetConversationIds.map((id) => String(id)).filter(Boolean)))
      : Array.from(new Set(conversations.map((conv) => String(conv.id)).filter(Boolean)));
    const conversationIds = requestedIds.filter((id) => isUuid(id));

    if (conversationIds.length === 0) {
      if (!targetConversationIds || targetConversationIds.length === 0) {
        setActiveCallsByConversationId({});
      } else {
        setActiveCallsByConversationId((prev) => {
          const next = { ...prev };
          for (const id of targetConversationIds) {
            delete next[String(id)];
          }
          return next;
        });
      }
      return;
    }

    let callRows: any[] | null = null;
    let callsError: any = null;

    const modernCallsResponse = await supabase
      .from('calls')
      .select('id, conversation_id, caller_id, callee_ids, state, metadata, created_at, expires_at')
      .in('conversation_id', conversationIds)
      .in('state', ['ringing', 'accepted'])
      .order('created_at', { ascending: false });

    if (modernCallsResponse.error && isCallsModernSchemaMissingError(modernCallsResponse.error)) {
      const legacyCallsResponse = await supabase
        .from('calls')
        .select('id, room, caller_id, callee_id, status, accepted, metadata, created_at, updated_at')
        .in('room', conversationIds)
        .in('status', ['ringing', 'accepted'])
        .order('created_at', { ascending: false });
      callRows = legacyCallsResponse.data as any[] | null;
      callsError = legacyCallsResponse.error;
    } else {
      callRows = modernCallsResponse.data as any[] | null;
      callsError = modernCallsResponse.error;
    }

    if (callsError) {
      const shouldDisable = shouldDisableCallsSignaling(callsError);
      if (shouldDisable) {
        callsSignalingUnavailableRef.current = true;
      }
      if (!callsSignalingWarnedRef.current || !shouldDisable) {
        callsSignalingWarnedRef.current = true;
        console.warn(
          shouldDisable
            ? 'Active call lookup failed; disabling calls table signaling and using fallback invites:'
            : 'Active call lookup failed; keeping signaling enabled and retrying on next event:',
          callsError
        );
      }
      return;
    }

    const latestByConversation = new Map<string, any>();
    const normalizedCallRows = (callRows || [])
      .map((row) => normalizeCallRow(row, CALL_JOIN_WINDOW_MS))
      .filter(Boolean) as Array<NonNullable<ReturnType<typeof normalizeCallRow>>>;
    for (const row of normalizedCallRows) {
      const conversationId = String(row.conversation_id || '');
      if (!conversationId || latestByConversation.has(conversationId)) continue;
      if (!isCallRowActive(row)) continue;
      latestByConversation.set(conversationId, row);
    }

    const participantUserIds = Array.from(new Set(
      Array.from(latestByConversation.values()).flatMap((row: any) => {
        const caller = row?.caller_id ? [String(row.caller_id)] : [];
        const callees = Array.isArray(row?.callee_ids)
          ? row.callee_ids.map((id: any) => String(id)).filter(Boolean)
          : [];
        return [...caller, ...callees];
      }),
    ));

    const profileMap = new Map<string, Profile>();
    const missingParticipantIds = participantUserIds.filter((id) => !participantProfileCacheRef.current.has(id));
    if (missingParticipantIds.length > 0) {
      const { data: profileRows, error: profileError } = await supabase
        .from('profiles')
        .select(DM_LIST_PROFILE_SELECT_COLUMNS)
        .in('id', missingParticipantIds);
      if (profileError) {
        console.warn('Active call participant profile lookup failed:', profileError);
      } else {
        for (const row of (profileRows || []) as Profile[]) {
          participantProfileCacheRef.current.set(String(row.id), row);
        }
      }
    }
    for (const userId of participantUserIds) {
      const cached = participantProfileCacheRef.current.get(userId);
      if (cached) profileMap.set(userId, cached);
    }

    const next: Record<string, ActiveConversationCall> = {};
    for (const [conversationId, row] of latestByConversation.entries()) {
      const callerId = row?.caller_id ? String(row.caller_id) : null;
      const calleeIds = Array.isArray(row?.callee_ids)
        ? row.callee_ids.map((id: any) => String(id)).filter(Boolean)
        : [];
      const participantIds = Array.from(new Set([...(callerId ? [callerId] : []), ...calleeIds]));
      const participantNames = participantIds
        .map((id) => {
          const p = profileMap.get(id);
          return p ? (p.display_name || p.username) : id.slice(0, 8);
        })
        .filter(Boolean);

      next[conversationId] = {
        id: String(row.id),
        conversationId,
        callerId,
        calleeIds,
        state: String(row.state) === 'accepted' ? 'accepted' : 'ringing',
        expiresAt: row.expires_at ? String(row.expires_at) : null,
        video: Boolean(row.video || (row.metadata as any)?.video),
        participantNames,
      };
    }

    setActiveCallsByConversationId((prev) => {
      if (!targetConversationIds || targetConversationIds.length === 0) {
        return next;
      }
      const merged: Record<string, ActiveConversationCall> = { ...prev };
      for (const id of targetConversationIds) {
        const key = String(id);
        if (next[key]) {
          merged[key] = next[key];
        } else {
          delete merged[key];
        }
      }
      return merged;
    });
  }

  async function loadConversations() {
    if (!profile) return;
    let membershipRows: Array<{ conversation_id: string }> = [];
    let membershipError: any = null;

    // Prefer RPC path (SECURITY DEFINER) so DM list still loads if select policies drift.
    const { data: rpcMembershipRows, error: rpcMembershipError } = await (supabase as any).rpc('get_my_dm_conversation_ids');
    if (!rpcMembershipError && Array.isArray(rpcMembershipRows)) {
      membershipRows = rpcMembershipRows
        .map((row: any) => ({ conversation_id: String(row?.conversation_id || '') }))
        .filter((row: any) => Boolean(row.conversation_id));
    } else {
      if (rpcMembershipError && !isMissingRpcFunctionError(rpcMembershipError)) {
        console.warn('DM conversation id RPC failed; falling back to table query.', rpcMembershipError);
      }
      const { data, error } = await supabase
        .from('direct_conversation_members')
        .select('conversation_id')
        .eq('user_id', profile.id)
        .limit(MAX_BOOTSTRAP_DM_CONVERSATIONS * 4);
      membershipRows = ((data || []) as any[])
        .map((row: any) => ({ conversation_id: String(row?.conversation_id || '') }))
        .filter((row: any) => Boolean(row.conversation_id));
      membershipError = error;
    }

    if (membershipError) {
      console.warn('DM membership lookup failed; keeping cached conversations if available.', membershipError);
      return;
    }

    const requestedConversationIds = Array.from(
      new Set((membershipRows || []).map((row: any) => String(row.conversation_id)).filter((id) => isUuid(id)))
    );

    if (requestedConversationIds.length === 0) {
      setConversations([]);
      return;
    }

    const { data: conversationsData, error: conversationsError } = await supabase
      .from('direct_conversations')
      .select('id, is_group, name, icon_url, created_by, created_at, updated_at')
      .in('id', requestedConversationIds)
      .order('updated_at', { ascending: false })
      .limit(MAX_BOOTSTRAP_DM_CONVERSATIONS);

    if (conversationsError) {
      console.warn('Primary DM conversation hydration failed:', conversationsError);
    }

    let conversationRows = (conversationsData || []) as any[];

    if (
      conversationId
      && isUuid(conversationId)
      && !conversationRows.some((row: any) => String(row?.id || '') === String(conversationId))
      && requestedConversationIds.includes(conversationId)
    ) {
      const { data: activeConversationRow } = await supabase
        .from('direct_conversations')
        .select('id, is_group, name, icon_url, created_by, created_at, updated_at')
        .eq('id', conversationId)
        .maybeSingle();
      if (activeConversationRow && (activeConversationRow as any).id) {
        conversationRows = [activeConversationRow as any, ...conversationRows];
      }
    }

    let hydratedConversationIds = Array.from(
      new Set(
        conversationRows
          .map((row: any) => String(row?.id || '').trim())
          .filter((id) => isUuid(id))
      )
    );

    if (hydratedConversationIds.length === 0) {
      hydratedConversationIds = requestedConversationIds.slice(0, MAX_BOOTSTRAP_DM_CONVERSATIONS);
    }

    const { data: membersData, error: membersError } = await supabase
      .from('direct_conversation_members')
      .select('id, conversation_id, user_id, last_read_at, role, added_by')
      .in('conversation_id', hydratedConversationIds);
    if (membersError) {
      console.warn('Primary DM member hydration failed:', membersError);
    }

    let memberRows = (membersData || []) as any[];

    // Fallback hydration path when direct conversation table fetch is constrained.
    if (conversationRows.length === 0) {
      const { data: fallbackRows, error: fallbackError } = await supabase
        .from('direct_conversation_members')
        .select('conversation:direct_conversations(id, is_group, name, icon_url, created_by, created_at, updated_at)')
        .eq('user_id', profile.id)
        .limit(MAX_BOOTSTRAP_DM_CONVERSATIONS);

      if (fallbackError) {
        console.warn('Fallback DM conversation hydration failed:', fallbackError);
      } else {
        const deduped = new Map<string, any>();
        for (const row of fallbackRows || []) {
          const conv = (row as any)?.conversation;
          if (conv?.id) deduped.set(String(conv.id), conv);
        }
        conversationRows = Array.from(deduped.values())
          .sort((a: any, b: any) => {
            const aTime = new Date(a?.updated_at || a?.created_at || 0).getTime();
            const bTime = new Date(b?.updated_at || b?.created_at || 0).getTime();
            return bTime - aTime;
          })
          .slice(0, MAX_BOOTSTRAP_DM_CONVERSATIONS);
      }
    }

    // Fallback members query (without profile join) if regular join fails or is empty.
    if (memberRows.length === 0) {
      const { data: fallbackMembers, error: fallbackMembersError } = await supabase
        .from('direct_conversation_members')
        .select('id, conversation_id, user_id, last_read_at, role, added_by')
        .in('conversation_id', hydratedConversationIds);
      if (fallbackMembersError) {
        console.warn('Fallback DM member hydration failed:', fallbackMembersError);
      } else {
        memberRows = (fallbackMembers || []) as any[];
      }
    }

    // Profile enrichment runs separately to avoid ambiguous embeds when multiple FKs exist.
    const shouldEnrichProfiles = memberRows.length > 0 && memberRows.some((row: any) => !row.profile);
    if (shouldEnrichProfiles) {
      const userIds = Array.from(new Set(memberRows.map((row: any) => String(row.user_id)).filter(Boolean)));
      if (userIds.length > 0) {
        const { data: profileRows, error: profileError } = await supabase
          .from('profiles')
          .select(DM_LIST_PROFILE_SELECT_COLUMNS)
          .in('id', userIds);
        if (profileError) {
          console.warn('DM profile enrichment failed:', profileError);
        } else {
          const profileById = new Map<string, any>();
          for (const profileRow of profileRows || []) {
            profileById.set(String((profileRow as any).id), profileRow);
          }
          memberRows = memberRows.map((row: any) => ({
            ...row,
            profile: profileById.get(String(row.user_id)) || null,
          }));
        }
      }
    }

    // Never drop the DM list when conversation hydration partially fails.
    // Membership rows are authoritative for "which DMs should appear."
    const nowIso = new Date().toISOString();
    const conversationMap = new Map<string, any>();
    for (const conv of conversationRows) {
      if (conv?.id) {
        conversationMap.set(String(conv.id), conv);
      }
    }
    for (const id of hydratedConversationIds) {
      if (!conversationMap.has(id)) {
        conversationMap.set(id, {
          id,
          is_group: false,
          name: null,
          icon_url: null,
          created_by: null,
          created_at: nowIso,
          updated_at: nowIso,
        });
      }
    }

    const membersByConversation = new Map<string, any[]>();
    for (const member of memberRows) {
      const key = String(member.conversation_id);
      const existing = membersByConversation.get(key) || [];
      existing.push(member);
      membersByConversation.set(key, existing);
    }

    const hydrated = Array.from(conversationMap.values()).map((conv: any) => {
      const id = String(conv.id);
      const members = membersByConversation.get(id);
      return {
        ...conv,
        members: members && members.length > 0
          ? members
          : [{
              id: `${id}:${profile.id}`,
              conversation_id: id,
              user_id: profile.id,
              last_read_at: null,
              role: 'member',
              added_by: null,
              profile,
            }],
      };
    });

    const filtered = hydrated
      .filter((conv: any) => !closedConversationIds.includes(String(conv.id)))
      .sort((a: any, b: any) => {
        const aTime = new Date(a.updated_at || a.created_at || 0).getTime();
        const bTime = new Date(b.updated_at || b.created_at || 0).getTime();
        return bTime - aTime;
      });

    // Keep one visible 1:1 thread per target user (most recent wins) to avoid
    // duplicate DM rows for the same person when legacy duplicate conversations exist.
    const directSeen = new Set<string>();
    const deduped = (filtered as any[]).filter((conv: any) => {
      if (conv.is_group) return true;
      const otherMember = (conv.members || []).find((member: any) => String(member.user_id) !== String(profile.id));
      const key = otherMember ? `direct:${String(otherMember.user_id)}` : `conversation:${String(conv.id)}`;
      if (directSeen.has(key)) return false;
      directSeen.add(key);
      return true;
    });

    setConversations(deduped as DirectConversation[]);
  }

  async function loadUserRelationships() {
    if (!profile) return;
    const { data } = await supabase
      .from('user_relationships')
      .select('target_user_id, relationship')
      .eq('user_id', profile.id);
    const map = Object.fromEntries(
      (data || []).map((row: any) => [String(row.target_user_id), row.relationship as 'friend' | 'ignored' | 'blocked'])
    );
    setUserRelationships(map);
  }

  async function loadMessages(convId: string) {
    const primary = await supabase
      .from('direct_messages')
      .select(`id, conversation_id, author_id, content, is_edited, created_at, updated_at, author:profiles(${PROFILE_SELECT_COLUMNS}), attachments:direct_message_attachments(*)`)
      .eq('conversation_id', convId)
      .order('created_at', { ascending: true })
      .limit(100);
    let hydratedData: DirectMessage[] | null = null;

    if (!primary.error && primary.data) {
      hydratedData = primary.data as DirectMessage[];
    } else {
      if (primary.error && !isMissingEmbedRelationshipError(primary.error)) {
        console.warn('Primary DM message fetch failed; trying fallback.', primary.error);
      }
      const fallback = await supabase
        .from('direct_messages')
        .select(`id, conversation_id, author_id, content, is_edited, created_at, updated_at, author:profiles(${PROFILE_SELECT_COLUMNS})`)
        .eq('conversation_id', convId)
        .order('created_at', { ascending: true })
        .limit(100);
      if (fallback.error) {
        console.warn('Fallback DM message fetch failed; using cached messages if available.', fallback.error);
        return;
      }
      hydratedData = ((fallback.data || []) as DirectMessage[]).map((msg) => ({ ...msg, attachments: [] }));
    }

    if (!hydratedData) return;

    setMessages(hydratedData);
    const cacheKey = getMessagesCacheKey(convId);
    if (cacheKey && hydratedData.length > 0) {
      try {
        localStorage.setItem(cacheKey, JSON.stringify(hydratedData.slice(-300)));
      } catch {
        // best-effort cache
      }
    }
    scrollToBottom('auto');
  }

  useEffect(() => {
    const query = searchUsers.trim();
    if (query.length < 2) {
      setUserResults([]);
      setSearchUsersError('');
      setLoadingUsers(false);
      return;
    }

    setLoadingUsers(true);
    setSearchUsersError('');
    const timer = setTimeout(async () => {
      // Prefer RPC path for consistent search behavior even if profile SELECT policy is missing.
      const { data: rpcData, error: rpcError } = await (supabase as any).rpc('search_profiles_for_dm', {
        p_query: query,
        p_limit: 10,
      });

      if (!rpcError && Array.isArray(rpcData)) {
        setUserResults((rpcData || []) as Profile[]);
        setLoadingUsers(false);
        return;
      }

      if (rpcError && !isMissingRpcFunctionError(rpcError)) {
        console.warn('DM user search RPC failed; falling back to direct query.', rpcError);
      }

      const { data, error } = await supabase
        .from('profiles')
        .select(DM_LIST_PROFILE_SELECT_COLUMNS)
        .or(`username.ilike.%${query}%,display_name.ilike.%${query}%`)
        .neq('id', profile?.id || '')
        .limit(10);

      if (error) {
        console.error('DM user search failed:', error);
        setUserResults([]);
        setSearchUsersError('Search is unavailable right now. Please try again.');
      } else {
        setUserResults((data || []) as Profile[]);
      }
      setLoadingUsers(false);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchUsers, profile?.id]);

  useEffect(() => {
    if (!showEditGroupModal || !activeConversation?.is_group || !profile) {
      setGroupMemberResults([]);
      setLoadingGroupMemberSearch(false);
      return;
    }

    if (!canManageGroupMembers(activeConversation)) {
      setGroupMemberResults([]);
      setLoadingGroupMemberSearch(false);
      return;
    }

    const query = groupMemberSearch.trim();
    if (query.length < 2) {
      setGroupMemberResults([]);
      setLoadingGroupMemberSearch(false);
      return;
    }

    setLoadingGroupMemberSearch(true);
    const timer = setTimeout(async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select(DM_LIST_PROFILE_SELECT_COLUMNS)
        .or(`username.ilike.%${query}%,display_name.ilike.%${query}%`)
        .neq('id', profile.id)
        .limit(12);

      if (error) {
        console.error('Group member search failed:', error);
        setGroupMemberResults([]);
        setLoadingGroupMemberSearch(false);
        return;
      }

      const existingIds = new Set((activeConversation.members || []).map((m: any) => String(m.user_id)));
      const filtered = ((data || []) as Profile[]).filter((candidate) => !existingIds.has(String(candidate.id)));
      setGroupMemberResults(filtered);
      setLoadingGroupMemberSearch(false);
    }, 250);

    return () => clearTimeout(timer);
  }, [showEditGroupModal, activeConversation?.id, activeConversation?.members, groupMemberSearch, profile?.id]);

  function resetNewDmComposer() {
    setShowNewDM(false);
    setSearchUsers('');
    setUserResults([]);
    setSearchUsersError('');
    setNewDmMode('direct');
    setNewGroupName('');
    setNewGroupMemberIds([]);
    setCreatingConversation(false);
  }

  function toggleGroupMemberSelection(userId: string) {
    setNewGroupMemberIds((prev) => {
      if (prev.includes(userId)) {
        return prev.filter((id) => id !== userId);
      }
      const maxSelectableMembers = Math.max(maxGroupDmMembers - 1, 1);
      if (prev.length >= maxSelectableMembers) {
        setSearchUsersError(`You can select up to ${maxSelectableMembers} members on your current plan.`);
        return prev;
      }
      setSearchUsersError('');
      return [...prev, userId];
    });
  }

  async function startConversation(otherUser: Profile) {
    if (!profile) return;
    setErrorMessage('');

    const existingDirect = conversations.find((conv: any) => {
      if (conv.is_group) return false;
      const memberIds = Array.from(new Set((conv.members || []).map((m: any) => String(m.user_id))));
      if (memberIds.length !== 2) return false;
      return memberIds.includes(String(profile.id)) && memberIds.includes(String(otherUser.id));
    });

    if (existingDirect) {
      resetNewDmComposer();
      navigate(`/app/dm/${existingDirect.id}`);
      return;
    }

    const { data: rpcConversationId, error: rpcError } = await (supabase as any).rpc('create_or_get_direct_conversation', {
      p_target_user_id: otherUser.id,
    });
    if (!rpcError && rpcConversationId) {
      resetNewDmComposer();
      await loadConversations();
      navigate(`/app/dm/${String(rpcConversationId)}`);
      return;
    }
    if (rpcError && !isMissingRpcFunctionError(rpcError)) {
      setErrorMessage(rpcError.message || 'Failed to create conversation.');
      return;
    }

    const { data: conv, error } = await supabase
      .from('direct_conversations')
      .insert({ created_by: profile.id, is_group: false })
      .select()
      .single();
    if (error || !conv) {
      setErrorMessage(error?.message || 'Failed to create conversation.');
      return;
    }

    const { error: membersError } = await supabase.from('direct_conversation_members').insert([
      { conversation_id: conv.id, user_id: profile.id, role: 'member', added_by: profile.id },
      { conversation_id: conv.id, user_id: otherUser.id, role: 'member', added_by: profile.id },
    ]);
    if (membersError) {
      setErrorMessage(membersError.message || 'Failed to add conversation members.');
      return;
    }

    resetNewDmComposer();
    await loadConversations();
    navigate(`/app/dm/${conv.id}`);
  }

  async function createGroupConversation() {
    if (!profile) return;
    setErrorMessage('');

    const uniqueMemberIds = Array.from(new Set(newGroupMemberIds.filter(Boolean)));
    if (uniqueMemberIds.length < 2) {
      setSearchUsersError('Select at least 2 members for a group DM.');
      return;
    }
    if ((uniqueMemberIds.length + 1) > maxGroupDmMembers) {
      setSearchUsersError(`This group exceeds your member cap (${maxGroupDmMembers}).`);
      return;
    }

    setCreatingConversation(true);
    try {
      const groupName = newGroupName.trim() || null;
      const { data: conv, error } = await supabase
        .from('direct_conversations')
        .insert({
          created_by: profile.id,
          is_group: true,
          name: groupName,
        })
        .select()
        .single();

      if (error || !conv) {
        setSearchUsersError(error?.message || 'Failed to create group conversation.');
        return;
      }

      const memberRows = [profile.id, ...uniqueMemberIds].map((userId) => ({
        conversation_id: conv.id,
        user_id: userId,
        role: userId === profile.id ? 'owner' : 'member',
        added_by: profile.id,
      }));
      const { error: memberError } = await supabase.from('direct_conversation_members').insert(memberRows);
      if (memberError) {
        setSearchUsersError(memberError.message || 'Failed to add selected members.');
        return;
      }

      resetNewDmComposer();
      await loadConversations();
      navigate(`/app/dm/${conv.id}`);
    } finally {
      setCreatingConversation(false);
    }
  }

  function queueSelectedFiles(fileList: FileList | File[] | null | undefined) {
    if (!fileList) return;
    const nextFiles = Array.isArray(fileList) ? fileList : Array.from(fileList);
    if (nextFiles.length === 0) return;
    const validFiles: File[] = [];
    const tooLargeFiles: string[] = [];

    for (const file of nextFiles) {
      if (file.size > maxUploadBytes) {
        tooLargeFiles.push(file.name);
        continue;
      }
      validFiles.push(file);
    }

    if (tooLargeFiles.length > 0) {
      setErrorMessage(`These files are over ${formatFileSize(maxUploadBytes)} and were skipped: ${tooLargeFiles.join(', ')}`);
    }

    if (validFiles.length === 0) return;
    setPendingFiles((prev) => {
      const deduped = new Map<string, File>();
      for (const item of [...prev, ...validFiles]) {
        const key = `${item.name}:${item.size}:${item.lastModified}`;
        deduped.set(key, item);
      }
      return Array.from(deduped.values());
    });
  }

  function handleComposerPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const clipboardItems = Array.from(event.clipboardData?.items || []);
    if (clipboardItems.length === 0) return;
    const imageFiles = clipboardItems
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));

    if (imageFiles.length === 0) return;
    event.preventDefault();
    queueSelectedFiles(imageFiles);
  }

  function removePendingFile(fileToRemove: File) {
    setPendingFiles((prev) => prev.filter((file) => (
      !(file.name === fileToRemove.name && file.size === fileToRemove.size && file.lastModified === fileToRemove.lastModified)
    )));
  }

  async function uploadPendingFilesForMessage(messageId: string, files: File[]) {
    if (!profile || !conversationId || files.length === 0) return;
    setUploadingFiles(true);
    try {
      for (const file of files) {
        const safeName = file.name.replace(/[^\w.\-() ]/g, '_');
        const storagePath = `${profile.id}/dm/${conversationId}/${messageId}/${Date.now()}-${safeName}`;
        const { error: uploadError } = await supabase
          .storage
          .from('message-uploads')
          .upload(storagePath, file, { upsert: false });
        if (uploadError) {
          setErrorMessage(`Upload failed for ${file.name}: ${uploadError.message}`);
          continue;
        }
        const { data: publicData } = supabase.storage.from('message-uploads').getPublicUrl(storagePath);
        const { error: attachmentError } = await supabase.from('direct_message_attachments').insert({
          direct_message_id: messageId,
          file_url: publicData.publicUrl,
          file_name: file.name,
          file_type: file.type || 'application/octet-stream',
          file_size: file.size,
        } as any);
        if (attachmentError) {
          setErrorMessage(`Attachment save failed for ${file.name}: ${attachmentError.message}`);
        }
      }
    } finally {
      setUploadingFiles(false);
    }
  }

  async function handleSend() {
    if (!profile || !conversationId || sending) return;

    const content = input.trim().slice(0, maxMessageLength);
    const filesToSend = [...pendingFiles];
    const hasText = content.length > 0;
    const hasFiles = filesToSend.length > 0;
    if (!hasText && !hasFiles) return;

    const shieldAssessment = analyzeMessageShield({
      text: content,
      fileNames: filesToSend.map((file) => file.name),
      trustedDomains: ['nyptidindustries.com', 'ncore.nyptidindustries.com', 'stripe.com', 'supabase.co'],
    });
    if (shieldAssessment.action === 'block') {
      const detail = describeShieldAssessment(shieldAssessment);
      setErrorMessage(detail);
      queueRuntimeEvent('shield_message_blocked', {
        scope: 'dm',
        severity: shieldAssessment.severity,
        findings: shieldAssessment.findings.map((finding) => finding.code),
      }, { userId: profile.id, sampleRate: 1 });
      return;
    }
    if (shieldAssessment.action === 'warn') {
      setErrorMessage(describeShieldAssessment(shieldAssessment));
      queueRuntimeEvent('shield_message_warned', {
        scope: 'dm',
        severity: shieldAssessment.severity,
        findings: shieldAssessment.findings.map((finding) => finding.code),
      }, { userId: profile.id, sampleRate: 1 });
    }

    setInput('');
    setPendingFiles([]);
    setSending(true);
    setErrorMessage('');

    const { data: insertedMessage, error } = await supabase
      .from('direct_messages')
      .insert({
        conversation_id: conversationId,
        author_id: profile.id,
        content,
      })
      .select('id')
      .maybeSingle();

    if (error || !insertedMessage?.id) {
      setErrorMessage(error?.message || 'Failed to send message.');
      setInput(content);
      setPendingFiles(filesToSend);
      setSending(false);
      return;
    }

    const optimisticMessage: DirectMessage = {
      id: String(insertedMessage.id),
      conversation_id: String(conversationId),
      author_id: profile.id,
      content,
      is_edited: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      author: profile as any,
      attachments: [],
    };
    upsertDirectMessage(optimisticMessage);
    scrollToBottom('auto');

    const activityAtIso = new Date().toISOString();
    promoteConversationActivity(conversationId, activityAtIso);
    void supabase
      .from('direct_conversations')
      .update({ updated_at: activityAtIso } as any)
      .eq('id', conversationId);

    if (filesToSend.length > 0) {
      await uploadPendingFilesForMessage(String(insertedMessage.id), filesToSend);
    }

    try {
      let recipientIds = Array.from(new Set(
        (activeConversation?.members || [])
          .map((member: any) => String(member?.user_id || '').trim())
          .filter((userId) => userId && userId !== profile.id),
      ));
      if (recipientIds.length === 0) {
        const { data: memberRows } = await supabase
          .from('direct_conversation_members')
          .select('user_id')
          .eq('conversation_id', conversationId)
          .neq('user_id', profile.id);
        recipientIds = Array.from(
          new Set((memberRows || []).map((row: any) => String(row.user_id)).filter(Boolean)),
        ) as string[];
      }
      if (recipientIds.length > 0) {
        const senderName = profile.display_name || profile.username || 'Someone';
        const messagePreview = content || (filesToSend.length > 0 ? `Sent ${filesToSend.length} attachment${filesToSend.length > 1 ? 's' : ''}` : 'Sent a message');
        const mentionedRecipientIds = new Set<string>();
        const allowBroadcastMention = Boolean(activeConversation?.is_group && hasBroadcastMention(content));
        if (allowBroadcastMention) {
          recipientIds.forEach((id) => mentionedRecipientIds.add(id));
        }

        if (content.includes('@') || content.includes('<@')) {
          const resolvedMentionTargets = resolveMentionTargetIds(
            content,
            dmMentionTargets.map((target) => ({
              id: target.id,
              username: target.username || null,
              display_name: target.display_name || null,
            })),
            false,
          );
          for (const id of resolvedMentionTargets) {
            mentionedRecipientIds.add(id);
          }
        }

        const notifications = recipientIds.map((recipientId) => {
          const isMention = mentionedRecipientIds.has(recipientId);
          return {
            user_id: recipientId,
            type: isMention ? 'mention' : 'direct_message',
            title: isMention ? `${senderName} mentioned you` : senderName,
            body: messagePreview.slice(0, 220),
            data: {
              conversation_id: conversationId,
              message_id: insertedMessage.id,
              author_id: profile.id,
              mention: isMention,
            },
            is_read: false,
          };
        });
        const notifyError = await insertNotificationsWithRetry(notifications as any[]);
        if (notifyError) {
          console.warn('Failed to queue DM notifications:', notifyError);
        }
      }
    } catch (notifyError) {
      console.warn('Failed to prepare DM notifications:', notifyError);
    }

    try {
      await supabase.rpc('award_xp_for_activity', {
        p_source_type: 'direct_message',
        p_source_id: insertedMessage.id,
        p_points: 4,
      });
    } catch {
      // XP is best-effort; message send should still succeed.
    }

    queueRuntimeEvent('direct_message_sent', {
      conversation_id: conversationId,
      has_files: filesToSend.length > 0,
      mention_count: Array.from(resolveMentionTargetIds(content, dmMentionTargets, false)).length,
      risk_severity: shieldAssessment.severity,
    }, { userId: profile.id, sampleRate: 0.35 });

    setSending(false);
    if (dmPresenceChannelRef.current) {
      await dmPresenceChannelRef.current.track({ user_id: profile.id, typing: false, ts: Date.now() });
    }
    inputRef.current?.focus();
  }

  const syncComposerSelection = useCallback((target: HTMLTextAreaElement | null) => {
    if (!target) return;
    setComposerSelectionStart(target.selectionStart ?? target.value.length);
  }, []);

  const syncDmTypingPresence = useCallback(async (value: string) => {
    if (!profile || !dmPresenceChannelRef.current) return;

    const isTyping = value.trim().length > 0;
    await dmPresenceChannelRef.current.track({ user_id: profile.id, typing: isTyping, ts: Date.now() });

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }

    if (isTyping) {
      typingTimeoutRef.current = setTimeout(async () => {
        if (dmPresenceChannelRef.current) {
          await dmPresenceChannelRef.current.track({ user_id: profile.id, typing: false, ts: Date.now() });
        }
      }, 1500);
    }
  }, [profile]);

  const commitMentionSuggestion = useCallback((suggestion: MentionSuggestion) => {
    if (!activeMentionQuery) return;
    const next = insertMentionSuggestion(input, activeMentionQuery, suggestion);
    setInput(next.value);
    void syncDmTypingPresence(next.value);
    requestAnimationFrame(() => {
      const target = inputRef.current;
      if (!target) return;
      target.focus();
      target.setSelectionRange(next.caretPosition, next.caretPosition);
      setComposerSelectionStart(next.caretPosition);
    });
  }, [activeMentionQuery, input, syncDmTypingPresence]);

  const handleComposerChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value.slice(0, maxMessageLength);
    setInput(value);
    setComposerSelectionStart(event.target.selectionStart ?? value.length);
    void syncDmTypingPresence(value);
  }, [maxMessageLength, syncDmTypingPresence]);

  const handleComposerKeyDown = useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (activeMentionQuery && mentionSuggestions.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setMentionSuggestionIndex((prev) => (prev + 1) % mentionSuggestions.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setMentionSuggestionIndex((prev) => (prev - 1 + mentionSuggestions.length) % mentionSuggestions.length);
        return;
      }
      if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
        event.preventDefault();
        commitMentionSuggestion(mentionSuggestions[mentionSuggestionIndex] || mentionSuggestions[0]);
        return;
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }, [activeMentionQuery, commitMentionSuggestion, handleSend, mentionSuggestionIndex, mentionSuggestions]);

  async function startCallForConversation(targetConversationId: string, video: boolean) {
    if (!profile || !targetConversationId) return;
    if (!isUuid(targetConversationId)) {
      setErrorMessage('Call route is invalid. Please reopen the DM and try again.');
      return;
    }
    setErrorMessage('');

    try {
      const authState = await ensureFreshAuthSession(90, { verifyOnServer: true });
      if (!authState.ok) {
        if (authState.requiresReauth) {
          setErrorMessage(authState.message || 'Session expired. Please sign in again.');
          return;
        }
        console.warn('Call auth preflight failed; continuing with local session fallback.', authState.message);
      }

      const { data: members, error: membersError } = await supabase
        .from('direct_conversation_members')
        .select('user_id')
        .eq('conversation_id', targetConversationId)
        .neq('user_id', profile.id);

      let resolvedMembers = (members || []) as Array<{ user_id: string }>;

      if (membersError) {
        console.warn('Failed to query call recipients from direct_conversation_members:', membersError);
        const fallbackConversation = conversations.find((c) => c.id === targetConversationId) || activeConversation;
        const fallbackMembers = (fallbackConversation?.members || [])
          .filter((m: any) => m.user_id !== profile.id)
          .map((m: any) => ({ user_id: String(m.user_id) }));
        resolvedMembers = fallbackMembers;
      }

      if (!resolvedMembers || resolvedMembers.length === 0) {
        const { data: allMembers, error: allMembersError } = await supabase
          .from('direct_conversation_members')
          .select('user_id')
          .eq('conversation_id', targetConversationId);
        if (allMembersError) {
          console.warn('Secondary call recipient lookup failed:', allMembersError);
        } else {
          resolvedMembers = ((allMembers || []) as Array<{ user_id: string }>)
            .filter((member) => String(member.user_id) !== String(profile.id));
        }
      }

      resolvedMembers = Array.from(
        new Set((resolvedMembers || []).map((member) => String(member.user_id || '')).filter(Boolean))
      )
        .filter((userId) => userId !== String(profile.id))
        .map((userId) => ({ user_id: userId }));

      if (!resolvedMembers || resolvedMembers.length === 0) {
        setErrorMessage('No participants found to call.');
        return;
      }

      const recipientCount = resolvedMembers.length;
      void trackGrowthEvent('call_start_attempted', {
        conversation_id: targetConversationId,
        recipient_count: recipientCount,
        video,
      }, { userId: profile.id });

      if (recipientCount > 2 && !capabilities.canStartHighVolumeCalls) {
        const reason = getCapabilityLockReason('can_start_high_volume_calls', contract.unlock_source);
        setErrorMessage(reason);
        void trackGrowthEvent('capability_gate_blocked', {
          gate: 'can_start_high_volume_calls',
          action: 'start_call',
          recipient_count: recipientCount,
        }, { userId: profile.id });
        return;
      }

      let shouldUseFallbackJoin = callsSignalingUnavailableRef.current;
      let existingCall: any = null;
      if (!callsSignalingUnavailableRef.current) {
        const { data: activeRow, error: activeRowError } = await fetchActiveCallRowWithRetry(targetConversationId);
        if (activeRowError) {
          const shouldDisable = shouldDisableCallsSignaling(activeRowError);
          if (shouldDisable) {
            callsSignalingUnavailableRef.current = true;
          }
          if (!callsSignalingWarnedRef.current || !shouldDisable) {
            callsSignalingWarnedRef.current = true;
            console.warn(
              shouldDisable
                ? 'Active call lookup failed; switching to fallback invite path.'
                : 'Active call lookup failed; keeping signaling enabled and retrying.',
              activeRowError
            );
          }
        } else {
          existingCall = activeRow;
        }
      }

      if (existingCall && isCallRowActive(existingCall)) {
        const existingVideo = Boolean((existingCall as any)?.metadata?.video);
        navigate(buildCallRoute(targetConversationId, existingVideo, false));
        return;
      }

      {
        const callerName = profile.display_name || profile.username;
        const calleeIds = resolvedMembers.map((m) => String(m.user_id));
        const channelName = `dm-${targetConversationId}`;
        let callId: string | null = null;

        if (!callsSignalingUnavailableRef.current) {
          const startedAtIso = new Date().toISOString();
          const modernPayload = {
            conversation_id: targetConversationId,
            caller_id: profile.id,
            callee_ids: calleeIds,
            state: 'ringing',
            channel_name: channelName,
            metadata: {
              video,
              started_at: startedAtIso,
            },
            expires_at: new Date(Date.now() + CALL_JOIN_WINDOW_MS).toISOString(),
          };
          const legacyPayload = buildLegacyCallInsertPayload({
            conversationId: targetConversationId,
            callerId: profile.id,
            calleeIds,
            video,
            metadata: {
              started_at: startedAtIso,
              channel_name: channelName,
            },
          });
          // Prefer persistent call row signaling, but do not hard-fail if DB policy/migration is missing.
          const { data: callData, error: callError } = await insertCallRowWithRetry(modernPayload, legacyPayload);

          if (!callError && callData && (callData as any).id) {
            callId = String((callData as any).id);
          } else {
            const shouldDisable = shouldDisableCallsSignaling(callError);
            if (shouldDisable) {
              callsSignalingUnavailableRef.current = true;
            }
            if (!callsSignalingWarnedRef.current || !shouldDisable) {
              callsSignalingWarnedRef.current = true;
              console.warn(
                shouldDisable
                  ? 'Call signaling row unavailable; using fallback invite path.'
                : 'Call row insert failed temporarily; will continue with fallback invite path.',
                callError
              );
            }
            shouldUseFallbackJoin = true;
          }
        }
        const fallbackJoin = !callId;
        if (fallbackJoin) {
          shouldUseFallbackJoin = true;
        }

        const notifications = resolvedMembers.map((member: any) => ({
          user_id: member.user_id,
          type: 'incoming_call',
          title: `${callerName} is calling`,
          body: video ? 'Incoming video call' : 'Incoming voice call',
          data: {
            conversation_id: targetConversationId,
            video,
            caller_id: profile.id,
            caller_name: callerName,
            fallback_join: fallbackJoin,
            ...(callId ? { call_id: callId } : {}),
          },
          is_read: false,
        }));

        const notifyError = await insertNotificationsWithRetry(notifications as any[]);
        if (notifyError) {
          console.warn('Call notifications failed; continuing with realtime invite.', notifyError);
        }

        // Realtime signal for recipients currently inside this DM route.
        if (dmInviteChannelRef.current) {
          for (const member of resolvedMembers as any[]) {
            try {
              await dmInviteChannelRef.current.send({
                type: 'broadcast',
                event: 'incoming-call',
                payload: {
                  conversation_id: targetConversationId,
                  to_user_id: member.user_id,
                  video,
                  caller_id: profile.id,
                  caller_name: callerName,
                  fallback_join: fallbackJoin,
                  ...(callId ? { call_id: callId } : {}),
                },
              });
            } catch (broadcastError) {
              console.warn('DM invite broadcast failed for recipient', member.user_id, broadcastError);
            }
          }
        }

        // Attempt push notifications via Edge Function (non-blocking).
        try {
          const { error: fnErr } = await supabase.functions.invoke('send-call-push', {
            body: {
              userIds: resolvedMembers.map((member: any) => member.user_id),
              notification: {
                title: `${callerName} is calling`,
                body: video ? 'Incoming video call' : 'Incoming voice call',
                data: {
                  conversation_id: targetConversationId,
                  video,
                  caller_id: profile.id,
                  fallback_join: fallbackJoin,
                  ...(callId ? { call_id: callId } : {}),
                },
              },
            },
          });
          if (fnErr && !isAuthOrJwtError(fnErr)) {
            console.warn('send-call-push failed:', fnErr);
          }
        } catch (fnErr) {
          if (!isAuthOrJwtError(fnErr)) {
            console.warn('send-call-push failed:', fnErr);
          }
        }
      }

      navigate(buildCallRoute(targetConversationId, video, shouldUseFallbackJoin, true));
    } catch (error) {
      setErrorMessage('Unable to start call right now.');
      void trackGrowthEvent('call_start_failed', {
        conversation_id: targetConversationId,
        error: String((error as Error)?.message || error),
      }, { userId: profile.id });
      console.error('startCall error:', error);
    }
  }

  const renderedMessages = useMemo(() => (
    messages.map((msg, i) => {
      const prev = messages[i - 1];
      const isOwn = msg.author_id === profile?.id;
      const author = (msg.author as any);
      const attachments = (msg.attachments || []) as DirectMessageAttachment[];
      const showAvatar = !prev || prev.author_id !== msg.author_id ||
        new Date(msg.created_at).getTime() - new Date(prev.created_at).getTime() > 5 * 60 * 1000;

      return (
        <div key={msg.id} className={`flex gap-3 ${isOwn ? 'flex-row-reverse' : 'flex-row'} group`}>
          <div className="w-8 flex-shrink-0">
            {showAvatar && (
              <Avatar
                src={author?.avatar_url}
                name={author?.display_name || author?.username || 'User'}
                size="sm"
              />
            )}
          </div>
          <div className={`flex flex-col ${isOwn ? 'items-end' : 'items-start'} max-w-[85%] sm:max-w-lg`}>
            {showAvatar && (
              <span className="text-xs text-surface-500 mb-1 px-1">
                {isOwn ? 'You' : author?.display_name || author?.username}
                {' · '}
                {formatShortTime(msg.created_at)}
              </span>
            )}
            <div className={`px-3 py-2 rounded-2xl text-sm ${isOwn
              ? 'bg-nyptid-300 text-surface-950 rounded-tr-sm'
              : 'bg-surface-700 text-surface-200 rounded-tl-sm'}`}>
              {msg.content && (
                <div className="whitespace-pre-wrap break-words">{renderDirectMessageContent(msg.content)}</div>
              )}
              {attachments.length > 0 && (
                <div className={`${msg.content ? 'mt-2' : ''} space-y-2`}>
                  {attachments.map((attachment) => {
                    const isImage = String(attachment.file_type || '').startsWith('image/');
                    return (
                      <a
                        key={attachment.id}
                        href={attachment.file_url}
                        target="_blank"
                        rel="noreferrer"
                        className={`block rounded-lg border text-xs overflow-hidden ${
                          isOwn
                            ? 'border-surface-950/20 hover:border-surface-950/30'
                            : 'border-surface-500/30 hover:border-surface-400/40'
                        }`}
                      >
                        {isImage ? (
                          <img
                            src={attachment.file_url}
                            alt={attachment.file_name}
                            className="max-h-64 w-auto object-contain bg-black/20"
                          />
                        ) : (
                          <div className="flex items-center gap-2 px-2.5 py-2">
                            <Paperclip size={13} />
                            <div className="min-w-0">
                              <div className="truncate font-medium">{attachment.file_name}</div>
                              <div className="opacity-70">{formatFileSize(Number(attachment.file_size || 0))}</div>
                            </div>
                          </div>
                        )}
                      </a>
                    );
                  })}
                </div>
              )}
              {msg.is_edited && <span className="text-xs opacity-60 ml-1">(edited)</span>}
            </div>
          </div>
        </div>
      );
    })
  ), [messages, profile?.id]);

  async function startCall(video: boolean) {
    if (!conversationId) return;
    await startCallForConversation(conversationId, video);
  }

  function getOtherProfileForDirectConversation(conv: DirectConversation): Profile | null {
    const other = (conv.members || []).find((m: any) => String(m.user_id) !== String(profile?.id)) as any;
    return (other?.profile || null) as Profile | null;
  }

  function getProfileDisplayNameWithNickname(userProfile: Profile | null): string {
    if (!userProfile) return 'Unknown';
    const nickname = friendNicknames[userProfile.id]?.trim();
    if (nickname) return nickname;
    return userProfile.display_name || userProfile.username;
  }

  function openConversationContextMenu(event: React.MouseEvent, conv: DirectConversation) {
    event.preventDefault();
    event.stopPropagation();
    const targetUser = conv.is_group ? null : getOtherProfileForDirectConversation(conv);
    setConversationContextMenu({
      conversation: conv,
      x: event.clientX,
      y: event.clientY,
      targetUser,
    });
  }

  async function markConversationAsRead(conv: DirectConversation) {
    if (!profile) return;
    await supabase
      .from('direct_conversation_members')
      .update({ last_read_at: new Date().toISOString() })
      .eq('conversation_id', conv.id)
      .eq('user_id', profile.id);
  }

  function closeConversationForCurrentUser(conv: DirectConversation) {
    const targetUserId = !conv.is_group
      ? String((conv.members || []).find((m: any) => String(m.user_id) !== String(profile?.id))?.user_id || '')
      : '';

    setClosedConversationIds((prev) => {
      const next = new Set(prev);
      if (targetUserId) {
        for (const existing of conversations) {
          if (existing.is_group) continue;
          const existingTarget = String((existing.members || []).find((m: any) => String(m.user_id) !== String(profile?.id))?.user_id || '');
          if (existingTarget && existingTarget === targetUserId) {
            next.add(String(existing.id));
          }
        }
      } else {
        next.add(String(conv.id));
      }
      return Array.from(next);
    });

    setConversations((prev) => (
      prev.filter((c) => {
        if (targetUserId && !c.is_group) {
          const existingTarget = String((c.members || []).find((m: any) => String(m.user_id) !== String(profile?.id))?.user_id || '');
          return existingTarget !== targetUserId;
        }
        return c.id !== conv.id;
      })
    ));

    const currentConversation = conversationId
      ? conversations.find((conversation) => conversation.id === conversationId)
      : null;
    const currentTargetUserId = currentConversation && !currentConversation.is_group
      ? String((currentConversation.members || []).find((m: any) => String(m.user_id) !== String(profile?.id))?.user_id || '')
      : '';
    if (conversationId === conv.id || (targetUserId && currentTargetUserId === targetUserId)) {
      navigate('/app/dm');
    }
  }

  function toggleConversationMute(conv: DirectConversation) {
    setMutedConversationIds((prev) => (
      prev.includes(conv.id)
        ? prev.filter((id) => id !== conv.id)
        : [...prev, conv.id]
    ));
  }

  function handleAddNote(targetUser: Profile | null) {
    if (!targetUser) return;
    const existing = friendNotes[targetUser.id] || '';
    const next = window.prompt(`Add a private note for ${targetUser.display_name || targetUser.username}:`, existing);
    if (next === null) return;
    const trimmed = next.trim();
    setFriendNotes((prev) => {
      if (!trimmed) {
        const copy = { ...prev };
        delete copy[targetUser.id];
        return copy;
      }
      return { ...prev, [targetUser.id]: trimmed };
    });
  }

  function handleAddNickname(targetUser: Profile | null) {
    if (!targetUser) return;
    const existing = friendNicknames[targetUser.id] || '';
    const next = window.prompt(`Set a nickname for ${targetUser.display_name || targetUser.username}:`, existing);
    if (next === null) return;
    const trimmed = next.trim();
    setFriendNicknames((prev) => {
      if (!trimmed) {
        const copy = { ...prev };
        delete copy[targetUser.id];
        return copy;
      }
      return { ...prev, [targetUser.id]: trimmed };
    });
  }

  function getContextMenuTargetLabel(targetUser: Profile | null): string {
    if (!targetUser) return 'Conversation';
    return getProfileDisplayNameWithNickname(targetUser);
  }

  function getMemberRole(conv: DirectConversation, userId: string): GroupMemberRole {
    const member = (conv.members || []).find((m: any) => String(m.user_id) === String(userId)) as any;
    const role = member?.role as GroupMemberRole | undefined;
    if (role === 'owner' || role === 'admin' || role === 'member') return role;
    return 'member';
  }

  function getMyGroupRole(conv: DirectConversation | null): GroupMemberRole {
    if (!conv || !profile) return 'member';
    return getMemberRole(conv, profile.id);
  }

  function canManageGroupMembers(conv: DirectConversation | null): boolean {
    if (!conv?.is_group) return false;
    const myRole = getMyGroupRole(conv);
    return myRole === 'owner' || myRole === 'admin';
  }

  function canEditGroupRoles(conv: DirectConversation | null): boolean {
    if (!conv?.is_group) return false;
    return getMyGroupRole(conv) === 'owner';
  }

  function openEditGroupModal(conv: DirectConversation) {
    setActiveConversation(conv);
    setGroupDraftName(conv.name || '');
    setGroupDraftIconUrl(conv.icon_url || null);
    setGroupMemberSearch('');
    setGroupMemberResults([]);
    setShowEditGroupModal(true);
  }

  async function handleUploadGroupIcon(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !profile || !activeConversation || !activeConversation.is_group) return;
    if (!file.type.startsWith('image/')) {
      setErrorMessage('Group icon must be an image file.');
      e.target.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setErrorMessage('Group icon must be under 5MB.');
      e.target.value = '';
      return;
    }

    setUploadingGroupIcon(true);
    try {
      const ext = file.name.split('.').pop() || 'png';
      const path = `${profile.id}/dm-group-${activeConversation.id}-icon.${ext}`;
      const { error: uploadErr } = await supabase.storage.from('community-assets').upload(path, file, { upsert: true });
      if (uploadErr) {
        setErrorMessage(uploadErr.message || 'Failed to upload group icon.');
        return;
      }
      const { data: { publicUrl } } = supabase.storage.from('community-assets').getPublicUrl(path);
      setGroupDraftIconUrl(publicUrl);
    } finally {
      setUploadingGroupIcon(false);
      e.target.value = '';
    }
  }

  async function saveGroupMetadata() {
    if (!activeConversation || !activeConversation.is_group) return;
    setSavingGroupMeta(true);
    setErrorMessage('');
    try {
      const payload = {
        name: groupDraftName.trim() || null,
        icon_url: groupDraftIconUrl || null,
      };
      const { error } = await supabase
        .from('direct_conversations')
        .update(payload as any)
        .eq('id', activeConversation.id);

      if (error) {
        setErrorMessage(error.message || 'Failed to save group settings.');
        return;
      }

      setConversations((prev) => prev.map((conv) => (
        conv.id === activeConversation.id ? { ...conv, ...payload } : conv
      )));
      setActiveConversation((prev) => (prev ? { ...prev, ...payload } : prev));
      setShowEditGroupModal(false);
    } finally {
      setSavingGroupMeta(false);
    }
  }

  async function addMemberToGroup(userToAdd: Profile) {
    if (!activeConversation || !activeConversation.is_group) return;
    if (!canManageGroupMembers(activeConversation)) {
      setErrorMessage('Only owner/admin can add members.');
      return;
    }
    const currentMemberCount = Array.isArray(activeConversation.members) ? activeConversation.members.length : 0;
    if (currentMemberCount >= maxGroupDmMembers) {
      setErrorMessage(`Group member cap reached (${maxGroupDmMembers}).`);
      return;
    }
    setAddingGroupMemberId(userToAdd.id);
    setErrorMessage('');
    try {
      const { error } = await supabase
        .from('direct_conversation_members')
        .insert({
          conversation_id: activeConversation.id,
          user_id: userToAdd.id,
          role: 'member',
          added_by: profile?.id || null,
        });

      if (error) {
        setErrorMessage(error.message || 'Failed to add member.');
        return;
      }

      const nextMember = {
        id: `${activeConversation.id}:${userToAdd.id}`,
        conversation_id: activeConversation.id,
        user_id: userToAdd.id,
        last_read_at: new Date().toISOString(),
        role: 'member',
        added_by: profile?.id || null,
        profile: userToAdd,
      } as any;

      setConversations((prev) => prev.map((conv: any) => (
        conv.id === activeConversation.id
          ? { ...conv, members: [...(conv.members || []), nextMember] }
          : conv
      )));
      setActiveConversation((prev: any) => (
        prev
          ? { ...prev, members: [...(prev.members || []), nextMember] }
          : prev
      ));
      setGroupMemberResults((prev) => prev.filter((u) => u.id !== userToAdd.id));
    } finally {
      setAddingGroupMemberId(null);
    }
  }

  async function removeMemberFromGroup(userId: string) {
    if (!activeConversation || !activeConversation.is_group) return;
    const isSelf = String(userId) === String(profile?.id);
    if (!isSelf && !canManageGroupMembers(activeConversation)) {
      setErrorMessage('Only owner/admin can remove other members.');
      return;
    }
    setRemovingGroupMemberId(userId);
    setErrorMessage('');
    try {
      const { error } = await supabase.rpc('remove_group_dm_member', {
        p_target_conversation_id: activeConversation.id,
        p_target_user_id: userId,
      });

      if (error) {
        setErrorMessage(error.message || 'Failed to remove member.');
        return;
      }

      setConversations((prev) => prev.map((conv: any) => (
        conv.id === activeConversation.id
          ? { ...conv, members: (conv.members || []).filter((m: any) => String(m.user_id) !== String(userId)) }
          : conv
      )));
      setActiveConversation((prev: any) => (
        prev
          ? { ...prev, members: (prev.members || []).filter((m: any) => String(m.user_id) !== String(userId)) }
          : prev
      ));

      if (String(userId) === String(profile?.id)) {
        setConversations((prev) => prev.filter((conv) => conv.id !== activeConversation.id));
        navigate('/app/dm');
        setShowEditGroupModal(false);
      }
    } finally {
      setRemovingGroupMemberId(null);
    }
  }

  async function changeGroupMemberRole(userId: string, nextRole: GroupMemberRole) {
    if (!activeConversation || !activeConversation.is_group) return;
    if (!canEditGroupRoles(activeConversation)) {
      setErrorMessage('Only group owner can change roles.');
      return;
    }
    setUpdatingGroupRoleUserId(userId);
    setErrorMessage('');
    try {
      const { error } = await supabase.rpc('set_group_dm_member_role', {
        p_target_conversation_id: activeConversation.id,
        p_target_user_id: userId,
        p_next_role: nextRole,
      });
      if (error) {
        setErrorMessage(error.message || 'Failed to change member role.');
        return;
      }

      setConversations((prev) => prev.map((conv: any) => (
        conv.id === activeConversation.id
          ? {
              ...conv,
              members: (conv.members || []).map((m: any) => (
                String(m.user_id) === String(userId) ? { ...m, role: nextRole } : m
              )),
            }
          : conv
      )));
      setActiveConversation((prev: any) => (
        prev
          ? {
              ...prev,
              members: (prev.members || []).map((m: any) => (
                String(m.user_id) === String(userId) ? { ...m, role: nextRole } : m
              )),
            }
          : prev
      ));
    } finally {
      setUpdatingGroupRoleUserId(null);
    }
  }

  async function transferGroupOwnership(userId: string) {
    if (!activeConversation || !activeConversation.is_group || !profile) return;
    if (!canEditGroupRoles(activeConversation)) {
      setErrorMessage('Only group owner can transfer ownership.');
      return;
    }
    if (String(userId) === String(profile.id)) return;

    const confirmed = window.confirm('Transfer ownership to this member? You will become admin.');
    if (!confirmed) return;

    setTransferringGroupOwnerId(userId);
    setErrorMessage('');
    try {
      const { error } = await supabase.rpc('transfer_group_dm_ownership', {
        p_target_conversation_id: activeConversation.id,
        p_target_user_id: userId,
      });
      if (error) {
        setErrorMessage(error.message || 'Failed to transfer ownership.');
        return;
      }

      const mutateRoles = (members: any[]) => (members || []).map((member: any) => {
        if (String(member.user_id) === String(userId)) {
          return { ...member, role: 'owner' };
        }
        if (String(member.user_id) === String(profile.id)) {
          return { ...member, role: 'admin' };
        }
        return member;
      });

      setConversations((prev) => prev.map((conv: any) => (
        conv.id === activeConversation.id
          ? { ...conv, members: mutateRoles(conv.members || []) }
          : conv
      )));
      setActiveConversation((prev: any) => (
        prev
          ? { ...prev, members: mutateRoles(prev.members || []) }
          : prev
      ));
    } finally {
      setTransferringGroupOwnerId(null);
    }
  }

  async function removeFriend(targetUser: Profile, conversation: DirectConversation) {
    setErrorMessage('');
    const { error } = await supabase.rpc('remove_friend', {
      p_target_user_id: targetUser.id,
    });
    if (error) {
      setErrorMessage(error.message || 'Could not remove friend.');
      return;
    }
    setUserRelationships((prev) => {
      const next = { ...prev };
      delete next[targetUser.id];
      return next;
    });
    closeConversationForCurrentUser(conversation);
  }

  async function setRelationshipAndClose(
    targetUser: Profile,
    relationship: 'ignored' | 'blocked',
    conversation: DirectConversation
  ) {
    setErrorMessage('');
    const { error } = await supabase.rpc('set_user_relationship', {
      p_target_user_id: targetUser.id,
      p_next_relationship: relationship,
    });
    if (error) {
      setErrorMessage(error.message || `Could not ${relationship} this user.`);
      return;
    }
    setUserRelationships((prev) => ({ ...prev, [targetUser.id]: relationship }));
    closeConversationForCurrentUser(conversation);
  }

  function getConversationName(conv: DirectConversation): string {
    if (conv.name) return conv.name;
    const others = (conv.members || []).filter((m: any) => m.user_id !== profile?.id);
    if (others.length === 0) return conv.is_group ? 'Group DM' : 'Unknown';
    const names = others.map((m: any) => (m.profile as any)?.display_name || (m.profile as any)?.username || 'User');
    if (conv.is_group) {
      if (names.length <= 3) return names.join(', ');
      return `${names.slice(0, 3).join(', ')} +${names.length - 3}`;
    }
    const directOther = getOtherProfileForDirectConversation(conv);
    return getProfileDisplayNameWithNickname(directOther) || names[0] || 'Unknown';
  }

  function getConversationAvatar(conv: DirectConversation): { src?: string; name: string; status?: Profile['status'] } {
    if (conv.is_group) {
      return {
        src: conv.icon_url || undefined,
        name: getConversationName(conv),
      };
    }
    const others = (conv.members || []).filter((m: any) => m.user_id !== profile?.id);
    if (!conv.is_group && others.length === 1) {
      const p = (others[0] as any).profile as any;
      const name = getProfileDisplayNameWithNickname(p || null);
      return { src: p?.avatar_url, name: name || p?.display_name || p?.username || 'User', status: p?.status };
    }
    return { name: getConversationName(conv) };
  }

  function getConversationSubtext(conv: DirectConversation): string {
    const isMuted = mutedConversationIds.includes(conv.id);
    if (conv.is_group) {
      const count = Math.max(1, (conv.members || []).length);
      return isMuted ? `Muted - ${count} members` : `${count} members`;
    }
    const other = (conv.members || []).find((m: any) => m.user_id !== profile?.id) as any;
    const status = other?.profile?.status;
    if (status === 'online') return isMuted ? 'Muted - Online' : 'Online';
    if (other?.profile?.last_seen) {
      const text = `Last seen ${formatRelativeTime(other.profile.last_seen)}`;
      return isMuted ? `Muted - ${text}` : text;
    }
    return isMuted ? 'Muted - Click to chat' : 'Click to chat';
  }

  const directCallConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === directCallState.conversationId) || null,
    [conversations, directCallState.conversationId],
  );

  const directCallDockVoice = useMemo<SidebarVoiceDockState | null>(() => {
    if (directCallState.phase === 'idle' || !directCallState.conversationId) return null;
    return {
      phase: directCallState.phase,
      communityId: null,
      channelId: directCallState.conversationId,
      channelName: directCallConversation ? getConversationName(directCallConversation) : 'Direct Call',
      isMuted: directCallState.isMuted,
      isDeafened: directCallState.isDeafened,
      isCameraOn: directCallState.isVideoOn,
      isScreenSharing: directCallState.isScreenSharing,
      noiseSuppressionEnabled: directCallState.noiseSuppressionEnabled,
      participantCount: Math.max(1, Number(directCallState.participantCount || 0)),
      averagePingMs: directCallState.averagePingMs,
      lastPingMs: directCallState.lastPingMs,
      outboundPacketLossPct: directCallState.outboundPacketLossPct,
      privacyCode: Array.isArray(directCallState.privacyCode) ? directCallState.privacyCode : [],
    };
  }, [
    directCallConversation,
    directCallState.averagePingMs,
    directCallState.conversationId,
    directCallState.isDeafened,
    directCallState.isMuted,
    directCallState.isScreenSharing,
    directCallState.isVideoOn,
    directCallState.lastPingMs,
    directCallState.noiseSuppressionEnabled,
    directCallState.outboundPacketLossPct,
    directCallState.participantCount,
    directCallState.phase,
    directCallState.privacyCode,
  ]);

  const sidebarDockVoice = directCallDockVoice || voiceShell;

  function handleDockOpenVoice() {
    if (directCallDockVoice?.channelId) {
      navigate(`/app/dm/${directCallDockVoice.channelId}/call${directCallState.wantsVideo ? '?video=1' : ''}`);
      return;
    }
    if (voiceShell.communityId && voiceShell.channelId) {
      navigate(`/app/community/${voiceShell.communityId}/voice/${voiceShell.channelId}`);
    }
  }

  function handleDockToggleMute() {
    if (directCallDockVoice) {
      void directCallSession.toggleMute();
      return;
    }
    void runServerVoiceAction('toggleMute');
  }

  function handleDockToggleDeafen() {
    if (directCallDockVoice) {
      void directCallSession.toggleDeafen();
      return;
    }
    void runServerVoiceAction('toggleDeafen');
  }

  function handleDockToggleScreenShare() {
    if (directCallDockVoice) {
      const preferredQuality = loadCallSettings().screenShareQuality as ScreenShareQuality;
      void directCallSession.toggleScreenShare({
        quality: preferredQuality,
        maxQuality: directCallMaxScreenShareQuality,
      });
      return;
    }
    void runServerVoiceAction('toggleScreenShare');
  }

  function handleDockLeaveVoice() {
    if (directCallDockVoice) {
      const canEndForEveryone = Boolean(profile?.platform_role === 'owner');
      void directCallSession.hangup({ signalEnded: canEndForEveryone });
      return;
    }
    void runServerVoiceAction('leave');
  }

  function getTypingText(): string {
    if (!activeConversation || typingUserIds.length === 0) return '';
    const others = (activeConversation.members || [])
      .filter((m: any) => typingUserIds.includes(m.user_id))
      .map((m: any) => m.profile?.display_name || m.profile?.username || 'Someone');
    if (others.length === 0) return '';
    if (others.length === 1) return `${others[0]} is typing`;
    return `${others[0]} and ${others.length - 1} other${others.length > 2 ? 's' : ''} are typing`;
  }

  const activeTypingText = getTypingText();
  const activeConversationCall = conversationId ? activeCallsByConversationId[conversationId] : null;

  function formatParticipantList(names: string[]): string {
    if (!names || names.length === 0) return 'No participants yet';
    if (names.length <= 2) return names.join(', ');
    return `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
  }

  return (
    <AppShell showChannelSidebar={false} suppressPersistentVoiceBar title="Direct Messages">
      <div className="flex h-full min-h-0">
        <div className={`${isCompactLayout && conversationId ? 'hidden' : 'flex'} ${isCompactLayout ? 'w-full' : 'w-72'} border-r border-surface-800 flex-col bg-surface-900`}>
          <div className="p-3 border-b border-surface-800">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-semibold text-surface-200 flex-1">Messages</span>
              <button
                onClick={() => setShowNewDM(true)}
                className="w-7 h-7 rounded-lg bg-surface-700 flex items-center justify-center text-surface-400 hover:text-surface-200 hover:bg-surface-600 transition-colors"
              >
                <Plus size={14} />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {visibleConversations.length === 0 ? (
              <div className="text-center py-8 px-4">
                <p className="text-surface-500 text-sm">No conversations yet</p>
                <button
                  onClick={() => setShowNewDM(true)}
                  className="nyptid-btn-primary mt-3 text-xs px-3 py-1.5"
                >
                  Start a DM
                </button>
              </div>
            ) : visibleConversations.map(conv => {
              const { src, name, status } = getConversationAvatar(conv);
              const isActive = conv.id === conversationId;
              const activeCall = activeCallsByConversationId[conv.id];
              const subtext = getConversationSubtext(conv);
              return (
                <div
                  key={conv.id}
                  onClick={() => navigate(`/app/dm/${conv.id}`)}
                  onContextMenu={(e) => openConversationContextMenu(e, conv)}
                  className={`group flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors ${isActive ? 'bg-surface-700' : 'hover:bg-surface-800'}`}
                >
                  <Avatar src={src} name={name} size="md" status={status} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-surface-200 text-sm truncate flex items-center gap-1.5">
                      <span className="truncate">{name}</span>
                      {conv.is_group && <Users size={12} className="text-surface-500 flex-shrink-0" />}
                    </div>
                    <div className={`text-xs truncate ${activeCall ? 'text-green-400' : 'text-surface-500'}`}>
                      {activeCall
                        ? `In call: ${formatParticipantList(activeCall.participantNames)}`
                        : subtext}
                    </div>
                  </div>
                  {activeCall && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        navigate(`/app/dm/${conv.id}/call${activeCall.video ? '?video=1' : ''}`);
                      }}
                      className="w-7 h-7 rounded-md bg-green-500/20 text-green-300 hover:bg-green-500/30 transition-colors flex items-center justify-center"
                      title="Join active call"
                    >
                      <Phone size={13} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      closeConversationForCurrentUser(conv);
                    }}
                    className={`${isCompactLayout ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} text-surface-500 hover:text-surface-200 transition-opacity p-1 rounded-md hover:bg-surface-700`}
                    title="Close DM"
                  >
                    <X size={13} />
                  </button>
                </div>
              );
            })}
          </div>

          {profile && (
            <SidebarUserDock
              profile={profile}
              voice={sidebarDockVoice}
              onOpenVoice={handleDockOpenVoice}
              onToggleMute={handleDockToggleMute}
              onToggleDeafen={handleDockToggleDeafen}
              onToggleScreenShare={handleDockToggleScreenShare}
              onLeaveVoice={handleDockLeaveVoice}
              onOpenSettings={() => navigate('/app/settings')}
            />
          )}
        </div>

        <div className={`${isCompactLayout && !conversationId ? 'hidden' : 'flex'} flex-1 flex-col min-w-0`}>
          {!conversationId ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
              <div className="w-20 h-20 bg-surface-800 rounded-2xl flex items-center justify-center mb-4">
                <Send size={32} className="text-surface-400" />
              </div>
              <h2 className="text-xl font-bold text-surface-200 mb-2">Your Messages</h2>
              <p className="text-surface-500 text-sm mb-4">Send private messages to friends and team members</p>
              <button onClick={() => setShowNewDM(true)} className="nyptid-btn-primary">
                <Plus size={16} /> New Message
              </button>
            </div>
          ) : (
            <>
              {activeConversation && (
                <div className="h-14 border-b border-surface-800 flex items-center justify-between px-4 bg-surface-900 flex-shrink-0">
                  <div className="flex items-center gap-3">
                    {isCompactLayout && (
                      <button
                        type="button"
                        onClick={() => navigate('/app/dm')}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-surface-400 hover:text-surface-200 hover:bg-surface-700 transition-colors"
                        title="Back to conversations"
                      >
                        <ChevronLeft size={16} />
                      </button>
                    )}
                    {(() => {
                      const { src, name, status } = getConversationAvatar(activeConversation);
                      return <Avatar src={src} name={name} size="sm" status={status} />;
                    })()}
                    <div className="min-w-0">
                      <span className="font-semibold text-surface-100 text-sm block truncate">
                        {getConversationName(activeConversation)}
                      </span>
                      {activeTypingText && (
                        <div className="flex items-center gap-1 text-xs text-nyptid-300">
                          <span>{activeTypingText}</span>
                          <span className="typing-dots">
                            <span />
                            <span />
                            <span />
                          </span>
                        </div>
                      )}
                      {!activeTypingText && activeConversation.is_group && (
                        <div className="text-xs text-surface-500">
                          {(activeConversation.members || []).length} members
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => startCall(false)}
                      className="w-9 h-9 rounded-lg flex items-center justify-center text-surface-400 hover:text-surface-200 hover:bg-surface-700 transition-colors"
                      title="Start voice call"
                    >
                      <Phone size={16} />
                    </button>
                    <button
                      onClick={() => startCall(true)}
                      className="w-9 h-9 rounded-lg flex items-center justify-center text-surface-400 hover:text-surface-200 hover:bg-surface-700 transition-colors"
                      title="Start video call"
                    >
                      <Video size={16} />
                    </button>
                    {activeConversation.is_group && (
                      <button
                        onClick={() => openEditGroupModal(activeConversation)}
                        className="w-9 h-9 rounded-lg flex items-center justify-center text-surface-400 hover:text-surface-200 hover:bg-surface-700 transition-colors"
                        title="Edit group chat"
                      >
                        <MoreHorizontal size={16} />
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div ref={messageScrollRef} className="flex-1 overflow-y-auto py-4 px-4 scrollbar-thin space-y-1">
                {activeConversation && activeConversationCall && (
                  <div className="mb-3 rounded-xl border border-green-500/30 bg-green-500/10 px-3 py-2.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-green-200 truncate flex items-center gap-2">
                        <Phone size={14} />
                        {activeConversationCall.state === 'accepted' ? 'Call in progress' : 'Call ringing'}
                      </div>
                      <div className="text-xs text-green-300/90 truncate">
                        In chat: {formatParticipantList(activeConversationCall.participantNames)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => navigate(`/app/dm/${activeConversation.id}/call${activeConversationCall.video ? '?video=1' : ''}`)}
                      className="inline-flex items-center gap-1 rounded-lg bg-green-500/85 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-400 transition-colors flex-shrink-0"
                      title="Join call"
                    >
                      <Phone size={13} />
                      Join
                    </button>
                  </div>
                )}
                {messages.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-full text-center">
                    <div className="w-16 h-16 bg-surface-800 rounded-2xl flex items-center justify-center mb-4">
                      <Send size={24} className="text-surface-400" />
                    </div>
                    <p className="text-surface-400">This is the beginning of your conversation</p>
                  </div>
                )}
                {renderedMessages}
                <div ref={messagesEndRef} />
              </div>

              <div className="px-4 pb-4 flex-shrink-0">
                {incomingInvite && (
                  <div className="mb-2 rounded-lg border border-nyptid-300/30 bg-nyptid-300/10 px-3 py-2 text-xs text-nyptid-200 flex items-center justify-between gap-3">
                    <span>
                  {incomingInvite.callerName || 'Someone'} is calling you ({incomingInvite.video ? 'video' : 'voice'})
                    </span>
                    <button
                      onClick={() => {
                        navigate(buildCallRoute(
                          incomingInvite.conversationId,
                          incomingInvite.video,
                          Boolean(incomingInvite.fallbackJoin),
                        ));
                        setIncomingInvite(null);
                      }}
                      className="nyptid-btn-primary text-xs px-3 py-1.5"
                    >
                      Join
                    </button>
                  </div>
                )}
                {errorMessage && (
                  <div className="mb-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                    {errorMessage}
                  </div>
                )}
                {pendingFiles.length > 0 && (
                  <div className="mb-2 rounded-lg border border-surface-700 bg-surface-900 px-2.5 py-2">
                    <div className="mb-1 text-[11px] uppercase tracking-wide text-surface-500">
                      Attachments ({pendingFiles.length}) {uploadingFiles ? ' - uploading...' : ''}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {pendingFiles.map((file) => (
                        <button
                          key={`${file.name}:${file.size}:${file.lastModified}`}
                          type="button"
                          onClick={() => removePendingFile(file)}
                          className="inline-flex items-center gap-1 rounded-full border border-surface-600 bg-surface-800 px-2 py-1 text-xs text-surface-200 hover:bg-surface-700"
                        >
                          <Paperclip size={11} />
                          <span className="max-w-[180px] truncate">{file.name}</span>
                          <span className="text-surface-500">{formatFileSize(file.size)}</span>
                          <X size={11} />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="relative">
                  {activeMentionQuery && mentionSuggestions.length > 0 && (
                    <div className="absolute bottom-full left-0 right-0 mb-2 overflow-hidden rounded-xl border border-surface-700 bg-surface-900 shadow-2xl z-20">
                      <div className="border-b border-surface-800 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-surface-500">
                        Mention someone in this conversation
                      </div>
                      <div className="max-h-64 overflow-y-auto py-1">
                        {mentionSuggestions.map((suggestion, index) => {
                          const isActive = index === mentionSuggestionIndex;
                          const label = suggestion.display_name || suggestion.username;
                          return (
                            <button
                              key={`dm-mention-${suggestion.id}`}
                              type="button"
                              onMouseDown={(event) => {
                                event.preventDefault();
                                commitMentionSuggestion(suggestion);
                              }}
                              className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
                                isActive ? 'bg-nyptid-300/10 text-surface-100' : 'text-surface-300 hover:bg-surface-800'
                              }`}
                            >
                              <Avatar
                                src={suggestion.avatar_url}
                                name={label}
                                size="sm"
                                status={(suggestion.status as any) || undefined}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-semibold text-surface-100">{label}</div>
                                <div className="truncate text-xs text-surface-500">@{suggestion.username}</div>
                              </div>
                              <div className="text-[11px] uppercase tracking-wide text-surface-500">Mention</div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                <div className="flex items-end gap-2 bg-surface-800 border border-surface-700 rounded-xl px-3 py-2">
                  <button
                    type="button"
                    onClick={() => attachmentInputRef.current?.click()}
                    className="p-1.5 text-surface-500 hover:text-surface-200 transition-colors flex-shrink-0"
                    title="Attach files"
                  >
                    <Paperclip size={17} />
                  </button>
                  <input
                    ref={attachmentInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(event) => {
                      queueSelectedFiles(event.target.files);
                      event.target.value = '';
                    }}
                  />
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={handleComposerChange}
                    onPaste={handleComposerPaste}
                    onKeyDown={handleComposerKeyDown}
                    onClick={(event) => syncComposerSelection(event.currentTarget)}
                    onKeyUp={(event) => syncComposerSelection(event.currentTarget)}
                    onSelect={(event) => syncComposerSelection(event.currentTarget)}
                    placeholder="Message..."
                    className="flex-1 bg-transparent text-sm text-surface-100 placeholder-surface-600 resize-none outline-none max-h-32 min-h-[20px]"
                    rows={1}
                    maxLength={maxMessageLength}
                    onInput={e => {
                      const t = e.target as HTMLTextAreaElement;
                      t.style.height = 'auto';
                      t.style.height = Math.min(t.scrollHeight, 128) + 'px';
                    }}
                  />
                  <button
                    onClick={handleSend}
                    disabled={(!input.trim() && pendingFiles.length === 0) || sending || uploadingFiles}
                    className={`p-1.5 rounded-lg transition-colors ${
                      input.trim() || pendingFiles.length > 0
                        ? 'text-nyptid-300 hover:bg-nyptid-300/10'
                        : 'text-surface-600 cursor-not-allowed'
                    }`}
                  >
                    <Send size={18} />
                  </button>
                </div>
                </div>
                <div className="mt-1 px-1 text-[11px] text-surface-500">
                  Up to 10GB per file. Message limit: 20,000 characters.
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <Modal isOpen={showNewDM} onClose={resetNewDmComposer} title="New Message" size="sm">
        <div className="space-y-3">
          <div className="grid grid-cols-2 rounded-lg bg-surface-800 p-1">
            <button
              type="button"
              onClick={() => {
                setNewDmMode('direct');
                setNewGroupMemberIds([]);
                setSearchUsersError('');
              }}
              className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                newDmMode === 'direct'
                  ? 'bg-nyptid-300 text-surface-950'
                  : 'text-surface-400 hover:text-surface-200'
              }`}
            >
              Direct DM
            </button>
            <button
              type="button"
              onClick={() => {
                setNewDmMode('group');
                setSearchUsersError('');
              }}
              className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                newDmMode === 'group'
                  ? 'bg-nyptid-300 text-surface-950'
                  : 'text-surface-400 hover:text-surface-200'
              }`}
            >
              Group DM
            </button>
          </div>

          {newDmMode === 'group' && (
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-surface-500">
                Group name (optional)
              </label>
              <input
                type="text"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="Weekend sprint squad"
                className="nyptid-input"
                maxLength={64}
              />
            </div>
          )}

          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-500" />
            <input
              type="text"
              value={searchUsers}
              onChange={e => setSearchUsers(e.target.value)}
              placeholder="Search by username or display name..."
              className="nyptid-input pl-9"
              autoFocus
            />
          </div>

          {newDmMode === 'group' && newGroupMemberIds.length > 0 && (
            <div className="rounded-lg border border-surface-700 bg-surface-900 px-3 py-2">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-surface-500">
                Selected members ({newGroupMemberIds.length}/{Math.max(maxGroupDmMembers - 1, 1)})
              </div>
              <div className="flex flex-wrap gap-1.5">
                {newGroupMemberIds.map((memberId) => {
                  const selected = userResults.find((u) => u.id === memberId)
                    || conversations
                      .flatMap((c: any) => c.members || [])
                      .map((m: any) => m.profile)
                      .find((p: any) => p?.id === memberId);
                  if (!selected) return null;
                  return (
                    <button
                      key={memberId}
                      type="button"
                      onClick={() => toggleGroupMemberSelection(memberId)}
                      className="inline-flex items-center gap-1 rounded-full border border-nyptid-300/30 bg-nyptid-300/10 px-2 py-1 text-xs text-nyptid-200"
                    >
                      {(selected.display_name || selected.username || 'User').slice(0, 20)}
                      <span className="text-surface-400">x</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {searchUsersError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {searchUsersError}
            </div>
          )}
          {loadingUsers && <div className="text-center text-surface-500 text-sm py-2">Searching...</div>}

          <div className="space-y-1 max-h-48 overflow-y-auto">
            {userResults.map(user => {
              const selected = newGroupMemberIds.includes(user.id);
              return (
                <div
                  key={user.id}
                  onClick={() => {
                    if (newDmMode === 'group') {
                      toggleGroupMemberSelection(user.id);
                    } else {
                      void startConversation(user);
                    }
                  }}
                  className={`flex items-center gap-3 p-2.5 rounded-lg cursor-pointer transition-colors ${
                    selected ? 'bg-nyptid-300/10 border border-nyptid-300/30' : 'hover:bg-surface-700'
                  }`}
                >
                  <Avatar src={user.avatar_url} name={user.display_name || user.username} size="sm" status={user.status} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-surface-200 truncate">{user.display_name || user.username}</div>
                    <div className="text-xs text-surface-500 truncate">@{user.username}</div>
                  </div>
                  {newDmMode === 'group' && (
                    <div className={`w-5 h-5 rounded-full border flex items-center justify-center ${
                      selected ? 'border-nyptid-300 bg-nyptid-300 text-surface-950' : 'border-surface-600'
                    }`}>
                      {selected && <Check size={12} />}
                    </div>
                  )}
                </div>
              );
            })}

            {searchUsers.length >= 2 && !loadingUsers && userResults.length === 0 && (
              <div className="text-center text-surface-500 text-sm py-4">No users found</div>
            )}
          </div>

          {newDmMode === 'group' && (
            <div className="pt-1">
              <button
                type="button"
                onClick={() => {
                  void createGroupConversation();
                }}
                disabled={creatingConversation || newGroupMemberIds.length < 2}
                className="nyptid-btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {creatingConversation ? 'Creating Group DM...' : 'Create Group DM'}
              </button>
              <p className="mt-2 text-center text-[11px] text-surface-500">
                Select at least 2 members. Group cap on your plan: {maxGroupDmMembers} total members.
              </p>
            </div>
          )}
        </div>
      </Modal>

      <Modal
        isOpen={showEditGroupModal}
        onClose={() => setShowEditGroupModal(false)}
        title="Edit Group Chat"
        size="sm"
      >
        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-surface-500">
              Group Icon
            </label>
            <div className="flex items-center gap-3">
              <Avatar
                src={groupDraftIconUrl || undefined}
                name={groupDraftName || activeConversation?.name || 'Group DM'}
                size="lg"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => groupIconInputRef.current?.click()}
                  className="nyptid-btn-secondary px-3 py-2 text-xs"
                  disabled={uploadingGroupIcon}
                >
                  <Upload size={14} />
                  {uploadingGroupIcon ? 'Uploading...' : 'Upload Icon'}
                </button>
                {groupDraftIconUrl && (
                  <button
                    type="button"
                    onClick={() => setGroupDraftIconUrl(null)}
                    className="rounded-lg border border-surface-700 px-3 py-2 text-xs text-surface-300 hover:text-surface-100 hover:bg-surface-800 transition-colors"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
            <input
              ref={groupIconInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                void handleUploadGroupIcon(event);
              }}
            />
            <p className="mt-2 text-xs text-surface-500">JPG, PNG, GIF, WEBP. Max 5MB.</p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-surface-500">
              Group Name
            </label>
            <input
              type="text"
              value={groupDraftName}
              onChange={(event) => setGroupDraftName(event.target.value)}
              className="nyptid-input"
              maxLength={64}
              placeholder="Name this group"
            />
            <p className="mt-1 text-xs text-surface-600">All members can see these changes instantly.</p>
          </div>

          <div className="rounded-lg border border-surface-700 bg-surface-900 p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-surface-500">Members</div>
            <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
              {(activeConversation?.members || []).map((member: any) => {
                const memberProfile = member.profile as Profile | undefined;
                const memberName = memberProfile?.display_name || memberProfile?.username || 'User';
                const isSelf = String(member.user_id) === String(profile?.id);
                const memberRole = (member.role || 'member') as GroupMemberRole;
                const myRole = getMyGroupRole(activeConversation);
                const removingThis = removingGroupMemberId === String(member.user_id);
                const changingRoleThis = updatingGroupRoleUserId === String(member.user_id);
                const canRemoveMember = isSelf
                  || myRole === 'owner'
                  || (myRole === 'admin' && memberRole === 'member');
                const canEditRole = canEditGroupRoles(activeConversation) && !isSelf && memberRole !== 'owner';
                const canTransferOwner = canEditGroupRoles(activeConversation) && !isSelf && memberRole !== 'owner';
                return (
                  <div
                    key={member.id || member.user_id}
                    className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-800/70"
                  >
                    <Avatar
                      src={memberProfile?.avatar_url || undefined}
                      name={memberName}
                      size="sm"
                      status={memberProfile?.status}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-surface-200 truncate flex items-center gap-2">
                        <span className="truncate">{memberName}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full uppercase tracking-wide ${
                          memberRole === 'owner'
                            ? 'bg-yellow-500/20 text-yellow-300'
                            : memberRole === 'admin'
                              ? 'bg-nyptid-300/20 text-nyptid-200'
                              : 'bg-surface-700 text-surface-400'
                        }`}>
                          {memberRole}
                        </span>
                      </div>
                      <div className="text-xs text-surface-500 truncate">@{memberProfile?.username || 'user'}</div>
                    </div>
                    {canEditRole && (
                      <button
                        type="button"
                        onClick={() => {
                          void changeGroupMemberRole(String(member.user_id), memberRole === 'admin' ? 'member' : 'admin');
                        }}
                        disabled={Boolean(updatingGroupRoleUserId)}
                        className={`text-xs rounded-md px-2 py-1 transition-colors text-nyptid-200 hover:bg-nyptid-300/15 ${
                          Boolean(updatingGroupRoleUserId) ? 'opacity-50 cursor-not-allowed' : ''
                        }`}
                      >
                        {changingRoleThis ? '...' : memberRole === 'admin' ? 'Demote' : 'Promote'}
                      </button>
                    )}
                    {canTransferOwner && (
                      <button
                        type="button"
                        onClick={() => {
                          void transferGroupOwnership(String(member.user_id));
                        }}
                        disabled={Boolean(transferringGroupOwnerId)}
                        className={`text-xs rounded-md px-2 py-1 transition-colors text-amber-200 hover:bg-amber-500/15 ${
                          Boolean(transferringGroupOwnerId) ? 'opacity-50 cursor-not-allowed' : ''
                        }`}
                      >
                        {transferringGroupOwnerId === String(member.user_id) ? '...' : 'Transfer'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        void removeMemberFromGroup(String(member.user_id));
                      }}
                      disabled={Boolean(removingGroupMemberId) || !canRemoveMember}
                      className={`text-xs rounded-md px-2 py-1 transition-colors ${
                        isSelf
                          ? 'text-red-300 hover:bg-red-500/10'
                          : 'text-surface-300 hover:bg-surface-700'
                      } ${Boolean(removingGroupMemberId) || !canRemoveMember ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      {removingThis ? '...' : isSelf ? 'Leave' : 'Remove'}
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="mt-3">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-surface-500">
                Add Member
              </label>
              <input
                type="text"
                value={groupMemberSearch}
                onChange={(event) => setGroupMemberSearch(event.target.value)}
                placeholder="Search users to add..."
                className="nyptid-input"
                disabled={!canManageGroupMembers(activeConversation)}
              />
              {!canManageGroupMembers(activeConversation) && (
                <div className="mt-2 text-xs text-surface-500">Only owner/admin can add members.</div>
              )}
              {loadingGroupMemberSearch && (
                <div className="mt-2 text-xs text-surface-500">Searching users...</div>
              )}
              {!loadingGroupMemberSearch && groupMemberSearch.trim().length >= 2 && groupMemberResults.length === 0 && (
                <div className="mt-2 text-xs text-surface-500">No users found.</div>
              )}
              {groupMemberResults.length > 0 && (
                <div className="mt-2 space-y-1 max-h-32 overflow-y-auto pr-1">
                  {groupMemberResults.map((candidate) => (
                    <div
                      key={candidate.id}
                      className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-800/70"
                    >
                      <Avatar
                        src={candidate.avatar_url || undefined}
                        name={candidate.display_name || candidate.username}
                        size="sm"
                        status={candidate.status}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-surface-200 truncate">
                          {candidate.display_name || candidate.username}
                        </div>
                        <div className="text-xs text-surface-500 truncate">@{candidate.username}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          void addMemberToGroup(candidate);
                        }}
                        disabled={Boolean(addingGroupMemberId) || !canManageGroupMembers(activeConversation)}
                        className={`text-xs rounded-md px-2 py-1 transition-colors text-nyptid-200 hover:bg-nyptid-300/15 ${
                          Boolean(addingGroupMemberId) || !canManageGroupMembers(activeConversation)
                            ? 'opacity-50 cursor-not-allowed'
                            : ''
                        }`}
                      >
                        {addingGroupMemberId === candidate.id ? 'Adding...' : 'Add'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowEditGroupModal(false)}
              className="nyptid-btn-secondary px-3 py-2 text-xs"
              disabled={savingGroupMeta}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                void saveGroupMetadata();
              }}
              className="nyptid-btn-primary px-3 py-2 text-xs disabled:opacity-50"
              disabled={savingGroupMeta}
            >
              {savingGroupMeta ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </Modal>

      {conversationContextMenu && (() => {
        const menuWidth = 260;
        const menuHeight = conversationContextMenu.conversation.is_group ? 320 : 520;
        const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : conversationContextMenu.x + menuWidth + 8;
        const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : conversationContextMenu.y + menuHeight + 8;
        const left = Math.max(8, Math.min(conversationContextMenu.x, viewportWidth - menuWidth - 8));
        const top = Math.max(8, Math.min(conversationContextMenu.y, viewportHeight - menuHeight - 8));
        const conv = conversationContextMenu.conversation;
        const targetUser = conversationContextMenu.targetUser;
        const targetLabel = getContextMenuTargetLabel(targetUser);
        const currentRelationship = targetUser ? userRelationships[targetUser.id] : undefined;
        const muteLabel = conv.is_group
          ? `Mute ${getConversationName(conv)}`
          : `Mute @${targetUser?.username || targetLabel}`;

        return (
          <div className="fixed inset-0 z-[80] pointer-events-none">
            <div
              className="pointer-events-auto fixed w-[260px] rounded-xl border border-surface-700 bg-surface-900/95 backdrop-blur shadow-2xl py-2"
              style={{ left, top }}
              onClick={(event) => event.stopPropagation()}
              onContextMenu={(event) => event.preventDefault()}
            >
              <button
                type="button"
                onClick={() => {
                  void markConversationAsRead(conv);
                  setConversationContextMenu(null);
                }}
                className="w-full px-3 py-2 text-left text-sm text-surface-200 hover:bg-surface-800 transition-colors"
              >
                Mark As Read
              </button>

              {!conv.is_group && targetUser && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      navigate(`/app/profile/${targetUser.id}`);
                      setConversationContextMenu(null);
                    }}
                    className="w-full px-3 py-2 text-left text-sm text-surface-200 hover:bg-surface-800 transition-colors"
                  >
                    Profile
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void startCallForConversation(conv.id, false);
                      setConversationContextMenu(null);
                    }}
                    className="w-full px-3 py-2 text-left text-sm text-surface-200 hover:bg-surface-800 transition-colors"
                  >
                    Start a Call
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      handleAddNote(targetUser);
                      setConversationContextMenu(null);
                    }}
                    className="w-full px-3 py-2 text-left hover:bg-surface-800 transition-colors"
                  >
                    <div className="text-sm text-surface-200">Add Note</div>
                    <div className="text-xs text-surface-500">Only visible to you</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      handleAddNickname(targetUser);
                      setConversationContextMenu(null);
                    }}
                    className="w-full px-3 py-2 text-left text-sm text-surface-200 hover:bg-surface-800 transition-colors"
                  >
                    Add Friend Nickname
                  </button>
                </>
              )}

              {conv.is_group && (
                <button
                  type="button"
                  onClick={() => {
                    openEditGroupModal(conv);
                    setConversationContextMenu(null);
                  }}
                  className="w-full px-3 py-2 text-left text-sm text-surface-200 hover:bg-surface-800 transition-colors"
                >
                  Edit Group Chat
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  closeConversationForCurrentUser(conv);
                  setConversationContextMenu(null);
                }}
                className="w-full px-3 py-2 text-left text-sm text-surface-200 hover:bg-surface-800 transition-colors"
              >
                Close DM
              </button>

              {!conv.is_group && (
                <>
                  <div className="my-2 border-t border-surface-700" />
                  <button
                    type="button"
                    onClick={() => {
                      setErrorMessage('Apps integration is coming soon.');
                      setConversationContextMenu(null);
                    }}
                    className="w-full px-3 py-2 text-left text-sm text-surface-200 hover:bg-surface-800 transition-colors flex items-center justify-between"
                  >
                    <span>Apps</span>
                    <ChevronRight size={14} className="text-surface-500" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setErrorMessage('Invite to Server flow is coming soon.');
                      setConversationContextMenu(null);
                    }}
                    className="w-full px-3 py-2 text-left text-sm text-surface-200 hover:bg-surface-800 transition-colors flex items-center justify-between"
                  >
                    <span>Invite to Server</span>
                    <ChevronRight size={14} className="text-surface-500" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (targetUser) {
                        void removeFriend(targetUser, conv);
                      }
                      setConversationContextMenu(null);
                    }}
                    className="w-full px-3 py-2 text-left text-sm text-surface-200 hover:bg-surface-800 transition-colors"
                  >
                    Remove Friend
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (targetUser) {
                        void setRelationshipAndClose(targetUser, 'ignored', conv);
                      }
                      setConversationContextMenu(null);
                    }}
                    className="w-full px-3 py-2 text-left text-sm text-surface-200 hover:bg-surface-800 transition-colors"
                  >
                    {currentRelationship === 'ignored' ? 'Ignored' : 'Ignore'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (targetUser) {
                        void setRelationshipAndClose(targetUser, 'blocked', conv);
                      }
                      setConversationContextMenu(null);
                    }}
                    className="w-full px-3 py-2 text-left text-sm text-red-300 hover:bg-red-500/10 transition-colors"
                  >
                    {currentRelationship === 'blocked' ? 'Blocked' : 'Block'}
                  </button>
                </>
              )}

              <div className="my-2 border-t border-surface-700" />
              <button
                type="button"
                onClick={() => {
                  toggleConversationMute(conv);
                  setConversationContextMenu(null);
                }}
                className="w-full px-3 py-2 text-left text-sm text-surface-200 hover:bg-surface-800 transition-colors flex items-center justify-between"
              >
                <span>{muteLabel}</span>
                <div className="flex items-center gap-1 text-surface-500">
                  <VolumeX size={14} />
                  <ChevronRight size={14} />
                </div>
              </button>
            </div>
          </div>
        );
      })()}
    </AppShell>
  );
}

function formatShortTime(dateString: string): string {
  return new Date(dateString).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}


