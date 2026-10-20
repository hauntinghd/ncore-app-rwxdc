import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Save, Shield, Trash2, X } from 'lucide-react';
import {
  PERMISSION,
  PERMISSION_LABELS,
  type PermissionName,
  DEFAULT_PERMISSIONS,
  createCommunityRole,
  deleteCommunityRole,
  listCommunityRoles,
  permissionsFromList,
  permissionsToList,
  updateCommunityRole,
  type CommunityRole,
} from '../../lib/communityRoles';

interface CustomRolesSectionProps {
  communityId: string;
  canManage: boolean;
}

interface DraftRole {
  id: string;
  name: string;
  color: string;
  position: number;
  permissions: bigint;
  hoist: boolean;
  mentionable: boolean;
  is_managed: boolean;
  isNew?: boolean;
  dirty?: boolean;
}

function roleToDraft(role: CommunityRole): DraftRole {
  return {
    id: role.id,
    name: role.name,
    color: role.color,
    position: role.position,
    permissions: role.permissions,
    hoist: role.hoist,
    mentionable: role.mentionable,
    is_managed: role.is_managed,
  };
}

const PERMISSION_ORDER: PermissionName[] = [
  'ADMINISTRATOR',
  'MANAGE_COMMUNITY',
  'MANAGE_ROLES',
  'MANAGE_CHANNELS',
  'MANAGE_MESSAGES',
  'KICK_MEMBERS',
  'BAN_MEMBERS',
  'VIEW_AUDIT_LOG',
  'MANAGE_NICKNAMES',
  'MUTE_MEMBERS',
  'DEAFEN_MEMBERS',
  'VIEW_CHANNEL',
  'READ_MESSAGES',
  'SEND_MESSAGES',
  'ATTACH_FILES',
  'ADD_REACTIONS',
  'MENTION_EVERYONE',
  'CONNECT_VOICE',
  'SPEAK_VOICE',
  'VIDEO',
];

export const CustomRolesSection = memo(function CustomRolesSection({
  communityId,
  canManage,
}: CustomRolesSectionProps) {
  const [roles, setRoles] = useState<DraftRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyRoleId, setBusyRoleId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!communityId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await listCommunityRoles(communityId);
      setRoles(data.map(roleToDraft));
    } catch (err) {
      setError((err as Error).message || 'Failed to load roles');
    } finally {
      setLoading(false);
    }
  }, [communityId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleAdd = useCallback(() => {
    if (!canManage) return;
    const id = `new-${Date.now()}`;
    setRoles((prev) => [
      ...prev,
      {
        id,
        name: 'New Role',
        color: '#5865F2',
        position: prev.length,
        permissions: DEFAULT_PERMISSIONS,
        hoist: false,
        mentionable: false,
        is_managed: false,
        isNew: true,
        dirty: true,
      },
    ]);
  }, [canManage]);

  const handleField = useCallback(
    <K extends keyof DraftRole>(id: string, field: K, value: DraftRole[K]) => {
      setRoles((prev) =>
        prev.map((r) => (r.id === id ? { ...r, [field]: value, dirty: true } : r)),
      );
    },
    [],
  );

  const handlePermissionToggle = useCallback((id: string, permission: PermissionName) => {
    setRoles((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const bit = PERMISSION[permission];
        const next = (r.permissions & bit) !== 0n ? r.permissions & ~bit : r.permissions | bit;
        return { ...r, permissions: next, dirty: true };
      }),
    );
  }, []);

  const handleSave = useCallback(
    async (id: string) => {
      const role = roles.find((r) => r.id === id);
      if (!role) return;
      setBusyRoleId(id);
      setError(null);
      try {
        if (role.isNew) {
          const created = await createCommunityRole({
            communityId,
            name: role.name.trim() || 'Role',
            color: role.color,
            position: role.position,
            permissions: role.permissions,
            hoist: role.hoist,
            mentionable: role.mentionable,
          });
          setRoles((prev) => prev.map((r) => (r.id === id ? roleToDraft(created) : r)));
        } else {
          const updated = await updateCommunityRole({
            roleId: role.id,
            name: role.name.trim(),
            color: role.color,
            position: role.position,
            permissions: role.permissions,
            hoist: role.hoist,
            mentionable: role.mentionable,
          });
          setRoles((prev) => prev.map((r) => (r.id === id ? roleToDraft(updated) : r)));
        }
      } catch (err) {
        setError((err as Error).message || 'Save failed');
      } finally {
        setBusyRoleId(null);
      }
    },
    [communityId, roles],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      const role = roles.find((r) => r.id === id);
      if (!role) return;
      if (role.isNew) {
        setRoles((prev) => prev.filter((r) => r.id !== id));
        return;
      }
      if (role.is_managed) return;
      const confirmed = typeof window !== 'undefined'
        ? window.confirm(`Delete role "${role.name}"? This cannot be undone.`)
        : true;
      if (!confirmed) return;
      setBusyRoleId(id);
      try {
        await deleteCommunityRole(id);
        setRoles((prev) => prev.filter((r) => r.id !== id));
      } catch (err) {
        setError((err as Error).message || 'Delete failed');
      } finally {
        setBusyRoleId(null);
      }
    },
    [roles],
  );

  const sorted = useMemo(() => [...roles].sort((a, b) => b.position - a.position), [roles]);

  if (loading) {
    return (
      <div className="nyptid-card p-5">
        <div className="flex items-center gap-2 mb-2">
          <Shield size={16} className="text-nyptid-300" />
          <h2 className="text-lg font-bold text-surface-100">Custom Roles</h2>
        </div>
        <div className="text-xs text-surface-500">Loading roles…</div>
      </div>
    );
  }

  return (
    <div className="nyptid-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Shield size={16} className="text-nyptid-300" />
          <h2 className="text-lg font-bold text-surface-100">Custom Roles</h2>
        </div>
        {canManage && (
          <button type="button" onClick={handleAdd} className="nyptid-btn-secondary px-2.5 py-1.5 text-xs">
            <Plus size={12} />
            Add Role
          </button>
        )}
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {error}
        </div>
      )}

      {sorted.length === 0 && (
        <div className="text-xs text-surface-500">
          No custom roles yet. Built-in roles (Owner, Admin, Moderator, Member) keep working — custom roles add
          extra permission bundles on top.
        </div>
      )}

      <div className="space-y-3">
        {sorted.map((role) => {
          const granted = permissionsToList(role.permissions);
          const isBusy = busyRoleId === role.id;
          const disabled = !canManage || role.is_managed || isBusy;
          return (
            <details
              key={role.id}
              className="rounded-lg border border-surface-700 bg-surface-900/40 [&[open]]:bg-surface-900/60"
            >
              <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2">
                <span
                  className="inline-block h-3 w-3 rounded-full"
                  style={{ background: role.color }}
                />
                <span className="font-medium text-surface-100">{role.name || '(unnamed role)'}</span>
                <span className="text-xs text-surface-500">{granted.length} perms</span>
                {role.dirty && <span className="text-[10px] uppercase text-amber-300">unsaved</span>}
                {role.is_managed && <span className="text-[10px] uppercase text-surface-500">managed</span>}
                <span className="ml-auto text-xs text-surface-500">pos {role.position}</span>
              </summary>

              <div className="space-y-3 border-t border-surface-700/60 px-3 py-3">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]">
                  <input
                    value={role.name}
                    onChange={(e) => handleField(role.id, 'name', e.target.value)}
                    disabled={disabled}
                    className="nyptid-input"
                    maxLength={48}
                    placeholder="Role name"
                  />
                  <input
                    type="color"
                    value={role.color}
                    onChange={(e) => handleField(role.id, 'color', e.target.value)}
                    disabled={disabled}
                    className="h-10 w-full rounded-md border border-surface-700 bg-surface-900 px-1"
                  />
                  <input
                    type="number"
                    value={role.position}
                    onChange={(e) => handleField(role.id, 'position', Number(e.target.value) || 0)}
                    disabled={disabled}
                    className="nyptid-input w-20"
                    placeholder="Pos"
                  />
                </div>

                <div className="flex flex-wrap gap-3 text-xs text-surface-300">
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={role.hoist}
                      disabled={disabled}
                      onChange={(e) => handleField(role.id, 'hoist', e.target.checked)}
                    />
                    Display separately in member list
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={role.mentionable}
                      disabled={disabled}
                      onChange={(e) => handleField(role.id, 'mentionable', e.target.checked)}
                    />
                    Allow @mentioning this role
                  </label>
                </div>

                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {PERMISSION_ORDER.map((permission) => {
                    const enabled = (role.permissions & PERMISSION[permission]) !== 0n;
                    return (
                      <label
                        key={permission}
                        className={`flex items-center gap-2 rounded px-2 py-1.5 text-xs ${
                          enabled ? 'bg-nyptid-300/10 text-nyptid-100' : 'text-surface-300'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={enabled}
                          disabled={disabled}
                          onChange={() => handlePermissionToggle(role.id, permission)}
                        />
                        <span className="truncate">{PERMISSION_LABELS[permission]}</span>
                      </label>
                    );
                  })}
                </div>

                <div className="flex items-center gap-2">
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => void handleSave(role.id)}
                      disabled={!role.dirty || isBusy || role.is_managed}
                      className="nyptid-btn-primary px-3 py-1.5 text-xs"
                    >
                      <Save size={12} />
                      {isBusy ? 'Saving…' : role.isNew ? 'Create' : 'Save'}
                    </button>
                  )}
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => void handleDelete(role.id)}
                      disabled={isBusy || role.is_managed}
                      className="nyptid-btn-secondary px-3 py-1.5 text-xs text-red-200"
                    >
                      {role.isNew ? <X size={12} /> : <Trash2 size={12} />}
                      {role.isNew ? 'Discard' : 'Delete'}
                    </button>
                  )}
                </div>
              </div>
            </details>
          );
        })}
      </div>

      <p className="mt-3 text-[11px] text-surface-500">
        Members get permissions from <strong>every</strong> role assigned to them, OR’d together. Channel-level
        overrides (allow/deny) layer on top — those are managed from the channel’s context menu in the channel
        list. The legacy Owner/Admin/Moderator/Member enum still wins for backwards compatibility.
      </p>
    </div>
  );
});

// Re-export for callers that just need the helpers nearby.
export { permissionsFromList };
