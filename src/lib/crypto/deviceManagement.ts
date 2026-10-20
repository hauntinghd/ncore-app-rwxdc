/**
 * E2E device management and safety numbers.
 *
 * Every signed-in client publishes its own ECDH device key to
 * `e2e_device_keys`; senders fan an envelope out to each of a recipient's
 * active devices. Revocation matters because `resolvePeerDeviceKeys` filters
 * on `revoked_at IS NULL` — revoking a device stops future messages being
 * encrypted to it. It cannot retroactively protect messages that device has
 * already received, and the UI says so.
 */
import { supabase } from '../supabase';
import { getCachedIdentity } from './e2eManager';

export interface E2EDevice {
  deviceId: string;
  publicKey: string;
  fingerprint: string;
  label: string;
  revokedAt: string | null;
  lastSeenAt: string;
  createdAt: string;
  /** True for the device this session is running on. */
  isCurrent: boolean;
}

interface DeviceRow {
  device_id: string;
  public_key: string;
  fingerprint: string | null;
  device_label: string | null;
  revoked_at: string | null;
  last_seen_at: string;
  created_at: string;
}

export async function listMyDevices(userId: string): Promise<E2EDevice[]> {
  const { data, error } = await supabase
    .from('e2e_device_keys')
    .select('device_id, public_key, fingerprint, device_label, revoked_at, last_seen_at, created_at')
    .eq('user_id', userId)
    .order('last_seen_at', { ascending: false });
  if (error) throw error;

  const currentDeviceId = getCachedIdentity()?.deviceId ?? '';

  return ((data ?? []) as DeviceRow[]).map((row) => ({
    deviceId: String(row.device_id),
    publicKey: String(row.public_key),
    fingerprint: String(row.fingerprint || ''),
    label: String(row.device_label || 'Unknown device'),
    revokedAt: row.revoked_at,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    isCurrent: String(row.device_id) === currentDeviceId,
  }));
}

/**
 * Revoke a device. Refuses the current device: revoking the session you are
 * sitting in would leave you unable to read your own new messages with no
 * obvious way back.
 */
export async function revokeDevice(userId: string, deviceId: string): Promise<void> {
  if (getCachedIdentity()?.deviceId === deviceId) {
    throw new Error('You cannot revoke the device you are currently using. Sign out on that device instead.');
  }

  const { error } = await supabase
    .from('e2e_device_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('device_id', deviceId);
  if (error) throw error;
}

export async function restoreDevice(userId: string, deviceId: string): Promise<void> {
  const { error } = await supabase
    .from('e2e_device_keys')
    .update({ revoked_at: null })
    .eq('user_id', userId)
    .eq('device_id', deviceId);
  if (error) throw error;
}

export async function renameDevice(userId: string, deviceId: string, label: string): Promise<void> {
  const trimmed = label.trim().slice(0, 80);
  if (!trimmed) throw new Error('Device name cannot be empty.');

  const { error } = await supabase
    .from('e2e_device_keys')
    .update({ device_label: trimmed })
    .eq('user_id', userId)
    .eq('device_id', deviceId);
  if (error) throw error;
}

/** Permanently delete a revoked device row. */
export async function forgetDevice(userId: string, deviceId: string): Promise<void> {
  if (getCachedIdentity()?.deviceId === deviceId) {
    throw new Error('You cannot remove the device you are currently using.');
  }

  const { error } = await supabase
    .from('e2e_device_keys')
    .delete()
    .eq('user_id', userId)
    .eq('device_id', deviceId);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Safety numbers
// ---------------------------------------------------------------------------

/**
 * A safety number is a short, human-comparable digest of both participants'
 * identity keys. If two people read the same number out loud over a channel an
 * attacker does not control, they know no one is sitting in the middle.
 *
 * Inputs are sorted so both sides compute the same value regardless of who is
 * looking. This is a verification aid, not a secret — it is safe to display.
 */
export async function computeSafetyNumber(
  myFingerprint: string,
  peerFingerprint: string,
): Promise<string> {
  const left = String(myFingerprint || '').trim().toLowerCase();
  const right = String(peerFingerprint || '').trim().toLowerCase();
  if (!left || !right) return '';

  const combined = [left, right].sort().join(':');
  const encoded = new TextEncoder().encode(combined);
  const hash = await globalThis.crypto.subtle.digest('SHA-256', encoded);
  const bytes = new Uint8Array(hash);

  // 12 groups of 5 digits, the same shape Signal uses — long enough to be
  // infeasible to collide, chunked so people can actually read it aloud.
  const groups: string[] = [];
  for (let group = 0; group < 12; group += 1) {
    let value = 0;
    for (let byte = 0; byte < 2; byte += 1) {
      value = value * 256 + bytes[group * 2 + byte];
    }
    groups.push(String(value % 100000).padStart(5, '0'));
  }

  return groups.join(' ');
}

/** The identity fingerprint a peer is currently publishing. */
export async function fetchPeerFingerprint(peerUserId: string): Promise<string> {
  const { data, error } = await supabase
    .from('e2e_identity_keys')
    .select('fingerprint')
    .eq('user_id', peerUserId)
    .maybeSingle();
  if (error || !data) return '';
  return String((data as { fingerprint?: string }).fingerprint || '');
}
