import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Users, TrendingUp, Globe, Lock, ArrowRight, Plus } from 'lucide-react';
import { AppShell } from '../components/layout/AppShell';
import { Badge } from '../components/ui/Badge';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { COMMUNITY_CATEGORIES } from '../lib/utils';
import type { Community } from '../lib/types';

export function DiscoverPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [communities, setCommunities] = useState<Community[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  const [joining, setJoining] = useState<string | null>(null);
  const [joinedIds, setJoinedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!profile) return;
    supabase
      .from('community_members')
      .select('community_id')
      .eq('user_id', profile.id)
      .then(({ data }) => {
        if (data) setJoinedIds(new Set(data.map((m: any) => m.community_id)));
      });
  }, [profile]);

  useEffect(() => {
    let query = supabase
      .from('communities')
      .select('*')
      .eq('visibility', 'public')
      .order('member_count', { ascending: false });

    if (activeCategory !== 'All') {
      query = query.eq('category', activeCategory);
    }
    if (search.trim()) {
      query = query.ilike('name', `%${search}%`);
    }

    query.limit(50).then(({ data }) => {
      if (data) setCommunities(data as Community[]);
      setLoading(false);
    });
  }, [search, activeCategory]);

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
      });
      if (joinError) {
        window.alert(`Join failed: ${joinError.message}`);
        setJoining(null);
        return;
      }
    }

    setJoinedIds(prev => new Set([...prev, communityId]));
    setJoining(null);
  }

  const categories = ['All', ...COMMUNITY_CATEGORIES];

  return (
    <AppShell showChannelSidebar={false} title="Discover Communities">
      <div className="h-full overflow-y-auto">
        <div className="max-w-5xl mx-auto p-6">
          <div className="mb-8">
            <h1 className="text-3xl font-black text-surface-100 mb-2">Discover Communities</h1>
            <p className="text-surface-400">Find your people. Join communities built around skills you want to develop.</p>
          </div>

          <div className="flex flex-col md:flex-row gap-4 mb-6">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-500" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search communities..."
                className="nyptid-input pl-9"
              />
            </div>
          </div>

          <div className="flex gap-2 flex-wrap mb-6">
            {categories.slice(0, 12).map(cat => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
                  activeCategory === cat
                    ? 'bg-nyptid-300 text-surface-950'
                    : 'bg-surface-800 text-surface-400 hover:text-surface-200 hover:bg-surface-700 border border-surface-700'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="nyptid-card h-48 animate-pulse" />
              ))}
            </div>
          ) : communities.length === 0 ? (
            <div className="text-center py-16">
              <Globe size={48} className="text-surface-700 mx-auto mb-4" />
              <p className="text-surface-400 text-lg font-medium mb-2">No communities found</p>
              <p className="text-surface-600 text-sm">Try a different search or category</p>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {communities.map(community => {
                const isJoined = joinedIds.has(community.id);
                return (
                  <div key={community.id} className="nyptid-card-hover overflow-hidden group">
                    <div
                      className="h-20 bg-gradient-to-br from-nyptid-900/60 to-surface-800 cursor-pointer"
                      onClick={() => navigate(`/app/community/${community.id}`)}
                    >
                      {community.banner_url && (
                        <img src={community.banner_url} alt="" className="w-full h-full object-cover" />
                      )}
                    </div>
                    <div className="p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div
                          className="flex items-center gap-2 cursor-pointer flex-1 min-w-0"
                          onClick={() => navigate(`/app/community/${community.id}`)}
                        >
                          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-nyptid-800 to-nyptid-950 flex items-center justify-center text-sm font-bold text-nyptid-300 flex-shrink-0 -mt-6 border-2 border-surface-800">
                            {community.icon_url ? (
                              <img src={community.icon_url} alt="" className="w-full h-full rounded-xl object-cover" />
                            ) : (
                              community.name.slice(0, 2).toUpperCase()
                            )}
                          </div>
                          <div className="min-w-0">
                            <h3 className="font-bold text-surface-100 text-sm truncate group-hover:text-nyptid-300 transition-colors">{community.name}</h3>
                          </div>
                        </div>
                        {community.visibility === 'private' && <Lock size={12} className="text-surface-500 mt-1 flex-shrink-0" />}
                      </div>

                      {community.description && (
                        <p className="text-xs text-surface-400 mb-3 line-clamp-2">{community.description}</p>
                      )}

                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 text-xs text-surface-500">
                          <span className="flex items-center gap-1"><Users size={11} /> {community.member_count.toLocaleString()}</span>
                          <Badge size="sm">{community.category}</Badge>
                        </div>
                        <button
                          onClick={() => isJoined ? navigate(`/app/community/${community.id}`) : handleJoin(community.id)}
                          disabled={joining === community.id}
                          className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-all ${
                            isJoined
                              ? 'bg-surface-700 text-surface-300 hover:bg-surface-600'
                              : 'bg-nyptid-300 text-surface-950 hover:bg-nyptid-200'
                          }`}
                        >
                          {joining === community.id ? '...' : isJoined ? 'Open' : 'Join'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
