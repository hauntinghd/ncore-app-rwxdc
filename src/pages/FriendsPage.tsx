import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Clock3,
  CheckCircle2,
  Gamepad2,
  MessageSquare,
  MonitorPlay,
  Phone,
  Plus,
  Search,
  UserCheck,
  UserPlus,
  UserRoundMinus,
  UserX,
  Video,
} from 'lucide-react';
import { AppShell } from '../components/layout/AppShell';
import { Avatar } from '../components/ui/Avatar';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { isCallsModernSchemaMissingError, normalizeCallRow } from '../lib/callsCompat';
import type { Profile } from '../lib/types';
import { formatRelativeTime } from '../lib/utils';

type FriendsTab = 'online' | 'all' | 'pending' | 'add';

interface RelationshipRow {
  target_user_id: string;
  relationship: 'friend' | 'ignored' | 'blocked' | 'friend_pending_outgoing' | 'friend_pending_incoming';
}

interface CallRow {
  id: string;
  conversation_id: string;
  caller_id: string | null;
  callee_ids: string[];
  state: 'ringing' | 'accepted' | 'declined' | 'ended';
  video: boolean;
  created_at: string;
}

interface FriendWithConversation {
  profile: Profile;
  conversationId: string | null;
  activeCall: CallRow | null;
}

interface PendingFriendEntry {
  profile: Profile;
  direction: 'incoming' | 'outgoing';
}

function normalizeUsername(value: string): string {
  return value.trim().replace(/^@/, '').toLowerCase().replace(/[^a-z0-9_]/g, '');
}

export function FriendsPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<FriendsTab>('online');
  const [loading, setLoading] = useState(true);
  const [friends, setFriends] = useState<FriendWithConversation[]>([]);
  const [pendingFriends, setPendingFriends] = useState<PendingFriendEntry[]>([]);
  const [errorMessage, setErrorMessage] = useState('');

  const [addFriendInput, setAddFriendInput] = useState('');
  const [addFriendLoading, setAddFriendLoading] = useState(false);
  const [addFriendMessage, setAddFriendMessage] = useState('');
  const [relationshipActionId, setRelationshipActionId] = useState<string | null>(null);

  const onlineFriends = useMemo(
    () =>
      friends.filter((entry) => {
        const status = entry.profile.status;
        return status === 'online' || status === 'idle' || status === 'dnd';
      }),
    [friends],
  );

  const activeNow = useMemo(() => {
    const fromCalls = friends.filter((entry) => Boolean(entry.activeCall));
    const onlineWithoutCalls = onlineFriends.filter((entry) => !entry.activeCall);
    return [...fromCalls, ...onlineWithoutCalls].slice(0, 12);
  }, [friends, onlineFriends]);

  async function loadFriends() {
    if (!profile?.id) return;
    setLoading(true);
    setErrorMessage('');
    try {
      const { data: relationshipRows, error: relationshipError } = await supabase
        .from('user_relationships')
        .select('target_user_id, relationship')
        .eq('user_id', profile.id)
        .in('relationship', ['friend', 'friend_pending_incoming', 'friend_pending_outgoing']);

      if (relationshipError) {
        setErrorMessage(relationshipError.message || 'Could not load friends.');
        setFriends([]);
        setPendingFriends([]);
        return;
      }

      const rows = (relationshipRows || []) as RelationshipRow[];
      const friendIds = Array.from(
        new Set(
          rows
            .filter((row) => row.relationship === 'friend')
            .map((row) => String(row.target_user_id))
            .filter(Boolean),
        ),
      );
      const incomingPendingIds = Array.from(
        new Set(
          rows
            .filter((row) => row.relationship === 'friend_pending_incoming')
            .map((row) => String(row.target_user_id))
            .filter(Boolean),
        ),
      );
      const outgoingPendingIds = Array.from(
        new Set(
          rows
            .filter((row) => row.relationship === 'friend_pending_outgoing')
            .map((row) => String(row.target_user_id))
            .filter(Boolean),
        ),
      );

      const relatedIds = Array.from(new Set([...friendIds, ...incomingPendingIds, ...outgoingPendingIds]));
      if (relatedIds.length === 0) {
        setFriends([]);
        setPendingFriends([]);
        return;
      }

      const { data: profileRows, error: profilesError } = await supabase
        .from('profiles')
        .select('*')
        .in('id', relatedIds);
      if (profilesError) {
        setErrorMessage(profilesError.message || 'Could not load friend profiles.');
        setFriends([]);
        setPendingFriends([]);
        return;
      }

      const profileById = new Map<string, Profile>((profileRows || []).map((row: any) => [String(row.id), row as Profile]));

      const { data: myConversationMembers, error: myConversationError } = await supabase
        .from('direct_conversation_members')
        .select('conversation_id')
        .eq('user_id', profile.id);
      if (myConversationError) {
        setErrorMessage(myConversationError.message || 'Could not load friend conversations.');
        setFriends([]);
        return;
      }

      const myConversationIds = Array.from(
        new Set((myConversationMembers || []).map((row: any) => String(row.conversation_id)).filter(Boolean)),
      );

      let conversationIdToFriendId = new Map<string, string>();
      let friendIdToConversationId = new Map<string, string>();
      if (myConversationIds.length > 0) {
        const [{ data: directConversations }, { data: conversationMembers }] = await Promise.all([
          supabase
            .from('direct_conversations')
            .select('id, is_group')
            .in('id', myConversationIds)
            .eq('is_group', false),
          supabase
            .from('direct_conversation_members')
            .select('conversation_id, user_id')
            .in('conversation_id', myConversationIds),
        ]);

        const directIds = new Set((directConversations || []).map((row: any) => String(row.id)));
        for (const row of conversationMembers || []) {
          const conversationId = String((row as any).conversation_id || '');
          const userId = String((row as any).user_id || '');
          if (!conversationId || !userId || !directIds.has(conversationId)) continue;
          if (userId === String(profile.id)) continue;
          if (!friendIds.includes(userId)) continue;
          if (!friendIdToConversationId.has(userId)) {
            friendIdToConversationId.set(userId, conversationId);
            conversationIdToFriendId.set(conversationId, userId);
          }
        }
      }

      let activeCallByConversationId = new Map<string, CallRow>();
      const conversationIds = Array.from(friendIdToConversationId.values());
      if (conversationIds.length > 0) {
        const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
        let callRows: any[] | null = null;
        let callRowsError: any = null;

        const modernResponse = await supabase
          .from('calls')
          .select('id, conversation_id, caller_id, callee_ids, state, video, metadata, created_at, expires_at')
          .in('conversation_id', conversationIds)
          .in('state', ['ringing', 'accepted'])
          .gte('created_at', since)
          .order('created_at', { ascending: false });

        if (modernResponse.error && isCallsModernSchemaMissingError(modernResponse.error)) {
          const legacyResponse = await supabase
            .from('calls')
            .select('id, room, caller_id, callee_id, status, accepted, metadata, created_at, updated_at')
            .in('room', conversationIds)
            .in('status', ['ringing', 'accepted'])
            .gte('created_at', since)
            .order('created_at', { ascending: false });
          callRows = legacyResponse.data as any[] | null;
          callRowsError = legacyResponse.error;
        } else {
          callRows = modernResponse.data as any[] | null;
          callRowsError = modernResponse.error;
        }

        if (callRowsError) {
          console.warn('Could not load active friend calls:', callRowsError);
        }

        for (const rawRow of (callRows || []) as any[]) {
          const row = normalizeCallRow(rawRow);
          if (!row) continue;
          const conversationId = String(row.conversation_id || '');
          if (!conversationId || activeCallByConversationId.has(conversationId)) continue;
          activeCallByConversationId.set(conversationId, {
            id: String(row.id),
            conversation_id: conversationId,
            caller_id: row.caller_id ? String(row.caller_id) : null,
            callee_ids: Array.isArray(row.callee_ids) ? row.callee_ids.map((id: any) => String(id)) : [],
            state: row.state,
            video: Boolean(row.video),
            created_at: String(row.created_at || ''),
          });
        }
      }

      const nextFriends: FriendWithConversation[] = [];
      for (const id of friendIds) {
        const friendProfile = profileById.get(id);
        if (!friendProfile) continue;
        const conversationId = friendIdToConversationId.get(id) || null;
        const activeCall = conversationId ? activeCallByConversationId.get(conversationId) || null : null;
        nextFriends.push({
          profile: friendProfile,
          conversationId,
          activeCall,
        });
      }

      nextFriends.sort((a, b) => {
        const aOnline = a.profile.status === 'online' ? 1 : 0;
        const bOnline = b.profile.status === 'online' ? 1 : 0;
        if (aOnline !== bOnline) return bOnline - aOnline;
        return String(a.profile.display_name || a.profile.username).localeCompare(
          String(b.profile.display_name || b.profile.username),
        );
      });

      setFriends(nextFriends);

      const pending: PendingFriendEntry[] = [];
      for (const id of incomingPendingIds) {
        const requestProfile = profileById.get(id);
        if (!requestProfile) continue;
        pending.push({ profile: requestProfile, direction: 'incoming' });
      }
      for (const id of outgoingPendingIds) {
        if (incomingPendingIds.includes(id)) continue;
        const requestProfile = profileById.get(id);
        if (!requestProfile) continue;
        pending.push({ profile: requestProfile, direction: 'outgoing' });
      }
      pending.sort((a, b) => {
        if (a.direction !== b.direction) return a.direction === 'incoming' ? -1 : 1;
        return String(a.profile.display_name || a.profile.username).localeCompare(
          String(b.profile.display_name || b.profile.username),
        );
      });
      setPendingFriends(pending);
    } catch (error: any) {
      setErrorMessage(error?.message || 'Could not load friends.');
      setFriends([]);
      setPendingFriends([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!profile?.id) return;
    void loadFriends();
  }, [profile?.id]);

  useEffect(() => {
    if (!profile?.id) return;
    const relationshipsChannel = supabase
      .channel(`friends:relationships:${profile.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_relationships',
          filter: `user_id=eq.${profile.id}`,
        },
        () => {
          void loadFriends();
        },
      )
      .subscribe();

    const periodicRefresh = setInterval(() => {
      void loadFriends();
    }, 18000);

    const onVisible = () => {
      if (!document.hidden) {
        void loadFriends();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(periodicRefresh);
      document.removeEventListener('visibilitychange', onVisible);
      supabase.removeChannel(relationshipsChannel);
    };
  }, [profile?.id]);

  async function ensureDirectConversation(targetUserId: string): Promise<string | null> {
    if (!profile?.id) return null;
    const existing = friends.find((entry) => String(entry.profile.id) === String(targetUserId));
    if (existing?.conversationId) return existing.conversationId;

    const { data: rpcConversationId, error: rpcError } = await (supabase as any).rpc('create_or_get_direct_conversation', {
      p_target_user_id: targetUserId,
    });
    if (!rpcError && rpcConversationId) {
      return String(rpcConversationId);
    }

    const { data: conversationRow, error: createConversationError } = await supabase
      .from('direct_conversations')
      .insert({ created_by: profile.id, is_group: false } as any)
      .select('id')
      .maybeSingle();
    if (createConversationError || !(conversationRow as any)?.id) return null;

    const conversationId = String((conversationRow as any).id);
    const { error: memberInsertError } = await supabase.from('direct_conversation_members').insert([
      { conversation_id: conversationId, user_id: profile.id, role: 'member', added_by: profile.id },
      { conversation_id: conversationId, user_id: targetUserId, role: 'member', added_by: profile.id },
    ] as any);
    if (memberInsertError) return null;
    return conversationId;
  }

  async function handleMessageFriend(targetUserId: string) {
    const conversationId = await ensureDirectConversation(targetUserId);
    if (!conversationId) {
      setErrorMessage('Could not open direct message.');
      return;
    }
    navigate(`/app/dm/${conversationId}`);
  }

  async function handleStartCall(targetUserId: string, video: boolean) {
    const conversationId = await ensureDirectConversation(targetUserId);
    if (!conversationId) {
      setErrorMessage('Could not open call route.');
      return;
    }
    navigate(`/app/dm/${conversationId}/call${video ? '?video=1' : ''}`);
  }

  async function handleRemoveFriend(targetUserId: string) {
    setRelationshipActionId(targetUserId);
    setErrorMessage('');
    try {
      const { error } = await supabase.rpc('remove_friend', {
        p_target_user_id: targetUserId,
      });
      if (error) {
        setErrorMessage(error.message || 'Could not remove friend.');
        return;
      }
      await loadFriends();
    } finally {
      setRelationshipActionId(null);
    }
  }

  async function handleAcceptFriendRequest(targetUserId: string) {
    setRelationshipActionId(targetUserId);
    setAddFriendMessage('');
    setErrorMessage('');
    try {
      const { error } = await supabase.rpc('respond_friend_request', {
        p_target_user_id: targetUserId,
        p_action: 'accept',
      });
      if (error) {
        setErrorMessage(error.message || 'Could not accept friend request.');
        return;
      }
      await loadFriends();
    } finally {
      setRelationshipActionId(null);
    }
  }

  async function handleDeclineFriendRequest(targetUserId: string) {
    setRelationshipActionId(targetUserId);
    setAddFriendMessage('');
    setErrorMessage('');
    try {
      const { error } = await supabase.rpc('respond_friend_request', {
        p_target_user_id: targetUserId,
        p_action: 'decline',
      });
      if (error) {
        setErrorMessage(error.message || 'Could not decline friend request.');
        return;
      }
      await loadFriends();
    } finally {
      setRelationshipActionId(null);
    }
  }

  async function handleCancelOutgoingRequest(targetUserId: string) {
    setRelationshipActionId(targetUserId);
    setAddFriendMessage('');
    setErrorMessage('');
    try {
      const { error } = await supabase.rpc('cancel_friend_request', {
        p_target_user_id: targetUserId,
      });
      if (error) {
        setErrorMessage(error.message || 'Could not cancel friend request.');
        return;
      }
      await loadFriends();
    } finally {
      setRelationshipActionId(null);
    }
  }

  async function handleSendFriendRequest() {
    if (!profile?.id) return;
    const normalized = normalizeUsername(addFriendInput);
    if (!normalized) {
      setAddFriendMessage('Enter a valid username.');
      return;
    }

    setAddFriendLoading(true);
    setAddFriendMessage('');
    setErrorMessage('');
    try {
      const { data: exactMatch, error: searchError } = await supabase
        .from('profiles')
        .select('*')
        .eq('username', normalized)
        .maybeSingle();

      if (searchError) {
        setAddFriendMessage(searchError.message || 'Could not search that username.');
        return;
      }
      if (!exactMatch) {
        setAddFriendMessage('No user found with that username.');
        return;
      }
      if (String((exactMatch as any).id) === String(profile.id)) {
        setAddFriendMessage('You cannot add yourself.');
        return;
      }

      const { data: requestState, error: requestError } = await supabase.rpc('send_friend_request', {
        p_target_user_id: (exactMatch as any).id,
      });
      if (requestError) {
        setAddFriendMessage(requestError.message || 'Could not send friend request.');
        return;
      }

      const state = String(requestState || '').trim();
      if (state === 'accepted') {
        setAddFriendMessage(`Request auto-accepted. You are now connected with @${(exactMatch as any).username}.`);
      } else if (state === 'already_friends') {
        setAddFriendMessage(`You are already connected with @${(exactMatch as any).username}.`);
      } else if (state === 'already_pending') {
        setAddFriendMessage(`Friend request is already pending with @${(exactMatch as any).username}.`);
      } else {
        setAddFriendMessage(`Friend request sent to @${(exactMatch as any).username}.`);
      }
      setAddFriendInput('');
      await loadFriends();
    } finally {
      setAddFriendLoading(false);
    }
  }

  const visibleFriends = activeTab === 'online' ? onlineFriends : friends;

  return (
    <AppShell showChannelSidebar={false} title="Friends">
      <div className="h-full flex min-h-0">
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="h-14 border-b border-surface-800 bg-surface-900 px-4 flex items-center gap-2">
            {([
              { id: 'online', label: 'Online' },
              { id: 'all', label: 'All' },
              { id: 'pending', label: 'Pending' },
              { id: 'add', label: 'Add Friend' },
            ] as { id: FriendsTab; label: string }[]).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  activeTab === tab.id
                    ? 'bg-nyptid-300/20 text-nyptid-200'
                    : 'text-surface-400 hover:text-surface-200 hover:bg-surface-800'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
            {errorMessage && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {errorMessage}
              </div>
            )}

            {activeTab === 'add' && (
              <div className="space-y-4">
                <div className="nyptid-card p-5">
                  <h2 className="text-xl font-bold text-surface-100 mb-1">Add Friend</h2>
                  <p className="text-surface-500 text-sm mb-4">Add people by their NCore username.</p>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-500" />
                      <input
                        value={addFriendInput}
                        onChange={(event) => setAddFriendInput(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            void handleSendFriendRequest();
                          }
                        }}
                        placeholder="You can add friends with their NCore username"
                        className="nyptid-input pl-9"
                        maxLength={32}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        void handleSendFriendRequest();
                      }}
                      disabled={addFriendLoading}
                      className="nyptid-btn-primary text-sm"
                    >
                      <UserPlus size={14} />
                      {addFriendLoading ? 'Sending...' : 'Send Friend Request'}
                    </button>
                  </div>
                  {addFriendMessage && (
                    <div className="mt-3 text-xs text-surface-300">{addFriendMessage}</div>
                  )}
                </div>

                <div className="nyptid-card p-5">
                  <h3 className="text-lg font-bold text-surface-100 mb-1">Other Places to Make Friends</h3>
                  <p className="text-surface-500 text-sm mb-4">
                    Explore public servers and meet people in gaming, anime, music, coding, and more.
                  </p>
                  <button
                    type="button"
                    onClick={() => navigate('/app/discover')}
                    className="w-full md:w-auto nyptid-btn-secondary"
                  >
                    <Plus size={14} />
                    Explore Discoverable Servers
                  </button>
                </div>
              </div>
            )}

            {activeTab !== 'add' && (
              <div className="space-y-2">
                {loading ? (
                  <div className="text-sm text-surface-500">Loading friends...</div>
                ) : activeTab === 'pending' ? (
                  pendingFriends.length === 0 ? (
                    <div className="nyptid-card p-6 text-sm text-surface-500">
                      No pending friend requests right now.
                    </div>
                  ) : pendingFriends.map((entry) => {
                    const requestUser = entry.profile;
                    const requestName = requestUser.display_name || requestUser.username;
                    const isIncoming = entry.direction === 'incoming';
                    return (
                      <div
                        key={`pending:${entry.direction}:${requestUser.id}`}
                        className="nyptid-card px-4 py-3 flex items-center gap-3"
                      >
                        <Avatar src={requestUser.avatar_url || undefined} name={requestName} status={requestUser.status} size="md" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-surface-100 truncate">{requestName}</div>
                          <div className="text-xs text-surface-500 truncate">@{requestUser.username}</div>
                          <div className="text-xs text-surface-400 truncate mt-0.5 flex items-center gap-1.5">
                            <Clock3 size={12} className="text-amber-300" />
                            {isIncoming ? 'Incoming friend request' : 'Outgoing friend request'}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {isIncoming ? (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  void handleAcceptFriendRequest(requestUser.id);
                                }}
                                disabled={relationshipActionId === requestUser.id}
                                className="px-3 h-9 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30 transition-colors text-xs font-semibold flex items-center gap-1.5 disabled:opacity-60"
                                title="Accept request"
                              >
                                <UserCheck size={13} />
                                Accept
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  void handleDeclineFriendRequest(requestUser.id);
                                }}
                                disabled={relationshipActionId === requestUser.id}
                                className="px-3 h-9 rounded-lg bg-surface-800 hover:bg-red-500/20 text-surface-300 hover:text-red-300 transition-colors text-xs font-semibold flex items-center gap-1.5 disabled:opacity-60"
                                title="Decline request"
                              >
                                <UserX size={13} />
                                Decline
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                void handleCancelOutgoingRequest(requestUser.id);
                              }}
                              disabled={relationshipActionId === requestUser.id}
                              className="px-3 h-9 rounded-lg bg-surface-800 hover:bg-red-500/20 text-surface-300 hover:text-red-300 transition-colors text-xs font-semibold flex items-center gap-1.5 disabled:opacity-60"
                              title="Cancel request"
                            >
                              <UserX size={13} />
                              Cancel
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                ) : visibleFriends.length === 0 ? (
                  <div className="nyptid-card p-6 text-sm text-surface-500">
                    {activeTab === 'online'
                      ? 'No friends are online right now.'
                      : 'No friends yet. Use Add Friend to connect with people.'}
                  </div>
                ) : (
                  visibleFriends.map((entry) => {
                    const friend = entry.profile;
                    const friendName = friend.display_name || friend.username;
                    const activity = (friend as any).activity as { type?: string; name?: string; details?: string } | null | undefined;
                    const activityText = activity?.name
                      ? `${activity.type === 'playing' ? 'Playing' : activity.type === 'streaming' ? 'Streaming' : activity.type === 'listening' ? 'Listening to' : activity.type === 'watching' ? 'Watching' : ''} ${activity.name}`.trim()
                      : null;
                    const statusText = activityText
                      || (friend.custom_status
                        ? `${friend.custom_status_emoji ? `${friend.custom_status_emoji} ` : ''}${friend.custom_status}`
                        : friend.bio || (friend.status === 'online' ? 'Online' : `Last seen ${formatRelativeTime(friend.last_seen)}`));
                    return (
                      <div
                        key={friend.id}
                        className="nyptid-card px-4 py-3 flex items-center gap-3"
                      >
                        <Avatar src={friend.avatar_url || undefined} name={friendName} status={friend.status} size="md" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-surface-100 truncate">{friendName}</div>
                          <div className="text-xs text-surface-500 truncate">@{friend.username}</div>
                          {activityText ? (
                            <div className="text-xs text-nyptid-300 truncate mt-0.5">{activityText}{activity?.details ? ` - ${activity.details}` : ''}</div>
                          ) : (
                            <div className="text-xs text-surface-400 truncate mt-0.5">{statusText || 'No status set.'}</div>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              void handleMessageFriend(friend.id);
                            }}
                            className="w-9 h-9 rounded-lg bg-surface-800 hover:bg-surface-700 text-surface-300 hover:text-surface-100 transition-colors flex items-center justify-center"
                            title="Message"
                          >
                            <MessageSquare size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              void handleStartCall(friend.id, false);
                            }}
                            className="w-9 h-9 rounded-lg bg-surface-800 hover:bg-surface-700 text-surface-300 hover:text-surface-100 transition-colors flex items-center justify-center"
                            title="Start voice call"
                          >
                            <Phone size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              void handleStartCall(friend.id, true);
                            }}
                            className="w-9 h-9 rounded-lg bg-surface-800 hover:bg-surface-700 text-surface-300 hover:text-surface-100 transition-colors flex items-center justify-center"
                            title="Start video call"
                          >
                            <Video size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              void handleRemoveFriend(friend.id);
                            }}
                            disabled={relationshipActionId === friend.id}
                            className="w-9 h-9 rounded-lg bg-surface-800 hover:bg-red-500/20 text-surface-300 hover:text-red-300 transition-colors flex items-center justify-center disabled:opacity-60"
                            title="Remove friend"
                          >
                            <UserRoundMinus size={15} />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>

        {(activeTab === 'online' || activeTab === 'all') && (
          <aside className="w-[320px] border-l border-surface-800 bg-surface-900/70 hidden xl:flex xl:flex-col">
            <div className="p-4 border-b border-surface-800">
              <h3 className="text-lg font-bold text-surface-100">Active Now</h3>
              <p className="text-xs text-surface-500 mt-1">Live friend presence, streams, and joinable calls.</p>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {activeNow.length === 0 ? (
                <div className="text-xs text-surface-500">No live activity from friends yet.</div>
              ) : activeNow.map((entry) => {
                const friend = entry.profile;
                const friendName = friend.display_name || friend.username;
                const inCall = Boolean(entry.activeCall);
                const isLive = Boolean(entry.activeCall && entry.activeCall.state === 'accepted');
                const activityLabel = inCall
                  ? (entry.activeCall?.video ? 'Sharing video / screen' : 'In voice call')
                  : friend.custom_status || friend.bio || 'Active on NCore';

                return (
                  <div key={`active:${friend.id}`} className="rounded-xl border border-surface-700 bg-surface-800/60 p-3">
                    <div className="flex items-center gap-2">
                      <Avatar src={friend.avatar_url || undefined} name={friendName} status={friend.status} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-surface-100 truncate">{friendName}</div>
                        <div className="text-xs text-surface-400 truncate flex items-center gap-1.5">
                          {inCall ? <MonitorPlay size={12} className="text-green-300" /> : <Gamepad2 size={12} className="text-surface-500" />}
                          <span>{activityLabel}</span>
                        </div>
                      </div>
                      {isLive && (
                        <span className="px-2 py-0.5 rounded-full bg-red-500/20 border border-red-500/40 text-[10px] font-bold text-red-300">
                          LIVE
                        </span>
                      )}
                    </div>
                    <div className="mt-3 rounded-lg border border-surface-700 bg-surface-900/70 p-2.5">
                      {entry.activeCall ? (
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs text-surface-300">
                            {entry.activeCall.state === 'accepted' ? 'Call in progress' : 'Call ringing'}
                          </div>
                          {entry.conversationId && (
                            <button
                              type="button"
                              onClick={() => navigate(`/app/dm/${entry.conversationId}/call${entry.activeCall?.video ? '?video=1' : ''}`)}
                              className="nyptid-btn-secondary px-2.5 py-1.5 text-xs"
                            >
                              <Phone size={12} />
                              Join
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="text-xs text-surface-500 flex items-center gap-1.5">
                          <CheckCircle2 size={12} className="text-green-400" />
                          Online now
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </aside>
        )}
      </div>
    </AppShell>
  );
}
