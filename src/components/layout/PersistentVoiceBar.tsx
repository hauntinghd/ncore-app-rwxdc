import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mic, MicOff, Monitor, MonitorOff, PhoneOff, Signal, Video, VideoOff, Volume2, VolumeX } from 'lucide-react';
import { ConnectionPanel } from './ConnectionPanel';

interface PersistentVoiceBarProps {
  channelName: string;
  communityId: string;
  channelId: string;
  isMuted: boolean;
  isDeafened: boolean;
  isCameraOn: boolean;
  isScreenSharing?: boolean;
  averagePingMs?: number | null;
  lastPingMs?: number | null;
  outboundPacketLossPct?: number | null;
  onToggleMute: () => void;
  onToggleDeafen: () => void;
  onToggleCamera: () => void;
  onToggleScreenShare?: () => void;
  onLeave: () => void;
}

/**
 * Signal-strength bars from round-trip time.
 *
 * Thresholds match the guidance in the connection panel, so the icon and the
 * numbers behind it never disagree.
 */
function signalTone(pingMs: number | null): string {
  if (pingMs === null) return 'text-surface-500';
  if (pingMs < 100) return 'text-green-400';
  if (pingMs < 250) return 'text-amber-400';
  return 'text-red-400';
}

export function PersistentVoiceBar({
  channelName, communityId, channelId,
  isMuted, isDeafened, isCameraOn, isScreenSharing = false,
  averagePingMs = null, lastPingMs = null, outboundPacketLossPct = null,
  onToggleMute, onToggleDeafen, onToggleCamera, onToggleScreenShare, onLeave,
}: PersistentVoiceBarProps) {
  const navigate = useNavigate();
  const [showConnection, setShowConnection] = useState(false);

  return (
    <div className="relative h-14 bg-green-900/20 border-t border-green-500/20 flex items-center gap-2 px-3 flex-shrink-0">
      <button
        onClick={() => navigate(`/app/community/${communityId}/voice/${channelId}`)}
        className="flex-1 flex items-center gap-2 hover:opacity-80 transition-opacity"
      >
        <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
        <div className="text-left">
          <div className="text-xs font-semibold text-green-400">Voice Connected</div>
          <div className="text-xs text-surface-400 truncate">{channelName}</div>
        </div>
      </button>

      {/* Ping is worth a click to see in detail, so the indicator is the button. */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setShowConnection((value) => !value)}
          aria-label="Connection details"
          title={averagePingMs === null ? 'Connection' : `${Math.round(averagePingMs)} ms`}
          className={`flex h-8 items-center gap-1 rounded-lg px-2 transition-colors hover:bg-surface-700/60 ${signalTone(averagePingMs)}`}
        >
          <Signal size={14} />
          {averagePingMs !== null && (
            <span className="font-mono text-[11px]">{Math.round(averagePingMs)}</span>
          )}
        </button>

        {showConnection && (
          <div className="absolute bottom-full right-0 z-50 mb-2">
            <ConnectionPanel
              averagePingMs={averagePingMs}
              lastPingMs={lastPingMs}
              outboundPacketLossPct={outboundPacketLossPct}
              onClose={() => setShowConnection(false)}
            />
          </div>
        )}
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={onToggleMute}
          title={isMuted ? 'Unmute' : 'Mute'}
          className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
            isMuted ? 'bg-red-600/20 text-red-400 hover:bg-red-600/30' : 'bg-surface-700 text-surface-300 hover:bg-surface-600'
          }`}
        >
          {isMuted ? <MicOff size={14} /> : <Mic size={14} />}
        </button>

        <button
          onClick={onToggleDeafen}
          title={isDeafened ? 'Undeafen' : 'Deafen'}
          className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
            isDeafened ? 'bg-red-600/20 text-red-400 hover:bg-red-600/30' : 'bg-surface-700 text-surface-300 hover:bg-surface-600'
          }`}
        >
          {isDeafened ? <VolumeX size={14} /> : <Volume2 size={14} />}
        </button>

        <button
          onClick={onToggleCamera}
          title={isCameraOn ? 'Turn off camera' : 'Turn on camera'}
          className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
            isCameraOn ? 'bg-nyptid-300/20 text-nyptid-300 hover:bg-nyptid-300/30' : 'bg-surface-700 text-surface-300 hover:bg-surface-600'
          }`}
        >
          {isCameraOn ? <Video size={14} /> : <VideoOff size={14} />}
        </button>

        {/* Screen share was reachable only from the full voice page, which is
            the one place you are not when the persistent bar is what you can
            see. */}
        <button
          onClick={onToggleScreenShare}
          title={isScreenSharing ? 'Stop sharing your screen' : 'Share your screen'}
          className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
            isScreenSharing ? 'bg-nyptid-300/20 text-nyptid-300 hover:bg-nyptid-300/30' : 'bg-surface-700 text-surface-300 hover:bg-surface-600'
          }`}
        >
          {isScreenSharing ? <MonitorOff size={14} /> : <Monitor size={14} />}
        </button>

        <button
          onClick={onLeave}
          title="Leave voice channel"
          className="w-8 h-8 rounded-lg bg-red-600 flex items-center justify-center text-white hover:bg-red-500 transition-colors"
        >
          <PhoneOff size={14} />
        </button>
      </div>
    </div>
  );
}
