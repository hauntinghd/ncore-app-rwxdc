/**
 * Voice-server ping, measured the way Discord shows it.
 *
 * Agora's getRTCStats().RTT stays 0 until media is flowing (alone in a call,
 * or muted), so the call bar could only ever say "Excellent". Underneath,
 * every WebRTC peer connection keeps the ICE pair to the media server alive
 * with periodic consent checks, and the browser records the measured
 * round-trip time on the selected candidate pair — `currentRoundTripTime` —
 * whether or not audio is being sent.
 *
 * Agora creates its RTCPeerConnections internally and does not expose them,
 * so this module wraps the constructor once at startup to keep a registry of
 * live connections. The wrapper is transparent: same constructor, same
 * prototype, same instances.
 */

const connections = new Set<RTCPeerConnection>();
let installed = false;

export function installPeerConnectionRegistry(): void {
  if (installed || typeof window === 'undefined' || typeof window.RTCPeerConnection !== 'function') return;
  installed = true;

  const Native = window.RTCPeerConnection;
  const Tracked = function (this: unknown, ...args: ConstructorParameters<typeof RTCPeerConnection>) {
    const pc = new Native(...args);
    connections.add(pc);
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'closed' || pc.connectionState === 'failed') connections.delete(pc);
    });
    return pc;
  } as unknown as typeof RTCPeerConnection;
  Tracked.prototype = Native.prototype;
  Object.setPrototypeOf(Tracked, Native);
  window.RTCPeerConnection = Tracked;
}

/** Lowest current RTT (ms) across connected peer connections, or null. */
export async function measureVoicePingMs(): Promise<number | null> {
  const samples: number[] = [];
  for (const pc of Array.from(connections)) {
    if (pc.connectionState !== 'connected') continue;
    try {
      const report = await pc.getStats();
      let selectedPairId: string | null = null;
      report.forEach((stat) => {
        if (stat.type === 'transport' && stat.selectedCandidatePairId) {
          selectedPairId = stat.selectedCandidatePairId;
        }
      });
      report.forEach((stat) => {
        if (stat.type !== 'candidate-pair') return;
        const isSelected = selectedPairId
          ? stat.id === selectedPairId
          : stat.state === 'succeeded' && stat.nominated;
        const rttSeconds = Number(stat.currentRoundTripTime);
        if (isSelected && Number.isFinite(rttSeconds) && rttSeconds > 0) {
          samples.push(Math.round(rttSeconds * 1000));
        }
      });
    } catch {
      // A connection closing mid-read is not an error worth surfacing.
    }
  }
  return samples.length ? Math.min(...samples) : null;
}
