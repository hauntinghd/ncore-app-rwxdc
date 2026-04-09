import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Compass,
  Flame,
  Globe,
  Lock,
  Plus,
  Radar,
  Rocket,
  Search,
  ShieldCheck,
  Sparkles,
  Swords,
  Target,
  Trophy,
  Users,
} from 'lucide-react';
import { AppShell } from '../components/layout/AppShell';
import { Badge } from '../components/ui/Badge';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import type { Community } from '../lib/types';

type DiscoverTab = 'apps' | 'servers' | 'quests';

interface DiscoverCardProps {
  community: Community;
  joined: boolean;
  joining: boolean;
  onOpen: () => void;
  onJoin: () => void;
}

interface DiscoverAppCard {
  id: string;
  name: string;
  tagline: string;
  summary: string;
  category: string;
  installs: string;
  trust: string;
  accent: string;
  tags: string[];
}

interface DiscoverQuestCard {
  id: string;
  name: string;
  reward: string;
  duration: string;
  difficulty: string;
  summary: string;
  accent: string;
  checkpoints: string[];
}

const DISCOVER_CATEGORIES = ['Home', 'Gaming', 'Music', 'Entertainment', 'Science', 'Technology', 'Education', 'Business'];

const APP_SPOTLIGHTS: DiscoverAppCard[] = [
  {
    id: 'ops-radar',
    name: 'Ops Radar',
    tagline: 'Realtime incident triage',
    summary: 'Tracks raids, mass joins, trust drops, and moderation escalations from one operator cockpit.',
    category: 'Moderation',
    installs: '4.2k installs',
    trust: 'Verified',
    accent: 'linear-gradient(135deg, rgba(54,95,181,0.95), rgba(8,18,38,0.96))',
    tags: ['Threat feed', 'Audit trail', 'Live triage'],
  },
  {
    id: 'launch-control',
    name: 'Launch Control',
    tagline: 'Ship events like a studio',
    summary: 'Coordinate campaigns, role drops, onboarding prompts, and timed announcements without a dozen bots.',
    category: 'Growth',
    installs: '2.8k installs',
    trust: 'Approved',
    accent: 'linear-gradient(135deg, rgba(219,110,49,0.95), rgba(72,23,10,0.96))',
    tags: ['Campaign timers', 'Role flows', 'Event prompts'],
  },
  {
    id: 'signal-graph',
    name: 'Signal Graph',
    tagline: 'Community intelligence',
    summary: 'Maps member movement, retention, and high-signal conversations so operators can see what actually matters.',
    category: 'Analytics',
    installs: '1.6k installs',
    trust: 'Operator pick',
    accent: 'linear-gradient(135deg, rgba(37,154,118,0.95), rgba(10,43,36,0.96))',
    tags: ['Retention map', 'Heat zones', 'Insight digests'],
  },
];

const QUEST_CAMPAIGNS: DiscoverQuestCard[] = [
  {
    id: 'founder-circuit',
    name: 'Founder Circuit',
    reward: 'Unlock founder badge + launch role',
    duration: '3 days',
    difficulty: 'Medium',
    summary: 'A guided launch sprint for new communities that want a sharp first-week onboarding sequence.',
    accent: 'linear-gradient(135deg, rgba(90,74,196,0.92), rgba(16,17,44,0.96))',
    checkpoints: ['Claim your launch brief', 'Publish an invite path', 'Hit first 25 members'],
  },
  {
    id: 'intel-hunt',
    name: 'Intel Hunt',
    reward: '750 XP + discovery placement',
    duration: '7 days',
    difficulty: 'High',
    summary: 'Run a timed community challenge, measure participation, and push the results back into discovery spotlight.',
    accent: 'linear-gradient(135deg, rgba(195,67,67,0.92), rgba(50,12,20,0.96))',
    checkpoints: ['Start operator briefing', 'Post the mission chain', 'Complete verification review'],
  },
  {
    id: 'operator-ladder',
    name: 'Operator Ladder',
    reward: 'Priority trust review',
    duration: '14 days',
    difficulty: 'High',
    summary: 'A progression path for serious hosts that want tighter moderation, better onboarding, and premium-grade signaling.',
    accent: 'linear-gradient(135deg, rgba(227,172,54,0.92), rgba(58,38,8,0.96))',
    checkpoints: ['Complete server hardening', 'Enable operator metrics', 'Pass trust threshold'],
  },
];

function DiscoverServerCard({ community, joined, joining, onOpen, onJoin }: DiscoverCardProps) {
  return (
    <div className="overflow-hidden rounded-[28px] border border-surface-700 bg-surface-900/92 shadow-[0_16px_60px_rgba(0,0,0,0.28)] transition-transform duration-300 hover:-translate-y-0.5">
      <button
        type="button"
        onClick={onOpen}
        className="block h-44 w-full bg-cover bg-center text-left"
        style={{
          backgroundImage: community.banner_url
            ? `linear-gradient(180deg, rgba(7,18,30,0.1), rgba(7,18,30,0.72)), url(${community.banner_url})`
            : 'linear-gradient(135deg, rgba(42,78,154,0.95), rgba(18,28,56,0.95))',
        }}
      >
        <div className="flex h-full items-end px-5 pb-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="h-14 w-14 overflow-hidden rounded-[18px] border border-white/10 bg-surface-900 shadow-xl">
              {community.icon_url ? (
                <img src={community.icon_url} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-lg font-black text-nyptid-200">
                  {community.name.slice(0, 2).toUpperCase()}
                </div>
              )}
            </div>
            <div className="min-w-0">
              <div className="truncate text-2xl font-black text-white">{community.name}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-white/75">
                <span className="inline-flex items-center gap-1"><Users size={12} />{Number(community.member_count || 0).toLocaleString()}</span>
                <Badge size="sm">{community.category}</Badge>
                {community.visibility === 'private' && <span className="inline-flex items-center gap-1"><Lock size={12} />Invite only</span>}
              </div>
            </div>
          </div>
        </div>
      </button>

      <div className="p-5">
        <div className="min-h-[4.5rem] text-sm leading-6 text-surface-300">
          {community.description || 'Open the server to view channels, members, and onboarding.'}
        </div>
        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="text-xs text-surface-500">
            {community.visibility === 'private'
              ? 'Invite required to enter this server'
              : 'Open join server with instant access'}
          </div>
          <button
            type="button"
            onClick={joined ? onOpen : onJoin}
            disabled={joining}
            className={joined ? 'nyptid-btn-secondary px-4 py-2 text-sm' : 'nyptid-btn-primary px-4 py-2 text-sm'}
          >
            {joining ? 'Joining...' : joined ? 'Open Server' : 'Join Server'}
          </button>
        </div>
      </div>
    </div>
  );
}

function MetricTile({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-[24px] border border-surface-700 bg-surface-950/70 px-4 py-4">
      <div className="text-[11px] uppercase tracking-[0.22em] text-surface-500">{label}</div>
      <div className="mt-2 text-2xl font-black text-surface-100">{value}</div>
      <div className="mt-1 text-xs text-surface-500">{detail}</div>
    </div>
  );
}

export function DiscoverPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const discoverTab = String(searchParams.get('tab') || 'servers').toLowerCase() as DiscoverTab;
  const activeTab: DiscoverTab = discoverTab === 'apps' || discoverTab === 'quests' ? discoverTab : 'servers';

  const [communities, setCommunities] = useState<Community[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('Home');
  const [joining, setJoining] = useState<string | null>(null);
  const [joinedIds, setJoinedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!profile) return;
    supabase
      .from('community_members')
      .select('community_id')
      .eq('user_id', profile.id)
      .then(({ data }) => {
        if (data) {
          setJoinedIds(new Set((data || []).map((member: { community_id: string }) => member.community_id)));
        }
      });
  }, [profile]);

  useEffect(() => {
    if (activeTab !== 'servers') {
      setLoading(false);
      return;
    }
    setLoading(true);

    let query = supabase
      .from('communities')
      .select('*')
      .eq('visibility', 'public')
      .order('member_count', { ascending: false });

    if (activeCategory !== 'Home') {
      query = query.eq('category', activeCategory);
    }
    if (search.trim()) {
      query = query.or(`name.ilike.%${search.trim()}%,description.ilike.%${search.trim()}%`);
    }

    query.limit(48).then(({ data }) => {
      setCommunities((data || []) as Community[]);
      setLoading(false);
    });
  }, [activeCategory, activeTab, search]);

  async function handleJoin(communityId: string) {
    if (!profile || joining) return;
    setJoining(communityId);
    const { data: customizationRow } = await supabase
      .from('community_server_customizations')
      .select('invite_only')
      .eq('community_id', communityId)
      .maybeSingle();

    const inviteOnly = Boolean((customizationRow as { invite_only?: boolean } | null)?.invite_only);
    if (inviteOnly) {
      const suppliedCode = String(window.prompt('This server is invite-only. Paste your invite code to join.') || '').trim();
      if (!suppliedCode) {
        setJoining(null);
        return;
      }
      const { error: inviteJoinError } = await supabase.rpc('join_community_with_invite', {
        p_code: suppliedCode,
        p_community_id: communityId,
      } as never);
      if (inviteJoinError) {
        window.alert(`Join failed: ${inviteJoinError.message}`);
        setJoining(null);
        return;
      }
    } else {
      const { error: joinError } = await supabase.from('community_members').insert({
        community_id: communityId,
        user_id: profile.id,
        role: 'member',
      } as never);
      if (joinError && !String(joinError.message || '').toLowerCase().includes('duplicate')) {
        window.alert(`Join failed: ${joinError.message}`);
        setJoining(null);
        return;
      }
    }

    setJoinedIds((prev) => new Set([...prev, communityId]));
    setJoining(null);
  }

  const heroCommunity = communities[0] || null;
  const spotlightCount = useMemo(
    () => communities.slice(0, 6).reduce((sum, community) => sum + Number(community.member_count || 0), 0),
    [communities],
  );
  const operatorPicks = useMemo(() => {
    const featured = communities.filter((community) => community.is_featured);
    return (featured.length > 0 ? featured : communities).slice(0, 3);
  }, [communities]);
  const trendingCommunities = useMemo(() => communities.slice(0, 6), [communities]);
  const freshCommunities = useMemo(
    () => [...communities].sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime()).slice(0, 4),
    [communities],
  );
  const joinedVisibleCommunities = useMemo(
    () => communities.filter((community) => joinedIds.has(community.id)).length,
    [communities, joinedIds],
  );
  const sidebarTabs: Array<{ id: DiscoverTab; label: string; icon: typeof Compass; subtitle: string; count: string }> = [
    { id: 'servers', label: 'Servers', icon: Compass, subtitle: 'Public communities with instant routing', count: `${communities.length || 0}` },
    { id: 'apps', label: 'Apps', icon: Sparkles, subtitle: 'Tools, bots, and operator utilities', count: `${APP_SPOTLIGHTS.length}` },
    { id: 'quests', label: 'Quests', icon: Swords, subtitle: 'Campaigns, unlock paths, and rewards', count: `${QUEST_CAMPAIGNS.length}` },
  ];

  return (
    <AppShell showChannelSidebar={false} title="Discover">
      <div className="h-full overflow-y-auto bg-[radial-gradient(circle_at_top,_rgba(65,92,186,0.18),_transparent_30%),linear-gradient(180deg,_rgba(8,11,18,1),_rgba(10,13,20,1))]">
        <div className="mx-auto flex min-h-full w-full max-w-[1640px] gap-6 px-4 py-4 lg:px-6 lg:py-6">
          <aside className="hidden w-[23rem] flex-shrink-0 xl:block">
            <div className="sticky top-4 space-y-5">
              <div className="rounded-[32px] border border-surface-700 bg-surface-900/80 p-6 shadow-[0_24px_90px_rgba(0,0,0,0.35)] backdrop-blur">
                <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-nyptid-200">Discovery Matrix</div>
                <div className="mt-3 text-4xl font-black text-surface-100">Find the signal.</div>
                <div className="mt-3 text-sm leading-6 text-surface-400">
                  Incore discovery should feel editorial, tactical, and fast. This surface now splits servers, apps, and quests into distinct browsing lanes instead of one generic list.
                </div>
                <div className="mt-6 space-y-3">
                  {sidebarTabs.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setSearchParams(tab.id === 'servers' ? {} : { tab: tab.id })}
                      className={`flex w-full items-center gap-3 rounded-[24px] border px-4 py-4 text-left transition-colors ${
                        activeTab === tab.id
                          ? 'border-surface-600 bg-surface-800 text-surface-100'
                          : 'border-transparent bg-surface-900/40 text-surface-400 hover:border-surface-700 hover:bg-surface-800/60 hover:text-surface-200'
                      }`}
                    >
                      <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${
                        activeTab === tab.id ? 'bg-nyptid-300/15 text-nyptid-200' : 'bg-surface-800 text-surface-500'
                      }`}>
                        <tab.icon size={20} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-lg font-bold">{tab.label}</div>
                          <span className="rounded-full border border-surface-700 bg-surface-900/90 px-2 py-0.5 text-[10px] font-bold text-surface-300">
                            {tab.count}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-surface-500">{tab.subtitle}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <MetricTile
                  label="Spotlight Reach"
                  value={spotlightCount.toLocaleString()}
                  detail="Combined members across the top discovery slice."
                />
                <MetricTile
                  label="Joined Here"
                  value={joinedVisibleCommunities.toLocaleString()}
                  detail="Servers in the current filter you already belong to."
                />
              </div>
            </div>
          </aside>

          <main className="min-w-0 flex-1">
            {activeTab === 'servers' && (
              <div className="space-y-6">
                <section className="overflow-hidden rounded-[34px] border border-surface-700 bg-surface-900 shadow-[0_24px_90px_rgba(0,0,0,0.35)]">
                  <div className="relative overflow-hidden border-b border-surface-800 bg-[#1f286f]">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(255,255,255,0.16),_transparent_35%)]" />
                    <div className="relative px-5 py-5 lg:px-7 lg:py-6">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                          <div className="text-[11px] font-bold uppercase tracking-[0.28em] text-white/70">Incore Discovery</div>
                          <div className="mt-3 max-w-4xl text-4xl font-black leading-none text-white lg:text-[4.7rem]">
                            Find the communities worth your time.
                          </div>
                          <div className="mt-4 max-w-2xl text-base text-white/80 lg:text-lg">
                            Discovery now splits operator picks, fast movers, and fresh drops so the tab feels curated instead of interchangeable.
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-3 lg:w-[30rem] lg:grid-cols-1">
                          <MetricTile
                            label="Visible"
                            value={communities.length.toLocaleString()}
                            detail="Public servers in the current directory slice."
                          />
                          <MetricTile
                            label="Operator Picks"
                            value={operatorPicks.length.toLocaleString()}
                            detail="Featured or top-ranked communities for this filter."
                          />
                          <MetricTile
                            label="Joined"
                            value={joinedIds.size.toLocaleString()}
                            detail="All communities already on your account."
                          />
                        </div>
                      </div>

                      <div className="mt-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                        <div className="flex flex-wrap gap-3 text-sm font-semibold text-white/85">
                          {DISCOVER_CATEGORIES.map((category) => (
                            <button
                              key={category}
                              type="button"
                              onClick={() => setActiveCategory(category)}
                              className={`rounded-full border px-4 py-2 transition-colors ${
                                activeCategory === category
                                  ? 'border-white/30 bg-white/12 text-white'
                                  : 'border-white/10 bg-white/5 text-white/70 hover:border-white/20 hover:text-white'
                              }`}
                            >
                              {category}
                            </button>
                          ))}
                        </div>

                        <div className="relative w-full max-w-md">
                          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/55" />
                          <input
                            type="text"
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="Search servers, operators, or niches..."
                            className="h-12 w-full rounded-2xl border border-white/10 bg-[#151b4e] pl-11 pr-4 text-sm text-white placeholder:text-white/45 outline-none transition-colors focus:border-white/25"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-6 bg-surface-900 px-5 py-6 lg:grid-cols-[1.2fr_0.8fr] lg:px-7">
                    <div className="rounded-[28px] border border-surface-700 bg-surface-950/70 p-5">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-surface-500">Signal Leader</div>
                          <div className="mt-2 text-3xl font-black text-surface-100">
                            {heroCommunity?.name || 'No server selected'}
                          </div>
                          <div className="mt-3 max-w-2xl text-sm leading-6 text-surface-400">
                            {heroCommunity?.description || 'Adjust your filters to pull a stronger discovery slice.'}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-surface-500">
                          <Flame size={14} className="text-orange-300" />
                          Hottest server right now
                        </div>
                      </div>

                      <div
                        className="mt-5 h-56 rounded-[24px] border border-surface-700 bg-cover bg-center"
                        style={{
                          backgroundImage: heroCommunity?.banner_url
                            ? `linear-gradient(135deg, rgba(12,15,28,0.25), rgba(12,15,28,0.72)), url(${heroCommunity.banner_url})`
                            : 'linear-gradient(135deg, rgba(74,101,214,0.28), rgba(17,24,42,0.96))',
                        }}
                      />

                      <div className="mt-5 flex flex-wrap items-center gap-3 text-xs text-surface-400">
                        <span className="inline-flex items-center gap-1 rounded-full border border-surface-700 bg-surface-900 px-3 py-1">
                          <Users size={12} className="text-surface-500" />
                          {Number(heroCommunity?.member_count || 0).toLocaleString()} members
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-full border border-surface-700 bg-surface-900 px-3 py-1">
                          <Radar size={12} className="text-nyptid-200" />
                          {heroCommunity?.category || 'General'}
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-full border border-surface-700 bg-surface-900 px-3 py-1">
                          <ShieldCheck size={12} className="text-emerald-300" />
                          Public routing ready
                        </span>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="rounded-[28px] border border-surface-700 bg-surface-950/70 p-5">
                        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-surface-500">
                          <Rocket size={14} className="text-nyptid-200" />
                          Operator Picks
                        </div>
                        <div className="mt-4 space-y-3">
                          {operatorPicks.map((community) => (
                            <button
                              key={community.id}
                              type="button"
                              onClick={() => navigate(`/app/community/${community.id}`)}
                              className="flex w-full items-center gap-3 rounded-2xl border border-surface-700 bg-surface-900/80 px-3 py-3 text-left transition-colors hover:border-surface-600 hover:bg-surface-800"
                            >
                              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-surface-800 text-sm font-black text-nyptid-200">
                                {community.name.slice(0, 2).toUpperCase()}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-semibold text-surface-100">{community.name}</div>
                                <div className="mt-0.5 truncate text-xs text-surface-500">{community.description || community.category}</div>
                              </div>
                              <span className="text-[11px] text-surface-500">{Number(community.member_count || 0).toLocaleString()}</span>
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="rounded-[28px] border border-surface-700 bg-surface-950/70 p-5">
                        <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-surface-500">Fresh Drops</div>
                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          {freshCommunities.map((community) => (
                            <button
                              key={community.id}
                              type="button"
                              onClick={() => navigate(`/app/community/${community.id}`)}
                              className="rounded-2xl border border-surface-700 bg-surface-900/80 px-4 py-4 text-left transition-colors hover:border-surface-600 hover:bg-surface-800"
                            >
                              <div className="truncate text-sm font-semibold text-surface-100">{community.name}</div>
                              <div className="mt-1 text-xs text-surface-500">{community.category}</div>
                              <div className="mt-3 text-[11px] text-surface-400">
                                Updated {new Date(community.updated_at || community.created_at || 0).toLocaleDateString()}
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                <section className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-3xl font-black text-surface-100">Fast Movers</div>
                      <div className="mt-1 text-sm text-surface-500">The strongest public communities in the current slice.</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => navigate('/app')}
                      className="hidden rounded-2xl border border-surface-700 bg-surface-900/80 px-4 py-2 text-sm font-semibold text-surface-300 transition-colors hover:border-surface-600 hover:text-surface-100 lg:inline-flex lg:items-center lg:gap-2"
                    >
                      <Plus size={14} />
                      Back to app
                    </button>
                  </div>

                  {loading ? (
                    <div className="grid gap-5 xl:grid-cols-2">
                      {Array.from({ length: 4 }).map((_, index) => (
                        <div key={index} className="h-[24rem] animate-pulse rounded-[28px] border border-surface-700 bg-surface-900/40" />
                      ))}
                    </div>
                  ) : trendingCommunities.length === 0 ? (
                    <div className="rounded-[28px] border border-dashed border-surface-700 bg-surface-900/60 px-6 py-14 text-center">
                      <Globe size={42} className="mx-auto text-surface-600" />
                      <div className="mt-4 text-xl font-bold text-surface-100">No servers matched this slice</div>
                      <div className="mt-2 text-sm text-surface-500">Change the category or search to broaden the directory.</div>
                    </div>
                  ) : (
                    <div className="grid gap-5 xl:grid-cols-2">
                      {trendingCommunities.map((community) => (
                        <DiscoverServerCard
                          key={community.id}
                          community={community}
                          joined={joinedIds.has(community.id)}
                          joining={joining === community.id}
                          onOpen={() => navigate(`/app/community/${community.id}`)}
                          onJoin={() => void handleJoin(community.id)}
                        />
                      ))}
                    </div>
                  )}
                </section>
              </div>
            )}

            {activeTab === 'apps' && (
              <div className="space-y-6">
                <section className="overflow-hidden rounded-[34px] border border-surface-700 bg-surface-900 shadow-[0_24px_90px_rgba(0,0,0,0.35)]">
                  <div className="grid gap-6 px-5 py-6 lg:grid-cols-[1.1fr_0.9fr] lg:px-7">
                    <div>
                      <div className="inline-flex items-center gap-2 rounded-full border border-nyptid-300/30 bg-nyptid-300/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.22em] text-nyptid-200">
                        <Sparkles size={12} />
                        App Directory
                      </div>
                      <div className="mt-4 max-w-4xl text-4xl font-black leading-none text-surface-100 lg:text-[4.4rem]">
                        Tools with teeth, not placeholder tiles.
                      </div>
                      <div className="mt-4 max-w-2xl text-base leading-7 text-surface-400">
                        The app lane is now presented like a premium operator catalog: trust level, install signal, and concrete use cases instead of a generic "coming soon" block.
                      </div>

                      <div className="mt-6 grid gap-3 sm:grid-cols-3">
                        <MetricTile label="Verified" value="12" detail="App surfaces staged for trust-reviewed rollout." />
                        <MetricTile label="Ops Tools" value="7" detail="Moderation, triage, and growth-control utilities." />
                        <MetricTile label="Pipeline" value="3" detail="Approval gates before public install goes live." />
                      </div>
                    </div>

                    <div className="rounded-[30px] border border-surface-700 bg-surface-950/70 p-5">
                      <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-surface-500">
                        <ShieldCheck size={13} className="text-emerald-300" />
                        Approval Rail
                      </div>
                      <div className="mt-4 space-y-4">
                        {[
                          ['Security review', 'Runtime permissions, remote calls, and storage access are inspected first.'],
                          ['Trust labeling', 'Each app card surfaces whether it is verified, approved, or operator-only.'],
                          ['Scoped install', 'Install surfaces will ship with explicit permission disclosure and audit logs.'],
                        ].map(([title, body]) => (
                          <div key={title} className="rounded-2xl border border-surface-700 bg-surface-900/80 px-4 py-4">
                            <div className="text-sm font-semibold text-surface-100">{title}</div>
                            <div className="mt-1 text-xs leading-6 text-surface-500">{body}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>

                <section className="grid gap-5 xl:grid-cols-3">
                  {APP_SPOTLIGHTS.map((app) => (
                    <div key={app.id} className="overflow-hidden rounded-[30px] border border-surface-700 bg-surface-900 shadow-[0_18px_70px_rgba(0,0,0,0.3)]">
                      <div className="h-40 border-b border-surface-700 px-5 py-5" style={{ backgroundImage: app.accent }}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/70">{app.category}</div>
                            <div className="mt-3 text-3xl font-black text-white">{app.name}</div>
                            <div className="mt-2 text-sm text-white/80">{app.tagline}</div>
                          </div>
                          <div className="rounded-full border border-white/15 bg-black/20 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white/80">
                            {app.trust}
                          </div>
                        </div>
                      </div>
                      <div className="p-5">
                        <div className="text-sm leading-6 text-surface-300">{app.summary}</div>
                        <div className="mt-4 flex flex-wrap gap-2">
                          {app.tags.map((tag) => (
                            <span key={tag} className="rounded-full border border-surface-700 bg-surface-950 px-3 py-1 text-[11px] text-surface-400">
                              {tag}
                            </span>
                          ))}
                        </div>
                        <div className="mt-5 flex items-center justify-between gap-3">
                          <div className="text-xs text-surface-500">{app.installs}</div>
                          <button
                            type="button"
                            onClick={() => window.alert(`${app.name} install flows are staged next.`)}
                            className="nyptid-btn-secondary px-4 py-2 text-xs"
                          >
                            Preview
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </section>
              </div>
            )}

            {activeTab === 'quests' && (
              <div className="space-y-6">
                <section className="overflow-hidden rounded-[34px] border border-surface-700 bg-surface-900 shadow-[0_24px_90px_rgba(0,0,0,0.35)]">
                  <div className="grid gap-6 px-5 py-6 lg:grid-cols-[1.05fr_0.95fr] lg:px-7">
                    <div>
                      <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.22em] text-amber-200">
                        <Swords size={12} />
                        Quest Surface
                      </div>
                      <div className="mt-4 max-w-4xl text-4xl font-black leading-none text-surface-100 lg:text-[4.3rem]">
                        Discovery that leads somewhere.
                      </div>
                      <div className="mt-4 max-w-2xl text-base leading-7 text-surface-400">
                        Quests are framed as campaign rails with rewards, checkpoints, and difficulty. That gives the tab a real identity instead of another empty marketing pane.
                      </div>
                    </div>

                    <div className="rounded-[30px] border border-surface-700 bg-surface-950/70 p-5">
                      <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-surface-500">
                        <Target size={13} className="text-amber-200" />
                        Reward Loop
                      </div>
                      <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
                        <MetricTile label="Tracks" value={QUEST_CAMPAIGNS.length.toString()} detail="Curated campaigns staged for rollout." />
                        <MetricTile label="Rewards" value="XP + Trust" detail="Quest outputs connect to identity and discovery placement." />
                        <MetricTile label="Flow" value="Guided" detail="Each quest breaks into checkpoints instead of walls of copy." />
                      </div>
                    </div>
                  </div>
                </section>

                <section className="grid gap-5 xl:grid-cols-3">
                  {QUEST_CAMPAIGNS.map((quest) => (
                    <div key={quest.id} className="overflow-hidden rounded-[30px] border border-surface-700 bg-surface-900 shadow-[0_18px_70px_rgba(0,0,0,0.3)]">
                      <div className="h-44 border-b border-surface-700 px-5 py-5" style={{ backgroundImage: quest.accent }}>
                        <div className="flex h-full flex-col justify-between">
                          <div className="flex items-start justify-between gap-3">
                            <div className="rounded-full border border-white/15 bg-black/20 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white/80">
                              {quest.difficulty}
                            </div>
                            <div className="rounded-full border border-white/15 bg-black/20 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white/80">
                              {quest.duration}
                            </div>
                          </div>
                          <div>
                            <div className="text-3xl font-black text-white">{quest.name}</div>
                            <div className="mt-2 text-sm text-white/80">{quest.reward}</div>
                          </div>
                        </div>
                      </div>
                      <div className="p-5">
                        <div className="text-sm leading-6 text-surface-300">{quest.summary}</div>
                        <div className="mt-4 space-y-2">
                          {quest.checkpoints.map((checkpoint, index) => (
                            <div key={checkpoint} className="flex items-start gap-3 rounded-2xl border border-surface-700 bg-surface-950/80 px-3 py-3">
                              <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-surface-800 text-[11px] font-bold text-amber-200">
                                {index + 1}
                              </div>
                              <div className="text-sm text-surface-300">{checkpoint}</div>
                            </div>
                          ))}
                        </div>
                        <div className="mt-5 flex items-center justify-between gap-3 text-xs text-surface-500">
                          <span>Quest rollout rail is ready.</span>
                          <button
                            type="button"
                            onClick={() => window.alert(`${quest.name} campaign actions are staged next.`)}
                            className="nyptid-btn-secondary px-4 py-2 text-xs"
                          >
                            Inspect
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </section>

                <section className="rounded-[30px] border border-surface-700 bg-surface-900/85 p-5 shadow-[0_18px_70px_rgba(0,0,0,0.24)]">
                  <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-surface-500">
                    <Trophy size={13} className="text-amber-200" />
                    Why this matters
                  </div>
                  <div className="mt-4 grid gap-4 lg:grid-cols-3">
                    {[
                      ['Campaign identity', 'Quests now look and read like guided operations rather than placeholder cards.'],
                      ['Reward clarity', 'Every lane shows the upside: XP, trust review, discovery placement, or badges.'],
                      ['Launch readiness', 'The page can accept live quest data later without another visual rewrite.'],
                    ].map(([title, body]) => (
                      <div key={title} className="rounded-2xl border border-surface-700 bg-surface-950/70 px-4 py-4">
                        <div className="text-lg font-bold text-surface-100">{title}</div>
                        <div className="mt-2 text-sm leading-6 text-surface-400">{body}</div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            )}
          </main>
        </div>
      </div>
    </AppShell>
  );
}
