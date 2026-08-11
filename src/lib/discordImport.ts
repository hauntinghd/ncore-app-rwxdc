/**
 * Discord data-package import — social graph restore.
 *
 * The package is parsed entirely in the browser. The only data that leaves
 * the device is HMAC fingerprints of Discord snowflake IDs (computed by the
 * `discord-import-hash` edge function, which holds the pepper) plus the
 * user's own import preferences. No usernames, no messages, no raw IDs are
 * stored server-side. See supabase/migrations/20260811090000 for the
 * matching rules (mutual attestation, block precedence).
 */

import JSZip from 'jszip';
import { supabase } from './supabase';

export interface DiscordPackageSummary {
  /** The package owner's Discord snowflake. */
  discordUserId: string;
  /** Display handle from the package, shown in the preview UI only. */
  username: string;
  friendIds: string[];
  blockedIds: string[];
  guildIds: string[];
  /** Relationship rows we deliberately ignore (pending requests). */
  ignoredPendingCount: number;
}

export interface DiscordImportResult {
  friendshipsRestored: number;
  blocksApplied: number;
  friendsImported: number;
  blocksImported: number;
  guildsImported: number;
}

export interface DiscordImportStatus extends DiscordImportResult {
  linked: boolean;
  autoFriend: boolean;
  linkedAt: string | null;
  lastImportAt: string | null;
}

const SNOWFLAKE_PATTERN = /^\d{5,25}$/;
/** Discord relationship type codes, per their API and data package. */
const RELATIONSHIP_FRIEND = 1;
const RELATIONSHIP_BLOCKED = 2;

const HASH_BATCH_SIZE = 1000;
const EDGE_SUBMIT_BATCH_SIZE = 1000;

function asSnowflake(value: unknown): string | null {
  const id = String(value ?? '').trim();
  return SNOWFLAKE_PATTERN.test(id) ? id : null;
}

async function readZipJson(zip: JSZip, pathPattern: RegExp): Promise<unknown | null> {
  const match = Object.keys(zip.files).find(
    (name) => !zip.files[name].dir && pathPattern.test(name.toLowerCase()),
  );
  if (!match) return null;
  try {
    return JSON.parse(await zip.files[match].async('text'));
  } catch {
    return null;
  }
}

/**
 * Parses a Discord GDPR data package (.zip) locally and extracts the social
 * graph. Tolerant of the package layout shifting: files are located by path
 * suffix, not exact position, and unrecognised relationship entries are
 * counted rather than fatal.
 */
export async function parseDiscordPackage(file: File): Promise<DiscordPackageSummary> {
  const zip = await JSZip.loadAsync(file);

  const user = (await readZipJson(zip, /(^|\/)account\/user\.json$/)) as
    | {
        id?: unknown;
        username?: unknown;
        global_name?: unknown;
        relationships?: Array<{ id?: unknown; type?: unknown; user?: { id?: unknown } }>;
      }
    | null;

  if (!user) {
    throw new Error(
      'No account/user.json found. This does not look like a Discord data package — request one under Discord Settings → Privacy & Safety → Request all of my Data.',
    );
  }

  const discordUserId = asSnowflake(user.id);
  if (!discordUserId) {
    throw new Error('The package is missing a valid account ID.');
  }

  const friendIds: string[] = [];
  const blockedIds: string[] = [];
  let ignoredPendingCount = 0;
  const seen = new Set<string>();

  for (const entry of Array.isArray(user.relationships) ? user.relationships : []) {
    const otherId = asSnowflake(entry?.id) ?? asSnowflake(entry?.user?.id);
    if (!otherId || otherId === discordUserId || seen.has(otherId)) continue;
    const type = Number(entry?.type);
    if (type === RELATIONSHIP_FRIEND) {
      seen.add(otherId);
      friendIds.push(otherId);
    } else if (type === RELATIONSHIP_BLOCKED) {
      seen.add(otherId);
      blockedIds.push(otherId);
    } else {
      // Incoming/outgoing pending requests — never friendships, so importing
      // them would manufacture consent that was never given.
      ignoredPendingCount += 1;
    }
  }

  // servers/index.json maps guild id -> guild name. Only the ids are used,
  // and only as fingerprints, for the future community-migration matcher.
  const serversIndex = (await readZipJson(zip, /(^|\/)servers\/index\.json$/)) as
    | Record<string, unknown>
    | null;
  const guildIds = serversIndex
    ? Object.keys(serversIndex)
        .map((key) => asSnowflake(key))
        .filter((id): id is string => id !== null)
    : [];

  return {
    discordUserId,
    username: String(user.global_name || user.username || 'Unknown').trim() || 'Unknown',
    friendIds,
    blockedIds,
    guildIds,
    ignoredPendingCount,
  };
}

async function hashDiscordIds(ids: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (let index = 0; index < ids.length; index += HASH_BATCH_SIZE) {
    const batch = ids.slice(index, index + HASH_BATCH_SIZE);
    const { data, error } = await supabase.functions.invoke('discord-import-hash', {
      body: { ids: batch },
    });
    if (error) {
      const payload = (data ?? {}) as { code?: string };
      if (payload.code === 'not_configured') {
        throw new Error('Discord import is not configured on this server yet.');
      }
      throw new Error(error.message || 'Could not fingerprint Discord IDs.');
    }
    const hashes = (data as { hashes?: string[] })?.hashes;
    if (!Array.isArray(hashes) || hashes.length !== batch.length) {
      throw new Error('Fingerprinting returned an unexpected result.');
    }
    batch.forEach((id, i) => result.set(id, hashes[i]));
  }
  return result;
}

/**
 * Links the identity, submits the fingerprint edges, and runs matching.
 * Safe to re-run: a re-import replaces the previous edge set.
 */
export async function importDiscordGraph(
  summary: DiscordPackageSummary,
  options: { autoFriend: boolean },
): Promise<DiscordImportResult> {
  const allIds = [
    summary.discordUserId,
    ...summary.friendIds,
    ...summary.blockedIds,
    ...summary.guildIds,
  ];
  const hashes = await hashDiscordIds(Array.from(new Set(allIds)));

  const selfHash = hashes.get(summary.discordUserId);
  if (!selfHash) throw new Error('Could not fingerprint your own Discord ID.');

  const { error: beginError } = await supabase.rpc('discord_import_begin', {
    p_self_hash: selfHash,
    p_auto_friend: options.autoFriend,
  });
  if (beginError) throw new Error(beginError.message);

  const edges: Array<{ h: string; t: 'friend' | 'blocked' | 'guild' }> = [];
  for (const id of summary.friendIds) {
    const hash = hashes.get(id);
    if (hash) edges.push({ h: hash, t: 'friend' });
  }
  for (const id of summary.blockedIds) {
    const hash = hashes.get(id);
    if (hash) edges.push({ h: hash, t: 'blocked' });
  }
  for (const id of summary.guildIds) {
    const hash = hashes.get(id);
    if (hash) edges.push({ h: hash, t: 'guild' });
  }

  for (let index = 0; index < edges.length; index += EDGE_SUBMIT_BATCH_SIZE) {
    const batch = edges.slice(index, index + EDGE_SUBMIT_BATCH_SIZE);
    const { error } = await supabase.rpc('discord_import_edges_submit', { p_edges: batch });
    if (error) throw new Error(error.message);
  }

  const { data, error: finalizeError } = await supabase.rpc('discord_import_finalize');
  if (finalizeError) throw new Error(finalizeError.message);

  const row = Array.isArray(data) ? data[0] : data;
  return {
    friendshipsRestored: Number(row?.friendships_restored) || 0,
    blocksApplied: Number(row?.blocks_applied) || 0,
    friendsImported: Number(row?.friends_imported) || 0,
    blocksImported: Number(row?.blocks_imported) || 0,
    guildsImported: Number(row?.guilds_imported) || 0,
  };
}

export async function getDiscordImportStatus(): Promise<DiscordImportStatus> {
  const { data, error } = await supabase
    .from('discord_identity_links')
    .select(
      'auto_friend, friends_imported, blocks_imported, guilds_imported, friendships_restored, blocks_applied, linked_at, last_import_at',
    )
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    return {
      linked: false,
      autoFriend: true,
      linkedAt: null,
      lastImportAt: null,
      friendshipsRestored: 0,
      blocksApplied: 0,
      friendsImported: 0,
      blocksImported: 0,
      guildsImported: 0,
    };
  }
  return {
    linked: true,
    autoFriend: Boolean(data.auto_friend),
    linkedAt: data.linked_at ? String(data.linked_at) : null,
    lastImportAt: data.last_import_at ? String(data.last_import_at) : null,
    friendshipsRestored: Number(data.friendships_restored) || 0,
    blocksApplied: Number(data.blocks_applied) || 0,
    friendsImported: Number(data.friends_imported) || 0,
    blocksImported: Number(data.blocks_imported) || 0,
    guildsImported: Number(data.guilds_imported) || 0,
  };
}

/** Removes the identity link and fingerprints. Restored relationships stay. */
export async function unlinkDiscordImport(): Promise<void> {
  const { error } = await supabase.rpc('discord_import_unlink');
  if (error) throw new Error(error.message);
}
