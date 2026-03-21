import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, Users, MessageSquare, Award, TrendingUp, ArrowRight, Zap, Star } from 'lucide-react';
import { AppShell } from '../components/layout/AppShell';
import { Avatar } from '../components/ui/Avatar';
import { Badge } from '../components/ui/Badge';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { getRankInfo, getRankBadgeClasses, getPlatformRoleBadge, formatRelativeTime } from '../lib/utils';
import type { Community, Notification, UserAchievement } from '../lib/types';

export function DashboardPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [communities, setCommunities] = useState<Community[]>([]);
  const [recentNotifs, setRecentNotifs] = useState<Notification[]>([]);
  const [achievements, setAchievements] = useState<UserAchievement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile) return;

    Promise.all([
      supabase.from('community_members')
        .select('role, community:communities(*)')
        .eq('user_id', profile.id)
        .limit(6),
      supabase.from('notifications')
        .select('*')
        .eq('user_id', profile.id)
        .order('created_at', { ascending: false })
        .limit(5),
      supabase.from('user_achievements')
        .select('*, achievements(*)')
        .eq('user_id', profile.id)
        .order('earned_at', { ascending: false })
        .limit(4),
    ]).then(([commRes, notifRes, achRes]) => {
      if (commRes.data) setCommunities(commRes.data.filter((m: any) => m.community).map((m: any) => ({ ...m.community, is_member: true, member_role: m.role })));
      if (notifRes.data) setRecentNotifs(notifRes.data as Notification[]);
      if (achRes.data) setAchievements(achRes.data as UserAchievement[]);
      setLoading(false);
    });
  }, [profile]);

  if (!profile) return null;

  const rankInfo = getRankInfo(profile.xp);
  const roleBadge = getPlatformRoleBadge(profile.platform_role);
  const rankClasses = getRankBadgeClasses(profile.rank);

  return (
    <AppShell showChannelSidebar={false}>
      <div className="h-full overflow-y-auto">
        <div className="max-w-5xl mx-auto p-6">
          {/* Welcome Header */}
          <div className="flex items-center gap-4 mb-8">
            <div className="relative">
              <Avatar
                src={profile.avatar_url}
                name={profile.display_name || profile.username}
                size="xl"
                status={profile.status}
              />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-2xl font-black text-surface-100">
                  Welcome back, {profile.display_name || profile.username}
                </h1>
                {roleBadge && (
                  <span className={`rank-badge ${roleBadge.classes}`}>{roleBadge.label}</span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span className={`rank-badge ${rankClasses}`}>{profile.rank}</span>
                <span className="text-surface-500 text-sm">{profile.xp.toLocaleString()} XP</span>
              </div>
            </div>
          </div>

          {/* XP Progress */}
          <div className="nyptid-card p-4 mb-6">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <TrendingUp size={16} className="text-nyptid-300" />
                <span className="text-sm font-semibold text-surface-200">Rank Progress</span>
              </div>
              <span className="text-xs text-surface-500">
                {profile.xp.toLocaleString()} / {rankInfo.nextXp.toLocaleString()} XP
              </span>
            </div>
            <div className="h-2 bg-surface-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-nyptid-500 to-nyptid-300 rounded-full transition-all duration-500"
                style={{ width: `${rankInfo.progress}%` }}
              />
            </div>
            <div className="flex items-center justify-between mt-2">
              <span className="text-xs text-surface-500">{profile.rank}</span>
              <span className="text-xs text-surface-500">
                {rankInfo.progress < 100 ? `${Math.round(100 - rankInfo.progress)}% to next rank` : 'Max rank!'}
              </span>
            </div>
          </div>

          {/* Stats Row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            {[
              { label: 'Communities', value: communities.length, icon: Users, color: 'text-blue-400', bg: 'bg-blue-400/10' },
              { label: 'XP Earned', value: profile.xp, icon: Star, color: 'text-yellow-400', bg: 'bg-yellow-400/10' },
              { label: 'Achievements', value: achievements.length, icon: Award, color: 'text-orange-400', bg: 'bg-orange-400/10' },
              { label: 'Notifications', value: recentNotifs.filter(n => !n.is_read).length, icon: Zap, color: 'text-nyptid-300', bg: 'bg-nyptid-300/10' },
            ].map(stat => (
              <div key={stat.label} className="nyptid-card p-4">
                <div className={`w-10 h-10 ${stat.bg} rounded-xl flex items-center justify-center mb-3`}>
                  <stat.icon size={18} className={stat.color} />
                </div>
                <div className="text-2xl font-black text-surface-100">{stat.value}</div>
                <div className="text-xs text-surface-500 mt-0.5">{stat.label}</div>
              </div>
            ))}
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {/* My Communities */}
            <div className="nyptid-card p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-surface-100 flex items-center gap-2">
                  <Users size={16} className="text-nyptid-300" />
                  My Communities
                </h2>
                <button
                  onClick={() => navigate('/app/discover')}
                  className="text-xs text-nyptid-300 hover:text-nyptid-200 transition-colors flex items-center gap-1"
                >
                  Discover <ArrowRight size={12} />
                </button>
              </div>
              {communities.length === 0 ? (
                <div className="text-center py-8">
                  <Users size={32} className="text-surface-700 mx-auto mb-3" />
                  <p className="text-surface-500 text-sm mb-3">You haven't joined any communities yet</p>
                  <button onClick={() => navigate('/app/discover')} className="nyptid-btn-primary text-sm px-4 py-2">
                    Discover Communities
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {communities.slice(0, 5).map(community => (
                    <div
                      key={community.id}
                      onClick={() => navigate(`/app/community/${community.id}`)}
                      className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-surface-700/50 cursor-pointer transition-colors group"
                    >
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-nyptid-800 to-nyptid-950 flex items-center justify-center text-sm font-bold text-nyptid-300 flex-shrink-0">
                        {community.icon_url ? (
                          <img src={community.icon_url} alt="" className="w-full h-full rounded-xl object-cover" />
                        ) : (
                          community.name.slice(0, 2).toUpperCase()
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-surface-200 text-sm group-hover:text-surface-100 truncate">{community.name}</div>
                        <div className="text-xs text-surface-500">{community.member_count?.toLocaleString() || 0} members</div>
                      </div>
                      <ArrowRight size={14} className="text-surface-600 group-hover:text-nyptid-300 transition-colors" />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Achievements */}
            <div className="nyptid-card p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-surface-100 flex items-center gap-2">
                  <Award size={16} className="text-nyptid-300" />
                  Recent Achievements
                </h2>
              </div>
              {achievements.length === 0 ? (
                <div className="text-center py-8">
                  <Award size={32} className="text-surface-700 mx-auto mb-3" />
                  <p className="text-surface-500 text-sm">Complete lessons and engage to earn achievements</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {achievements.map(ua => (
                    <div key={ua.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-surface-700/30">
                      <div className="w-10 h-10 bg-yellow-500/10 rounded-xl flex items-center justify-center text-yellow-400">
                        <Award size={20} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-surface-200 text-sm">{ua.achievement?.name}</div>
                        <div className="text-xs text-surface-500">{ua.achievement?.description}</div>
                      </div>
                      <Badge variant="warning" size="sm">+{ua.achievement?.xp_reward} XP</Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Quick Actions */}
            <div className="nyptid-card p-5">
              <h2 className="font-bold text-surface-100 flex items-center gap-2 mb-4">
                <Zap size={16} className="text-nyptid-300" />
                Quick Actions
              </h2>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Discover Communities', icon: Users, color: 'bg-blue-500/10 text-blue-400', action: () => navigate('/app/discover') },
                  { label: 'View Leaderboard', icon: TrendingUp, color: 'bg-yellow-500/10 text-yellow-400', action: () => navigate('/app/leaderboard') },
                  { label: 'My Profile', icon: Star, color: 'bg-nyptid-300/10 text-nyptid-300', action: () => navigate(`/app/profile/${profile.id}`) },
                  { label: 'Direct Messages', icon: MessageSquare, color: 'bg-green-500/10 text-green-400', action: () => navigate('/app/dm') },
                ].map(action => (
                  <button
                    key={action.label}
                    onClick={action.action}
                    className="flex flex-col items-center gap-2 p-4 rounded-xl border border-surface-700 hover:border-surface-500 hover:bg-surface-700/30 transition-all text-center"
                  >
                    <div className={`w-10 h-10 ${action.color} rounded-xl flex items-center justify-center`}>
                      <action.icon size={18} />
                    </div>
                    <span className="text-xs font-medium text-surface-300">{action.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Recent Notifications */}
            <div className="nyptid-card p-5">
              <h2 className="font-bold text-surface-100 flex items-center gap-2 mb-4">
                <Zap size={16} className="text-nyptid-300" />
                Recent Activity
              </h2>
              {recentNotifs.length === 0 ? (
                <div className="text-center py-8">
                  <Zap size={32} className="text-surface-700 mx-auto mb-3" />
                  <p className="text-surface-500 text-sm">No recent activity</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {recentNotifs.map(notif => (
                    <div
                      key={notif.id}
                      className={`flex items-start gap-3 p-2.5 rounded-lg transition-colors ${!notif.is_read ? 'bg-nyptid-300/5' : ''}`}
                    >
                      {!notif.is_read && <div className="w-2 h-2 bg-nyptid-300 rounded-full mt-1.5 flex-shrink-0" />}
                      <div className={!notif.is_read ? '' : 'ml-5'}>
                        <div className="text-sm text-surface-200 font-medium">{notif.title}</div>
                        {notif.body && <div className="text-xs text-surface-400">{notif.body}</div>}
                        <div className="text-xs text-surface-600 mt-0.5">{formatRelativeTime(notif.created_at)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
