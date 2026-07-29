import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, Laptop, Pencil, ShieldCheck, Trash2, X } from 'lucide-react';
import {
  forgetDevice,
  listMyDevices,
  renameDevice,
  restoreDevice,
  revokeDevice,
  type E2EDevice,
} from '../../lib/crypto/deviceManagement';
import { getCachedIdentity, isE2EEnabled } from '../../lib/crypto/e2eManager';
import { formatRelativeTime } from '../../lib/utils';

interface E2EDevicesSectionProps {
  userId: string;
}

/**
 * Device management for end-to-end encrypted DMs.
 *
 * The audit flagged this as the largest remaining hole in the E2E work: keys
 * were being published per device with no way to see or revoke them.
 */
export function E2EDevicesSection({ userId }: E2EDevicesSectionProps) {
  const [devices, setDevices] = useState<E2EDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyDeviceId, setBusyDeviceId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const identity = getCachedIdentity();
  const e2eOn = isE2EEnabled();

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      setDevices(await listMyDevices(userId));
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load devices.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runAction(deviceId: string, action: () => Promise<void>) {
    setBusyDeviceId(deviceId);
    setError('');
    try {
      await action();
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Action failed.');
    } finally {
      setBusyDeviceId(null);
    }
  }

  const activeDevices = devices.filter((device) => !device.revokedAt);
  const revokedDevices = devices.filter((device) => device.revokedAt);

  return (
    <div className="nyptid-card p-5">
      <div className="mb-3 flex items-center gap-2">
        <ShieldCheck size={16} className="text-nyptid-300" />
        <h2 className="text-lg font-bold text-surface-100">Encrypted Message Devices</h2>
      </div>

      {!e2eOn ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          End-to-end encryption for direct messages is currently disabled on this client, so no
          device keys are in use.
        </div>
      ) : (
        <>
          <p className="mb-4 text-sm text-surface-400">
            Each device you sign in on publishes its own encryption key, and new direct messages are
            encrypted separately for every active device. Revoking a device stops future messages
            from being readable on it.
          </p>

          <div className="mb-4 flex gap-2 rounded-lg border border-surface-700 bg-surface-900/50 px-3 py-2 text-xs text-surface-400">
            <AlertTriangle size={14} className="mt-0.5 flex-shrink-0 text-amber-300" />
            <span>
              Revoking cannot claw back messages a device has already received and decrypted. If a
              device is lost or stolen, revoke it and treat past conversations on it as exposed.
            </span>
          </div>

          {error && (
            <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {error}
            </div>
          )}

          {loading ? (
            <div className="py-6 text-center text-sm text-surface-500">Loading devices…</div>
          ) : devices.length === 0 ? (
            <div className="py-6 text-center text-sm text-surface-500">
              No encryption devices registered yet. Open a direct message to publish this device's key.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1">
                {activeDevices.map((device) => (
                  <div
                    key={device.deviceId}
                    className={`flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2.5 ${
                      device.isCurrent
                        ? 'border-nyptid-300/40 bg-nyptid-300/5'
                        : 'border-surface-700/70 bg-surface-900/40'
                    }`}
                  >
                    <Laptop size={16} className="flex-shrink-0 text-surface-400" />

                    {renamingId === device.deviceId ? (
                      <>
                        <input
                          type="text"
                          value={renameValue}
                          onChange={(event) => setRenameValue(event.target.value)}
                          aria-label="Device name"
                          className="w-48 rounded-lg border border-surface-700 bg-surface-950 px-2 py-1 text-xs text-surface-200 focus:border-nyptid-300 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            void runAction(device.deviceId, async () => {
                              await renameDevice(userId, device.deviceId, renameValue);
                              setRenamingId(null);
                            })
                          }
                          aria-label="Save device name"
                          className="p-1.5 text-green-300 hover:text-green-200"
                        >
                          <Check size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setRenamingId(null)}
                          aria-label="Cancel rename"
                          className="p-1.5 text-surface-400 hover:text-surface-200"
                        >
                          <X size={14} />
                        </button>
                      </>
                    ) : (
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-surface-200">
                            {device.label}
                          </span>
                          {device.isCurrent && (
                            <span className="rounded bg-nyptid-300/20 px-1.5 py-0.5 text-[10px] font-bold text-nyptid-200">
                              THIS DEVICE
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-surface-500">
                          <span>Last seen {formatRelativeTime(device.lastSeenAt)}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono">{device.fingerprint || 'no fingerprint'}</span>
                        </div>
                      </div>
                    )}

                    {renamingId !== device.deviceId && (
                      <div className="ml-auto flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setRenamingId(device.deviceId);
                            setRenameValue(device.label);
                            setError('');
                          }}
                          aria-label={`Rename ${device.label}`}
                          className="p-1.5 text-surface-400 transition-colors hover:text-surface-200"
                        >
                          <Pencil size={13} />
                        </button>
                        {!device.isCurrent && (
                          <button
                            type="button"
                            onClick={() =>
                              void runAction(device.deviceId, () => revokeDevice(userId, device.deviceId))
                            }
                            disabled={busyDeviceId === device.deviceId}
                            className="nyptid-btn-secondary px-2.5 py-1 text-xs text-red-200 hover:bg-red-500/15"
                          >
                            Revoke
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {revokedDevices.length > 0 && (
                <div>
                  <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-surface-500 uppercase">
                    Revoked
                  </div>
                  <div className="space-y-1">
                    {revokedDevices.map((device) => (
                      <div
                        key={device.deviceId}
                        className="flex flex-wrap items-center gap-3 rounded-lg border border-surface-800 bg-surface-900/20 px-3 py-2 opacity-70"
                      >
                        <Laptop size={15} className="flex-shrink-0 text-surface-600" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm text-surface-400 line-through">
                            {device.label}
                          </div>
                          <div className="text-xs text-surface-600">
                            Revoked {formatRelativeTime(device.revokedAt || '')}
                          </div>
                        </div>
                        <div className="ml-auto flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              void runAction(device.deviceId, () => restoreDevice(userId, device.deviceId))
                            }
                            disabled={busyDeviceId === device.deviceId}
                            className="nyptid-btn-secondary px-2.5 py-1 text-xs"
                          >
                            Restore
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              void runAction(device.deviceId, () => forgetDevice(userId, device.deviceId))
                            }
                            disabled={busyDeviceId === device.deviceId}
                            aria-label={`Remove ${device.label}`}
                            className="p-1.5 text-red-400 transition-colors hover:text-red-300"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {identity?.fingerprint && (
            <p className="mt-4 border-t border-surface-700 pt-3 text-xs text-surface-600">
              This device's key fingerprint is{' '}
              <span className="font-mono text-surface-400">{identity.fingerprint}</span>. Private
              keys are stored in this browser's local storage; a hardened platform keystore is
              still outstanding work.
            </p>
          )}
        </>
      )}
    </div>
  );
}
