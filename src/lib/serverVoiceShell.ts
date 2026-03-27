import { useSyncExternalStore } from 'react';

type Listener = () => void;

export interface ServerVoiceShellState {
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

export type ServerVoiceRuntimeAction = 'toggleMute' | 'toggleDeafen' | 'toggleCamera' | 'toggleScreenShare' | 'toggleNoiseSuppression' | 'leave';

const DEFAULT_STATE: ServerVoiceShellState = {
  phase: 'idle',
  communityId: null,
  channelId: null,
  channelName: '',
  isMuted: false,
  isDeafened: false,
  isCameraOn: false,
  isScreenSharing: false,
  noiseSuppressionEnabled: false,
  participantCount: 0,
  averagePingMs: null,
  lastPingMs: null,
  outboundPacketLossPct: null,
  privacyCode: [],
};

const listeners = new Set<Listener>();
let state: ServerVoiceShellState = { ...DEFAULT_STATE };

function sameState(a: ServerVoiceShellState, b: ServerVoiceShellState): boolean {
  return (
    a.phase === b.phase
    && a.communityId === b.communityId
    && a.channelId === b.channelId
    && a.channelName === b.channelName
    && a.isMuted === b.isMuted
    && a.isDeafened === b.isDeafened
    && a.isCameraOn === b.isCameraOn
    && a.isScreenSharing === b.isScreenSharing
    && a.noiseSuppressionEnabled === b.noiseSuppressionEnabled
    && a.participantCount === b.participantCount
    && a.averagePingMs === b.averagePingMs
    && a.lastPingMs === b.lastPingMs
    && a.outboundPacketLossPct === b.outboundPacketLossPct
    && JSON.stringify(a.privacyCode) === JSON.stringify(b.privacyCode)
  );
}

export function publishServerVoiceShellState(nextState: ServerVoiceShellState) {
  if (sameState(state, nextState)) return;
  state = { ...nextState };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getState() {
  return state;
}

export function useServerVoiceShellState(): ServerVoiceShellState {
  return useSyncExternalStore(subscribe, getState, getState);
}

export async function runServerVoiceAction(action: ServerVoiceRuntimeAction) {
  const { serverVoiceSession } = await import('./serverVoiceSession');
  return serverVoiceSession[action]();
}
