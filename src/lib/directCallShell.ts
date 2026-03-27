import { useSyncExternalStore } from 'react';
import type { CallSettings } from './callSettings';

type Listener = () => void;

export interface DirectCallShellState {
  phase: 'idle' | 'connecting' | 'active';
  conversationId: string | null;
  callId: string | null;
  wantsVideo: boolean;
  startedAt: number | null;
}

interface HangupOptions {
  signalEnded?: boolean;
  clearMeta?: boolean;
}

const DEFAULT_STATE: DirectCallShellState = {
  phase: 'idle',
  conversationId: null,
  callId: null,
  wantsVideo: false,
  startedAt: null,
};

const listeners = new Set<Listener>();
let state: DirectCallShellState = { ...DEFAULT_STATE };

function sameState(a: DirectCallShellState, b: DirectCallShellState): boolean {
  return (
    a.phase === b.phase
    && a.conversationId === b.conversationId
    && a.callId === b.callId
    && a.wantsVideo === b.wantsVideo
    && a.startedAt === b.startedAt
  );
}

export function publishDirectCallShellState(nextState: DirectCallShellState) {
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

export function useDirectCallShellState(): DirectCallShellState {
  return useSyncExternalStore(subscribe, getState, getState);
}

export async function hangupDirectCall(options?: HangupOptions) {
  const { directCallSession } = await import('./directCallSession');
  return directCallSession.hangup(options);
}

export async function applyDirectCallSettings(nextSettings: CallSettings) {
  const { directCallSession } = await import('./directCallSession');
  return directCallSession.applyCallSettings(nextSettings);
}
