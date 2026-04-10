/**
 * NCore E2E Encryption Module
 *
 * Provides end-to-end encryption for direct messages using:
 * - X25519 key agreement (via WebCrypto ECDH with P-256 as fallback)
 * - AES-256-GCM for message encryption
 * - HKDF for key derivation
 *
 * This is the client-side foundation. The server only stores ciphertext.
 */

// ---------------------------------------------------------------------------
// Key generation
// ---------------------------------------------------------------------------

export interface E2EKeyPair {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  publicKeyRaw: ArrayBuffer;
}

export async function generateIdentityKeyPair(): Promise<E2EKeyPair> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits'],
  );
  const publicKeyRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey);
  return {
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
    publicKeyRaw,
  };
}

export async function generatePreKey(): Promise<E2EKeyPair> {
  return generateIdentityKeyPair(); // Same algo, different lifecycle
}

// ---------------------------------------------------------------------------
// Key exchange (simplified X3DH-like)
// ---------------------------------------------------------------------------

export async function deriveSharedSecret(
  myPrivateKey: CryptoKey,
  theirPublicKeyRaw: ArrayBuffer,
): Promise<CryptoKey> {
  const theirPublicKey = await crypto.subtle.importKey(
    'raw',
    theirPublicKeyRaw,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );

  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: theirPublicKey },
    myPrivateKey,
    256,
  );

  // Derive AES key from shared secret using HKDF
  const hkdfKey = await crypto.subtle.importKey(
    'raw',
    sharedBits,
    'HKDF',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode('ncore-e2e-v1'),
      info: new TextEncoder().encode('message-encryption'),
    },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// ---------------------------------------------------------------------------
// Message encryption / decryption
// ---------------------------------------------------------------------------

export interface EncryptedPayload {
  iv: string;       // Base64-encoded 12-byte IV
  ciphertext: string; // Base64-encoded ciphertext
  tag: string;       // Included in GCM ciphertext
  version: 1;
}

export async function encryptMessage(
  key: CryptoKey,
  plaintext: string,
): Promise<EncryptedPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded,
  );

  return {
    iv: arrayBufferToBase64(iv),
    ciphertext: arrayBufferToBase64(ciphertext),
    tag: '', // GCM tag is appended to ciphertext by WebCrypto
    version: 1,
  };
}

export async function decryptMessage(
  key: CryptoKey,
  payload: EncryptedPayload,
): Promise<string> {
  const iv = base64ToArrayBuffer(payload.iv);
  const ciphertext = base64ToArrayBuffer(payload.ciphertext);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext,
  );

  return new TextDecoder().decode(decrypted);
}

// ---------------------------------------------------------------------------
// Key storage helpers
// ---------------------------------------------------------------------------

export async function exportKeyPair(keyPair: E2EKeyPair): Promise<{ publicKey: string; privateKey: string }> {
  const pubRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey);
  const privJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
  return {
    publicKey: arrayBufferToBase64(pubRaw),
    privateKey: JSON.stringify(privJwk),
  };
}

export async function importKeyPair(exported: { publicKey: string; privateKey: string }): Promise<E2EKeyPair> {
  const pubRaw = base64ToArrayBuffer(exported.publicKey);
  const privJwk = JSON.parse(exported.privateKey);

  const publicKey = await crypto.subtle.importKey(
    'raw',
    pubRaw,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    [],
  );
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    privJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits'],
  );

  return { publicKey, privateKey, publicKeyRaw: pubRaw };
}

// ---------------------------------------------------------------------------
// Verification codes (safety numbers)
// ---------------------------------------------------------------------------

export async function generateVerificationCode(
  myPublicKeyRaw: ArrayBuffer,
  theirPublicKeyRaw: ArrayBuffer,
): Promise<string[]> {
  const combined = new Uint8Array(myPublicKeyRaw.byteLength + theirPublicKeyRaw.byteLength);
  // Sort deterministically so both sides get the same code
  const myBytes = new Uint8Array(myPublicKeyRaw);
  const theirBytes = new Uint8Array(theirPublicKeyRaw);
  const [first, second] = compareBytes(myBytes, theirBytes) < 0
    ? [myBytes, theirBytes]
    : [theirBytes, myBytes];
  combined.set(first, 0);
  combined.set(second, first.byteLength);

  const hash = await crypto.subtle.digest('SHA-256', combined);
  const hashBytes = new Uint8Array(hash);

  const codes: string[] = [];
  for (let i = 0; i < 6; i++) {
    const offset = i * 4;
    const num = ((hashBytes[offset] << 16) | (hashBytes[offset + 1] << 8) | hashBytes[offset + 2]) % 100000;
    codes.push(String(num).padStart(5, '0'));
  }
  return codes;
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

// ---------------------------------------------------------------------------
// Encoding utilities
// ---------------------------------------------------------------------------

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
