import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart3,
  ChevronRight,
  MonitorUp,
  Mic,
  MicOff,
  PhoneOff,
  Settings,
  User,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { Avatar } from '../ui/Avatar';
import { useAuth } from '../../contexts/AuthContext';
import type { Profile, UserStatus } from '../../lib/types';
import { getPlatformRoleBadge, getRankBadgeClasses, getStatusLabel } from '../../lib/utils';

export interface SidebarVoiceDockState {
  phase: 'idle' | 'connecting' | 'active';
  communityId: string | null;
  channelId: string | null;
  channelName: string;
  isMuted: boolean;
  isDeafened: boolean;
  isCameraOn: boolean;
  isScreenSharing: boolean;
  noiseSuppressionEnabled: boolean;
  participantCount: number;
  averagePingMs: number | null;
  lastPingMs: number | null;
  outboundPacketLossPct: number | null;
  privacyCode: string[];
}

interface SidebarUserDockProps {
  profile: Profile;
  communityRoleLabel?: string | null;
  voice?: SidebarVoiceDockState | null;
  showVoiceCard?: boolean;
  onOpenVoice?: () => void;
  onToggleMute?: () => void;
  onToggleDeafen?: () => void;
  onToggleScreenShare?: () => void;
  onLeaveVoice?: () => void;
  onOpenSettings?: () => void;
}

export function SidebarUserDock({
  profile,
  communityRoleLabel,
  voice,
  showVoiceCard = true,
  onOpenVoice,
  onToggleMute,
  onToggleDeafen,
  onToggleScreenShare,
  onLeaveVoice,
  onOpenSettings,
}: SidebarUserDockProps) {
  const navigate = useNavigate();
  const { updateProfile } = useAuth();
  const [showProfilePopover, setShowProfilePopover] = useState(false);
  const [showVoiceDetails, setShowVoiceDetails] = useState(false);
  const [voiceTab, setVoiceTab] = useState<'connection' | 'privacy'>('connection');
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [statusDraft, setStatusDraft] = useState<UserStatus>(profile.status);
  const [customStatusDraft, setCustomStatusDraft] = useState(profile.custom_status || '');
  const [customStatusEmojiDraft, setCustomStatusEmojiDraft] = useState(profile.custom_status_emoji || '');
  const [statusSaveError, setStatusSaveError] = useState('');
  const [statusSaved, setStatusSaved] = useState(false);

  const hasActiveVoice = Boolean(voice && voice.phase !== 'idle' && voice.channelId);
  const roleBadge = getPlatformRoleBadge(profile.platform_role);
  const rankClasses = getRankBadgeClasses(profile.rank);
  const isDirectCallVoice = Boolean(hasActiveVoice && voice && !voice.communityId);
  const voiceConnectionLabel = voice
    ? (voice.phase === 'connecting'
      ? (isDirectCallVoice ? 'Connecting Call' : 'Connecting Voice')
      : (isDirectCallVoice ? 'Call Connected' : 'Voice Connected'))
    : 'Voice Connected';
  const voiceParticipantLabel = voice
    ? `${voice.participantCount} ${isDirectCallVoice ? 'in call' : 'in channel'}`
    : '0 connected';
  const voiceLatencyLabel = voice?.averagePingMs != null ? `${voice.averagePingMs} ms` : '';
  const privacyRows = useMemo(() => {
    const chunks: string[][] = [];
    const source = Array.isArray(voice?.privacyCode) ? voice!.privacyCode : [];
    for (let index = 0; index < source.length; index += 3) {
      chunks.push(source.slice(index, index + 3));
    }
    return chunks;
  }, [voice?.privacyCode]);

  const statusLine = useMemo(() => {
    if (profile.custom_status) {
      return `${profile.custom_status_emoji ? `${profile.custom_status_emoji} ` : ''}${profile.custom_status}`.trim();
    }
    return getStatusLabel(profile.status);
  }, [profile.custom_status, profile.custom_status_emoji, profile.status]);

  useEffect(() => {
    if (!showProfilePopover && !showVoiceDetails) return undefined;
    const close = () => {
      setShowProfilePopover(false);
      setShowVoiceDetails(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('click', close);
    window.addEventListener('contextmenu', close);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('contextmenu', close);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [showProfilePopover, showVoiceDetails]);

  useEffect(() => {
    setStatusDraft(profile.status);
    setCustomStatusDraft(profile.custom_status || '');
    setCustomStatusEmojiDraft(profile.custom_status_emoji || '');
    setStatusSaveError('');
  }, [profile.custom_status, profile.custom_status_emoji, profile.status]);

  async function handleSaveStatus() {
    if (statusUpdating) return;
    setStatusUpdating(true);
    setStatusSaveError('');
    setStatusSaved(false);

    const { error } = await updateProfile({
      status: statusDraft,
      custom_status: customStatusDraft.trim().slice(0, 160),
      custom_status_emoji: customStatusEmojiDraft.trim().slice(0, 16),
    });

    if (error) {
      setStatusSaveError(error.message);
    } else {
      setStatusSaved(true);
      window.setTimeout(() => setStatusSaved(false), 2200);
    }

    setStatusUpdating(false);
  }

  return (
    <div className="border-t border-surface-800 bg-surface-950/95 px-2 py-2 space-y-2">
      {showVoiceCard && hasActiveVoice && voice && (
        <div className="relative" onClick={(event) => event.stopPropagation()}>
          {showVoiceDetails && (
            <div className="absolute bottom-full left-0 right-0 mb-2 overflow-hidden rounded-2xl border border-surface-700 bg-surface-900/95 shadow-2xl backdrop-blur">
              <div className="px-4 py-3 text-base font-semibold text-surface-100">Voice Details</div>
              <div className="border-t border-surface-800 px-4 pt-3">
                <div className="flex items-center gap-5 text-sm">
                  {([
                    { id: 'connection', label: 'Connection' },
                    { id: 'privacy', label: 'Privacy' },
                  ] as const).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setVoiceTab(tab.id)}
                      className={`border-b-2 pb-2 font-medium transition-colors ${
                        voiceTab === tab.id
                          ? 'border-nyptid-300 text-nyptid-200'
                          : 'border-transparent text-surface-400 hover:text-surface-200'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="px-4 py-4">
                {voiceTab === 'connection' ? (
                  <div className="space-y-2 text-sm text-surface-300">
                    <div>Average ping: <span className="font-semibold text-surface-100">{voice.averagePingMs ?? 'â€”'} ms</span></div>
                    <div>Last ping: <span className="font-semibold text-surface-100">{voice.lastPingMs ?? 'â€”'} ms</span></div>
                    <div>Outbound packet loss rate: <span className="font-semibold text-surface-100">{voice.outboundPacketLossPct ?? 0}%</span></div>
                    <p className="pt-2 text-xs leading-relaxed text-surface-500">
                      Audio usually starts degrading around 250 ms or when packet loss climbs above 10%. If it keeps drifting, leave and rejoin the channel.
                    </p>
                    <div className="pt-2 text-xs font-medium text-emerald-300">Transport secured in transit</div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="text-xs font-medium uppercase tracking-[0.18em] text-emerald-300">Secured voice transport</div>
                    <p className="text-sm leading-relaxed text-surface-300">
                      Voice media is protected in transit. Compare the privacy code with everyone in the call to confirm you are all on the same live session.
                    </p>
                    <div className="rounded-2xl border border-surface-700 bg-surface-800/80 p-3">
                      <div className="mb-2 text-sm font-semibold text-surface-100">Voice Privacy Code</div>
                      <div className="space-y-2">
                        {privacyRows.map((row, rowIndex) => (
                          <div key={`privacy-row-${rowIndex}`} className="grid grid-cols-3 gap-2 text-center text-sm font-semibold text-surface-200">
                            {row.map((code) => (
                              <div key={code} className="rounded-xl bg-surface-900 px-2 py-2">{code}</div>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-green-500/20 bg-green-500/10 p-3">
            <div className="flex items-start gap-2">
              <button
                type="button"
                onClick={onOpenVoice}
                className="min-w-0 flex-1 text-left"
              >
                <div className="text-xs font-semibold text-green-300">{voiceConnectionLabel}</div>
                <div className="truncate text-sm font-medium text-surface-100">{voice.channelName}</div>
                <div className="mt-0.5 text-[11px] text-surface-400">
                  {voiceParticipantLabel}
                  {voiceLatencyLabel ? ` • ${voiceLatencyLabel}` : ''}
                  {' • '}
                  Noise {voice.noiseSuppressionEnabled ? 'On' : 'Off'}
                </div>
              </button>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setShowVoiceDetails((prev) => !prev)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-800/90 text-surface-300 transition-colors hover:bg-surface-700 hover:text-surface-100"
                  title="Voice details"
                >
                  <BarChart3 size={14} />
                </button>
                {onToggleScreenShare && (
                  <button
                    type="button"
                    onClick={onToggleScreenShare}
                    className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                      voice.isScreenSharing
                        ? 'bg-blue-500/20 text-blue-300 hover:bg-blue-500/30'
                        : 'bg-surface-800/90 text-surface-300 hover:bg-surface-700 hover:text-surface-100'
                    }`}
                    title={voice.isScreenSharing ? 'Stop screen share' : 'Start screen share'}
                  >
                    <MonitorUp size={14} />
                  </button>
                )}
                {onLeaveVoice && (
                  <button
                    type="button"
                    onClick={onLeaveVoice}
                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500/20 text-red-300 transition-colors hover:bg-red-500/30"
                    title="Leave voice"
                  >
                    <PhoneOff size={14} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="relative" onClick={(event) => event.stopPropagation()}>
        {showProfilePopover && (
          <div className="absolute bottom-full left-0 right-0 mb-2 overflow-hidden rounded-2xl border border-surface-700 bg-surface-900/95 shadow-2xl backdrop-blur">
            <div className="relative h-24 overflow-hidden bg-gradient-to-br from-nyptid-900/70 to-surface-800">
              {profile.banner_url && (
                <img
                  src={profile.banner_url}
                  alt={`${profile.display_name || profile.username} banner`}
                  className="absolute inset-0 h-full w-full object-cover"
                />
              )}
              <div className="absolute inset-0 bg-black/30" />
            </div>
            <div className="px-4 pb-4">
              <div className="-mt-8 flex items-end gap-3">
                <Avatar
                  src={profile.avatar_url}
                  name={profile.display_name || profile.username}
                  size="xl"
                  status={profile.status}
                  className="rounded-full border-4 border-surface-900"
                />
                <div className="min-w-0 pb-1">
                  <div className="truncate text-lg font-black text-surface-100">{profile.display_name || profile.username}</div>
                  <div className="truncate text-xs text-surface-400">@{profile.username}</div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {roleBadge && <span className={`rank-badge ${roleBadge.classes}`}>{roleBadge.label}</span>}
                {communityRoleLabel && (
                  <span className="rank-badge bg-surface-700 text-surface-200">{communityRoleLabel}</span>
                )}
                <span className={`rank-badge ${rankClasses}`}>{profile.rank}</span>
              </div>

              <div className="mt-3 rounded-xl border border-surface-700 bg-surface-800/70 px-3 py-2 text-sm text-surface-300">
                {statusLine}
              </div>

              <div className="mt-3 rounded-xl border border-surface-700 bg-surface-950/70 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-surface-500">Quick Status</div>
                    <div className="mt-1 text-xs text-surface-400">Update presence and custom status without leaving the chat.</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setStatusDraft(profile.status);
                      setCustomStatusDraft('');
                      setCustomStatusEmojiDraft('');
                      setStatusSaveError('');
                    }}
                    className="text-[11px] font-semibold text-surface-500 transition-colors hover:text-surface-300"
                  >
                    Clear
                  </button>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  {([
                    { value: 'online', label: 'Online', tone: 'border-green-500/30 bg-green-500/10 text-green-200' },
                    { value: 'idle', label: 'Idle', tone: 'border-yellow-500/30 bg-yellow-500/10 text-yellow-200' },
                    { value: 'dnd', label: 'DND', tone: 'border-red-500/30 bg-red-500/10 text-red-200' },
                    { value: 'invisible', label: 'Invisible', tone: 'border-surface-600 bg-surface-800 text-surface-200' },
                  ] as const).map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setStatusDraft(option.value)}
                      className={`rounded-xl border px-3 py-2 text-left text-xs font-semibold transition-colors ${
                        statusDraft === option.value ? option.tone : 'border-surface-700 bg-surface-900/70 text-surface-400 hover:text-surface-200'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                <div className="mt-3 grid grid-cols-[84px_minmax(0,1fr)] gap-2">
                  <label className="text-[11px] font-semibold uppercase tracking-wide text-surface-500">
                    Emoji
                    <input
                      type="text"
                      value={customStatusEmojiDraft}
                      onChange={(event) => setCustomStatusEmojiDraft(event.target.value)}
                      maxLength={16}
                      placeholder=":)"
                      className="nyptid-input mt-1 text-center"
                    />
                  </label>
                  <label className="text-[11px] font-semibold uppercase tracking-wide text-surface-500">
                    Status
                    <input
                      type="text"
                      value={customStatusDraft}
                      onChange={(event) => setCustomStatusDraft(event.target.value)}
                      maxLength={160}
                      placeholder="What are you doing right now?"
                      className="nyptid-input mt-1"
                    />
                  </label>
                </div>

                <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-surface-500">
                  <span>{customStatusDraft.length}/160 characters</span>
                  <span>{statusDraft === 'dnd' ? 'Notifications stay muted.' : 'Applies across profile, DMs, and the dock.'}</span>
                </div>

                {(statusSaveError || statusSaved) && (
                  <div className={`mt-2 text-xs ${statusSaveError ? 'text-red-300' : 'text-emerald-300'}`}>
                    {statusSaveError || 'Status updated.'}
                  </div>
                )}

                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleSaveStatus()}
                    disabled={statusUpdating}
                    className="nyptid-btn-primary flex-1 py-2 text-xs disabled:opacity-60"
                  >
                    {statusUpdating ? 'Saving...' : 'Save Status'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      navigate('/app/settings?section=privacy');
                      setShowProfilePopover(false);
                    }}
                    className="nyptid-btn-secondary px-3 py-2 text-xs"
                  >
                    More
                  </button>
                </div>
              </div>

              {profile.bio && (
                <div className="mt-3 text-sm leading-relaxed text-surface-300 line-clamp-4">
                  {profile.bio}
                </div>
              )}

              <div className="mt-4 space-y-1">
                <button
                  type="button"
                  onClick={() => {
                    navigate(`/app/profile/${profile.id}`);
                    setShowProfilePopover(false);
                  }}
                  className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-surface-200 transition-colors hover:bg-surface-800"
                >
                  <span className="flex items-center gap-2"><User size={14} /> View Profile</span>
                  <ChevronRight size={14} className="text-surface-500" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    navigate('/app/settings?section=profile');
                    setShowProfilePopover(false);
                  }}
                  className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-surface-200 transition-colors hover:bg-surface-800"
                >
                  <span className="flex items-center gap-2"><Settings size={14} /> Edit Profile</span>
                  <ChevronRight size={14} className="text-surface-500" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    navigate('/app/settings?section=privacy');
                    setShowProfilePopover(false);
                  }}
                  className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-surface-200 transition-colors hover:bg-surface-800 disabled:opacity-60"
                >
                  <span>Privacy &amp; Status</span>
                  <ChevronRight size={14} className="text-surface-500" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onOpenSettings?.();
                    setShowProfilePopover(false);
                  }}
                  className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-surface-200 transition-colors hover:bg-surface-800"
                >
                  <span>Settings</span>
                  <ChevronRight size={14} className="text-surface-500" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    window.alert('Switch Accounts is rolling out.');
                    setShowProfilePopover(false);
                  }}
                  className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-surface-500 transition-colors hover:bg-surface-800 hover:text-surface-300"
                >
                  <span>Switch Accounts</span>
                  <ChevronRight size={14} className="text-surface-600" />
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 rounded-2xl bg-surface-900/80 px-2 py-2">
          <button
            type="button"
            onClick={() => setShowProfilePopover((prev) => !prev)}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            <Avatar
              src={profile.avatar_url}
              name={profile.display_name || profile.username}
              size="sm"
              status={profile.status}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-surface-100">
                {profile.display_name || profile.username}
              </div>
              <div className="truncate text-[11px] text-surface-500">{statusLine}</div>
            </div>
          </button>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onToggleMute}
              className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                hasActiveVoice
                  ? voice?.isMuted
                    ? 'bg-red-500/20 text-red-300 hover:bg-red-500/30'
                    : 'bg-surface-800 text-surface-300 hover:bg-surface-700 hover:text-surface-100'
                  : voice?.isMuted
                    ? 'bg-red-500/20 text-red-300 hover:bg-red-500/30'
                    : 'bg-surface-900 text-surface-500 hover:bg-surface-800 hover:text-surface-200'
              }`}
              title={hasActiveVoice
                ? (voice?.isMuted ? 'Unmute' : 'Mute')
                : (voice?.isMuted ? 'Unmute (ready for next call)' : 'Mute (ready for next call)')}
            >
              {voice?.isMuted ? <MicOff size={14} /> : <Mic size={14} />}
            </button>
            <button
              type="button"
              onClick={onToggleDeafen}
              className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                hasActiveVoice
                  ? voice?.isDeafened
                    ? 'bg-red-500/20 text-red-300 hover:bg-red-500/30'
                    : 'bg-surface-800 text-surface-300 hover:bg-surface-700 hover:text-surface-100'
                  : voice?.isDeafened
                    ? 'bg-red-500/20 text-red-300 hover:bg-red-500/30'
                    : 'bg-surface-900 text-surface-500 hover:bg-surface-800 hover:text-surface-200'
              }`}
              title={hasActiveVoice
                ? (voice?.isDeafened ? 'Undeafen' : 'Deafen')
                : (voice?.isDeafened ? 'Undeafen (ready for next call)' : 'Deafen (ready for next call)')}
            >
              {voice?.isDeafened ? <VolumeX size={14} /> : <Volume2 size={14} />}
            </button>
            <button
              type="button"
              onClick={onOpenSettings}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-800 text-surface-300 transition-colors hover:bg-surface-700 hover:text-surface-100"
              title="Open settings"
            >
              <Settings size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

