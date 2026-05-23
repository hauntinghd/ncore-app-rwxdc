/**
 * NCore end-to-end DM encryption manager.
 *
 * Owns the user's identity key (private half cached locally, public half
 * published to `e2e_identity_keys`) and resolves per-conversation
 * symmetric keys via ECDH.
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

export const E2E_VERSION = 1;
const STORAGE_PREFIX = 'ncore.e2e.identity.';
const FEATURE_FLAG_KEY = 'VITE_ENABLE_E2E_DMS';
export const E2E_PLACEHOLDER = '[NCore encrypted message — update your client to read]';

// ---------------------------------------------------------------------------
// Feature flag
// ---------------------------------------------------------------------------

export function isE2EEnabled(): boolean {
  const flag = String((import.meta.env as Record<string, string | undefined>)[FEATURE_FLAG_KEY] || '').trim();
  if (!flag) return false;
  return flag === '1' || flag.toLowerCase() === 'true' || flag.toLowerCase() === 'on';
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface IdentityCacheEntry {
  userId: string;
  keyPair: E2EKeyPair;
  publicKeyBase64: string;
  fingerprint: string;
}

let cachedIdentity: IdentityCacheEntry | null = null;
const peerKeyCache = new Map<string, { publicKeyRaw: ArrayBuffer; fetchedAt: number }>();
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

  const publicKeyBase64 = stored?.publicKey || base64Encode(new Uint8Array(keyPair.publicKeyRaw));
  const fingerprint = await fingerprintFromRaw(keyPair.publicKeyRaw);

  // Publish/refresh the public key. Failures here are non-fatal — we
  // still cache locally so we can decrypt incoming messages.
  try {
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

  cachedIdentity = { userId, keyPair, publicKeyBase64, fingerprint };
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

async function resolvePeerPublicKey(peerUserId: string): Promise<ArrayBuffer | null> {
  const now = Date.now();
  const cached = peerKeyCache.get(peerUserId);
  if (cached && now - cached.fetchedAt < PEER_KEY_TTL_MS) return cached.publicKeyRaw;

  const { data, error } = await supabase
    .from('e2e_identity_keys')
    .select('public_key, algorithm')
    .eq('user_id', peerUserId)
    .maybeSingle();

  if (error || !data) return null;
  if (String((data as { algorithm?: string }).algorithm || '') !== 'ECDH-P256') return null;

  const raw = base64Decode(String((data as { public_key: string }).public_key || ''));
  if (!raw) return null;
  peerKeyCache.set(peerUserId, { publicKeyRaw: raw, fetchedAt: now });
  return raw;
}

async function getSharedKey(myUserId: string, peerUserId: string): Promise<CryptoKey | null> {
  const cacheKey = `${myUserId}>${peerUserId}`;
  const cached = sharedKeyCache.get(cacheKey);
  if (cached) return cached;

  const me = await ensureIdentityKey(myUserId);
  if (!me) return null;
  const peerRaw = await resolvePeerPublicKey(peerUserId);
  if (!peerRaw) return null;

  try {
    const key = await deriveSharedSecret(me.keyPair.privateKey, peerRaw);
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

// ---------------------------------------------------------------------------
// Encrypt / decrypt for a conversation
// ---------------------------------------------------------------------------

export interface ConversationCipherEnvelope {
  v: 1;
  alg: 'ECDH-P256+AES-GCM';
  sender: string;
  recipients: Record<string, EncryptedPayload>; // user_id -> blob
}

interface EncryptForConversationArgs {
  myUserId: string;
  recipientUserIds: string[];
  plaintext: string;
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

  await ensureIdentityKey(args.myUserId);

  const recipients: Record<string, EncryptedPayload> = {};
  const unencrypted: string[] = [];

  for (const peerId of args.recipientUserIds) {
    if (!peerId || peerId === args.myUserId) continue;
    const key = await getSharedKey(args.myUserId, peerId);
    if (!key) {
      unencrypted.push(peerId);
      continue;
    }
    try {
      recipients[peerId] = await encryptWithKey(key, args.plaintext);
    } catch {
      unencrypted.push(peerId);
    }
  }

  if (Object.keys(recipients).length === 0) {
    return { envelope: null, unencryptedRecipients: unencrypted };
  }

  return {
    envelope: {
      v: 1,
      alg: 'ECDH-P256+AES-GCM',
      sender: args.myUserId,
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
  if (envelope.v !== 1 || envelope.alg !== 'ECDH-P256+AES-GCM') return null;

  const blob = envelope.recipients?.[myUserId];
  if (!blob) return null;

  const key = await getSharedKey(myUserId, envelope.sender);
  if (!key) return null;

  try {
    return await decryptWithKey(key, blob);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
