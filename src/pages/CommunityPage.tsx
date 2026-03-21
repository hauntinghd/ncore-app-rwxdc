import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Users, MessageSquare, Settings, UserPlus, UserMinus, Crown, Shield, ChevronRight } from 'lucide-react';
import { AppShell } from '../components/layout/AppShell';
import { Avatar } from '../components/ui/Avatar';
import { Badge } from '../components/ui/Badge';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import type { Community, CommunityMember, CommunityServerCustomization, Profile } from '../lib/types';
import { getCommunityRoleBadge } from '../lib/utils';
import { detectCommunityTemplate, getCommunityBlueprint } from '../lib/communityBlueprints';

interface MemberContextMenuState {
  x: number;
  y: number;
  member: CommunityMember;
  targetUser: Profile | null;
}

export function CommunityPage() {
  const { communityId } = useParams<{ communityId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [community, setCommunity] = useState<Community | null>(null);
  const [members, setMembers] = useState<CommunityMember[]>([]);
  const requestedTab = String(searchParams.get('tab') || '').toLowerCase();
  const inviteCodeFromUrl = String(searchParams.get('invite') || '').trim();
  const initialTab: 'overview' | 'members' = requestedTab === 'members' ? 'members' : 'overview';
  const [tab, setTab] = useState<'overview' | 'members'>(initialTab);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [openingChat, setOpeningChat] = useState(false);
  const [transferringOwnerId, setTransferringOwnerId] = useState<string | null>(null);
  const [customization, setCustomization] = useState<CommunityServerCustomization | null>(null);
  const [memberContextMenu, setMemberContextMenu] = useState<MemberContextMenuState | null>(null);
  const [userRelationships, setUserRelationships] = useState<Record<string, 'friend' | 'ignored' | 'blocked' | 'friend_pending_outgoing' | 'friend_pending_incoming'>>({});
  const [invitableCommunities, setInvitableCommunities] = useState<Array<{ id: string; name: string }>>([]);
  const memberUserIdsRef = useRef<Set<string>>(new Set());

  async function fetchHydratedMembers(targetCommunityId: string): Promise<CommunityMember[]> {
    const { data: membersData, error: membersError } = await supabase
      .from('community_members')
      .select('*')
      .eq('community_id', targetCommunityId)
      .order('role')
      .limit(500);

    if (membersError) {
      console.warn('Community member hydration failed:', membersError);
      return [];
    }

    const memberRows = ((membersData || []) as CommunityMember[]).map((member: any) => ({
      ...member,
      profile: member.profile || member.profiles || null,
    })) as CommunityMember[];

    const missingProfileIds = Array.from(
      new Set(
        memberRows
          .filter((member: any) => !member.profile && member.user_id)
          .map((member) => String(member.user_id)),
      ),
    );

    if (missingProfileIds.length === 0) return memberRows;

    const { data: profileRows, error: profileRowsError } = await supabase
      .from('profiles')
      .select('*')
      .in('id', missingProfileIds);

    if (profileRowsError || !profileRows) {
      if (profileRowsError) {
        console.warn('Community profile hydration failed:', profileRowsError);
      }
      return memberRows;
    }

    const profileById = new Map((profileRows as any[]).map((row) => [String(row.id), row]));
    return memberRows.map((member: any) => ({
      ...member,
      profile: member.profile || profileById.get(String(member.user_id)) || null,
    })) as CommunityMember[];
  }

  function applyMembersToState(hydratedMembers: CommunityMember[]) {
    setMembers(hydratedMembers);
    setCommunity((prev) => {
      if (!prev) return prev;
      const myMembership = hydratedMembers.find((member) => member.user_id === profile?.id);
      return {
        ...prev,
        member_count: hydratedMembers.length,
        is_member: Boolean(myMembership),
        member_role: myMembership?.role,
      };
    });
  }

  async function refreshCommunityMembersSnapshot(targetCommunityId: string) {
    const hydratedMembers = await fetchHydratedMembers(targetCommunityId);
    applyMembersToState(hydratedMembers);
  }

  useEffect(() => {
    if (!communityId) return;
    let cancelled = false;

    void (async () => {
      setLoading(true);
      const [commRes, customizationRes, hydratedMembers] = await Promise.all([
        supabase
          .from('communities')
          .select('*')
          .eq('id', communityId)
          .maybeSingle(),
        supabase
          .from('community_server_customizations')
          .select('*')
          .eq('community_id', communityId)
          .maybeSingle(),
        fetchHydratedMembers(communityId),
      ]);

      if (cancelled) return;

      if (commRes.data) {
        const comm = commRes.data as Community;
        const myMembership = hydratedMembers.find((member) => member.user_id === profile?.id);
        setCommunity({
          ...comm,
          member_count: hydratedMembers.length,
          is_member: !!myMembership,
          member_role: myMembership?.role,
        });
      } else {
        setCommunity(null);
      }

      setMembers(hydratedMembers);
      setCustomization(customizationRes.data ? customizationRes.data as CommunityServerCustomization : null);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [communityId, profile?.id]);

  useEffect(() => {
    memberUserIdsRef.current = new Set(
      members.map((member) => String(member.user_id)).filter(Boolean),
    );
  }, [members]);

  useEffect(() => {
    if (!communityId) return;
    let cancelled = false;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase
      .channel(`community:members:${communityId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'community_members',
          filter: `community_id=eq.${communityId}`,
        },
        () => {
          if (refreshTimer) clearTimeout(refreshTimer);
          refreshTimer = setTimeout(() => {
            if (cancelled) return;
            void refreshCommunityMembersSnapshot(communityId);
          }, 140);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      supabase.removeChannel(channel);
    };
  }, [communityId, profile?.id]);

  useEffect(() => {
    if (!communityId) return;
    const channel = supabase
      .channel(`community:profiles:${communityId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
        },
        (payload) => {
          const updatedProfile = payload.new as any;
          const updatedProfileId = String(updatedProfile?.id || '').trim();
          if (!updatedProfileId || !memberUserIdsRef.current.has(updatedProfileId)) return;
          setMembers((prev) => prev.map((member: any) => (
            String(member.user_id) === updatedProfileId
              ? { ...member, profile: { ...(member.profile || {}), ...updatedProfile } }
              : member
          )) as CommunityMember[]);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [communityId]);

  useEffect(() => {
    const next = String(searchParams.get('tab') || '').toLowerCase();
    if (next === 'overview' || next === 'members') {
      setTab(next as 'overview' | 'members');
      return;
    }
    if (tab !== 'overview') {
      setTab('overview');
    }
  }, [searchParams, tab]);

  function getMemberProfile(member: CommunityMember) {
    const raw = member as any;
    return raw.profile || raw.profiles || null;
  }

  function getNotesStorageKey(): string | null {
    if (!profile?.id) return null;
    return `ncore.dm.notes.${profile.id}`;
  }

  function readFriendNotes(): Record<string, string> {
    const storageKey = getNotesStorageKey();
    if (!storageKey) return {};
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function writeFriendNotes(next: Record<string, string>) {
    const storageKey = getNotesStorageKey();
    if (!storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Ignore local storage write failures.
    }
  }

  function createInviteCode() {
    const token = Math.random().toString(36).slice(2, 8);
    const stamp = Date.now().toString(36).slice(-4);
    return `${token}${stamp}`.toUpperCase();
  }

  async function ensureDirectConversation(targetUserId: string): Promise<string | null> {
    if (!profile?.id) return null;
    const normalizedTargetId = String(targetUserId || '').trim();
    if (!normalizedTargetId || normalizedTargetId === String(profile.id)) return null;

    const { data: rpcConversationId, error: rpcError } = await (supabase as any).rpc('create_or_get_direct_conversation', {
      p_target_user_id: normalizedTargetId,
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
      { conversation_id: conversationId, user_id: normalizedTargetId, role: 'member', added_by: profile.id },
    ] as any);
    if (memberInsertError) return null;

    return conversationId;
  }

  async function getPrimaryServerTextChannelId(targetCommunityId: string): Promise<string | null> {
    const { data: existingServers } = await supabase
      .from('servers')
      .select('id')
      .eq('community_id', targetCommunityId)
      .order('id', { ascending: true })
      .limit(1);

    const serverId = (existingServers && existingServers[0] && (existingServers[0] as any).id)
      ? String((existingServers[0] as any).id)
      : null;
    if (!serverId) return null;

    const { data: existingChannel } = await supabase
      .from('channels')
      .select('id')
      .eq('server_id', serverId)
      .in('channel_type', ['text', 'announcement'])
      .order('order_index', { ascending: true })
      .limit(1)
      .maybeSingle();

    return (existingChannel as any)?.id ? String((existingChannel as any).id) : null;
  }

  function openMemberContextMenu(event: React.MouseEvent, member: CommunityMember) {
    event.preventDefault();
    event.stopPropagation();
    setMemberContextMenu({
      x: event.clientX,
      y: event.clientY,
      member,
      targetUser: getMemberProfile(member) as Profile | null,
    });
  }

  async function handleMentionMember(targetUser: Profile) {
    const mention = `@${targetUser.username} `;
    if (communityId) {
      try {
        localStorage.setItem(`ncore.chat.prefill.${communityId}`, mention);
      } catch {
        // Ignore storage failures and still attempt navigation.
      }
      const primaryChannelId = await getPrimaryServerTextChannelId(communityId);
      if (primaryChannelId) {
        navigate(`/app/community/${communityId}/channel/${primaryChannelId}`);
        return;
      }
      await handleOpenCommunityChat();
      return;
    }

    try {
      await navigator.clipboard.writeText(mention);
      window.alert(`Mention copied: ${mention}`);
    } catch {
      window.prompt('Copy this mention:', mention);
    }
  }

  function handleAddNote(targetUser: Profile) {
    const notes = readFriendNotes();
    const existing = notes[targetUser.id] || '';
    const next = window.prompt(`Add a private note for ${targetUser.display_name || targetUser.username}:`, existing);
    if (next === null) return;
    const trimmed = next.trim();
    if (!trimmed) {
      delete notes[targetUser.id];
    } else {
      notes[targetUser.id] = trimmed;
    }
    writeFriendNotes(notes);
  }

  async function handleInviteToServer(targetUser: Profile) {
    if (!profile?.id) return;
    if (invitableCommunities.length === 0) {
      window.alert('You need owner/admin access in at least one server to create invite links.');
      return;
    }

    let selectedServer = invitableCommunities[0];
    if (invitableCommunities.length > 1) {
      const menu = invitableCommunities.map((item, index) => `${index + 1}) ${item.name}`).join('\n');
      const rawSelection = window.prompt(`Invite @${targetUser.username} to which server?\n${menu}`, '1');
      if (rawSelection === null) return;
      const index = Math.max(Number(rawSelection) - 1, 0);
      if (!Number.isFinite(index) || !invitableCommunities[index]) {
        window.alert('Invalid server selection.');
        return;
      }
      selectedServer = invitableCommunities[index];
    }

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: inviteRow, error: inviteError } = await supabase
      .from('community_invites')
      .insert({
        community_id: selectedServer.id,
        code: createInviteCode(),
        max_uses: 1,
        expires_at: expiresAt,
        created_by: profile.id,
      } as any)
      .select('code')
      .maybeSingle();

    if (inviteError || !(inviteRow as any)?.code) {
      window.alert(inviteError?.message || 'Could not create invite right now.');
      return;
    }

    const inviteLink = `${window.location.origin}/app/community/${selectedServer.id}?invite=${encodeURIComponent(String((inviteRow as any).code))}`;

    try {
      await navigator.clipboard.writeText(inviteLink);
    } catch {
      // Clipboard can fail in some desktop contexts; we still DM below.
    }

    const conversationId = await ensureDirectConversation(targetUser.id);
    if (conversationId) {
      await supabase.from('direct_messages').insert({
        conversation_id: conversationId,
        sender_id: profile.id,
        content: `Join me in ${selectedServer.name}: ${inviteLink}`,
      } as any);
    }

    window.alert(`Invite created for ${selectedServer.name}. Link copied and sent in DM.`);
  }

  async function handleSendFriendRequest(targetUserId: string): Promise<string> {
    const { data, error } = await supabase.rpc('send_friend_request', {
      p_target_user_id: targetUserId,
    });
    if (error) {
      window.alert(error.message || 'Could not send friend request.');
      return '';
    }
    const state = String(data || '').trim();
    if (state === 'accepted') {
      setUserRelationships((prev) => ({ ...prev, [targetUserId]: 'friend' }));
    } else if (state === 'pending' || state === 'already_pending') {
      setUserRelationships((prev) => ({ ...prev, [targetUserId]: 'friend_pending_outgoing' }));
    } else if (state === 'already_friends') {
      setUserRelationships((prev) => ({ ...prev, [targetUserId]: 'friend' }));
    }
    return state;
  }

  async function handleSetRelationship(targetUserId: string, nextRelationship: 'ignored' | 'blocked') {
    const { error } = await supabase.rpc('set_user_relationship', {
      p_target_user_id: targetUserId,
      p_next_relationship: nextRelationship,
    });
    if (error) {
      window.alert(error.message || `Could not update relationship to ${nextRelationship}.`);
      return;
    }
    setUserRelationships((prev) => ({ ...prev, [targetUserId]: nextRelationship }));
  }

  useEffect(() => {
    if (!memberContextMenu) return;
    const onWindowClick = () => setMemberContextMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMemberContextMenu(null);
      }
    };
    window.addEventListener('click', onWindowClick);
    window.addEventListener('contextmenu', onWindowClick);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('click', onWindowClick);
      window.removeEventListener('contextmenu', onWindowClick);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [memberContextMenu]);

  useEffect(() => {
    if (!profile?.id) return;
    const memberIds = Array.from(
      new Set(
        members
          .map((member) => String(member.user_id || '').trim())
          .filter((id) => Boolean(id) && id !== String(profile.id)),
      ),
    );
    if (memberIds.length === 0) {
      setUserRelationships({});
      return;
    }

    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from('user_relationships')
        .select('target_user_id, relationship')
        .eq('user_id', profile.id)
        .in('target_user_id', memberIds);

      if (cancelled || error) return;
      const next: Record<string, 'friend' | 'ignored' | 'blocked' | 'friend_pending_outgoing' | 'friend_pending_incoming'> = {};
      for (const row of (data || []) as any[]) {
        const targetId = String(row.target_user_id || '').trim();
        const relationship = String(row.relationship || '').trim() as 'friend' | 'ignored' | 'blocked' | 'friend_pending_outgoing' | 'friend_pending_incoming';
        if (!targetId) continue;
        if (
          relationship === 'friend'
          || relationship === 'ignored'
          || relationship === 'blocked'
          || relationship === 'friend_pending_outgoing'
          || relationship === 'friend_pending_incoming'
        ) {
          next[targetId] = relationship;
        }
      }
      setUserRelationships(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [members, profile?.id]);

  useEffect(() => {
    if (!profile?.id) return;
    let cancelled = false;
    void (async () => {
      const { data: memberRows, error: membershipError } = await supabase
        .from('community_members')
        .select('community_id, role')
        .eq('user_id', profile.id)
        .in('role', ['owner', 'admin']);

      if (cancelled || membershipError || !memberRows) return;
      const targetCommunityIds = Array.from(
        new Set(
          (memberRows as any[])
            .map((row) => String(row.community_id || '').trim())
            .filter(Boolean),
        ),
      );
      if (targetCommunityIds.length === 0) {
        setInvitableCommunities([]);
        return;
      }

      const { data: communitiesData, error: communitiesError } = await supabase
        .from('communities')
        .select('id, name')
        .in('id', targetCommunityIds)
        .order('name', { ascending: true });

      if (cancelled || communitiesError || !communitiesData) return;
      setInvitableCommunities(
        (communitiesData as any[])
          .map((row) => ({ id: String(row.id), name: String(row.name || 'Untitled Server') }))
          .filter((row) => Boolean(row.id)),
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [profile?.id]);

  async function handleJoin() {
    if (!profile || !community) return;
    setJoining(true);
    if (customization?.invite_only) {
      const suppliedCode = inviteCodeFromUrl
        || String(window.prompt('This server is invite-only. Paste your invite code to join.') || '').trim();
      if (!suppliedCode) {
        setJoining(false);
        return;
      }
      const { error: inviteJoinError } = await supabase.rpc('join_community_with_invite', {
        p_code: suppliedCode,
        p_community_id: community.id,
      } as any);
      if (inviteJoinError) {
        window.alert(`Join failed: ${inviteJoinError.message}`);
        setJoining(false);
        return;
      }
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('invite');
        return next;
      }, { replace: true });
    } else {
      const { error: joinError } = await supabase.from('community_members').insert({
        community_id: community.id,
        user_id: profile.id,
        role: 'member',
      });
      if (joinError) {
        window.alert(`Join failed: ${joinError.message}`);
        setJoining(false);
        return;
      }
    }
    await refreshCommunityMembersSnapshot(community.id);
    setJoining(false);
  }

  async function handleLeave() {
    if (!profile || !community) return;
    await supabase.from('community_members').delete()
      .eq('community_id', community.id)
      .eq('user_id', profile.id);
    await refreshCommunityMembersSnapshot(community.id);
  }

  async function handleTransferOwnership(targetUserId: string) {
    if (!community || !profile) return;
    if (community.owner_id !== profile.id) return;
    if (!targetUserId || targetUserId === profile.id) return;

    const targetMember = members.find((member) => member.user_id === targetUserId);
    const targetProfile = targetMember ? getMemberProfile(targetMember) : null;
    const targetName = targetProfile?.display_name || targetProfile?.username || 'this member';
    const confirmed = window.confirm(`Transfer community ownership to ${targetName}? You will become admin.`);
    if (!confirmed) return;

    setTransferringOwnerId(targetUserId);
    try {
      const { error } = await supabase.rpc('transfer_community_ownership', {
        p_community_id: community.id,
        p_target_user_id: targetUserId,
      });
      if (error) {
        console.error('Ownership transfer failed:', error);
        return;
      }

      setCommunity((prev) => prev ? { ...prev, owner_id: targetUserId, member_role: 'admin' } : prev);
      setMembers((prev) => prev.map((member) => {
        if (member.user_id === targetUserId) return { ...member, role: 'owner' } as CommunityMember;
        if (member.user_id === profile.id) return { ...member, role: 'admin' } as CommunityMember;
        return member;
      }));
    } finally {
      setTransferringOwnerId(null);
    }
  }

  if (loading) {
    return (
      <AppShell activeCommunityId={communityId} showChannelSidebar={true}>
        <div className="flex items-center justify-center h-full">
          <div className="w-8 h-8 border-2 border-nyptid-300 border-t-transparent rounded-full animate-spin" />
        </div>
      </AppShell>
    );
  }

  if (!community) {
    return (
      <AppShell showChannelSidebar={false}>
        <div className="flex items-center justify-center h-full text-surface-400">
          Community not found
        </div>
      </AppShell>
    );
  }

  const isAdmin = community.owner_id === profile?.id || community.member_role === 'owner' || community.member_role === 'admin' || profile?.platform_role === 'owner';
  const isCommunityOwner = community.owner_id === profile?.id;

  async function handleOpenCommunityChat() {
    if (!communityId || !community || openingChat) return;
    setOpeningChat(true);
    try {
      let serverId: string | null = null;
      const { data: existingServers, error: serverLookupError } = await supabase
        .from('servers')
        .select('id')
        .eq('community_id', communityId)
        .order('id', { ascending: true })
        .limit(1);

      if (serverLookupError) {
        console.warn('Server lookup failed when opening community chat:', serverLookupError);
      }

      if ((existingServers || []).length > 0) {
        serverId = String((existingServers as any[])[0].id);
      }

      if (!serverId && isAdmin && profile) {
        const { data: createdServer, error: createServerError } = await supabase
          .from('servers')
          .insert({
            community_id: communityId,
            name: community.name,
            owner_id: profile.id,
          } as any)
          .select('id')
          .single();

        if (createServerError) {
          console.warn('Server auto-create failed when opening community chat:', createServerError);
        } else if ((createdServer as any)?.id) {
          serverId = String((createdServer as any).id);
        }
      }

      if (!serverId) {
        navigate(isAdmin ? `/app/community/${communityId}/settings` : `/app/community/${communityId}`);
        return;
      }

      const findPrimaryTextChannel = async (): Promise<string | null> => {
        const { data: existingChannel, error: channelLookupError } = await supabase
          .from('channels')
          .select('id')
          .eq('server_id', serverId)
          .in('channel_type', ['text', 'announcement'])
          .order('order_index', { ascending: true })
          .limit(1)
          .maybeSingle();
        if (channelLookupError) {
          console.warn('Channel lookup failed when opening community chat:', channelLookupError);
        }
        return (existingChannel as any)?.id ? String((existingChannel as any).id) : null;
      };

      let targetChannelId = await findPrimaryTextChannel();

      if (!targetChannelId && isAdmin) {
        const { data: existingCategory, error: categoryLookupError } = await supabase
          .from('channel_categories')
          .select('id')
          .eq('server_id', serverId)
          .order('order_index', { ascending: true })
          .limit(1);
        if (categoryLookupError) {
          console.warn('Category lookup failed when opening community chat:', categoryLookupError);
        }

        if ((existingCategory || []).length === 0) {
          const templateId = detectCommunityTemplate(community.name, community.slug);
          const blueprint = getCommunityBlueprint(templateId);

          for (let categoryIndex = 0; categoryIndex < blueprint.categories.length; categoryIndex += 1) {
            const category = blueprint.categories[categoryIndex];
            const { data: createdCategory, error: createCategoryError } = await supabase
              .from('channel_categories')
              .insert({
                server_id: serverId,
                name: category.name,
                order_index: categoryIndex,
              } as any)
              .select('id')
              .maybeSingle();
            if (createCategoryError || !(createdCategory as any)?.id) {
              console.warn('Category auto-create failed when opening community chat:', createCategoryError);
              continue;
            }

            const categoryId = String((createdCategory as any).id);
            const channels = category.channels.map((channel, channelIndex) => ({
              server_id: serverId,
              category_id: categoryId,
              name: channel.name,
              channel_type: channel.channel_type,
              order_index: channelIndex,
            }));

            if (channels.length > 0) {
              const { error: createChannelError } = await supabase
                .from('channels')
                .insert(channels as any);
              if (createChannelError) {
                console.warn('Channel auto-create failed when opening community chat:', createChannelError);
              }
            }
          }
        }

        targetChannelId = await findPrimaryTextChannel();

        if (!targetChannelId) {
          const { data: createdChannel, error: createChannelError } = await supabase
            .from('channels')
            .insert({
              server_id: serverId,
              category_id: null,
              name: 'general',
              channel_type: 'text',
              order_index: 0,
            } as any)
            .select('id')
            .maybeSingle();
          if (createChannelError) {
            console.warn('Channel auto-create failed when opening community chat:', createChannelError);
          } else if ((createdChannel as any)?.id) {
            targetChannelId = String((createdChannel as any).id);
          }
        }
      }

      if (targetChannelId) {
        navigate(`/app/community/${communityId}/channel/${targetChannelId}`);
      } else {
        navigate(isAdmin ? `/app/community/${communityId}/settings` : `/app/community/${communityId}`);
      }
    } finally {
      setOpeningChat(false);
    }
  }

  return (
    <AppShell activeCommunityId={communityId} title={community.name}>
      <div className="h-full overflow-y-auto">
        <div className="relative">
          <div
            className="h-32 md:h-48"
            style={{
              backgroundImage: `linear-gradient(135deg, ${customization?.gradient_start || '#04111f'}, ${customization?.gradient_end || '#151c28'})`,
            }}
          >
            {community.banner_url && (
              <img src={community.banner_url} alt="" className="w-full h-full object-cover" />
            )}
          </div>

          <div className="max-w-4xl mx-auto px-6">
            <div className="flex items-end gap-4 -mt-8 mb-4">
              <div className="w-20 h-20 rounded-2xl border-4 border-surface-900 bg-gradient-to-br from-nyptid-800 to-nyptid-950 flex items-center justify-center text-2xl font-black text-nyptid-300 flex-shrink-0">
                {community.icon_url ? (
                  <img src={community.icon_url} alt="" className="w-full h-full rounded-xl object-cover" />
                ) : (
                  community.name.slice(0, 2).toUpperCase()
                )}
              </div>
              <div className="flex-1 min-w-0 pb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-2xl font-black text-surface-100">{community.name}</h1>
                  <Badge>{community.category}</Badge>
                  {community.is_featured && <Badge variant="warning">Featured</Badge>}
                </div>
                <div className="flex items-center gap-4 text-sm text-surface-400 mt-1">
                  <span className="flex items-center gap-1"><Users size={13} /> {members.length.toLocaleString()} members</span>
                </div>
              </div>
              <div className="flex items-center gap-2 pb-2">
                {community.is_member ? (
                  <>
                    <button
                      onClick={handleOpenCommunityChat}
                      disabled={openingChat}
                      className="nyptid-btn-primary"
                    >
                      <MessageSquare size={16} />
                      {openingChat ? 'Opening...' : 'Chat'}
                    </button>
                    {isAdmin && (
                      <button
                        onClick={() => navigate(`/app/community/${communityId}/settings`)}
                        className="nyptid-btn-secondary"
                      >
                        <Settings size={16} />
                      </button>
                    )}
                    {community.owner_id !== profile?.id && (
                      <button onClick={handleLeave} className="nyptid-btn-ghost text-red-400 hover:bg-red-500/10">
                        <UserMinus size={16} />
                      </button>
                    )}
                  </>
                ) : (
                  <button onClick={handleJoin} disabled={joining} className="nyptid-btn-primary">
                    <UserPlus size={16} />
                    {joining ? 'Joining...' : customization?.invite_only ? 'Join with Invite' : 'Join Community'}
                  </button>
                )}
              </div>
            </div>

            {community.description && (
              <p className="text-surface-400 mb-6">{community.description}</p>
            )}
            {customization?.server_tagline && (
              <p className="text-sm mb-6" style={{ color: customization.accent_color || '#00c8ff' }}>
                {customization.server_tagline}
              </p>
            )}

            <div className="flex gap-1 border-b border-surface-700 mb-6">
              {(['overview', 'members'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => {
                    setTab(t);
                    setSearchParams((prev) => {
                      const next = new URLSearchParams(prev);
                      if (t === 'overview') {
                        next.delete('tab');
                      } else {
                        next.set('tab', t);
                      }
                      return next;
                    }, { replace: true });
                  }}
                  className={`px-4 py-2.5 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
                    tab === t
                      ? 'text-nyptid-300 border-nyptid-300'
                      : 'text-surface-400 border-transparent hover:text-surface-200'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            {tab === 'overview' && (
              <div className="grid md:grid-cols-3 gap-6 pb-8">
                <div className="md:col-span-2 space-y-4">
                  <h2 className="font-bold text-surface-100">Server Overview</h2>
                  <div className="nyptid-card p-5 space-y-3">
                    <p className="text-surface-300">
                      {community.description || 'No description has been set for this server yet.'}
                    </p>
                    {customization?.welcome_message && (
                      <div className="rounded-lg border border-surface-700 bg-surface-900/60 px-3 py-2">
                        <div className="text-xs uppercase tracking-wide text-surface-500 mb-1">Welcome Message</div>
                        <p className="text-sm text-surface-300">{customization.welcome_message}</p>
                      </div>
                    )}
                    {customization?.onboarding_steps && customization.onboarding_steps.length > 0 && (
                      <div>
                        <div className="text-xs uppercase tracking-wide text-surface-500 mb-1">Getting Started</div>
                        <ul className="list-disc ml-5 space-y-1 text-sm text-surface-400">
                          {customization.onboarding_steps.slice(0, 5).map((step, index) => (
                            <li key={`${step}-${index}`}>{step}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <h2 className="font-bold text-surface-100 mb-4">Members ({members.length})</h2>
                  <div className="space-y-2">
                    {members.slice(0, 8).map(member => {
                      const memberProfile = getMemberProfile(member);
                      const roleBadge = getCommunityRoleBadge(member.role);
                      return (
                        <div
                          key={member.id}
                          onContextMenu={(event) => openMemberContextMenu(event, member)}
                          onClick={() => navigate(`/app/profile/${member.user_id}`)}
                          className="flex items-center gap-2 p-2 rounded-lg hover:bg-surface-700/50 cursor-pointer transition-colors"
                        >
                          <Avatar
                            src={memberProfile?.avatar_url}
                            name={memberProfile?.display_name || memberProfile?.username || 'User'}
                            size="sm"
                            status={memberProfile?.status}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm text-surface-200 truncate">
                              {memberProfile?.display_name || memberProfile?.username || 'User'}
                            </div>
                          </div>
                          {member.role === 'owner' && <Crown size={12} className="text-yellow-400" />}
                          {member.role === 'admin' && <Shield size={12} className="text-red-400" />}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {tab === 'members' && (
              <div className="grid md:grid-cols-2 gap-3 pb-8">
                {members.map(member => {
                  const memberProfile = getMemberProfile(member);
                  const roleBadge = getCommunityRoleBadge(member.role);
                  return (
                    <div
                      key={member.id}
                      onContextMenu={(event) => openMemberContextMenu(event, member)}
                      onClick={() => navigate(`/app/profile/${member.user_id}`)}
                      className="nyptid-card p-3 flex items-center gap-3 cursor-pointer hover:border-surface-600 transition-colors"
                    >
                      <Avatar
                        src={memberProfile?.avatar_url}
                        name={memberProfile?.display_name || memberProfile?.username || 'User'}
                        size="md"
                        status={memberProfile?.status}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-surface-200 truncate">
                          {memberProfile?.display_name || memberProfile?.username || 'User'}
                        </div>
                        <div className="text-xs text-surface-500">@{memberProfile?.username || 'unknown'}</div>
                        {isCommunityOwner && member.user_id !== profile?.id && (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleTransferOwnership(member.user_id);
                            }}
                            disabled={Boolean(transferringOwnerId)}
                            className={`mt-1 text-[11px] rounded-md px-2 py-1 transition-colors ${
                              transferringOwnerId === member.user_id
                                ? 'bg-amber-500/20 text-amber-200'
                                : 'bg-surface-700 text-surface-300 hover:bg-surface-600'
                            } ${Boolean(transferringOwnerId) ? 'opacity-70 cursor-not-allowed' : ''}`}
                          >
                            {transferringOwnerId === member.user_id ? 'Transferring...' : 'Transfer Ownership'}
                          </button>
                        )}
                      </div>
                      {roleBadge && (
                        <span className={`rank-badge ${roleBadge.classes}`}>{roleBadge.label}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
      {memberContextMenu && (() => {
        const menuWidth = 240;
        const menuHeight = 408;
        const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : memberContextMenu.x + menuWidth + 8;
        const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : memberContextMenu.y + menuHeight + 8;
        const left = Math.max(8, Math.min(memberContextMenu.x, viewportWidth - menuWidth - 8));
        const top = Math.max(8, Math.min(memberContextMenu.y, viewportHeight - menuHeight - 8));
        const targetUser = memberContextMenu.targetUser;
        const isSelf = String(targetUser?.id || '') === String(profile?.id || '');
        const currentRelationship = targetUser ? userRelationships[targetUser.id] : undefined;
        const addFriendLabel =
          currentRelationship === 'friend'
            ? 'Friend Added'
            : currentRelationship === 'friend_pending_outgoing'
              ? 'Request Pending'
              : currentRelationship === 'friend_pending_incoming'
                ? 'Accept Friend Request'
                : 'Add Friend';
        const ignoreLabel = currentRelationship === 'ignored' ? 'Ignored' : 'Ignore';
        const blockLabel = currentRelationship === 'blocked' ? 'Blocked' : 'Block';

        return (
          <div className="fixed inset-0 z-[85] pointer-events-none">
            <div
              className="pointer-events-auto fixed w-[240px] rounded-xl border border-surface-700 bg-surface-900/95 backdrop-blur shadow-2xl py-2"
              style={{ left, top }}
              onClick={(event) => event.stopPropagation()}
              onContextMenu={(event) => event.preventDefault()}
            >
              <button
                type="button"
                onClick={() => {
                  if (targetUser) {
                    navigate(`/app/profile/${targetUser.id}`);
                  }
                  setMemberContextMenu(null);
                }}
                className="w-full px-3 py-2 text-left text-sm text-surface-200 hover:bg-surface-800 transition-colors"
              >
                Profile
              </button>

              <button
                type="button"
                disabled={!targetUser || !targetUser.username}
                onClick={() => {
                  if (targetUser) {
                    void handleMentionMember(targetUser);
                  }
                  setMemberContextMenu(null);
                }}
                className={`w-full px-3 py-2 text-left text-sm transition-colors ${
                  !targetUser || !targetUser.username
                    ? 'text-surface-500 cursor-not-allowed'
                    : 'text-surface-200 hover:bg-surface-800'
                }`}
              >
                Mention
              </button>

              {!isSelf && (
                <>
                  <button
                    type="button"
                    disabled={!targetUser}
                    onClick={() => {
                      if (targetUser) {
                        void (async () => {
                          const conversationId = await ensureDirectConversation(targetUser.id);
                          if (!conversationId) {
                            window.alert('Could not open direct message right now.');
                            return;
                          }
                          navigate(`/app/dm/${conversationId}`);
                        })();
                      }
                      setMemberContextMenu(null);
                    }}
                    className={`w-full px-3 py-2 text-left text-sm transition-colors ${
                      !targetUser
                        ? 'text-surface-500 cursor-not-allowed'
                        : 'text-surface-200 hover:bg-surface-800'
                    }`}
                  >
                    Message
                  </button>

                  <button
                    type="button"
                    disabled={!targetUser}
                    onClick={() => {
                      if (targetUser) {
                        void (async () => {
                          const conversationId = await ensureDirectConversation(targetUser.id);
                          if (!conversationId) {
                            window.alert('Could not open call route right now.');
                            return;
                          }
                          navigate(`/app/dm/${conversationId}/call`);
                        })();
                      }
                      setMemberContextMenu(null);
                    }}
                    className={`w-full px-3 py-2 text-left text-sm transition-colors ${
                      !targetUser
                        ? 'text-surface-500 cursor-not-allowed'
                        : 'text-surface-200 hover:bg-surface-800'
                    }`}
                  >
                    Start a Call
                  </button>

                  <button
                    type="button"
                    disabled={!targetUser}
                    onClick={() => {
                      if (targetUser) {
                        handleAddNote(targetUser);
                      }
                      setMemberContextMenu(null);
                    }}
                    className={`w-full px-3 py-2 text-left transition-colors ${
                      !targetUser
                        ? 'text-surface-500 cursor-not-allowed'
                        : 'hover:bg-surface-800'
                    }`}
                  >
                    <div className="text-sm text-surface-200">Add Note</div>
                    <div className="text-xs text-surface-500">Only visible to you</div>
                  </button>

                  <div className="my-2 border-t border-surface-700" />

                  <button
                    type="button"
                    disabled={!targetUser}
                    onClick={() => {
                      if (targetUser) {
                        void handleInviteToServer(targetUser);
                      }
                      setMemberContextMenu(null);
                    }}
                    className={`w-full px-3 py-2 text-left text-sm transition-colors flex items-center justify-between ${
                      !targetUser
                        ? 'text-surface-500 cursor-not-allowed'
                        : 'text-surface-200 hover:bg-surface-800'
                    }`}
                  >
                    <span>Invite to Server</span>
                    <ChevronRight size={14} className="text-surface-500" />
                  </button>

                  <button
                    type="button"
                    disabled={!targetUser}
                    onClick={() => {
                      if (targetUser) {
                        void (async () => {
                          if (currentRelationship === 'friend_pending_incoming') {
                            const { error } = await supabase.rpc('respond_friend_request', {
                              p_target_user_id: targetUser.id,
                              p_action: 'accept',
                            });
                            if (error) {
                              window.alert(error.message || 'Could not accept friend request.');
                              return;
                            }
                            setUserRelationships((prev) => ({ ...prev, [targetUser.id]: 'friend' }));
                            return;
                          }
                          await handleSendFriendRequest(targetUser.id);
                        })();
                      }
                      setMemberContextMenu(null);
                    }}
                    className={`w-full px-3 py-2 text-left text-sm transition-colors ${
                      !targetUser
                        ? 'text-surface-500 cursor-not-allowed'
                        : 'text-surface-200 hover:bg-surface-800'
                    }`}
                  >
                    {addFriendLabel}
                  </button>

                  <button
                    type="button"
                    disabled={!targetUser}
                    onClick={() => {
                      if (targetUser) {
                        void handleSetRelationship(targetUser.id, 'ignored');
                      }
                      setMemberContextMenu(null);
                    }}
                    className={`w-full px-3 py-2 text-left text-sm transition-colors ${
                      !targetUser
                        ? 'text-surface-500 cursor-not-allowed'
                        : 'text-surface-200 hover:bg-surface-800'
                    }`}
                  >
                    {ignoreLabel}
                  </button>

                  <button
                    type="button"
                    disabled={!targetUser}
                    onClick={() => {
                      if (targetUser) {
                        void handleSetRelationship(targetUser.id, 'blocked');
                      }
                      setMemberContextMenu(null);
                    }}
                    className={`w-full px-3 py-2 text-left text-sm transition-colors ${
                      !targetUser
                        ? 'text-surface-500 cursor-not-allowed'
                        : 'text-red-300 hover:bg-red-500/10'
                    }`}
                  >
                    {blockLabel}
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })()}
    </AppShell>
  );
}
