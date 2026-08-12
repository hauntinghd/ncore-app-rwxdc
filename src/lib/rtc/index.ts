/**
 * RTC Abstraction Layer - Public API
 *
 * Import from 'lib/rtc' to access provider-agnostic RTC types and the
 * configured provider instance.
 */

export type {
  IRTCProvider,
  IRTCClient,
  IRTCLocalAudioTrack,
  IRTCLocalVideoTrack,
  IRTCRemoteAudioTrack,
  IRTCRemoteVideoTrack,
  IRTCRemoteParticipant,
  RTCClientConfig,
  RTCClientEvents,
  RTCAudioTrackConfig,
  RTCScreenShareConfig,
  RTCJoinOptions,
  RTCConnectionState,
  RTCConnectionStats,
  RTCNetworkQuality,
  RTCMediaType,
  RTCProviderName,
  NoiseSuppressionBinding,
} from './rtcProvider';

export {
  getConfiguredProviderName,
  getRTCProvider,
} from './rtcProvider';
