import { useEffect, useState, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Hash, Mic, Megaphone, ChevronDown, ChevronRight,
  Plus, Settings, Users, Volume2, VolumeX, Pencil, Trash2
} from 'lucide-react';
import { Avatar } from '../ui/Avatar';
import { useAuth } from '../../contexts/AuthContext';
import { getPlatformRoleBadge, getRankBadgeClasses } from '../../lib/utils';
import type { Community, Channel, ChannelCategory, VoiceSession } from '../../lib/types';

interface ChannelSidebarProps {
  community?: Community;
  categories?: ChannelCategory[];
  activeChannelId?: string;
  voiceSessions?: Record<string, VoiceSession[]>;
  currentVoiceChannelId?: string;
  onAddChannel?: (categoryId: string, type: 'text' | 'voice') => void;
  onAddCategory?: () => void;
  onEditCategory?: (categoryId: string) => void;
  onDeleteCategory?: (categoryId: string) => void;
  onEditChannel?: (channelId: string) => void;
  onDeleteChannel?: (channelId: string) => void;
  onClose?: () => void;
}

interface SidebarContextMenuState {
  x: number;
  y: number;
  category?: ChannelCategory;
  channel?: Channel;
}

function ChannelIcon({ type }: { type: string }) {
  if (type === 'voice') return <Mic size={16} className="text-surface-400" />;
  if (type === 'announcement') return <Megaphone size={16} className="text-surface-400" />;
  return <Hash size={16} className="text-surface-400" />;
}

export function ChannelSidebar({
  community, categories = [], activeChannelId,
  voiceSessions = {}, currentVoiceChannelId, onAddChannel, onAddCategory,
  onEditCategory, onDeleteCategory, onEditChannel, onDeleteChannel, onClose,
}: ChannelSidebarProps) {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [contextMenu, setContextMenu] = useState<SidebarContextMenuState | null>(null);

  const isAdmin = community && (
    community.owner_id === profile?.id ||
    community.member_role === 'owner' ||
    community.member_role === 'admin' ||
    profile?.platform_role === 'owner'
  );
  const communityMemberCount = Math.max(0, Number(community?.member_count || 0));

  const roleBadge = profile ? getPlatformRoleBadge(profile.platform_role) : null;
  const rankClasses = profile ? getRankBadgeClasses(profile.rank) : '';

  function toggleCategory(id: string) {
    setCollapsed(prev => ({ ...prev, [id]: !prev[id] }));
  }

  function handleChannelClick(channel: Channel) {
    if (!community?.id) return;
    if (channel.channel_type === 'voice') {
      navigate(`/app/community/${community?.id}/voice/${channel.id}`);
    } else {
      navigate(`/app/community/${community?.id}/channel/${channel.id}`);
    }
    onClose?.();
  }

  function openCategoryContextMenu(event: MouseEvent, category: ChannelCategory) {
    if (!isAdmin) return;
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      category,
    });
  }

  function openChannelContextMenu(event: MouseEvent, channel: Channel) {
    if (!isAdmin) return;
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      channel,
    });
  }

  useEffect(() => {
    if (!contextMenu) return undefined;
    const close = () => setContextMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setContextMenu(null);
      }
    };
    window.addEventListener('click', close);
    window.addEventListener('contextmenu', close);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('contextmenu', close);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [contextMenu]);

  return (
    <div className="relative w-60 bg-surface-900 flex h-full min-h-0 flex-col border-r border-surface-800 flex-shrink-0">
      {community && (
        <div className="h-14 flex items-center justify-between px-4 border-b border-surface-800">
          <button
            type="button"
            className="min-w-0 text-left hover:text-surface-100 transition-colors"
            onClick={() => navigate(`/app/community/${community.id}`)}
          >
            <span className="font-bold text-surface-100 text-sm truncate">{community.name}</span>
          </button>
          {isAdmin && onAddCategory && (
            <button
              type="button"
              onClick={onAddCategory}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-surface-400 hover:text-nyptid-300 hover:bg-surface-700 transition-colors"
              title="Add category"
            >
              <Plus size={14} />
            </button>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain py-2 scrollbar-thin touch-pan-y">
        {categories.length === 0 && !community && (
          <div className="px-3 py-2 text-xs text-surface-500 text-center mt-4">
            Select a community to see channels
          </div>
        )}

        {categories.map(category => (
          <div key={category.id} className="mb-1">
            <div className="group w-full flex items-center gap-1 px-2 py-1 text-xs font-semibold text-surface-400 uppercase tracking-wider hover:text-surface-200 transition-colors">
              <button
                type="button"
                onClick={() => toggleCategory(category.id)}
                onContextMenu={(event) => openCategoryContextMenu(event, category)}
                className="flex items-center gap-1 flex-1 text-left"
              >
                {collapsed[category.id] ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                <span>{category.name}</span>
              </button>
              {isAdmin && onAddChannel && (
                <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-all">
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); onAddChannel?.(category.id, 'text'); }}
                    className="hover:text-nyptid-300 transition-colors"
                    title="Add text channel"
                  >
                    <Hash size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); onAddChannel?.(category.id, 'voice'); }}
                    className="hover:text-nyptid-300 transition-colors"
                    title="Add voice channel"
                  >
                    <Mic size={13} />
                  </button>
                </div>
              )}
            </div>

            {!collapsed[category.id] && category.channels?.map(channel => {
              const participants = voiceSessions[channel.id] || [];
              const isActive = channel.id === activeChannelId;
              const isCurrentVoice = channel.id === currentVoiceChannelId;

              return (
                <div key={channel.id}>
                  <button
                    type="button"
                    onClick={() => {
                      handleChannelClick(channel);
                    }}
                    onContextMenu={(event) => openChannelContextMenu(event, channel)}
                    className={`channel-item mx-1 w-full text-left ${isActive ? 'active' : ''} ${isCurrentVoice ? 'text-nyptid-300' : ''}`}
                  >
                    <ChannelIcon type={channel.channel_type} />
                    <span className="truncate flex-1">{channel.name}</span>
                    {isCurrentVoice && (
                      <Volume2 size={12} className="text-nyptid-300 flex-shrink-0" />
                    )}
                    {channel.channel_type === 'voice' && participants.length > 0 && (
                      <span className="text-xs text-surface-500 ml-auto">{participants.length}</span>
                    )}
                  </button>

                  {channel.channel_type === 'voice' && participants.length > 0 && (
                    <div className="ml-6 space-y-0.5 mb-1">
                      {participants.map(session => (
                        <div key={session.user_id} className="flex items-center gap-1.5 px-2 py-1 text-xs text-surface-400">
                          <Avatar
                            src={session.profile?.avatar_url}
                            name={session.profile?.display_name || session.profile?.username || 'User'}
                            size="xs"
                          />
                          <span className="truncate">{session.profile?.display_name || session.profile?.username}</span>
                          {session.is_muted && <VolumeX size={10} className="text-red-400 flex-shrink-0" />}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}

        {community && (
          <div className="mt-3 px-2 space-y-0.5">
            <button
              type="button"
              onClick={() => { navigate(`/app/community/${community.id}?tab=members`); onClose?.(); }}
              className="channel-item w-full text-left"
            >
              <Users size={16} className="text-surface-400" />
              <span>Members ({communityMemberCount.toLocaleString()})</span>
            </button>
            {isAdmin && (
              <button
                type="button"
                onClick={() => { navigate(`/app/community/${community.id}/settings`); onClose?.(); }}
                className="channel-item w-full text-left"
              >
                <Settings size={16} className="text-surface-400" />
                <span>Settings</span>
              </button>
            )}
          </div>
        )}
      </div>

      {profile && (
        <div className="h-14 bg-surface-950/80 border-t border-surface-800 flex items-center gap-2 px-3">
          <div className="relative flex-shrink-0">
            <Avatar
              src={profile.avatar_url}
              name={profile.display_name || profile.username}
              size="sm"
              status={profile.status}
            />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold text-surface-100 truncate">
                {profile.display_name || profile.username}
              </span>
              {roleBadge && (
                <span className={`rank-badge ${roleBadge.classes} text-xs`}>{roleBadge.label}</span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <span className={`rank-badge ${rankClasses}`}>{profile.rank}</span>
            </div>
          </div>
        </div>
      )}

      {contextMenu && (
        <div className="fixed inset-0 z-[95] pointer-events-none">
          <div
            className="pointer-events-auto fixed w-56 rounded-xl border border-surface-700 bg-surface-900/95 py-2 shadow-2xl backdrop-blur"
            style={{
              left: Math.max(8, Math.min(contextMenu.x, window.innerWidth - 224 - 8)),
              top: Math.max(8, Math.min(contextMenu.y, window.innerHeight - 220 - 8)),
            }}
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          >
            {contextMenu.category && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    onEditCategory?.(contextMenu.category!.id);
                    setContextMenu(null);
                  }}
                  className="w-full px-3 py-2 text-left text-sm text-surface-200 hover:bg-surface-800 transition-colors flex items-center gap-2"
                >
                  <Pencil size={13} />
                  Rename Category
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onAddChannel?.(contextMenu.category!.id, 'text');
                    setContextMenu(null);
                  }}
                  className="w-full px-3 py-2 text-left text-sm text-surface-200 hover:bg-surface-800 transition-colors"
                >
                  Add Text Channel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onAddChannel?.(contextMenu.category!.id, 'voice');
                    setContextMenu(null);
                  }}
                  className="w-full px-3 py-2 text-left text-sm text-surface-200 hover:bg-surface-800 transition-colors"
                >
                  Add Voice Channel
                </button>
                <div className="my-1 border-t border-surface-700" />
                <button
                  type="button"
                  onClick={() => {
                    onDeleteCategory?.(contextMenu.category!.id);
                    setContextMenu(null);
                  }}
                  className="w-full px-3 py-2 text-left text-sm text-red-300 hover:bg-red-500/10 transition-colors flex items-center gap-2"
                >
                  <Trash2 size={13} />
                  Delete Category
                </button>
              </>
            )}

            {contextMenu.channel && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    handleChannelClick(contextMenu.channel!);
                    setContextMenu(null);
                  }}
                  className="w-full px-3 py-2 text-left text-sm text-surface-200 hover:bg-surface-800 transition-colors"
                >
                  Open Channel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onEditChannel?.(contextMenu.channel!.id);
                    setContextMenu(null);
                  }}
                  className="w-full px-3 py-2 text-left text-sm text-surface-200 hover:bg-surface-800 transition-colors flex items-center gap-2"
                >
                  <Pencil size={13} />
                  Rename Channel
                </button>
                <div className="my-1 border-t border-surface-700" />
                <button
                  type="button"
                  onClick={() => {
                    onDeleteChannel?.(contextMenu.channel!.id);
                    setContextMenu(null);
                  }}
                  className="w-full px-3 py-2 text-left text-sm text-red-300 hover:bg-red-500/10 transition-colors flex items-center gap-2"
                >
                  <Trash2 size={13} />
                  Delete Channel
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
