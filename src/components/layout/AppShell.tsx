import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ServerRail } from './ServerRail';
import { ChannelSidebar } from './ChannelSidebar';
import { TopBar } from './TopBar';
import { PersistentVoiceBar } from './PersistentVoiceBar';
import { Modal } from '../ui/Modal';
import { Avatar } from '../ui/Avatar';
import { useAuth } from '../../contexts/AuthContext';
import { useGrowthCapabilities, getCapabilityLockReason } from '../../lib/growthCapabilities';
import { trackGrowthEvent } from '../../lib/growthEvents';
import { runServerVoiceAction, useServerVoiceShellState } from '../../lib/serverVoiceShell';
import { supabase } from '../../lib/supabase';
import type { ChannelCategory, ChannelType, Community, Profile, VoiceSession } from '../../lib/types';
import { COMMUNITY_CATEGORIES, generateSlug } from '../../lib/utils';
import {
  type CommunityTemplateId,
  detectCommunityTemplate,
  getCommunityBlueprint,
} from '../../lib/communityBlueprints';

interface AppShellProps {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  topBarActions?: ReactNode;
  activeCommunityId?: string;
  activeChannelId?: string;
  showChannelSidebar?: boolean;
  suppressPersistentVoiceBar?: boolean;
}

interface CreateCommunityForm {
  name: string;
  description: string;
  category: string;
  visibility: 'public' | 'private';
  templateId: CommunityTemplateId;
}

interface InviteCandidate {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  status: Profile['status'];
  custom_status?: string | null;
}

const DEFAULT_FORM: CreateCommunityForm = {
  name: '',
  description: '',
  category: 'General',
  visibility: 'public',
  templateId: 'standard',
};

function normalizeTemplateId(value: string): CommunityTemplateId {
  return value === 'animehub' ? 'animehub' : 'standard';
}

export function AppShell({
  children, title, subtitle, topBarActions,
  activeCommunityId, activeChannelId, showChannelSidebar = true, suppressPersistentVoiceBar = false,
}: AppShellProps) {
  const { profile } = useAuth();
  const { capabilities, contract } = useGrowthCapabilities();
  const navigate = useNavigate();
  const location = useLocation();
  const voiceSession = useServerVoiceShellState();
  const [communities, setCommunities] = useState<Community[]>([]);
  const [activeCommunity, setActiveCommunity] = useState<Community | null>(null);
  const [activeServerId, setActiveServerId] = useState<string | null>(null);
  const [categories, setCategories] = useState<ChannelCategory[]>([]);
  const [voiceSessions, setVoiceSessions] = useState<Record<string, VoiceSession[]>>({});
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isDesktopSidebar, setIsDesktopSidebar] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.matchMedia('(min-width: 1024px)').matches;
  });
  const [isMobileRail, setIsMobileRail] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 767px)').matches;
  });
  const trackedCommunityIdsRef = useRef<Set<string>>(new Set());
  const memberCountRefreshTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const sidebarVoiceRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showCreateCommunity, setShowCreateCommunity] = useState(false);
  const [newCommunity, setNewCommunity] = useState<CreateCommunityForm>(DEFAULT_FORM);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteCandidates, setInviteCandidates] = useState<InviteCandidate[]>([]);
  const [inviteSearch, setInviteSearch] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteLink, setInviteLink] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [inviteActionUserId, setInviteActionUserId] = useState<string | null>(null);
  const [inviteMessage, setInviteMessage] = useState('');
  const [featureNotice, setFeatureNotice] = useState<{ title: string; body: string } | null>(null);
  const communitiesCacheKey = profile ? `ncore.cache.communities.${profile.id}` : null;
  const hasActiveServerVoice = voiceSession.phase !== 'idle' && Boolean(voiceSession.channelId);
  const sidebarVoiceChannelIds = useMemo(
    () => categories
      .flatMap((category) => (category.channels || []).map((channel) => String(channel.id || '').trim()).filter(Boolean))
      .sort(),
    [categories],
  );
  const sidebarVoiceChannelIdsSignature = useMemo(
    () => sidebarVoiceChannelIds.join('|'),
    [sidebarVoiceChannelIds],
  );
  const isOnActiveVoiceRoute = hasActiveServerVoice
    && Boolean(voiceSession.channelId)
    && Boolean(voiceSession.communityId)
    && location.pathname === `/app/community/${voiceSession.communityId}/voice/${voiceSession.channelId}`;
  const shouldShowPersistentVoiceBar = hasActiveServerVoice
    && !isOnActiveVoiceRoute
    && voiceSession.channelId
    && voiceSession.communityId
    && !suppressPersistentVoiceBar
    && !(showChannelSidebar && isDesktopSidebar);
  const activeChannelName = useMemo(() => {
    if (!activeChannelId) return '';
    for (const category of categories) {
      const match = (category.channels || []).find((channel) => String(channel.id) === String(activeChannelId));
      if (match) return String(match.name || '');
    }
    return '';
  }, [activeChannelId, categories]);
  const filteredInviteCandidates = useMemo(() => {
    const query = inviteSearch.trim().toLowerCase();
    if (!query) return inviteCandidates;
    return inviteCandidates.filter((candidate) => {
      const display = String(candidate.display_name || '').toLowerCase();
      const username = String(candidate.username || '').toLowerCase();
      return display.includes(query) || username.includes(query);
    });
  }, [inviteCandidates, inviteSearch]);

  function createInviteCode() {
    const token = Math.random().toString(36).slice(2, 8);
    const stamp = Date.now().toString(36).slice(-4);
    return `${token}${stamp}`.toUpperCase();
  }

  function buildInviteLink(communityId: string, code: string): string {
    return `${window.location.origin}/app/community/${communityId}?invite=${encodeURIComponent(code)}`;
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

  async function ensureInviteLink(forceRefresh = false): Promise<string> {
    if (!activeCommunityId || !profile?.id) return '';
    if (!forceRefresh && inviteLink && inviteCode) return inviteLink;

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const nextCode = createInviteCode();
    const { data, error } = await supabase
      .from('community_invites')
      .insert({
        community_id: activeCommunityId,
        code: nextCode,
        max_uses: null,
        expires_at: expiresAt,
        created_by: profile.id,
      } as any)
      .select('code')
      .maybeSingle();

    if (error || !(data as any)?.code) {
      setInviteMessage(error?.message || 'Could not create an invite link right now.');
      return '';
    }

    const code = String((data as any).code || nextCode);
    const link = buildInviteLink(activeCommunityId, code);
    setInviteCode(code);
    setInviteLink(link);
    return link;
  }

  async function loadInviteCandidates() {
    if (!profile?.id) return;
    setInviteLoading(true);
    setInviteMessage('');
    try {
      const { data: relationshipRows, error: relationshipError } = await supabase
        .from('user_relationships')
        .select('target_user_id, relationship')
        .eq('user_id', profile.id)
        .eq('relationship', 'friend');

      if (relationshipError) {
        setInviteMessage(relationshipError.message || 'Could not load your friends.');
        setInviteCandidates([]);
        return;
      }

      const friendIds = Array.from(
        new Set((relationshipRows || []).map((row: any) => String(row.target_user_id || '').trim()).filter(Boolean)),
      );
      if (friendIds.length === 0) {
        setInviteCandidates([]);
        return;
      }

      const { data: profileRows, error: profileError } = await supabase
        .from('profiles')
        .select('id,username,display_name,avatar_url,status,custom_status')
        .in('id', friendIds);

      if (profileError) {
        setInviteMessage(profileError.message || 'Could not load friend profiles.');
        setInviteCandidates([]);
        return;
      }

      const nextCandidates = ((profileRows || []) as any[])
        .map((row) => ({
          id: String(row.id),
          username: String(row.username || ''),
          display_name: row.display_name || null,
          avatar_url: row.avatar_url || null,
          status: row.status || 'offline',
          custom_status: row.custom_status || null,
        }))
        .sort((a, b) => {
          const onlineScore = (entry: InviteCandidate) => (entry.status === 'online' ? 2 : entry.status === 'idle' || entry.status === 'dnd' ? 1 : 0);
          return onlineScore(b) - onlineScore(a) || String(a.display_name || a.username).localeCompare(String(b.display_name || b.username));
        });
      setInviteCandidates(nextCandidates);
    } finally {
      setInviteLoading(false);
    }
  }

  async function loadUserCommunities() {
    if (!profile) return;
    const { data } = await supabase
      .from('community_members')
      .select('role, community:communities(id,name,slug,description,category,visibility,icon_url,banner_url,owner_id,member_count)')
      .eq('user_id', profile.id);

    if (!data) return;
    const nextCommunities = data
      .filter((membership: any) => membership.community)
      .map((membership: any) => ({
        ...membership.community,
        is_member: true,
        member_role: membership.role || 'member',
      })) as Community[];

    // Render immediately using `member_count` from communities rows.
    // Precise per-community count refreshes happen via focused realtime updates
    // and explicit refresh calls to avoid boot-time fan-out queries.
    setCommunities(nextCommunities);
    if (activeCommunityId) {
      const nextActive = nextCommunities.find((community) => community.id === activeCommunityId) || null;
      setActiveCommunity(nextActive);
    }

    if (communitiesCacheKey) {
      try {
        localStorage.setItem(communitiesCacheKey, JSON.stringify(nextCommunities));
      } catch {
        // best-effort cache
      }
    }
  }

  async function refreshCommunityMemberCount(communityId: string) {
    const normalizedCommunityId = String(communityId || '').trim();
    if (!normalizedCommunityId) return;
    const { count, error } = await supabase
      .from('community_members')
      .select('id', { count: 'exact', head: true })
      .eq('community_id', normalizedCommunityId);

    if (error || typeof count !== 'number') return;
    setCommunities((prev) => prev.map((community) => (
      community.id === normalizedCommunityId
        ? { ...community, member_count: count }
        : community
    )));
    setActiveCommunity((prev) => (
      prev && prev.id === normalizedCommunityId
        ? { ...prev, member_count: count }
        : prev
    ));
  }

  function isCommunityAdmin(community: Community | null): boolean {
    if (!community) return false;
    return community.owner_id === profile?.id
      || community.member_role === 'owner'
      || community.member_role === 'admin'
      || profile?.platform_role === 'owner';
  }

  function resolveTemplateForCommunity(
    community: Pick<Community, 'name' | 'slug'> | null,
    fallback?: CommunityTemplateId,
  ): CommunityTemplateId {
    if (fallback) return fallback;
    return detectCommunityTemplate(community?.name, community?.slug);
  }

  async function ensureCommunityCustomization(communityId: string, templateId: CommunityTemplateId) {
    const { data: existingCustomization } = await supabase
      .from('community_server_customizations')
      .select('id')
      .eq('community_id', communityId)
      .maybeSingle();

    if ((existingCustomization as any)?.id) return;

    const blueprint = getCommunityBlueprint(templateId);
    await supabase
      .from('community_server_customizations')
      .insert({
        community_id: communityId,
        accent_color: blueprint.accentColor,
        gradient_start: blueprint.gradientStart,
        gradient_end: blueprint.gradientEnd,
        server_tagline: blueprint.serverTagline,
        welcome_message: blueprint.welcomeMessage,
        rules_markdown: blueprint.rulesMarkdown,
        onboarding_steps: blueprint.onboardingSteps,
        custom_role_labels: blueprint.roleLabels,
      } as any);
  }

  async function ensureServerChannels(serverId: string, templateId: CommunityTemplateId) {
    const { data: existingCategories } = await supabase
      .from('channel_categories')
      .select('id')
      .eq('server_id', serverId)
      .limit(1);

    if ((existingCategories || []).length > 0) return;

    const blueprint = getCommunityBlueprint(templateId);
    for (let categoryIndex = 0; categoryIndex < blueprint.categories.length; categoryIndex += 1) {
      const category = blueprint.categories[categoryIndex];
      const { data: createdCategory, error: categoryError } = await supabase
        .from('channel_categories')
        .insert({
          server_id: serverId,
          name: category.name,
          order_index: categoryIndex,
        } as any)
        .select('id')
        .maybeSingle();

      if (categoryError || !(createdCategory as any)?.id) {
        console.warn('Failed creating category from blueprint:', categoryError);
        continue;
      }

      const categoryId = String((createdCategory as any).id);
      const channelRows = category.channels.map((channel, channelIndex) => ({
        server_id: serverId,
        category_id: categoryId,
        name: channel.name,
        channel_type: channel.channel_type,
        order_index: channelIndex,
      }));

      if (channelRows.length > 0) {
        const { error: channelError } = await supabase
          .from('channels')
          .insert(channelRows as any);
        if (channelError) {
          console.warn('Failed creating channels from blueprint:', channelError);
        }
      }
    }
  }

  async function ensureServerScaffold(
    communityId: string,
    serverId: string,
    community: Pick<Community, 'name' | 'slug'> | null,
    templateOverride?: CommunityTemplateId,
  ) {
    const templateId = resolveTemplateForCommunity(community, templateOverride);
    await ensureServerChannels(serverId, templateId);
    await ensureCommunityCustomization(communityId, templateId);
  }

  async function refreshSidebarForServer(serverId: string) {
    const { data: categoryData } = await supabase
      .from('channel_categories')
      .select('*, channels(*, voice_sessions(*, profile:profiles(*)))')
      .eq('server_id', serverId)
      .order('order_index');

    const cats = (categoryData || []) as ChannelCategory[];
    const missingProfileIds = new Set<string>();
    cats.forEach((category: any) => {
      category.channels?.forEach((channel: any) => {
        channel.voice_sessions?.forEach((session: any) => {
          if (!session.profile && session.user_id) {
            missingProfileIds.add(String(session.user_id));
          }
        });
      });
    });

    let profileById = new Map<string, any>();
    if (missingProfileIds.size > 0) {
      const { data: profileRows } = await supabase
        .from('profiles')
        .select('*')
        .in('id', Array.from(missingProfileIds));
      if (profileRows) {
        profileById = new Map((profileRows as any[]).map((profile) => [String(profile.id), profile]));
      }
    }

    const hydratedCats = cats.map((category: any) => ({
      ...category,
      channels: (category.channels || []).map((channel: any) => ({
        ...channel,
        voice_sessions: (channel.voice_sessions || []).map((session: any) => ({
          ...session,
          profile: session.profile || session.profiles || profileById.get(String(session.user_id)) || null,
        })),
      })),
    })) as ChannelCategory[];

    setCategories(hydratedCats);

    const sessions: Record<string, VoiceSession[]> = {};
    hydratedCats.forEach((cat: any) => {
      cat.channels?.forEach((channel: any) => {
        if (channel.voice_sessions?.length > 0) {
          sessions[channel.id] = channel.voice_sessions;
        }
      });
    });
    setVoiceSessions(sessions);
  }

  useEffect(() => {
    if (!communitiesCacheKey) return;
    try {
      const raw = localStorage.getItem(communitiesCacheKey);
      if (!raw) return;
      const cached = JSON.parse(raw) as Community[];
      if (!Array.isArray(cached) || cached.length === 0) return;
      setCommunities((prev) => (prev.length > 0 ? prev : cached));
      if (activeCommunityId) {
        const nextActive = cached.find((community) => String(community.id) === String(activeCommunityId)) || null;
        if (nextActive) setActiveCommunity(nextActive);
      }
    } catch {
      // ignore malformed cache
    }
  }, [communitiesCacheKey, activeCommunityId]);

  useEffect(() => {
    if (!showInviteModal) return;
    void loadInviteCandidates();
    void ensureInviteLink(true);
  }, [showInviteModal, activeCommunityId, profile?.id]);

  useEffect(() => {
    if (!profile) return;

    let idleId: number | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const requestIdle = (window as any).requestIdleCallback as
      | ((cb: () => void, opts?: { timeout: number }) => number)
      | undefined;

    const run = () => {
      void loadUserCommunities();
    };

    if (typeof requestIdle === 'function') {
      idleId = requestIdle(run, { timeout: 1200 });
    } else {
      timeoutId = setTimeout(run, 250);
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
    trackedCommunityIdsRef.current = new Set(
      communities.map((community) => String(community.id)).filter(Boolean),
    );
  }, [communities]);

  useEffect(() => {
    if (!profile?.id) return;
    const channel = supabase
      .channel(`appshell:my-memberships:${profile.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'community_members',
          filter: `user_id=eq.${profile.id}`,
        },
        () => {
          void loadUserCommunities();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile?.id]);

  useEffect(() => {
    if (!activeCommunityId) return;
    void refreshCommunityMemberCount(activeCommunityId);
  }, [activeCommunityId]);

  useEffect(() => {
    if (!activeServerId) return;
    const activeChannelIds = new Set(sidebarVoiceChannelIds);
    if (activeChannelIds.size === 0) return;

    const scheduleRefresh = (channelId: string) => {
      if (!activeChannelIds.has(channelId)) return;
      if (sidebarVoiceRefreshTimerRef.current) {
        clearTimeout(sidebarVoiceRefreshTimerRef.current);
      }
      sidebarVoiceRefreshTimerRef.current = setTimeout(() => {
        sidebarVoiceRefreshTimerRef.current = null;
        void refreshSidebarForServer(activeServerId);
      }, 120);
    };

    const channel = supabase
      .channel(`appshell:voice-sidebar:${activeServerId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'voice_sessions',
        },
        (payload) => {
          const changedChannelId = String((payload.new as any)?.channel_id || (payload.old as any)?.channel_id || '').trim();
          if (!changedChannelId) return;
          scheduleRefresh(changedChannelId);
        },
      )
      .subscribe();

    return () => {
      if (sidebarVoiceRefreshTimerRef.current) {
        clearTimeout(sidebarVoiceRefreshTimerRef.current);
        sidebarVoiceRefreshTimerRef.current = null;
      }
      supabase.removeChannel(channel);
    };
  }, [activeServerId, sidebarVoiceChannelIds, sidebarVoiceChannelIdsSignature]);

  useEffect(() => {
    if (!profile?.id) return;
    const channel = supabase
      .channel(`appshell:community-counts:${profile.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'community_members',
        },
        (payload) => {
          const communityId = String((payload.new as any)?.community_id || (payload.old as any)?.community_id || '').trim();
          if (!communityId || !trackedCommunityIdsRef.current.has(communityId)) return;
          const existingTimer = memberCountRefreshTimersRef.current[communityId];
          if (existingTimer) clearTimeout(existingTimer);
          memberCountRefreshTimersRef.current[communityId] = setTimeout(() => {
            delete memberCountRefreshTimersRef.current[communityId];
            void refreshCommunityMemberCount(communityId);
          }, 140);
        },
      )
      .subscribe();

    return () => {
      Object.values(memberCountRefreshTimersRef.current).forEach((timer) => clearTimeout(timer));
      memberCountRefreshTimersRef.current = {};
      supabase.removeChannel(channel);
    };
  }, [profile?.id]);

  useEffect(() => {
    if (!activeCommunityId) {
      setActiveCommunity(null);
      setActiveServerId(null);
      setCategories([]);
      setVoiceSessions({});
      return;
    }

    let cancelled = false;
    const found = communities.find((community) => community.id === activeCommunityId) || null;
    setActiveCommunity(found);
    const isAdminForActiveCommunity = isCommunityAdmin(found);

    const loadSidebar = async () => {
      let serverId: string | null = null;
      const { data: servers, error: serverLookupError } = await supabase
        .from('servers')
        .select('id')
        .eq('community_id', activeCommunityId)
        .order('id', { ascending: true })
        .limit(1);

      if (serverLookupError) {
        console.warn('Server lookup failed while loading sidebar:', serverLookupError);
      } else if ((servers || []).length > 0) {
        serverId = String((servers as any[])[0].id);
      }

      if (!serverId && isAdminForActiveCommunity && profile) {
        const { data: createdServer, error: createServerError } = await supabase
          .from('servers')
          .insert({ community_id: activeCommunityId, name: found?.name || 'Community', owner_id: profile.id } as any)
          .select('id')
          .maybeSingle();

        if (createServerError) {
          console.warn('Server auto-create failed while loading sidebar:', createServerError);
        } else if ((createdServer as any)?.id) {
          serverId = String((createdServer as any).id);
        }
      }

      if (!serverId) {
        if (!cancelled) {
          setActiveServerId(null);
          setCategories([]);
          setVoiceSessions({});
        }
        return;
      }

      if (!cancelled) {
        setActiveServerId(serverId);
      }

      if (isAdminForActiveCommunity) {
        await ensureServerScaffold(
          activeCommunityId,
          serverId,
          found ? { name: found.name, slug: found.slug } : null,
        );
      }

      if (cancelled) return;
      await refreshSidebarForServer(serverId);
    };

    void loadSidebar();

    return () => {
      cancelled = true;
    };
  }, [activeCommunityId, communities, profile?.id, profile?.platform_role]);

  useEffect(() => {
    if (!showChannelSidebar) return;
    if (typeof window === 'undefined') return;

    const media = window.matchMedia('(min-width: 1024px)');
    const onChange = () => {
      setIsDesktopSidebar(media.matches);
      if (media.matches) setSidebarOpen(false);
    };

    onChange();
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    }

    media.addListener(onChange);
    return () => media.removeListener(onChange);
  }, [showChannelSidebar]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const media = window.matchMedia('(max-width: 767px)');
    const onChange = () => {
      setIsMobileRail(media.matches);
    };

    onChange();
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    }

    media.addListener(onChange);
    return () => media.removeListener(onChange);
  }, []);

  useEffect(() => {
    if (isMobileRail) {
      setSidebarOpen(false);
    }
  }, [isMobileRail]);

  useEffect(() => {
    if (!showChannelSidebar) return;
    if (isDesktopSidebar) return;
    if (typeof document === 'undefined') return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = sidebarOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isDesktopSidebar, showChannelSidebar, sidebarOpen]);

  useEffect(() => {
    if (showChannelSidebar && !isDesktopSidebar) {
      setSidebarOpen(false);
    }
  }, [isDesktopSidebar, location.pathname, showChannelSidebar]);

  async function handleAddCategory() {
    if (!activeServerId || !activeCommunity || !isCommunityAdmin(activeCommunity)) return;
    const requestedName = window.prompt('Category name', 'NEW CATEGORY');
    const name = String(requestedName || '').trim();
    if (!name) return;

    const nextIndex = categories.length;
    const { data: createdCategory, error } = await supabase
      .from('channel_categories')
      .insert({
        server_id: activeServerId,
        name: name.toUpperCase(),
        order_index: nextIndex,
      } as any)
      .select('*')
      .maybeSingle();

    if (error || !(createdCategory as any)?.id) {
      console.warn('Could not create category:', error);
      return;
    }

    setCategories((prev) => [...prev, { ...(createdCategory as any), channels: [] } as ChannelCategory]);
  }

  async function handleAddChannel(categoryId: string, type: 'text' | 'voice') {
    if (!activeServerId || !activeCommunity || !isCommunityAdmin(activeCommunity)) return;

    const typeLabel = type === 'voice' ? 'Voice channel name' : 'Text channel name';
    const placeholder = type === 'voice' ? 'voice-lounge' : 'new-channel';
    const requestedName = window.prompt(typeLabel, placeholder);
    const name = String(requestedName || '').trim();
    if (!name) return;

    const targetCategory = categories.find((category) => category.id === categoryId);
    const nextIndex = (targetCategory?.channels || []).length;
    const channelType: ChannelType = type;

    const { data: createdChannel, error } = await supabase
      .from('channels')
      .insert({
        server_id: activeServerId,
        category_id: categoryId,
        name,
        channel_type: channelType,
        order_index: nextIndex,
      } as any)
      .select('*')
      .maybeSingle();

    if (error || !(createdChannel as any)?.id) {
      console.warn('Could not create channel:', error);
      return;
    }

    const channel = createdChannel as any;
    setCategories((prev) => prev.map((category) => {
      if (category.id !== categoryId) return category;
      return {
        ...category,
        channels: [...(category.channels || []), channel],
      } as ChannelCategory;
    }));

    if (type === 'voice') {
      navigate(`/app/community/${activeCommunity.id}/voice/${channel.id}`);
    } else {
      navigate(`/app/community/${activeCommunity.id}/channel/${channel.id}`);
    }

    if (!isDesktopSidebar) {
      setSidebarOpen(false);
    }
  }

  function findFirstRoutableChannel(nextCategories: ChannelCategory[]): { id: string; type: ChannelType } | null {
    for (const category of nextCategories) {
      for (const channel of category.channels || []) {
        const channelId = String(channel.id || '').trim();
        if (!channelId) continue;
        if (channel.channel_type === 'voice' || channel.channel_type === 'text' || channel.channel_type === 'announcement') {
          return { id: channelId, type: channel.channel_type };
        }
      }
    }
    return null;
  }

  async function handleEditCategory(categoryId: string) {
    if (!activeServerId || !activeCommunity || !isCommunityAdmin(activeCommunity)) return;
    const targetCategory = categories.find((category) => String(category.id) === String(categoryId));
    if (!targetCategory) return;
    const requestedName = window.prompt('Rename category', String(targetCategory.name || ''));
    const name = String(requestedName || '').trim();
    if (!name) return;

    const { error } = await supabase
      .from('channel_categories')
      .update({ name: name.toUpperCase() } as any)
      .eq('id', categoryId)
      .eq('server_id', activeServerId);

    if (error) {
      console.warn('Could not rename category:', error);
      return;
    }

    setCategories((prev) => prev.map((category) => (
      String(category.id) === String(categoryId)
        ? { ...category, name: name.toUpperCase() }
        : category
    )));
  }

  async function handleDeleteCategory(categoryId: string) {
    if (!activeServerId || !activeCommunity || !isCommunityAdmin(activeCommunity)) return;
    const targetCategory = categories.find((category) => String(category.id) === String(categoryId));
    if (!targetCategory) return;
    const confirmed = window.confirm(`Delete category "${targetCategory.name}" and all channels inside it?`);
    if (!confirmed) return;

    const targetChannelIds = (targetCategory.channels || []).map((channel) => String(channel.id || '').trim()).filter(Boolean);
    if (targetChannelIds.length > 0) {
      const { error: deleteChannelsError } = await supabase
        .from('channels')
        .delete()
        .in('id', targetChannelIds);
      if (deleteChannelsError) {
        console.warn('Could not delete channels for category:', deleteChannelsError);
        return;
      }
    }

    const { error } = await supabase
      .from('channel_categories')
      .delete()
      .eq('id', categoryId)
      .eq('server_id', activeServerId);

    if (error) {
      console.warn('Could not delete category:', error);
      return;
    }

    const nextCategories = categories.filter((category) => String(category.id) !== String(categoryId));
    setCategories(nextCategories);

    if (activeChannelId && targetChannelIds.includes(String(activeChannelId))) {
      const fallback = findFirstRoutableChannel(nextCategories);
      if (fallback && activeCommunity?.id) {
        navigate(`/app/community/${activeCommunity.id}/${fallback.type === 'voice' ? 'voice' : 'channel'}/${fallback.id}`);
      } else if (activeCommunity?.id) {
        navigate(`/app/community/${activeCommunity.id}`);
      }
    }
  }

  async function handleEditChannel(channelId: string) {
    if (!activeServerId || !activeCommunity || !isCommunityAdmin(activeCommunity)) return;
    const targetChannel = categories.flatMap((category) => category.channels || []).find((channel) => String(channel.id) === String(channelId));
    if (!targetChannel) return;
    const requestedName = window.prompt('Rename channel', String(targetChannel.name || ''));
    const name = String(requestedName || '').trim();
    if (!name) return;

    const { error } = await supabase
      .from('channels')
      .update({ name } as any)
      .eq('id', channelId)
      .eq('server_id', activeServerId);

    if (error) {
      console.warn('Could not rename channel:', error);
      return;
    }

    setCategories((prev) => prev.map((category) => ({
      ...category,
      channels: (category.channels || []).map((channel) => (
        String(channel.id) === String(channelId)
          ? { ...channel, name }
          : channel
      )),
    })));
  }

  async function handleDeleteChannel(channelId: string) {
    if (!activeServerId || !activeCommunity || !isCommunityAdmin(activeCommunity)) return;
    const targetChannel = categories.flatMap((category) => category.channels || []).find((channel) => String(channel.id) === String(channelId));
    if (!targetChannel) return;
    const confirmed = window.confirm(`Delete channel "${targetChannel.name}"?`);
    if (!confirmed) return;

    const { error } = await supabase
      .from('channels')
      .delete()
      .eq('id', channelId)
      .eq('server_id', activeServerId);

    if (error) {
      console.warn('Could not delete channel:', error);
      return;
    }

    const nextCategories = categories.map((category) => ({
      ...category,
      channels: (category.channels || []).filter((channel) => String(channel.id) !== String(channelId)),
    }));
    setCategories(nextCategories);

    if (activeChannelId && String(activeChannelId) === String(channelId)) {
      const fallback = findFirstRoutableChannel(nextCategories);
      if (fallback && activeCommunity?.id) {
        navigate(`/app/community/${activeCommunity.id}/${fallback.type === 'voice' ? 'voice' : 'channel'}/${fallback.id}`);
      } else if (activeCommunity?.id) {
        navigate(`/app/community/${activeCommunity.id}`);
      }
    }
  }

  async function ensureQuickCreateCategory(): Promise<string | null> {
    if (!activeServerId || !activeCommunity || !isCommunityAdmin(activeCommunity)) return null;
    if (categories[0]?.id) return String(categories[0].id);
    const requestedName = window.prompt('Category name', 'TEXT CHANNELS');
    const name = String(requestedName || '').trim();
    if (!name) return null;

    const { data: createdCategory, error } = await supabase
      .from('channel_categories')
      .insert({
        server_id: activeServerId,
        name: name.toUpperCase(),
        order_index: categories.length,
      } as any)
      .select('*')
      .maybeSingle();

    if (error || !(createdCategory as any)?.id) {
      console.warn('Could not create category:', error);
      return null;
    }

    const nextCategory = { ...(createdCategory as any), channels: [] } as ChannelCategory;
    setCategories((prev) => [...prev, nextCategory]);
    return String(nextCategory.id);
  }

  async function handleQuickCreateChannel(type: 'text' | 'voice' = 'text') {
    const categoryId = await ensureQuickCreateCategory();
    if (!categoryId) return;
    await handleAddChannel(categoryId, type);
  }

  async function handleInviteFriend(target: InviteCandidate) {
    if (!profile?.id || !activeCommunityId || !activeCommunity) return;
    setInviteActionUserId(target.id);
    setInviteMessage('');
    try {
      const link = await ensureInviteLink();
      if (!link) return;
      try {
        await navigator.clipboard.writeText(link);
      } catch {
        // noop
      }

      const conversationId = await ensureDirectConversation(target.id);
      if (conversationId) {
        await supabase.from('direct_messages').insert({
          conversation_id: conversationId,
          author_id: profile.id,
          content: `Join me in ${activeCommunity.name}${activeChannelName ? ` (#${activeChannelName})` : ''}: ${link}`,
        } as any);
      }

      setInviteMessage(`Invite sent to @${target.username}.`);
    } finally {
      setInviteActionUserId(null);
    }
  }

  async function handleCopyInviteLink() {
    const link = await ensureInviteLink();
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setInviteMessage('Invite link copied.');
    } catch {
      setInviteMessage(link);
    }
  }

  async function handleLeaveCommunity() {
    if (!activeCommunity || !activeCommunityId || !profile?.id) return;
    if (String(activeCommunity.owner_id || '') === String(profile.id)) {
      setFeatureNotice({
        title: 'Owner action required',
        body: 'Transfer ownership or delete the server from Server Settings before leaving it.',
      });
      return;
    }
    const confirmed = window.confirm(`Leave ${activeCommunity.name}?`);
    if (!confirmed) return;
    const { error } = await supabase
      .from('community_members')
      .delete()
      .eq('community_id', activeCommunityId)
      .eq('user_id', profile.id);
    if (error) {
      setFeatureNotice({ title: 'Could not leave server', body: error.message || 'The server could not be left right now.' });
      return;
    }
    setCommunities((prev) => prev.filter((community) => String(community.id) !== String(activeCommunityId)));
    navigate('/app/dm');
  }

  function handleTemplateChange(rawTemplateId: string) {
    const templateId = normalizeTemplateId(rawTemplateId);
    const blueprint = getCommunityBlueprint(templateId);
    setNewCommunity((prev) => ({
      ...prev,
      templateId,
      name: prev.name || blueprint.recommendedName || prev.name,
      description: prev.description || blueprint.recommendedDescription || prev.description,
      category: templateId === 'animehub'
        ? (blueprint.recommendedCategory || prev.category)
        : prev.category,
    }));
  }

  async function handleCreateCommunity() {
    if (!profile || !newCommunity.name.trim()) return;
    if (!capabilities.canCreateServer) {
      const reason = getCapabilityLockReason('can_create_server', contract.unlock_source);
      setCreateError(reason);
      void trackGrowthEvent('capability_gate_blocked', {
        gate: 'can_create_server',
        action: 'create_community',
      }, { userId: profile.id });
      return;
    }

    setCreating(true);
    setCreateError('');
    void trackGrowthEvent('server_create_started', {
      template_id: normalizeTemplateId(newCommunity.templateId),
      visibility: newCommunity.visibility,
    }, { userId: profile.id });
    const templateId = normalizeTemplateId(newCommunity.templateId);
    const slug = generateSlug(newCommunity.name);
    const { data: community, error } = await supabase
      .from('communities')
      .insert({
        name: newCommunity.name.trim(),
        slug: `${slug}-${Date.now()}`,
        description: newCommunity.description,
        category: newCommunity.category,
        visibility: newCommunity.visibility,
        owner_id: profile.id,
      })
      .select()
      .single();

    if (error || !community) {
      setCreateError(error?.message || 'Failed to create community. Please try again.');
      void trackGrowthEvent('server_create_failed', {
        reason: error?.message || 'insert_failed',
      }, { userId: profile.id });
      setCreating(false);
      return;
    }

    await supabase.from('community_members').insert({
      community_id: community.id,
      user_id: profile.id,
      role: 'owner',
    });

    const { data: server } = await supabase
      .from('servers')
      .insert({ community_id: community.id, name: community.name, owner_id: profile.id })
      .select('id')
      .maybeSingle();

    if ((server as any)?.id) {
      await ensureServerScaffold(
        community.id,
        String((server as any).id),
        { name: community.name, slug: community.slug },
        templateId,
      );
    }

    setCreating(false);
    setShowCreateCommunity(false);
    setNewCommunity(DEFAULT_FORM);
    setCommunities((prev) => [...prev, { ...community, is_member: true, member_role: 'owner' }]);
    void trackGrowthEvent('server_create_succeeded', {
      community_id: community.id,
      visibility: community.visibility || newCommunity.visibility,
    }, { userId: profile.id });
    navigate(`/app/community/${community.id}`);
  }

  return (
    <div className={`flex h-[100dvh] overflow-hidden bg-surface-950 ${isMobileRail ? 'pb-[calc(4.25rem+env(safe-area-inset-bottom))]' : ''}`}>
      {!isMobileRail && (
        <ServerRail
          communities={communities}
          activeCommunityId={activeCommunityId}
          onCreateCommunity={() => setShowCreateCommunity(true)}
        />
      )}

      {showChannelSidebar && isDesktopSidebar && (
        <div className="relative z-10 h-full min-h-0">
          <ChannelSidebar
            community={activeCommunity || undefined}
            categories={categories}
            activeChannelId={activeChannelId}
            voiceSessions={voiceSessions}
            currentVoiceChannelId={voiceSession.channelId || undefined}
            onAddCategory={handleAddCategory}
            onAddChannel={handleAddChannel}
            onEditCategory={handleEditCategory}
            onDeleteCategory={handleDeleteCategory}
            onEditChannel={handleEditChannel}
            onDeleteChannel={handleDeleteChannel}
            onQuickCreateChannel={handleQuickCreateChannel}
            onOpenInviteModal={() => setShowInviteModal(true)}
            onOpenFeatureNotice={(title, body) => setFeatureNotice({ title, body })}
            onLeaveCommunity={handleLeaveCommunity}
            onClose={() => setSidebarOpen(false)}
          />
        </div>
      )}

      {showChannelSidebar && !isDesktopSidebar && (
        <>
          <div
            className={`fixed inset-0 z-20 bg-black/50 transition-opacity duration-300 ${sidebarOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'}`}
            onClick={() => setSidebarOpen(false)}
          />
          <div className={`fixed top-0 ${isMobileRail ? 'left-0' : 'left-[72px]'} z-30 h-full w-[min(88vw,22rem)] overflow-hidden ${sidebarOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}>
            <div className={`h-full transition-transform duration-300 ease-in-out ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
              <ChannelSidebar
                community={activeCommunity || undefined}
                categories={categories}
                activeChannelId={activeChannelId}
                voiceSessions={voiceSessions}
                currentVoiceChannelId={voiceSession.channelId || undefined}
                onAddCategory={handleAddCategory}
                onAddChannel={handleAddChannel}
                onEditCategory={handleEditCategory}
                onDeleteCategory={handleDeleteCategory}
                onEditChannel={handleEditChannel}
                onDeleteChannel={handleDeleteChannel}
                onQuickCreateChannel={handleQuickCreateChannel}
                onOpenInviteModal={() => setShowInviteModal(true)}
                onOpenFeatureNotice={(title, body) => setFeatureNotice({ title, body })}
                onLeaveCommunity={handleLeaveCommunity}
                onClose={() => setSidebarOpen(false)}
              />
            </div>
          </div>
        </>
      )}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar
          title={title}
          subtitle={subtitle}
          actions={topBarActions}
          showSidebarToggle={showChannelSidebar && !isDesktopSidebar}
          onToggleSidebar={() => {
            if (!isDesktopSidebar) setSidebarOpen((value) => !value);
          }}
          sidebarOpen={isDesktopSidebar ? true : sidebarOpen}
        />
        <div className="flex-1 overflow-hidden">{children}</div>
        {shouldShowPersistentVoiceBar && (
          <PersistentVoiceBar
            channelName={voiceSession.channelName}
            communityId={voiceSession.communityId!}
            channelId={voiceSession.channelId!}
            isMuted={voiceSession.isMuted}
            isDeafened={voiceSession.isDeafened}
            isCameraOn={voiceSession.isCameraOn}
            onToggleMute={() => void runServerVoiceAction('toggleMute')}
            onToggleDeafen={() => void runServerVoiceAction('toggleDeafen')}
            onToggleCamera={() => void runServerVoiceAction('toggleCamera')}
            onLeave={() => void runServerVoiceAction('leave')}
          />
        )}
      </div>

      {isMobileRail && (
        <div className="fixed inset-x-0 bottom-0 z-40 pb-[env(safe-area-inset-bottom)]">
          <ServerRail
            communities={communities}
            activeCommunityId={activeCommunityId}
            onCreateCommunity={() => setShowCreateCommunity(true)}
            mobile
          />
        </div>
      )}

      <Modal
        isOpen={showCreateCommunity}
        onClose={() => {
          setShowCreateCommunity(false);
          setCreateError('');
        }}
        title="Create a Community"
        size="md"
      >
        <div className="space-y-4">
          {createError && (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">
              <span className="mt-0.5 flex-shrink-0">!</span>
              {createError}
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-sm font-medium text-surface-300">Preset</label>
            <select
              value={newCommunity.templateId}
              onChange={(event) => handleTemplateChange(event.target.value)}
              className="nyptid-input"
            >
              <option value="standard">Standard Server</option>
              <option value="animehub">AnimeHub Preset</option>
            </select>
            <p className="mt-1.5 text-xs text-surface-500">
              AnimeHub preset creates the full anime fan server structure with Owner, Mod, Server Booster, and Member labels.
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-surface-300">Community name</label>
            <input
              type="text"
              value={newCommunity.name}
              onChange={(event) => setNewCommunity((prev) => ({ ...prev, name: event.target.value }))}
              className="nyptid-input"
              placeholder="My Awesome Community"
              maxLength={50}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-surface-300">Description</label>
            <textarea
              value={newCommunity.description}
              onChange={(event) => setNewCommunity((prev) => ({ ...prev, description: event.target.value }))}
              className="nyptid-input resize-none"
              placeholder="What is this community about?"
              rows={3}
              maxLength={300}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-surface-300">Category</label>
              <select
                value={newCommunity.category}
                onChange={(event) => setNewCommunity((prev) => ({ ...prev, category: event.target.value }))}
                className="nyptid-input"
              >
                {COMMUNITY_CATEGORIES.map((category) => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-surface-300">Visibility</label>
              <select
                value={newCommunity.visibility}
                onChange={(event) => setNewCommunity((prev) => ({
                  ...prev,
                  visibility: event.target.value === 'private' ? 'private' : 'public',
                }))}
                className="nyptid-input"
              >
                <option value="public">Public</option>
                <option value="private">Private</option>
              </select>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button onClick={() => setShowCreateCommunity(false)} className="nyptid-btn-secondary flex-1">
              Cancel
            </button>
            <button
              onClick={handleCreateCommunity}
              className="nyptid-btn-primary flex-1"
              disabled={creating || !newCommunity.name.trim()}
            >
              {creating ? 'Creating...' : 'Create Community'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showInviteModal}
        onClose={() => {
          setShowInviteModal(false);
          setInviteSearch('');
          setInviteMessage('');
        }}
        title={activeCommunity ? `Invite friends to ${activeCommunity.name}` : 'Invite to Server'}
        size="xl"
      >
        <div className="space-y-4">
          <div className="text-sm text-surface-400">
            Recipients will land in {activeChannelName ? `#${activeChannelName}` : 'the server'}.
          </div>
          <input
            type="text"
            value={inviteSearch}
            onChange={(event) => setInviteSearch(event.target.value)}
            placeholder="Search for friends"
            className="nyptid-input"
          />
          {inviteMessage && (
            <div className="rounded-xl border border-surface-700 bg-surface-900/60 px-3 py-2 text-xs text-surface-300">
              {inviteMessage}
            </div>
          )}
          <div className="max-h-[48vh] overflow-y-auto rounded-2xl border border-surface-700 bg-surface-900/60">
            {inviteLoading ? (
              <div className="px-4 py-8 text-center text-sm text-surface-500">Loading your friends...</div>
            ) : filteredInviteCandidates.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-surface-500">No friends match that search yet.</div>
            ) : filteredInviteCandidates.map((candidate) => (
              <div key={candidate.id} className="flex items-center gap-3 border-b border-surface-800/80 px-4 py-3 last:border-b-0">
                <Avatar
                  src={candidate.avatar_url}
                  name={candidate.display_name || candidate.username}
                  size="md"
                  status={candidate.status}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-surface-100">{candidate.display_name || candidate.username}</div>
                  <div className="truncate text-xs text-surface-500">@{candidate.username}</div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleInviteFriend(candidate)}
                  disabled={inviteActionUserId === candidate.id}
                  className="nyptid-btn-secondary px-3 py-2 text-xs"
                >
                  {inviteActionUserId === candidate.id ? 'Inviting...' : 'Invite'}
                </button>
              </div>
            ))}
          </div>
          <div className="rounded-2xl border border-surface-700 bg-surface-900/60 p-4">
            <div className="text-sm font-semibold text-surface-100">Or, send a server invite link</div>
            <div className="mt-3 flex gap-2">
              <input
                type="text"
                readOnly
                value={inviteLink}
                className="nyptid-input flex-1"
                placeholder="Creating invite link..."
              />
              <button type="button" onClick={() => void handleCopyInviteLink()} className="nyptid-btn-primary px-4">
                Copy
              </button>
            </div>
            <div className="mt-2 text-xs text-surface-500">Invite links expire in 7 days by default.</div>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={Boolean(featureNotice)}
        onClose={() => setFeatureNotice(null)}
        title={featureNotice?.title || 'NCore'}
        size="md"
      >
        <div className="text-sm leading-relaxed text-surface-300">{featureNotice?.body}</div>
      </Modal>
    </div>
  );
}
