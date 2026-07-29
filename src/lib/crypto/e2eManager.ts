/**
 * NCore end-to-end DM encryption manager.
 *
 * Owns the user's per-device identity key (private half cached locally,
 * public half published to `e2e_device_keys`) and resolves
 * per-conversation symmetric keys via ECDH.
 *
 * Design (Path A — single device per install):
 *   1. On first call we generate an ECDH P-256 keypair, store the JWK in
 *      localStorage under `ncore.e2e.identity.<userId>`, and publish the
 *      raw public key + a SHA-256 fingerprint to `e2e_identity_keys`.
 *   2. To send to a conversation, we look up every other member's public
 *      key, derive a shared key per peer via ECDH, encrypt the message
 *      once per peer, and pack the ciphertext blobs into the JSONB
 *      payload on `direct_messages.ciphertext`.
 *   3. To receive, the recipient pulls out their own ciphertext blob,
 *      derives the shared key with the sender's public key, and
 *      decrypts.
 *
 * Multi-device fan-out (one key per device, encrypt per-device) is
 * deferred to Path B — see `memory/2026-05-22.md` follow-up notes.
 */
import { supabase } from '../supabase';
import {
  decryptMessage as decryptWithKey,
  deriveSharedSecret,
  encryptMessage as encryptWithKey,
  exportKeyPair,
  generateIdentityKeyPair,
  importKeyPair,
  type E2EKeyPair,
  type EncryptedPayload,
} from './e2e';

export const E2E_VERSION = 2;
const STORAGE_PREFIX = 'ncore.e2e.identity.';
const DEVICE_STORAGE_PREFIX = 'ncore.e2e.device.';
const FEATURE_FLAG_KEY = 'VITE_ENABLE_E2E_DMS';
export const E2E_PLACEHOLDER = '[NCore encrypted message — update your client to read]';

export class E2ERequiredError extends Error {
  readonly missingRecipientIds: string[];

  constructor(message: string, missingRecipientIds: string[] = []) {
    super(message);
    this.name = 'E2ERequiredError';
    this.missingRecipientIds = missingRecipientIds;
  }
}

// ---------------------------------------------------------------------------
// Feature flag
// ---------------------------------------------------------------------------

export function isE2EEnabled(): boolean {
  const flag = String((import.meta.env as Record<string, string | undefined>)[FEATURE_FLAG_KEY] || '').trim();
  if (!flag) return true;
  const normalized = flag.toLowerCase();
  return normalized !== '0' && normalized !== 'false' && normalized !== 'off';
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface IdentityCacheEntry {
  userId: string;
  deviceId: string;
  keyPair: E2EKeyPair;
  publicKeyBase64: string;
  fingerprint: string;
}

let cachedIdentity: IdentityCacheEntry | null = null;
interface PeerDeviceKey {
  userId: string;
  deviceId: string;
  publicKeyRaw: ArrayBuffer;
  fingerprint: string;
  isLegacy?: boolean;
}

const peerKeyCache = new Map<string, { devices: PeerDeviceKey[]; fetchedAt: number }>();
const PEER_KEY_TTL_MS = 60 * 1000;
const sharedKeyCache = new Map<string, CryptoKey>();

// ---------------------------------------------------------------------------
// Identity bootstrap
// ---------------------------------------------------------------------------

export async function ensureIdentityKey(userId: string): Promise<IdentityCacheEntry | null> {
  if (!isE2EEnabled() || !userId) return null;
  if (cachedIdentity?.userId === userId) return cachedIdentity;
  if (typeof window === 'undefined' || !globalThis.crypto?.subtle) return null;

  const storageKey = `${STORAGE_PREFIX}${userId}`;
  let stored: { publicKey: string; privateKey: string } | null = null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (raw) stored = JSON.parse(raw);
  } catch {
    stored = null;
  }

  let keyPair: E2EKeyPair;
  if (stored) {
    try {
      keyPair = await importKeyPair(stored);
    } catch {
      keyPair = await generateIdentityKeyPair();
      stored = await exportKeyPair(keyPair);
      try { window.localStorage.setItem(storageKey, JSON.stringify(stored)); } catch { /* quota: ignore */ }
    }
  } else {
    keyPair = await generateIdentityKeyPair();
    const exported = await exportKeyPair(keyPair);
    try { window.localStorage.setItem(storageKey, JSON.stringify(exported)); } catch { /* quota: ignore */ }
    stored = exported;
  }

  const deviceId = getOrCreateDeviceId(userId);
  const publicKeyBase64 = stored?.publicKey || base64Encode(new Uint8Array(keyPair.publicKeyRaw));
  const fingerprint = await fingerprintFromRaw(keyPair.publicKeyRaw);

  // Publish/refresh the public key. Failures here are non-fatal — we
  // still cache locally so we can decrypt incoming messages.
  try {
    await supabase
      .from('e2e_device_keys')
      .upsert(
        {
          user_id: userId,
          device_id: deviceId,
          public_key: publicKeyBase64,
          algorithm: 'ECDH-P256',
          fingerprint,
          device_label: getDeviceLabel(),
          revoked_at: null,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,device_id' },
      );

    await supabase
      .from('e2e_identity_keys')
      .upsert(
        {
          user_id: userId,
          public_key: publicKeyBase64,
          algorithm: 'ECDH-P256',
          fingerprint,
        },
        { onConflict: 'user_id' },
      );
  } catch (err) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn('[e2e] publish failed', err);
    }
  }

  cachedIdentity = { userId, deviceId, keyPair, publicKeyBase64, fingerprint };
  return cachedIdentity;
}

export function getCachedIdentity(): IdentityCacheEntry | null {
  return cachedIdentity;
}

export function resetIdentityCache(): void {
  cachedIdentity = null;
  peerKeyCache.clear();
  sharedKeyCache.clear();
}

// ---------------------------------------------------------------------------
// Peer keys
// ---------------------------------------------------------------------------

async function resolvePeerDeviceKeys(peerUserId: string): Promise<PeerDeviceKey[]> {
  const now = Date.now();
  const cached = peerKeyCache.get(peerUserId);
  if (cached && now - cached.fetchedAt < PEER_KEY_TTL_MS) return cached.devices;

  const devices: PeerDeviceKey[] = [];
  const { data: deviceRows, error: deviceError } = await supabase
    .from('e2e_device_keys')
    .select('device_id, public_key, algorithm, fingerprint')
    .eq('user_id', peerUserId)
    .is('revoked_at', null);

  if (!deviceError) {
    for (const row of deviceRows || []) {
      if (String((row as { algorithm?: string }).algorithm || '') !== 'ECDH-P256') continue;
      const raw = base64Decode(String((row as { public_key?: string }).public_key || ''));
      const deviceId = String((row as { device_id?: string }).device_id || '').trim();
      if (!raw || !deviceId) continue;
      devices.push({
        userId: peerUserId,
        deviceId,
        publicKeyRaw: raw,
        fingerprint: String((row as { fingerprint?: string }).fingerprint || ''),
      });
    }
  }

  if (devices.length === 0) {
    const { data, error } = await supabase
      .from('e2e_identity_keys')
      .select('public_key, algorithm, fingerprint')
      .eq('user_id', peerUserId)
      .maybeSingle();

    if (!error && data && String((data as { algorithm?: string }).algorithm || '') === 'ECDH-P256') {
      const raw = base64Decode(String((data as { public_key: string }).public_key || ''));
      if (raw) {
        devices.push({
          userId: peerUserId,
          deviceId: peerUserId,
          publicKeyRaw: raw,
          fingerprint: String((data as { fingerprint?: string }).fingerprint || ''),
          isLegacy: true,
        });
      }
    }
  }

  peerKeyCache.set(peerUserId, { devices, fetchedAt: now });
  return devices;
}

/**
 * Return every active device for a participant. For the local account, always
 * include this client's identity even if its directory write has not reached
 * the server yet, so it retains a decryptable copy of its own sends.
 */
async function resolveParticipantDeviceKeys(
  myUserId: string,
  identity: IdentityCacheEntry,
  participantUserId: string,
): Promise<PeerDeviceKey[]> {
  const resolved = await resolvePeerDeviceKeys(participantUserId);
  if (participantUserId !== myUserId) return resolved;

  const localDevice: PeerDeviceKey = {
    userId: myUserId,
    deviceId: identity.deviceId,
    publicKeyRaw: identity.keyPair.publicKeyRaw,
    fingerprint: identity.fingerprint,
  };
  if (resolved.some((device) => device.deviceId === localDevice.deviceId)) return resolved;
  return [localDevice, ...resolved];
}

async function getSharedKeyForDevice(myUserId: string, peerUserId: string, peerDevice: PeerDeviceKey): Promise<CryptoKey | null> {
  const cacheKey = `${myUserId}>${peerUserId}:${peerDevice.deviceId}`;
  const cached = sharedKeyCache.get(cacheKey);
  if (cached) return cached;

  const me = await ensureIdentityKey(myUserId);
  if (!me) return null;

  try {
    const key = await deriveSharedSecret(me.keyPair.privateKey, peerDevice.publicKeyRaw);
    sharedKeyCache.set(cacheKey, key);
    return key;
  } catch (err) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn('[e2e] derive failed', err);
    }
    return null;
  }
}

async function getSharedKey(myUserId: string, peerUserId: string): Promise<CryptoKey | null> {
  const [device] = await resolvePeerDeviceKeys(peerUserId);
  if (!device) return null;
  return getSharedKeyForDevice(myUserId, peerUserId, device);
}

async function getSharedKeyForSender(myUserId: string, senderUserId: string, senderDeviceId?: string): Promise<CryptoKey | null> {
  if (!senderDeviceId) return getSharedKey(myUserId, senderUserId);

  const identity = await ensureIdentityKey(myUserId);
  if (
    identity
    && senderUserId === myUserId
    && senderDeviceId === identity.deviceId
  ) {
    return getSharedKeyForDevice(myUserId, senderUserId, {
      userId: senderUserId,
      deviceId: senderDeviceId,
      publicKeyRaw: identity.keyPair.publicKeyRaw,
      fingerprint: identity.fingerprint,
    });
  }

  const senderDevices = await resolvePeerDeviceKeys(senderUserId);
  const senderDevice = senderDevices.find((device) => device.deviceId === senderDeviceId);
  if (!senderDevice) return null;
  return getSharedKeyForDevice(myUserId, senderUserId, senderDevice);
}

function recipientSlot(userId: string, deviceId: string): string {
  return `${userId}:${deviceId}`;
}

// ---------------------------------------------------------------------------
// Encrypt / decrypt for a conversation
// ---------------------------------------------------------------------------

export interface ConversationCipherEnvelope {
  v: 1 | 2;
  alg: 'ECDH-P256+AES-GCM' | 'ECDH-P256+AES-GCM-MULTIDEVICE';
  sender: string;
  senderDevice?: string;
  recipients: Record<string, EncryptedPayload>; // user_id or user_id:device_id -> blob
}

export interface AttachmentCipherEnvelope {
  v: 1 | 2;
  alg: 'ECDH-P256+AES-256-GCM' | 'ECDH-P256+AES-256-GCM-MULTIDEVICE';
  sender: string;
  senderDevice?: string;
  iv: string;
  keyRecipients: Record<string, EncryptedPayload>; // user_id or user_id:device_id -> encrypted raw file key
  originalName: string;
  originalType: string;
  originalSize: number;
  encryptedSize: number;
}

interface EncryptForConversationArgs {
  myUserId: string;
  recipientUserIds: string[];
  plaintext: string;
  requireComplete?: boolean;
}

export interface EncryptForConversationResult {
  envelope: ConversationCipherEnvelope | null;
  unencryptedRecipients: string[];
}

export async function encryptForConversation(
  args: EncryptForConversationArgs,
): Promise<EncryptForConversationResult> {
  if (!isE2EEnabled()) return { envelope: null, unencryptedRecipients: args.recipientUserIds };
  if (!args.recipientUserIds.length) return { envelope: null, unencryptedRecipients: [] };

  const identity = await ensureIdentityKey(args.myUserId);
  if (!identity) {
    throw new E2ERequiredError('Encrypted messaging is required, but this device could not create an encryption identity.');
  }

  const recipients: Record<string, EncryptedPayload> = {};
  const unencrypted: string[] = [];

  // The sender is a participant too. Without their own device slots, a
  // message sent on desktop could not be read later on their mobile device.
  const participantIds = Array.from(new Set([
    args.myUserId,
    ...args.recipientUserIds,
  ].filter(Boolean)));

  for (const peerId of participantIds) {
    const peerDevices = await resolveParticipantDeviceKeys(args.myUserId, identity, peerId);
    if (peerDevices.length === 0) {
      unencrypted.push(peerId);
      continue;
    }

    let encryptedForPeer = 0;
    for (const peerDevice of peerDevices) {
      const key = await getSharedKeyForDevice(args.myUserId, peerId, peerDevice);
      if (!key) continue;
      try {
        const payload = await encryptWithKey(key, args.plaintext);
        recipients[recipientSlot(peerId, peerDevice.deviceId)] = payload;
        if (encryptedForPeer === 0) recipients[peerId] = payload;
        encryptedForPeer += 1;
      } catch {
        // Device-level failures are accounted for after the loop.
      }
    }

    if (encryptedForPeer === 0) {
      unencrypted.push(peerId);
    }
  }

  if (args.requireComplete !== false && unencrypted.length > 0) {
    throw new E2ERequiredError(
      'Encrypted messaging is required, but one or more recipients are missing usable encryption keys.',
      unencrypted,
    );
  }

  if (Object.keys(recipients).length === 0) {
    if (args.requireComplete !== false) {
      throw new E2ERequiredError(
        'Encrypted messaging is required, but no recipient encryption keys were available.',
        unencrypted,
      );
    }
    return { envelope: null, unencryptedRecipients: unencrypted };
  }

  return {
    envelope: {
      v: 2,
      alg: 'ECDH-P256+AES-GCM-MULTIDEVICE',
      sender: args.myUserId,
      senderDevice: identity.deviceId,
      recipients,
    },
    unencryptedRecipients: unencrypted,
  };
}

interface DecryptArgs {
  myUserId: string;
  envelope: ConversationCipherEnvelope | null | undefined;
}

export async function decryptFromConversation(args: DecryptArgs): Promise<string | null> {
  if (!args.envelope) return null;
  const { envelope, myUserId } = args;
  if (envelope.v !== 1 && envelope.v !== 2) return null;
  if (envelope.alg !== 'ECDH-P256+AES-GCM' && envelope.alg !== 'ECDH-P256+AES-GCM-MULTIDEVICE') return null;

  const identity = await ensureIdentityKey(myUserId);
  const deviceSlot = identity?.deviceId ? recipientSlot(myUserId, identity.deviceId) : '';
  const blob = (deviceSlot && envelope.recipients?.[deviceSlot]) || envelope.recipients?.[myUserId];
  if (!blob) return null;

  const key = await getSharedKeyForSender(myUserId, envelope.sender, envelope.senderDevice);
  if (!key) return null;

  try {
    return await decryptWithKey(key, blob);
  } catch {
    return null;
  }
}

interface EncryptAttachmentArgs {
  myUserId: string;
  recipientUserIds: string[];
  file: File;
  requireComplete?: boolean;
}

export interface EncryptAttachmentResult {
  encryptedBlob: Blob;
  envelope: AttachmentCipherEnvelope;
  unencryptedRecipients: string[];
}

export async function encryptAttachmentForConversation(
  args: EncryptAttachmentArgs,
): Promise<EncryptAttachmentResult> {
  if (!isE2EEnabled()) {
    throw new E2ERequiredError('Encrypted attachments are disabled.');
  }

  const identity = await ensureIdentityKey(args.myUserId);
  if (!identity) {
    throw new E2ERequiredError('Encrypted attachments require an encryption identity on this device.');
  }

  const rawFileKey = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const fileKey = await globalThis.crypto.subtle.importKey(
    'raw',
    rawFileKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const plaintext = await args.file.arrayBuffer();
  const encryptedBytes = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    fileKey,
    plaintext,
  );

  const keyRecipients: Record<string, EncryptedPayload> = {};
  const unencrypted: string[] = [];
  const fileKeyBase64 = base64Encode(rawFileKey);
  const participantIds = Array.from(new Set([args.myUserId, ...args.recipientUserIds].filter(Boolean)));

  for (const peerId of participantIds) {
    // Fan out to every sender device too, otherwise encrypted attachment
    // history breaks when the sender moves between desktop, web, and mobile.
    const peerDevices = await resolveParticipantDeviceKeys(args.myUserId, identity, peerId);
    if (peerDevices.length === 0) {
      unencrypted.push(peerId);
      continue;
    }

    let encryptedForPeer = 0;
    for (const peerDevice of peerDevices) {
      const key = await getSharedKeyForDevice(args.myUserId, peerId, peerDevice);
      if (!key) continue;
      try {
        const payload = await encryptWithKey(key, fileKeyBase64);
        keyRecipients[recipientSlot(peerId, peerDevice.deviceId)] = payload;
        if (encryptedForPeer === 0) keyRecipients[peerId] = payload;
        encryptedForPeer += 1;
      } catch {
        // Device-level failures are accounted for after the loop.
      }
    }

    if (encryptedForPeer === 0) {
      unencrypted.push(peerId);
    }
  }

  const missingRecipients = unencrypted.filter((peerId) => peerId !== args.myUserId);
  if (args.requireComplete !== false && missingRecipients.length > 0) {
    throw new E2ERequiredError(
      'Encrypted attachment blocked: one or more recipients are missing usable encryption keys.',
      missingRecipients,
    );
  }
  if (!keyRecipients[args.myUserId]) {
    throw new E2ERequiredError('Encrypted attachment blocked: this device could not wrap the attachment key.');
  }

  return {
    encryptedBlob: new Blob([encryptedBytes], { type: 'application/octet-stream' }),
    envelope: {
      v: 2,
      alg: 'ECDH-P256+AES-256-GCM-MULTIDEVICE',
      sender: args.myUserId,
      senderDevice: identity.deviceId,
      iv: base64Encode(iv),
      keyRecipients,
      originalName: args.file.name,
      originalType: args.file.type || 'application/octet-stream',
      originalSize: args.file.size,
      encryptedSize: encryptedBytes.byteLength,
    },
    unencryptedRecipients: missingRecipients,
  };
}

interface DecryptAttachmentArgs {
  myUserId: string;
  envelope: AttachmentCipherEnvelope | null | undefined;
  encryptedBytes: ArrayBuffer;
}

export async function decryptAttachmentFromConversation(args: DecryptAttachmentArgs): Promise<Blob | null> {
  const { envelope, myUserId } = args;
  if (!envelope || (envelope.v !== 1 && envelope.v !== 2)) return null;
  if (envelope.alg !== 'ECDH-P256+AES-256-GCM' && envelope.alg !== 'ECDH-P256+AES-256-GCM-MULTIDEVICE') return null;

  const identity = await ensureIdentityKey(myUserId);
  const deviceSlot = identity?.deviceId ? recipientSlot(myUserId, identity.deviceId) : '';
  const wrappedFileKey = (deviceSlot && envelope.keyRecipients?.[deviceSlot]) || envelope.keyRecipients?.[myUserId];
  if (!wrappedFileKey) return null;

  const wrappingKey = await getSharedKeyForSender(myUserId, envelope.sender, envelope.senderDevice);
  if (!wrappingKey) return null;

  try {
    const fileKeyBase64 = await decryptWithKey(wrappingKey, wrappedFileKey);
    const rawFileKey = base64Decode(fileKeyBase64);
    const iv = base64Decode(envelope.iv);
    if (!rawFileKey || !iv) return null;

    const fileKey = await globalThis.crypto.subtle.importKey(
      'raw',
      rawFileKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt'],
    );
    const plaintext = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(iv) },
      fileKey,
      args.encryptedBytes,
    );
    return new Blob([plaintext], { type: envelope.originalType || 'application/octet-stream' });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getOrCreateDeviceId(userId: string): string {
  const storageKey = `${DEVICE_STORAGE_PREFIX}${userId}`;
  if (typeof window === 'undefined') return `runtime-${userId}`;

  try {
    const existing = window.localStorage.getItem(storageKey);
    if (existing) return existing;
    const next = globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(storageKey, next);
    return next;
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
}

function getDeviceLabel(): string {
  if (typeof navigator === 'undefined') return 'NCore device';
  const platform = String(navigator.platform || '').trim();
  const userAgent = String(navigator.userAgent || '').trim();
  if (platform) return platform.slice(0, 80);
  if (userAgent) return userAgent.slice(0, 80);
  return 'NCore device';
}

async function fingerprintFromRaw(raw: ArrayBuffer): Promise<string> {
  const hash = await globalThis.crypto.subtle.digest('SHA-256', raw);
  const bytes = new Uint8Array(hash);
  let hex = '';
  for (let i = 0; i < 8; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

function base64Encode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64Decode(value: string): ArrayBuffer | null {
  try {
    const bin = atob(value);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  } catch {
    return null;
  }
}
