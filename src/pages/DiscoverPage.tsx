import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Compass,
  Globe,
  Lock,
  Plus,
  Search,
  Sparkles,
  Swords,
  Users,
} from 'lucide-react';
import { AppShell } from '../components/layout/AppShell';
import { Badge } from '../components/ui/Badge';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { COMMUNITY_CATEGORIES } from '../lib/utils';
import type { Community } from '../lib/types';

type DiscoverTab = 'apps' | 'servers' | 'quests';

interface DiscoverCardProps {
  community: Community;
  joined: boolean;
  joining: boolean;
  onOpen: () => void;
  onJoin: () => void;
}

function DiscoverServerCard({ community, joined, joining, onOpen, onJoin }: DiscoverCardProps) {
  return (
    <div className="overflow-hidden rounded-[26px] border border-surface-700 bg-surface-900/92 shadow-[0_16px_60px_rgba(0,0,0,0.28)] transition-transform duration-300 hover:-translate-y-0.5">
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

export function DiscoverPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const discoverTab = (String(searchParams.get('tab') || 'servers').toLowerCase() as DiscoverTab);
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
        if (data) setJoinedIds(new Set(data.map((member: any) => member.community_id)));
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
      if (data) setCommunities(data as Community[]);
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

    const inviteOnly = Boolean((customizationRow as any)?.invite_only);
    if (inviteOnly) {
      const suppliedCode = String(window.prompt('This server is invite-only. Paste your invite code to join.') || '').trim();
      if (!suppliedCode) {
        setJoining(null);
        return;
      }
      const { error: inviteJoinError } = await supabase.rpc('join_community_with_invite', {
        p_code: suppliedCode,
        p_community_id: communityId,
      } as any);
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
      } as any);
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
  const featuredCommunities = communities.slice(0, 8);
  const sidebarTabs: { id: DiscoverTab; label: string; icon: typeof Compass; subtitle: string }[] = [
    { id: 'apps', label: 'Apps', icon: Sparkles, subtitle: 'Bots, tools, and integrations' },
    { id: 'servers', label: 'Servers', icon: Compass, subtitle: 'Public communities you can join' },
    { id: 'quests', label: 'Quests', icon: Swords, subtitle: 'Featured campaigns and unlock paths' },
  ];
  const discoverCategories = ['Home', 'Gaming', 'Music', 'Entertainment', 'Science', 'Technology', 'Education', 'Business'];
  const spotlightCount = communities.slice(0, 4).reduce((sum, community) => sum + Number(community.member_count || 0), 0);

  return (
    <AppShell showChannelSidebar={false} title="Discover">
      <div className="h-full overflow-y-auto bg-surface-950">
        <div className="flex min-h-full">
          <aside className="hidden w-[22rem] flex-shrink-0 border-r border-surface-800 bg-surface-900/75 px-6 py-6 xl:block">
            <div className="text-4xl font-black text-surface-100">Discover</div>
            <div className="mt-2 text-sm text-surface-500">
              Find public NCore communities, app surfaces, and curated launch channels from one directory.
            </div>

            <div className="mt-8 space-y-3">
              {sidebarTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setSearchParams(tab.id === 'servers' ? {} : { tab: tab.id })}
                  className={`flex w-full items-center gap-3 rounded-[22px] border px-4 py-4 text-left transition-colors ${
                    activeTab === tab.id
                      ? 'border-surface-600 bg-surface-800 text-surface-100'
                      : 'border-transparent bg-surface-900/40 text-surface-400 hover:border-surface-700 hover:bg-surface-800/60 hover:text-surface-200'
                  }`}
                >
                  <div className={`flex h-11 w-11 items-center justify-center rounded-2xl ${
                    activeTab === tab.id ? 'bg-nyptid-300/15 text-nyptid-200' : 'bg-surface-800 text-surface-500'
                  }`}>
                    <tab.icon size={20} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-lg font-bold">{tab.label}</div>
                    <div className="text-xs text-surface-500">{tab.subtitle}</div>
                  </div>
                </button>
              ))}
            </div>

            <div className="mt-8 rounded-[24px] border border-surface-700 bg-surface-950/70 p-5">
              <div className="text-xs font-bold uppercase tracking-[0.28em] text-surface-500">Directory Pulse</div>
              <div className="mt-4 text-4xl font-black text-surface-100">{spotlightCount.toLocaleString()}</div>
              <div className="mt-1 text-sm text-surface-400">combined member reach across the current spotlight</div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-surface-700 bg-surface-900/70 px-3 py-3">
                  <div className="text-[11px] uppercase tracking-wide text-surface-500">Visible Servers</div>
                  <div className="mt-1 text-xl font-black text-surface-100">{communities.length}</div>
                </div>
                <div className="rounded-2xl border border-surface-700 bg-surface-900/70 px-3 py-3">
                  <div className="text-[11px] uppercase tracking-wide text-surface-500">Joined</div>
                  <div className="mt-1 text-xl font-black text-surface-100">{joinedIds.size}</div>
                </div>
              </div>
            </div>
          </aside>

          <main className="min-w-0 flex-1">
            {activeTab === 'servers' && (
              <div className="px-5 py-5 lg:px-8 lg:py-6">
                <div className="overflow-hidden rounded-[30px] border border-surface-700 bg-surface-900 shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
                  <div className="border-b border-surface-800 bg-[#2b2f8e]">
                    <div className="flex flex-col gap-4 px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
                      <div className="flex flex-wrap gap-4 text-sm font-semibold text-white/85">
                        {discoverCategories.map((category) => (
                          <button
                            key={category}
                            type="button"
                            onClick={() => setActiveCategory(category)}
                            className={`border-b-2 pb-3 transition-colors ${
                              activeCategory === category
                                ? 'border-white text-white'
                                : 'border-transparent text-white/70 hover:text-white'
                            }`}
                          >
                            {category}
                          </button>
                        ))}
                      </div>
                      <div className="relative w-full max-w-sm">
                        <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/55" />
                        <input
                          type="text"
                          value={search}
                          onChange={(event) => setSearch(event.target.value)}
                          placeholder="Search servers..."
                          className="h-12 w-full rounded-2xl border border-white/10 bg-[#1d215d] pl-11 pr-4 text-sm text-white placeholder:text-white/45 outline-none transition-colors focus:border-white/25"
                        />
                      </div>
                    </div>

                    <div className="grid gap-6 px-6 pb-8 pt-3 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
                      <div>
                        <div className="text-[11px] font-bold uppercase tracking-[0.28em] text-white/70">NCore Discovery</div>
                        <div className="mt-4 max-w-3xl text-4xl font-black leading-none text-white lg:text-[4.5rem]">
                          Find your community on NCore.
                        </div>
                        <div className="mt-4 max-w-2xl text-lg text-white/80">
                          From private operators to public communities, discover the servers worth joining and route into them fast.
                        </div>
                      </div>
                      <div
                        className="h-48 rounded-[24px] border border-white/10 bg-cover bg-center shadow-2xl"
                        style={{
                          backgroundImage: heroCommunity?.banner_url
                            ? `linear-gradient(135deg, rgba(16,20,45,0.25), rgba(16,20,45,0.55)), url(${heroCommunity.banner_url})`
                            : 'linear-gradient(135deg, rgba(255,255,255,0.12), rgba(255,255,255,0.04))',
                        }}
                      />
                    </div>
                  </div>

                  <div className="bg-surface-900 px-6 py-7">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-3xl font-black text-surface-100">Featured Servers</div>
                        <div className="mt-1 text-sm text-surface-500">Curated public communities currently visible in discovery.</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => navigate('/app')}
                        className="hidden rounded-2xl border border-surface-700 bg-surface-950/70 px-4 py-2 text-sm font-semibold text-surface-300 transition-colors hover:border-surface-600 hover:text-surface-100 lg:inline-flex lg:items-center lg:gap-2"
                      >
                        <Plus size={14} />
                        Back to app
                      </button>
                    </div>

                    {loading ? (
                      <div className="mt-6 grid gap-5 xl:grid-cols-2">
                        {Array.from({ length: 4 }).map((_, index) => (
                          <div key={index} className="h-[24rem] animate-pulse rounded-[26px] border border-surface-700 bg-surface-950/60" />
                        ))}
                      </div>
                    ) : featuredCommunities.length === 0 ? (
                      <div className="mt-8 rounded-[26px] border border-dashed border-surface-700 bg-surface-950/60 px-6 py-14 text-center">
                        <Globe size={42} className="mx-auto text-surface-600" />
                        <div className="mt-4 text-xl font-bold text-surface-100">No servers matched this slice</div>
                        <div className="mt-2 text-sm text-surface-500">Change the category or search to broaden the directory.</div>
                      </div>
                    ) : (
                      <div className="mt-6 grid gap-5 xl:grid-cols-2">
                        {featuredCommunities.map((community) => (
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
                  </div>
                </div>
              </div>
            )}

            {activeTab !== 'servers' && (
              <div className="px-5 py-5 lg:px-8 lg:py-6">
                <div className="rounded-[30px] border border-surface-700 bg-surface-900 px-6 py-7 shadow-[0_24px_80px_rgba(0,0,0,0.3)]">
                  <div className="text-[11px] font-bold uppercase tracking-[0.28em] text-nyptid-200">
                    {activeTab === 'apps' ? 'App Directory' : 'Quest Surface'}
                  </div>
                  <div className="mt-4 text-4xl font-black text-surface-100">
                    {activeTab === 'apps' ? 'App discovery is wired next.' : 'Quest discovery is staged next.'}
                  </div>
                  <div className="mt-4 max-w-3xl text-base text-surface-400">
                    The server shell now routes into these surfaces, but the public catalog data still needs to be populated. The tab works, the layout works, and the next release can land content without another discover overhaul.
                  </div>

                  <div className="mt-8 grid gap-4 lg:grid-cols-3">
                    {[
                      {
                        title: activeTab === 'apps' ? 'Verified tools' : 'Operator missions',
                        body: activeTab === 'apps'
                          ? 'Browse approved utilities, moderation apps, and workflow integrations.'
                          : 'Time-boxed campaigns and progression quests for communities.',
                      },
                      {
                        title: activeTab === 'apps' ? 'Approval pipeline' : 'Reward rails',
                        body: activeTab === 'apps'
                          ? 'App directory approval and trust rails are now represented in the UI.'
                          : 'Quest rewards, XP unlocks, and completion validation slot here.',
                      },
                      {
                        title: activeTab === 'apps' ? 'Permissions preview' : 'Campaign analytics',
                        body: activeTab === 'apps'
                          ? 'App scopes, install permissions, and audit trails will live here.'
                          : 'Community campaign conversion, participation, and completion metrics go here.',
                      },
                    ].map((item) => (
                      <div key={item.title} className="rounded-[24px] border border-surface-700 bg-surface-950/70 p-5">
                        <div className="text-lg font-bold text-surface-100">{item.title}</div>
                        <div className="mt-2 text-sm leading-6 text-surface-400">{item.body}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </AppShell>
  );
}
