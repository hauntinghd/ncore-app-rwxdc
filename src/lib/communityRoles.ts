/**
 * Custom roles for communities — client surface.
 *
 * Schema lives in `20260522211000_custom_roles.sql`. Writes go through
 * SECURITY DEFINER RPCs that gate on the MANAGE_ROLES permission bit.
 */
import { supabase } from './supabase';

// ---------------------------------------------------------------------------
// Permission bits (must stay in sync with the SQL migration)
// ---------------------------------------------------------------------------

export const PERMISSION = {
  VIEW_CHANNEL: 1n << 0n,
  READ_MESSAGES: 1n << 1n,
  SEND_MESSAGES: 1n << 2n,
  MANAGE_MESSAGES: 1n << 3n,
  ATTACH_FILES: 1n << 4n,
  ADD_REACTIONS: 1n << 5n,
  MENTION_EVERYONE: 1n << 6n,
  MANAGE_CHANNELS: 1n << 7n,
  CONNECT_VOICE: 1n << 8n,
  SPEAK_VOICE: 1n << 9n,
  VIDEO: 1n << 10n,
  MUTE_MEMBERS: 1n << 11n,
  DEAFEN_MEMBERS: 1n << 12n,
  MANAGE_ROLES: 1n << 13n,
  MANAGE_NICKNAMES: 1n << 14n,
  KICK_MEMBERS: 1n << 15n,
  BAN_MEMBERS: 1n << 16n,
  MANAGE_COMMUNITY: 1n << 17n,
  ADMINISTRATOR: 1n << 18n,
  VIEW_AUDIT_LOG: 1n << 19n,
} as const;

export type PermissionName = keyof typeof PERMISSION;

export const PERMISSION_LABELS: Record<PermissionName, string> = {
  VIEW_CHANNEL: 'View Channel',
  READ_MESSAGES: 'Read Messages',
  SEND_MESSAGES: 'Send Messages',
  MANAGE_MESSAGES: 'Manage Messages',
  ATTACH_FILES: 'Attach Files',
  ADD_REACTIONS: 'Add Reactions',
  MENTION_EVERYONE: 'Mention @everyone / @here',
  MANAGE_CHANNELS: 'Manage Channels',
  CONNECT_VOICE: 'Connect to Voice',
  SPEAK_VOICE: 'Speak in Voice',
  VIDEO: 'Stream Video',
  MUTE_MEMBERS: 'Mute Members',
  DEAFEN_MEMBERS: 'Deafen Members',
  MANAGE_ROLES: 'Manage Roles',
  MANAGE_NICKNAMES: 'Manage Nicknames',
  KICK_MEMBERS: 'Kick Members',
  BAN_MEMBERS: 'Ban Members',
  MANAGE_COMMUNITY: 'Manage Community',
  ADMINISTRATOR: 'Administrator',
  VIEW_AUDIT_LOG: 'View Audit Log',
};

export const DEFAULT_PERMISSIONS: bigint =
  PERMISSION.VIEW_CHANNEL |
  PERMISSION.READ_MESSAGES |
  PERMISSION.SEND_MESSAGES |
  PERMISSION.ATTACH_FILES |
  PERMISSION.ADD_REACTIONS |
  PERMISSION.CONNECT_VOICE |
  PERMISSION.SPEAK_VOICE |
  PERMISSION.VIDEO; // 1847

export function hasPermission(bits: bigint | number | string | null | undefined, perm: bigint): boolean {
  if (bits == null) return false;
  const b = typeof bits === 'bigint' ? bits : BigInt(bits);
  if ((b & PERMISSION.ADMINISTRATOR) !== 0n) return true;
  return (b & perm) !== 0n;
}

export function permissionsToList(bits: bigint | number | string): PermissionName[] {
  const b = typeof bits === 'bigint' ? bits : BigInt(bits);
  const out: PermissionName[] = [];
  for (const [name, bit] of Object.entries(PERMISSION) as Array<[PermissionName, bigint]>) {
    if ((b & bit) !== 0n) out.push(name);
  }
  return out;
}

export function permissionsFromList(names: readonly PermissionName[]): bigint {
  let b = 0n;
  for (const name of names) b |= PERMISSION[name];
  return b;
}

// ---------------------------------------------------------------------------
// Types matching the SQL row shapes
// ---------------------------------------------------------------------------

export interface CommunityRole {
  id: string;
  community_id: string;
  name: string;
  color: string;
  position: number;
  permissions: bigint;
  is_managed: boolean;
  hoist: boolean;
  mentionable: boolean;
  created_at: string;
  updated_at: string;
}

export interface CommunityMemberRole {
  community_id: string;
  user_id: string;
  role_id: string;
  assigned_at: string;
  assigned_by: string | null;
}

export interface ChannelRoleOverride {
  channel_id: string;
  role_id: string | null;
  allow: bigint;
  deny: bigint;
  updated_at: string;
}

interface CommunityRoleRow {
  id: string;
  community_id: string;
  name: string;
  color: string | null;
  position: number;
  permissions: number | string;
  is_managed: boolean;
  hoist: boolean;
  mentionable: boolean;
  created_at: string;
  updated_at: string;
}

function rowToRole(row: CommunityRoleRow): CommunityRole {
  return {
    id: row.id,
    community_id: row.community_id,
    name: row.name,
    color: row.color || '#5865F2',
    position: Number(row.position) || 0,
    permissions: BigInt(row.permissions ?? 0),
    is_managed: Boolean(row.is_managed),
    hoist: Boolean(row.hoist),
    mentionable: Boolean(row.mentionable),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listCommunityRoles(communityId: string): Promise<CommunityRole[]> {
  const { data, error } = await supabase
    .from('community_roles')
    .select('*')
    .eq('community_id', communityId)
    .order('position', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row: CommunityRoleRow) => rowToRole(row));
}

export async function listMemberRoleAssignments(communityId: string): Promise<CommunityMemberRole[]> {
  const { data, error } = await supabase
    .from('community_member_roles')
    .select('*')
    .eq('community_id', communityId);
  if (error) throw error;
  return (data ?? []) as CommunityMemberRole[];
}

export async function getEffectivePermissions(
  communityId: string,
  userId: string,
  channelId: string | null = null,
): Promise<bigint> {
  const { data, error } = await supabase.rpc('community_member_permissions', {
    p_community_id: communityId,
    p_user_id: userId,
    p_channel_id: channelId,
  });
  if (error) throw error;
  if (data == null) return 0n;
  return BigInt(data as number | string);
}

// ---------------------------------------------------------------------------
// Writes (RPC wrappers)
// ---------------------------------------------------------------------------

interface CreateRoleArgs {
  communityId: string;
  name: string;
  color?: string;
  position?: number;
  permissions?: bigint;
  hoist?: boolean;
  mentionable?: boolean;
}

export async function createCommunityRole(args: CreateRoleArgs): Promise<CommunityRole> {
  const { data, error } = await supabase.rpc('community_role_create', {
    p_community_id: args.communityId,
    p_name: args.name,
    p_color: args.color ?? '#5865F2',
    p_position: args.position ?? 0,
    p_permissions: (args.permissions ?? DEFAULT_PERMISSIONS).toString(),
    p_hoist: args.hoist ?? false,
    p_mentionable: args.mentionable ?? false,
  });
  if (error) throw error;
  return rowToRole(data as CommunityRoleRow);
}

interface UpdateRoleArgs {
  roleId: string;
  name?: string | null;
  color?: string | null;
  position?: number | null;
  permissions?: bigint | null;
  hoist?: boolean | null;
  mentionable?: boolean | null;
}

export async function updateCommunityRole(args: UpdateRoleArgs): Promise<CommunityRole> {
  const { data, error } = await supabase.rpc('community_role_update', {
    p_role_id: args.roleId,
    p_name: args.name ?? null,
    p_color: args.color ?? null,
    p_position: args.position ?? null,
    p_permissions: args.permissions != null ? args.permissions.toString() : null,
    p_hoist: args.hoist ?? null,
    p_mentionable: args.mentionable ?? null,
  });
  if (error) throw error;
  return rowToRole(data as CommunityRoleRow);
}

export async function deleteCommunityRole(roleId: string): Promise<void> {
  const { error } = await supabase.rpc('community_role_delete', { p_role_id: roleId });
  if (error) throw error;
}

export async function assignCommunityRole(
  communityId: string,
  userId: string,
  roleId: string,
): Promise<void> {
  const { error } = await supabase.rpc('community_role_assign', {
    p_community_id: communityId,
    p_user_id: userId,
    p_role_id: roleId,
  });
  if (error) throw error;
}

export async function unassignCommunityRole(
  communityId: string,
  userId: string,
  roleId: string,
): Promise<void> {
  const { error } = await supabase.rpc('community_role_unassign', {
    p_community_id: communityId,
    p_user_id: userId,
    p_role_id: roleId,
  });
  if (error) throw error;
}

export async function setChannelRoleOverride(
  channelId: string,
  roleId: string | null,
  allow: bigint,
  deny: bigint,
): Promise<void> {
  const { error } = await supabase.rpc('channel_role_override_set', {
    p_channel_id: channelId,
    p_role_id: roleId,
    p_allow: allow.toString(),
    p_deny: deny.toString(),
  });
  if (error) throw error;
}

export async function clearChannelRoleOverride(
  channelId: string,
  roleId: string | null,
): Promise<void> {
  const { error } = await supabase.rpc('channel_role_override_clear', {
    p_channel_id: channelId,
    p_role_id: roleId,
  });
  if (error) throw error;
}
