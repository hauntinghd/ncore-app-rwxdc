/**
 * E2E private key storage.
 *
 * ## The problem this solves
 * Identity keys were generated as extractable and written to localStorage as
 * exported JWK. Any XSS — one bad dependency, one unescaped render — could read
 * `ncore.e2e.identity.<userId>`, walk away with the raw private key, and
 * decrypt every past and future message for that user, forever, from anywhere.
 * The encryption was real but the key was sitting in a text file.
 *
 * ## What replaces it
 * Keys are generated **non-extractable** and stored as live `CryptoKey` objects
 * in IndexedDB, which can structured-clone them without ever exposing their
 * bytes to JavaScript.
 *
 * This does not make XSS harmless — script running on the page can still *use*
 * the key to decrypt while it is running. What it removes is exfiltration: the
 * attacker cannot copy the key out, cannot decrypt anything after they lose
 * script execution, and cannot decrypt on another machine. That is the
 * difference between a permanent compromise and a session-length one, and it is
 * the strongest guarantee a browser offers.
 *
 * ## Migration
 * An existing localStorage key is imported into IndexedDB on first load and the
 * localStorage copy is deleted. The imported key cannot be made non-extractable
 * retroactively — the bytes were already extractable and may already have
 * leaked — so `isLegacyKey` stays true for it and the UI says so. A user who
 * wants the stronger guarantee has to rotate, which is a real decision with a
 * real cost (undecryptable history), so it is offered rather than forced.
 */

const DB_NAME = 'ncore-e2e';
const DB_VERSION = 1;
const STORE_NAME = 'identity-keys';
const LEGACY_STORAGE_PREFIX = 'ncore.e2e.identity.';

export interface StoredIdentity {
  userId: string;
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  /** Raw public key bytes — public by definition, safe to keep as bytes. */
  publicKeyRaw: ArrayBuffer;
  /**
   * True when this key came from the old localStorage format. Its material was
   * extractable at some point, so it cannot be treated as unexfiltratable.
   */
  isLegacyKey: boolean;
  createdAt: number;
}

interface StoredRecord {
  userId: string;
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  publicKeyRaw: ArrayBuffer;
  isLegacyKey: boolean;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// IndexedDB plumbing
// ---------------------------------------------------------------------------

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'userId' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the key database.'));
    // Fired when another tab holds an older version open. Not fatal here since
    // there is only one version, but leaving it unhandled hangs forever.
    request.onblocked = () => reject(new Error('The key database is blocked by another tab.'));
  });

  // A failed open must not be cached, or every later call fails too.
  dbPromise.catch(() => {
    dbPromise = null;
  });

  return dbPromise;
}

function runTransaction<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, mode);
        const request = operation(transaction.objectStore(STORE_NAME));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Key store operation failed.'));
        transaction.onabort = () =>
          reject(transaction.error ?? new Error('Key store transaction aborted.'));
      }),
  );
}

// ---------------------------------------------------------------------------
// Key generation
// ---------------------------------------------------------------------------

/**
 * Generates an identity key pair whose private half can never leave the
 * browser.
 *
 * `extractable: false` is the entire point — `crypto.subtle.exportKey` on this
 * private key throws, so there is no code path, hostile or otherwise, that
 * turns it back into bytes.
 */
async function generateNonExtractableIdentity(): Promise<{
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  publicKeyRaw: ArrayBuffer;
}> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveKey', 'deriveBits'],
  );

  // The public key is exported before we lose the handle; it is public data and
  // has to be published to `e2e_device_keys` anyway.
  const publicKey = await crypto.subtle.importKey(
    'raw',
    await crypto.subtle.exportKey('raw', keyPair.publicKey),
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    [],
  );
  const publicKeyRaw = await crypto.subtle.exportKey('raw', publicKey);

  return { publicKey, privateKey: keyPair.privateKey, publicKeyRaw };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function loadIdentity(userId: string): Promise<StoredIdentity | null> {
  if (!userId) return null;
  try {
    const record = await runTransaction<StoredRecord | undefined>('readonly', (store) =>
      store.get(userId),
    );
    if (!record?.privateKey) return null;
    return {
      userId: record.userId,
      publicKey: record.publicKey,
      privateKey: record.privateKey,
      publicKeyRaw: record.publicKeyRaw,
      isLegacyKey: Boolean(record.isLegacyKey),
      createdAt: Number(record.createdAt) || 0,
    };
  } catch {
    return null;
  }
}

async function saveIdentity(record: StoredRecord): Promise<void> {
  await runTransaction('readwrite', (store) => store.put(record));
}

/**
 * Returns the user's identity key, creating or migrating one as needed.
 *
 * Order matters: an existing IndexedDB key wins over a legacy localStorage one,
 * so a completed migration is never undone by a stale localStorage entry that
 * failed to delete.
 */
export async function ensureStoredIdentity(userId: string): Promise<StoredIdentity | null> {
  if (!userId || typeof window === 'undefined' || !globalThis.crypto?.subtle) return null;

  const existing = await loadIdentity(userId);
  if (existing) {
    void clearLegacyKey(userId);
    return existing;
  }

  const migrated = await migrateLegacyKey(userId);
  if (migrated) return migrated;

  try {
    const generated = await generateNonExtractableIdentity();
    const record: StoredRecord = {
      userId,
      publicKey: generated.publicKey,
      privateKey: generated.privateKey,
      publicKeyRaw: generated.publicKeyRaw,
      isLegacyKey: false,
      createdAt: Date.now(),
    };
    await saveIdentity(record);
    return { ...record };
  } catch {
    return null;
  }
}

/**
 * Imports a key from the old localStorage format, then deletes the original.
 *
 * The imported private key is marked non-extractable going forward, which stops
 * *future* export, but the bytes existed in a readable form and may already be
 * in someone's hands. `isLegacyKey` records that so nothing downstream claims a
 * guarantee this key cannot make.
 */
async function migrateLegacyKey(userId: string): Promise<StoredIdentity | null> {
  const storageKey = `${LEGACY_STORAGE_PREFIX}${userId}`;

  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(storageKey);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as { publicKey?: string; privateKey?: string };
    if (!parsed.publicKey || !parsed.privateKey) return null;

    const publicKeyRaw = base64ToArrayBuffer(parsed.publicKey);
    const publicKey = await crypto.subtle.importKey(
      'raw',
      publicKeyRaw,
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      [],
    );
    const privateKey = await crypto.subtle.importKey(
      'jwk',
      JSON.parse(parsed.privateKey),
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveKey', 'deriveBits'],
    );

    const record: StoredRecord = {
      userId,
      publicKey,
      privateKey,
      publicKeyRaw,
      isLegacyKey: true,
      createdAt: Date.now(),
    };
    await saveIdentity(record);

    // Only remove the original once the new copy is durably written. Deleting
    // first and then failing the write would destroy the user's history.
    await clearLegacyKey(userId);

    return { ...record };
  } catch {
    // A malformed legacy blob is left exactly where it is. It is useless to us,
    // but deleting someone's only key material on a parse error is not our call.
    return null;
  }
}

async function clearLegacyKey(userId: string): Promise<void> {
  try {
    window.localStorage.removeItem(`${LEGACY_STORAGE_PREFIX}${userId}`);
  } catch {
    // Nothing to do; the IndexedDB copy is authoritative either way.
  }
}

/**
 * Discards the stored key and generates a fresh non-extractable one.
 *
 * Destructive: messages encrypted to the old key become permanently
 * unreadable on this device. Only worth doing when the old key is believed
 * compromised — which is exactly the case for migrated legacy keys.
 */
export async function rotateIdentity(userId: string): Promise<StoredIdentity | null> {
  if (!userId) return null;
  try {
    await runTransaction('readwrite', (store) => store.delete(userId));
  } catch {
    return null;
  }
  await clearLegacyKey(userId);
  return ensureStoredIdentity(userId);
}

/** Whether keys can be stored non-extractably on this client at all. */
export function isSecureKeystoreAvailable(): boolean {
  return typeof indexedDB !== 'undefined' && Boolean(globalThis.crypto?.subtle);
}

/** Any localStorage identity keys still on disk, by user id. */
export function findLegacyKeyUserIds(): string[] {
  if (typeof window === 'undefined') return [];
  const found: string[] = [];
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(LEGACY_STORAGE_PREFIX)) {
        found.push(key.slice(LEGACY_STORAGE_PREFIX.length));
      }
    }
  } catch {
    return [];
  }
  return found;
}

function base64ToArrayBuffer(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}
