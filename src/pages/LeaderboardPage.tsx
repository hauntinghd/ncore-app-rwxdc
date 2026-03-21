import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Crown, TrendingUp, Award, Zap } from 'lucide-react';
import { AppShell } from '../components/layout/AppShell';
import { Avatar } from '../components/ui/Avatar';
import { Badge } from '../components/ui/Badge';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import type { Profile } from '../lib/types';
import { getRankBadgeClasses } from '../lib/utils';

export function LeaderboardPage() {
  const { profile: currentProfile } = useAuth();
  const navigate = useNavigate();
  const [topUsers, setTopUsers] = useState<Profile[]>([]);
  const [myRank, setMyRank] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'xp' | 'achievements'>('xp');

  useEffect(() => {
    supabase
      .from('profiles')
      .select('*')
      .order('xp', { ascending: false })
      .limit(100)
      .then(({ data }) => {
        if (data) {
          setTopUsers(data as Profile[]);
          if (currentProfile) {
            const rank = data.findIndex(u => u.id === currentProfile.id);
            setMyRank(rank >= 0 ? rank + 1 : null);
          }
        }
        setLoading(false);
      });
  }, [currentProfile]);

  const top3 = topUsers.slice(0, 3);
  const rest = topUsers.slice(3);

  return (
    <AppShell showChannelSidebar={false} title="Leaderboard">
      <div className="h-full overflow-y-auto">
        <div className="max-w-3xl mx-auto p-6">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-12 h-12 bg-yellow-500/10 rounded-2xl flex items-center justify-center">
              <Crown size={24} className="text-yellow-400" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-surface-100">Leaderboard</h1>
              <p className="text-surface-400 text-sm">Top contributors across the platform</p>
            </div>
            {myRank && (
              <div className="ml-auto nyptid-card px-4 py-2 text-center">
                <div className="text-2xl font-black text-nyptid-300">#{myRank}</div>
                <div className="text-xs text-surface-500">Your Rank</div>
              </div>
            )}
          </div>

          <div className="flex gap-1 mb-6">
            {(['xp', 'achievements'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${
                  tab === t ? 'bg-nyptid-300 text-surface-950' : 'text-surface-400 hover:bg-surface-700 hover:text-surface-200'
                }`}
              >
                {t === 'xp' ? 'XP Rankings' : 'Achievements'}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="nyptid-card h-16 animate-pulse" />
              ))}
            </div>
          ) : (
            <>
              {top3.length >= 3 && (
                <div className="grid grid-cols-3 gap-4 mb-8">
                  {[top3[1], top3[0], top3[2]].map((user, visualIndex) => {
                    const rank = visualIndex === 0 ? 2 : visualIndex === 1 ? 1 : 3;
                    const rankClasses = getRankBadgeClasses(user.rank);
                    return (
                      <div
                        key={user.id}
                        onClick={() => navigate(`/app/profile/${user.id}`)}
                        className={`nyptid-card p-4 flex flex-col items-center text-center cursor-pointer hover:border-nyptid-300/30 transition-all ${rank === 1 ? 'border-yellow-500/30 bg-yellow-500/5 shadow-glow -mt-2' : ''}`}
                      >
                        <div className="text-2xl mb-2">{rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉'}</div>
                        <Avatar src={user.avatar_url} name={user.display_name || user.username} size={rank === 1 ? 'lg' : 'md'} />
                        <div className="mt-2 font-bold text-surface-100 text-sm truncate w-full">
                          {user.display_name || user.username}
                        </div>
                        <div className={`rank-badge ${rankClasses} mt-1`}>{user.rank}</div>
                        <div className="text-nyptid-300 font-bold text-sm mt-1">{user.xp.toLocaleString()} XP</div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="space-y-2">
                {rest.map((user, i) => {
                  const rank = i + 4;
                  const isMe = user.id === currentProfile?.id;
                  const rankClasses = getRankBadgeClasses(user.rank);
                  return (
                    <div
                      key={user.id}
                      onClick={() => navigate(`/app/profile/${user.id}`)}
                      className={`flex items-center gap-4 p-3 rounded-xl border cursor-pointer transition-all ${
                        isMe
                          ? 'border-nyptid-300/30 bg-nyptid-300/5'
                          : 'border-surface-700 hover:border-surface-600 hover:bg-surface-800/50'
                      }`}
                    >
                      <div className="w-8 text-center font-bold text-surface-500 text-sm">{rank}</div>
                      <Avatar src={user.avatar_url} name={user.display_name || user.username} size="sm" status={user.status} />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-surface-200 text-sm truncate">
                          {user.display_name || user.username}
                          {isMe && <span className="text-nyptid-300 ml-2 text-xs">(You)</span>}
                        </div>
                        <span className={`rank-badge ${rankClasses} text-xs`}>{user.rank}</span>
                      </div>
                      <div className="font-bold text-nyptid-300 text-sm flex-shrink-0">{user.xp.toLocaleString()} XP</div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
