import { useNavigate } from 'react-router-dom';
import { Mic, MicOff, Video, VideoOff, Monitor, PhoneOff, Volume2 } from 'lucide-react';

interface PersistentVoiceBarProps {
  channelName: string;
  communityId: string;
  channelId: string;
  isMuted: boolean;
  isDeafened: boolean;
  isCameraOn: boolean;
  onToggleMute: () => void;
  onToggleDeafen: () => void;
  onToggleCamera: () => void;
  onLeave: () => void;
}

export function PersistentVoiceBar({
  channelName, communityId, channelId,
  isMuted, isDeafened, isCameraOn,
  onToggleMute, onToggleDeafen, onToggleCamera, onLeave,
}: PersistentVoiceBarProps) {
  const navigate = useNavigate();

  return (
    <div className="h-14 bg-green-900/20 border-t border-green-500/20 flex items-center gap-2 px-3 flex-shrink-0">
      <button
        onClick={() => navigate(`/app/community/${communityId}/voice/${channelId}`)}
        className="flex-1 flex items-center gap-2 hover:opacity-80 transition-opacity"
      >
        <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
        <div>
          <div className="text-xs font-semibold text-green-400">Voice Connected</div>
          <div className="text-xs text-surface-400 truncate">{channelName}</div>
        </div>
      </button>

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
          {isDeafened ? <VideoOff size={14} /> : <Volume2 size={14} />}
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
