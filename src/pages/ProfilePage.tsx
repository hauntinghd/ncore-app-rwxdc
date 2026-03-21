import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Calendar, MessageSquare, Award, Users, BookOpen, Crown, Shield, CreditCard as Edit3 } from 'lucide-react';
import { AppShell } from '../components/layout/AppShell';
import { Avatar } from '../components/ui/Avatar';
import { Badge } from '../components/ui/Badge';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import type { Profile, UserAchievement, Community } from '../lib/types';
import { getRankInfo, getRankBadgeClasses, getPlatformRoleBadge, getCommunityRoleBadge } from '../lib/utils';

export function ProfilePage() {
  const { userId } = useParams<{ userId: string }>();
  const { profile: currentProfile } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [achievements, setAchievements] = useState<UserAchievement[]>([]);
  const [communities, setCommunities] = useState<Array<Community & { member_role: string }>>([]);
  const [loading, setLoading] = useState(true);

  const isOwn = userId === currentProfile?.id;

  useEffect(() => {
    if (!userId) return;
    Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
      supabase.from('user_achievements').select('*, achievements(*)').eq('user_id', userId).order('earned_at', { ascending: false }),
      supabase.from('community_members').select('*, communities(*)').eq('user_id', userId).limit(12),
    ]).then(([profileRes, achRes, commRes]) => {
      if (profileRes.data) setProfile(profileRes.data as Profile);
      if (achRes.data) setAchievements(achRes.data as UserAchievement[]);
      if (commRes.data) {
        setCommunities(commRes.data.map((m: any) => ({
          ...m.communities,
          member_role: m.role,
        })));
      }
      setLoading(false);
    });
  }, [userId]);

  if (loading) {
    return (
      <AppShell showChannelSidebar={false}>
        <div className="flex items-center justify-center h-full">
          <div className="w-8 h-8 border-2 border-nyptid-300 border-t-transparent rounded-full animate-spin" />
        </div>
      </AppShell>
    );
  }

  if (!profile) {
    return (
      <AppShell showChannelSidebar={false}>
        <div className="flex items-center justify-center h-full text-surface-400">Profile not found</div>
      </AppShell>
    );
  }

  const rankInfo = getRankInfo(profile.xp);
  const rankClasses = getRankBadgeClasses(profile.rank);
  const roleBadge = getPlatformRoleBadge(profile.platform_role);

  return (
    <AppShell showChannelSidebar={false} title={profile.display_name || profile.username}>
      <div className="h-full overflow-y-auto">
        <div className="max-w-3xl mx-auto p-6">
          <div className="nyptid-card overflow-hidden mb-6">
            <div className="h-24 bg-gradient-to-br from-nyptid-900/60 to-surface-800 relative overflow-hidden">
              {profile.banner_url && (
                <img
                  src={profile.banner_url}
                  alt={`${profile.display_name || profile.username} banner`}
                  className="absolute inset-0 w-full h-full object-cover"
                />
              )}
              <div className="absolute inset-0 bg-black/25" />
            </div>
            <div className="px-6 pb-6">
              <div className="flex items-end gap-4 -mt-8 mb-4">
                <div className="relative flex-shrink-0">
                  <div className="w-20 h-20 rounded-2xl border-4 border-surface-800">
                    <Avatar
                      src={profile.avatar_url}
                      name={profile.display_name || profile.username}
                      size="xl"
                      status={profile.status}
                    />
                  </div>
                </div>
                <div className="flex-1 min-w-0 pb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h1 className="text-2xl font-black text-surface-100">
                      {profile.display_name || profile.username}
                    </h1>
                    {profile.platform_role === 'owner' && (
                      <Crown size={18} className="text-nyptid-300" />
                    )}
                    {profile.platform_role === 'admin' && (
                      <Shield size={18} className="text-red-400" />
                    )}
                    {roleBadge && (
                      <span className={`rank-badge ${roleBadge.classes}`}>{roleBadge.label}</span>
                    )}
                  </div>
                  <div className="text-surface-500 text-sm">@{profile.username}</div>
                  {(profile.custom_status || profile.custom_status_emoji) && (
                    <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-surface-700 bg-surface-800/70 px-3 py-1 text-xs text-surface-300">
                      {profile.custom_status_emoji && <span>{profile.custom_status_emoji}</span>}
                      <span className="truncate max-w-[320px]">{profile.custom_status || 'Status set'}</span>
                    </div>
                  )}
                </div>
                {isOwn ? (
                  <button
                    onClick={() => navigate('/app/settings')}
                    className="nyptid-btn-secondary pb-2"
                  >
                    <Edit3 size={14} /> Edit Profile
                  </button>
                ) : (
                  <button
                    onClick={() => navigate('/app/dm')}
                    className="nyptid-btn-secondary pb-2"
                  >
                    <MessageSquare size={14} /> Message
                  </button>
                )}
              </div>

              {profile.bio && (
                <p className="text-surface-300 text-sm mb-4">{profile.bio}</p>
              )}

              <div className="flex items-center gap-4 text-xs text-surface-500">
                <span className="flex items-center gap-1">
                  <Calendar size={12} />
                  Joined {new Date(profile.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                </span>
                <span className="flex items-center gap-1">
                  <Users size={12} />
                  {communities.length} communities
                </span>
              </div>
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-4 mb-6">
            <div className="nyptid-card p-4 col-span-3">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className={`rank-badge ${rankClasses} text-sm px-3 py-1`}>{profile.rank}</span>
                  <span className="text-surface-400 text-sm">{profile.xp.toLocaleString()} XP</span>
                </div>
                <span className="text-xs text-surface-500">
                  {Math.round(rankInfo.progress)}% to next rank
                </span>
              </div>
              <div className="h-2 bg-surface-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-nyptid-500 to-nyptid-300 rounded-full transition-all duration-500"
                  style={{ width: `${rankInfo.progress}%` }}
                />
              </div>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <div className="nyptid-card p-5">
              <h2 className="font-bold text-surface-100 flex items-center gap-2 mb-4">
                <Award size={16} className="text-nyptid-300" />
                Achievements ({achievements.length})
              </h2>
              {achievements.length === 0 ? (
                <div className="text-center py-6">
                  <Award size={28} className="text-surface-700 mx-auto mb-2" />
                  <p className="text-surface-500 text-sm">No achievements yet</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {achievements.map(ua => (
                    <div key={ua.id} className="bg-surface-700/50 rounded-xl p-3 flex flex-col items-center text-center gap-1.5">
                      <div className="w-10 h-10 bg-yellow-500/10 rounded-xl flex items-center justify-center">
                        <Award size={18} className="text-yellow-400" />
                      </div>
                      <span className="text-xs font-semibold text-surface-200">{ua.achievement?.name}</span>
                      <Badge variant="warning" size="sm">+{ua.achievement?.xp_reward} XP</Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="nyptid-card p-5">
              <h2 className="font-bold text-surface-100 flex items-center gap-2 mb-4">
                <Users size={16} className="text-nyptid-300" />
                Communities ({communities.length})
              </h2>
              {communities.length === 0 ? (
                <div className="text-center py-6">
                  <Users size={28} className="text-surface-700 mx-auto mb-2" />
                  <p className="text-surface-500 text-sm">No communities joined</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {communities.slice(0, 6).map(community => {
                    const roleBadge = getCommunityRoleBadge(community.member_role as any);
                    return (
                      <div
                        key={community.id}
                        onClick={() => navigate(`/app/community/${community.id}`)}
                        className="flex items-center gap-3 p-2 rounded-lg hover:bg-surface-700/50 cursor-pointer transition-colors"
                      >
                        <div className="w-8 h-8 rounded-lg bg-nyptid-900/50 flex items-center justify-center text-xs font-bold text-nyptid-300">
                          {community.name?.slice(0, 2).toUpperCase()}
                        </div>
                        <span className="text-sm text-surface-300 flex-1 truncate">{community.name}</span>
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
      </div>
    </AppShell>
  );
}
