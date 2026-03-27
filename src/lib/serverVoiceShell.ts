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
}

export type ServerVoiceRuntimeAction = 'toggleMute' | 'toggleDeafen' | 'toggleCamera' | 'leave';

const DEFAULT_STATE: ServerVoiceShellState = {
  phase: 'idle',
  communityId: null,
  channelId: null,
  channelName: '',
  isMuted: false,
  isDeafened: false,
  isCameraOn: false,
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
