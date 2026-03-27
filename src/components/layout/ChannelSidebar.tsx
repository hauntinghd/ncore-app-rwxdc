import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  CalendarPlus,
  Check,
  ChevronDown,
  ChevronRight,
  FolderPlus,
  Grip,
  Hash,
  LogOut,
  Megaphone,
  Mic,
  Pencil,
  PlusCircle,
  Settings,
  Shield,
  Sparkles,
  Tag,
  Trash2,
  UserPlus,
  Users,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { Avatar } from '../ui/Avatar';
import { SidebarUserDock } from './SidebarUserDock';
import { useAuth } from '../../contexts/AuthContext';
import { runServerVoiceAction, useServerVoiceShellState } from '../../lib/serverVoiceShell';
import { getCommunityRoleBadge } from '../../lib/utils';
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
  onQuickCreateChannel?: (type?: 'text' | 'voice') => void;
  onOpenInviteModal?: () => void;
  onOpenFeatureNotice?: (title: string, body: string) => void;
  onLeaveCommunity?: () => void;
  onClose?: () => void;
}

type ContextMenuKind = 'server' | 'category' | 'channel';

interface SidebarContextMenuState {
  x: number;
  y: number;
  kind: ContextMenuKind;
  category?: ChannelCategory;
  channel?: Channel;
}

function ChannelIcon({ type }: { type: string }) {
  if (type === 'voice') return <Mic size={16} className="text-surface-400" />;
  if (type === 'announcement') return <Megaphone size={16} className="text-surface-400" />;
  return <Hash size={16} className="text-surface-400" />;
}

export function ChannelSidebar({
  community,
  categories = [],
  activeChannelId,
  voiceSessions = {},
  currentVoiceChannelId,
  onAddChannel,
  onAddCategory,
  onEditCategory,
  onDeleteCategory,
  onEditChannel,
  onDeleteChannel,
  onQuickCreateChannel,
  onOpenInviteModal,
  onOpenFeatureNotice,
  onLeaveCommunity,
  onClose,
}: ChannelSidebarProps) {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const voiceSession = useServerVoiceShellState();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [contextMenu, setContextMenu] = useState<SidebarContextMenuState | null>(null);
  const [showServerMenu, setShowServerMenu] = useState(false);
  const [hideMutedChannels, setHideMutedChannels] = useState(false);

  const isAdmin = Boolean(community && (
    community.owner_id === profile?.id
    || community.member_role === 'owner'
    || community.member_role === 'admin'
    || profile?.platform_role === 'owner'
  ));
  const communityMemberCount = Math.max(0, Number(community?.member_count || 0));
  const hideMutedStorageKey = community ? `ncore.sidebar.hideMuted.${community.id}` : null;
  const communityRoleBadge = community?.member_role ? getCommunityRoleBadge(community.member_role as any) : null;

  useEffect(() => {
    if (!hideMutedStorageKey || typeof window === 'undefined') {
      setHideMutedChannels(false);
      return;
    }
    setHideMutedChannels(window.localStorage.getItem(hideMutedStorageKey) === '1');
  }, [hideMutedStorageKey]);

  useEffect(() => {
    if (!hideMutedStorageKey || typeof window === 'undefined') return;
    window.localStorage.setItem(hideMutedStorageKey, hideMutedChannels ? '1' : '0');
  }, [hideMutedChannels, hideMutedStorageKey]);

  function isChannelMuted(channelId: string): boolean {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(`ncore.chat.channelNotifMode.${channelId}`) === 'none';
  }

  const visibleCategories = useMemo(() => (
    categories
      .map((category) => ({
        ...category,
        channels: (category.channels || []).filter((channel) => {
          if (!hideMutedChannels) return true;
          const normalizedChannelId = String(channel.id || '').trim();
          if (!normalizedChannelId) return true;
          if (normalizedChannelId === String(activeChannelId || '')) return true;
          if (normalizedChannelId === String(currentVoiceChannelId || '')) return true;
          return !isChannelMuted(normalizedChannelId);
        }),
      }))
      .filter((category) => (category.channels || []).length > 0 || !hideMutedChannels)
  ), [activeChannelId, categories, currentVoiceChannelId, hideMutedChannels]);

  function toggleCategory(id: string) {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function handleChannelClick(channel: Channel) {
    if (!community?.id) return;
    if (channel.channel_type === 'voice') {
      navigate(`/app/community/${community.id}/voice/${channel.id}`);
    } else {
      navigate(`/app/community/${community.id}/channel/${channel.id}`);
    }
    onClose?.();
  }

  function openCategoryContextMenu(event: MouseEvent, category: ChannelCategory) {
    if (!isAdmin) return;
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ x: event.clientX, y: event.clientY, kind: 'category', category });
  }

  function openChannelContextMenu(event: MouseEvent, channel: Channel) {
    if (!isAdmin) return;
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ x: event.clientX, y: event.clientY, kind: 'channel', channel });
  }

  function openServerContextMenu(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ x: event.clientX, y: event.clientY, kind: 'server' });
  }

  function closeMenus() {
    setContextMenu(null);
    setShowServerMenu(false);
  }

  useEffect(() => {
    if (!contextMenu && !showServerMenu) return undefined;
    const close = () => closeMenus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenus();
    };
    window.addEventListener('click', close);
    window.addEventListener('contextmenu', close);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('contextmenu', close);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [contextMenu, showServerMenu]);

  function handleServerMenuNavigation(path: string) {
    navigate(path);
    closeMenus();
    onClose?.();
  }

  function handleFeatureNotice(title: string, body: string) {
    onOpenFeatureNotice?.(title, body);
    closeMenus();
  }

  return (
    <div className="relative flex h-full min-h-0 w-60 flex-shrink-0 flex-col border-r border-surface-800 bg-surface-900">
      {community && (
        <div className="relative flex h-14 items-center gap-2 border-b border-surface-800 px-3">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-surface-100 transition-colors hover:bg-surface-800"
            onClick={(event) => {
              event.stopPropagation();
              setShowServerMenu((prev) => !prev);
            }}
          >
            <span className="truncate text-sm font-bold">{community.name}</span>
            <ChevronDown size={14} className="text-surface-500" />
          </button>

          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpenInviteModal?.();
            }}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-surface-400 transition-colors hover:bg-surface-800 hover:text-nyptid-300"
            title="Invite to server"
          >
            <UserPlus size={15} />
          </button>

          {showServerMenu && (
            <div
              className="absolute left-3 top-full z-40 mt-2 w-64 overflow-hidden rounded-2xl border border-surface-700 bg-surface-900/95 py-2 shadow-2xl backdrop-blur"
              onClick={(event) => event.stopPropagation()}
              onContextMenu={(event) => event.preventDefault()}
            >
              <button
                type="button"
                onClick={() => handleServerMenuNavigation('/app/settings?section=server-boost')}
                className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm text-surface-200 transition-colors hover:bg-surface-800"
              >
                <span>Server Boost</span>
                <Shield size={15} className="text-surface-500" />
              </button>

              {isAdmin ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      onOpenInviteModal?.();
                      closeMenus();
                    }}
                    className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm text-surface-200 transition-colors hover:bg-surface-800"
                  >
                    <span>Invite to Server</span>
                    <UserPlus size={15} className="text-surface-500" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleServerMenuNavigation(`/app/community/${community.id}/settings`)}
                    className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm text-surface-200 transition-colors hover:bg-surface-800"
                  >
                    <span>Server Settings</span>
                    <Settings size={15} className="text-surface-500" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void onQuickCreateChannel?.('text');
                      closeMenus();
                    }}
                    className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm text-surface-200 transition-colors hover:bg-surface-800"
                  >
                    <span>Create Channel</span>
                    <PlusCircle size={15} className="text-surface-500" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onAddCategory?.();
                      closeMenus();
                    }}
                    className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm text-surface-200 transition-colors hover:bg-surface-800"
                  >
                    <span>Create Category</span>
                    <FolderPlus size={15} className="text-surface-500" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleFeatureNotice('Create Event', 'Scheduled community events are rolling out next. Server event creation will land in a follow-up patch.')}
                    className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm text-surface-200 transition-colors hover:bg-surface-800"
                  >
                    <span>Create Event</span>
                    <CalendarPlus size={15} className="text-surface-500" />
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => handleServerMenuNavigation(`/app/community/${community.id}/settings`)}
                    className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm text-surface-200 transition-colors hover:bg-surface-800"
                  >
                    <span>Server Tag</span>
                    <Tag size={15} className="text-surface-500" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onOpenInviteModal?.();
                      closeMenus();
                    }}
                    className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm text-surface-200 transition-colors hover:bg-surface-800"
                  >
                    <span>Invite to Server</span>
                    <UserPlus size={15} className="text-surface-500" />
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={() => handleFeatureNotice('App Directory', 'App Directory is being built out. This menu entry is wired now so it can go live without another shell overhaul.')}
                className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm text-surface-200 transition-colors hover:bg-surface-800"
              >
                <span>App Directory</span>
                <Sparkles size={15} className="text-surface-500" />
              </button>

              <div className="my-1 border-t border-surface-800" />

              <button
                type="button"
                onClick={() => {
                  setHideMutedChannels(false);
                  closeMenus();
                }}
                className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm text-surface-200 transition-colors hover:bg-surface-800"
              >
                <span>Show All Channels</span>
                {!hideMutedChannels ? <Check size={15} className="text-nyptid-300" /> : <span className="h-[15px] w-[15px]" />}
              </button>
              <button
                type="button"
                onClick={() => handleServerMenuNavigation('/app/settings?section=notifications')}
                className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm text-surface-200 transition-colors hover:bg-surface-800"
              >
                <span>Notification Settings</span>
                <Bell size={15} className="text-surface-500" />
              </button>
              <button
                type="button"
                onClick={() => handleServerMenuNavigation('/app/settings?section=privacy')}
                className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm text-surface-200 transition-colors hover:bg-surface-800"
              >
                <span>Privacy Settings</span>
                <Shield size={15} className="text-surface-500" />
              </button>
              <button
                type="button"
                onClick={() => handleServerMenuNavigation('/app/settings?section=server-profiles')}
                className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm text-surface-200 transition-colors hover:bg-surface-800"
              >
                <span>Edit Per-server Profile</span>
                <Pencil size={15} className="text-surface-500" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setHideMutedChannels((prev) => !prev);
                  closeMenus();
                }}
                className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm text-surface-200 transition-colors hover:bg-surface-800"
              >
                <span>Hide Muted Channels</span>
                {hideMutedChannels ? <Check size={15} className="text-nyptid-300" /> : <span className="h-[15px] w-[15px]" />}
              </button>

              {!isAdmin && (
                <>
                  <div className="my-1 border-t border-surface-800" />
                  <button
                    type="button"
                    onClick={() => {
                      onLeaveCommunity?.();
                      closeMenus();
                    }}
                    className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm text-red-300 transition-colors hover:bg-red-500/10"
                  >
                    <span>Leave Server</span>
                    <LogOut size={15} className="text-red-300" />
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      <div
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain py-2 scrollbar-thin touch-pan-y"
        onContextMenu={openServerContextMenu}
      >
        {visibleCategories.length === 0 && !community && (
          <div className="mt-4 px-3 py-2 text-center text-xs text-surface-500">
            Select a community to see channels
          </div>
        )}

        {visibleCategories.map((category) => (
          <div key={category.id} className="mb-1">
            <div className="group flex w-full items-center gap-1 px-2 py-1 text-xs font-semibold uppercase tracking-wider text-surface-400 transition-colors hover:text-surface-200">
              <button
                type="button"
                onClick={() => toggleCategory(category.id)}
                onContextMenu={(event) => openCategoryContextMenu(event, category)}
                className="flex flex-1 items-center gap-1 text-left"
              >
                {collapsed[category.id] ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                <span>{category.name}</span>
              </button>
              {isAdmin && onAddChannel && (
                <div className="flex items-center gap-1 opacity-0 transition-all group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onAddChannel(category.id, 'text');
                    }}
                    className="transition-colors hover:text-nyptid-300"
                    title="Add text channel"
                  >
                    <Hash size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onAddChannel(category.id, 'voice');
                    }}
                    className="transition-colors hover:text-nyptid-300"
                    title="Add voice channel"
                  >
                    <Mic size={13} />
                  </button>
                </div>
              )}
            </div>

            {!collapsed[category.id] && (category.channels || []).map((channel) => {
              const participants = voiceSessions[channel.id] || [];
              const isActive = channel.id === activeChannelId;
              const isCurrentVoice = channel.id === currentVoiceChannelId;
              const isMutedChannel = isChannelMuted(String(channel.id || '').trim());

              return (
                <div key={channel.id}>
                  <button
                    type="button"
                    onClick={() => handleChannelClick(channel)}
                    onContextMenu={(event) => openChannelContextMenu(event, channel)}
                    className={`channel-item mx-1 w-full text-left ${isActive ? 'active' : ''} ${isCurrentVoice ? 'text-nyptid-300' : ''} ${isMutedChannel ? 'opacity-70' : ''}`}
                  >
                    <ChannelIcon type={channel.channel_type} />
                    <span className="truncate flex-1">{channel.name}</span>
                    {isCurrentVoice && <Volume2 size={12} className="flex-shrink-0 text-nyptid-300" />}
                    {channel.channel_type === 'voice' && participants.length > 0 && (
                      <span className="ml-auto text-xs text-surface-500">{participants.length}</span>
                    )}
                  </button>

                  {channel.channel_type === 'voice' && participants.length > 0 && (
                    <div className="mb-1 ml-6 space-y-0.5">
                      {participants.map((session) => (
                        <div key={session.user_id} className="flex items-center gap-1.5 px-2 py-1 text-xs text-surface-400">
                          <Avatar
                            src={session.profile?.avatar_url}
                            name={session.profile?.display_name || session.profile?.username || 'User'}
                            size="xs"
                          />
                          <span className="truncate">{session.profile?.display_name || session.profile?.username}</span>
                          {session.is_muted && <VolumeX size={10} className="flex-shrink-0 text-red-400" />}
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
          <div className="mt-3 space-y-0.5 px-2">
            <button
              type="button"
              onClick={() => {
                navigate(`/app/community/${community.id}?tab=members`);
                onClose?.();
              }}
              className="channel-item w-full text-left"
            >
              <Users size={16} className="text-surface-400" />
              <span>Members ({communityMemberCount.toLocaleString()})</span>
            </button>
            {isAdmin && (
              <button
                type="button"
                onClick={() => {
                  navigate(`/app/community/${community.id}/settings`);
                  onClose?.();
                }}
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
        <SidebarUserDock
          profile={profile}
          communityRoleLabel={communityRoleBadge?.label || (community?.member_role ? String(community.member_role).toUpperCase() : null)}
          voice={voiceSession.phase === 'idle' ? null : voiceSession}
          showVoiceCard
          onOpenVoice={() => {
            if (voiceSession.communityId && voiceSession.channelId) {
              navigate(`/app/community/${voiceSession.communityId}/voice/${voiceSession.channelId}`);
              onClose?.();
            }
          }}
          onToggleMute={() => void runServerVoiceAction('toggleMute')}
          onToggleDeafen={() => void runServerVoiceAction('toggleDeafen')}
          onToggleScreenShare={() => void runServerVoiceAction('toggleScreenShare')}
          onLeaveVoice={() => void runServerVoiceAction('leave')}
          onOpenSettings={() => {
            navigate('/app/settings');
            onClose?.();
          }}
        />
      )}

      {contextMenu && (
        <div className="pointer-events-none fixed inset-0 z-[95]">
          <div
            className="pointer-events-auto fixed w-56 rounded-xl border border-surface-700 bg-surface-900/95 py-2 shadow-2xl backdrop-blur"
            style={{
              left: Math.max(8, Math.min(contextMenu.x, window.innerWidth - 224 - 8)),
              top: Math.max(8, Math.min(contextMenu.y, window.innerHeight - 240 - 8)),
            }}
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          >
            {contextMenu.kind === 'server' && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    onOpenInviteModal?.();
                    closeMenus();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-surface-200 transition-colors hover:bg-surface-800"
                >
                  <UserPlus size={13} />
                  Invite to Server
                </button>
                {isAdmin && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        void onQuickCreateChannel?.('text');
                        closeMenus();
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-surface-200 transition-colors hover:bg-surface-800"
                    >
                      <PlusCircle size={13} />
                      Create Channel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onAddCategory?.();
                        closeMenus();
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-surface-200 transition-colors hover:bg-surface-800"
                    >
                      <FolderPlus size={13} />
                      Create Category
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setHideMutedChannels((prev) => !prev);
                    closeMenus();
                  }}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-surface-200 transition-colors hover:bg-surface-800"
                >
                  <span className="flex items-center gap-2">
                    <Grip size={13} />
                    Hide Muted Channels
                  </span>
                  {hideMutedChannels ? <Check size={13} className="text-nyptid-300" /> : null}
                </button>
              </>
            )}

            {contextMenu.kind === 'category' && contextMenu.category && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    onEditCategory?.(contextMenu.category!.id);
                    closeMenus();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-surface-200 transition-colors hover:bg-surface-800"
                >
                  <Pencil size={13} />
                  Rename Category
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onAddChannel?.(contextMenu.category!.id, 'text');
                    closeMenus();
                  }}
                  className="w-full px-3 py-2 text-left text-sm text-surface-200 transition-colors hover:bg-surface-800"
                >
                  Add Text Channel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onAddChannel?.(contextMenu.category!.id, 'voice');
                    closeMenus();
                  }}
                  className="w-full px-3 py-2 text-left text-sm text-surface-200 transition-colors hover:bg-surface-800"
                >
                  Add Voice Channel
                </button>
                <div className="my-1 border-t border-surface-700" />
                <button
                  type="button"
                  onClick={() => {
                    onDeleteCategory?.(contextMenu.category!.id);
                    closeMenus();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-300 transition-colors hover:bg-red-500/10"
                >
                  <Trash2 size={13} />
                  Delete Category
                </button>
              </>
            )}

            {contextMenu.kind === 'channel' && contextMenu.channel && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    handleChannelClick(contextMenu.channel!);
                    closeMenus();
                  }}
                  className="w-full px-3 py-2 text-left text-sm text-surface-200 transition-colors hover:bg-surface-800"
                >
                  Open Channel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onEditChannel?.(contextMenu.channel!.id);
                    closeMenus();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-surface-200 transition-colors hover:bg-surface-800"
                >
                  <Pencil size={13} />
                  Rename Channel
                </button>
                <div className="my-1 border-t border-surface-700" />
                <button
                  type="button"
                  onClick={() => {
                    onDeleteChannel?.(contextMenu.channel!.id);
                    closeMenus();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-300 transition-colors hover:bg-red-500/10"
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
