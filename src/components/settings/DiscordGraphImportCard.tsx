import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle, Link2, RefreshCw, ShieldOff, Upload, Users } from 'lucide-react';
import {
  DiscordImportResult,
  DiscordImportStatus,
  DiscordPackageSummary,
  getDiscordImportStatus,
  importDiscordGraph,
  linkDiscordIdentityById,
  parseDiscordPackage,
  unlinkDiscordImport,
} from '../../lib/discordImport';

type Phase = 'idle' | 'parsing' | 'preview' | 'importing' | 'done';

/**
 * "Reconnect your Discord friends" — parses the user's Discord data package
 * locally and restores the friend/block graph via fingerprint matching.
 * Sits alongside the message-archive importer in Settings → Data Import.
 */
export function DiscordGraphImportCard() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [summary, setSummary] = useState<DiscordPackageSummary | null>(null);
  const [autoFriend, setAutoFriend] = useState(true);
  const [result, setResult] = useState<DiscordImportResult | null>(null);
  const [status, setStatus] = useState<DiscordImportStatus | null>(null);
  const [error, setError] = useState('');
  const [unlinking, setUnlinking] = useState(false);
  const [showIdLink, setShowIdLink] = useState(false);
  const [discordIdInput, setDiscordIdInput] = useState('');
  const [linkingById, setLinkingById] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getDiscordImportStatus()
      .then((value) => {
        if (!cancelled) setStatus(value);
      })
      .catch(() => {
        // Status is a nicety; the import flow itself surfaces real errors.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleFile(file: File) {
    setError('');
    setResult(null);
    setPhase('parsing');
    try {
      const parsed = await parseDiscordPackage(file);
      setSummary(parsed);
      setPhase('preview');
    } catch (err: unknown) {
      setError(String((err as Error)?.message || err));
      setPhase('idle');
    }
  }

  async function handleImport() {
    if (!summary) return;
    setError('');
    setPhase('importing');
    try {
      const outcome = await importDiscordGraph(summary, { autoFriend });
      setResult(outcome);
      setPhase('done');
      setStatus(await getDiscordImportStatus().catch(() => null));
    } catch (err: unknown) {
      setError(String((err as Error)?.message || err));
      setPhase('preview');
    }
  }

  async function handleLinkById() {
    setError('');
    setLinkingById(true);
    try {
      const outcome = await linkDiscordIdentityById(discordIdInput, { autoFriend: true });
      setResult(outcome);
      setPhase('done');
      setShowIdLink(false);
      setDiscordIdInput('');
      setStatus(await getDiscordImportStatus().catch(() => null));
    } catch (err: unknown) {
      setError(String((err as Error)?.message || err));
    } finally {
      setLinkingById(false);
    }
  }

  async function handleUnlink() {
    setError('');
    setUnlinking(true);
    try {
      await unlinkDiscordImport();
      setStatus(await getDiscordImportStatus().catch(() => null));
      setSummary(null);
      setResult(null);
      setPhase('idle');
    } catch (err: unknown) {
      setError(String((err as Error)?.message || err));
    } finally {
      setUnlinking(false);
    }
  }

  const busy = phase === 'parsing' || phase === 'importing';

  return (
    <div className="nyptid-card p-5 space-y-4">
      <div className="rounded-lg border border-surface-700 bg-surface-900 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-surface-200 mb-1">
          <Users size={15} className="text-nyptid-200" />
          Reconnect Your Discord Friends
        </div>
        <p className="text-xs text-surface-500 leading-relaxed">
          Upload your Discord data package and your friendships restore automatically as your
          friends arrive — each one reconnects the moment they import their own package. Blocklists
          carry over too, so the people you blocked there cannot find you fresh here.
        </p>
        <p className="text-xs text-surface-500 leading-relaxed mt-2">
          The package is read on your device. Only anonymous fingerprints of Discord IDs are
          stored — no names, no messages, and no way to look up who your friends are.
        </p>
      </div>

      {status?.linked && phase !== 'done' && (
        <div className="rounded-lg border border-surface-700 bg-surface-900/60 px-3 py-2 text-xs text-surface-300 flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="inline-flex items-center gap-1.5">
            <Link2 size={12} className="text-nyptid-200" />
            Discord identity linked
          </span>
          <span>{status.friendsImported.toLocaleString()} friends imported</span>
          <span>{status.friendshipsRestored.toLocaleString()} friendships restored so far</span>
          {status.requestsCreated > 0 && <span>{status.requestsCreated.toLocaleString()} requests sent</span>}
          {status.blocksApplied > 0 && <span>{status.blocksApplied.toLocaleString()} blocks applied</span>}
        </div>
      )}

      {(phase === 'idle' || phase === 'parsing') && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            className="nyptid-btn-primary text-sm"
          >
            {phase === 'parsing' ? <RefreshCw size={14} className="animate-spin" /> : <Upload size={14} />}
            {phase === 'parsing' ? 'Reading package...' : status?.linked ? 'Re-import Package' : 'Upload Discord Package'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFile(file);
              event.currentTarget.value = '';
            }}
          />
          <span className="text-xs text-surface-500">
            Request it under Discord Settings → Privacy &amp; Safety → Request all of my Data.
          </span>
        </div>
      )}

      {(phase === 'idle' || phase === 'parsing') && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setShowIdLink((value) => !value)}
            className="text-xs text-nyptid-200 hover:text-nyptid-100 transition-colors"
          >
            No package? Link with your Discord User ID instead
          </button>
          {showIdLink && (
            <div className="rounded-lg border border-surface-700 bg-surface-900/60 p-3 space-y-2">
              <p className="text-xs text-surface-500 leading-relaxed">
                Discord only delivers data packages by email, so if you cannot receive that email
                you can still link your identity: friends who import their packages will reconnect
                with you automatically or reach you as normal friend requests. In Discord:
                Settings → Advanced → enable Developer Mode, then right-click your own name and
                Copy User ID.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={discordIdInput}
                  onChange={(event) => setDiscordIdInput(event.target.value)}
                  placeholder="Your Discord User ID (numbers only)"
                  className="nyptid-input text-sm flex-1 min-w-[220px]"
                  inputMode="numeric"
                />
                <button
                  type="button"
                  onClick={() => void handleLinkById()}
                  disabled={linkingById || !discordIdInput.trim()}
                  className="nyptid-btn-primary text-sm"
                >
                  {linkingById ? <RefreshCw size={14} className="animate-spin" /> : <Link2 size={14} />}
                  {linkingById ? 'Linking...' : 'Link Identity'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {phase === 'preview' && summary && (
        <div className="space-y-3">
          <div className="rounded-lg border border-surface-700 bg-surface-900 p-4 space-y-2">
            <div className="text-sm text-surface-200">
              Package for <span className="font-semibold text-nyptid-200">@{summary.username}</span>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full border border-surface-600 bg-surface-900/60 px-2 py-0.5 text-surface-300">
                {summary.friendIds.length.toLocaleString()} friends
              </span>
              <span className="rounded-full border border-surface-600 bg-surface-900/60 px-2 py-0.5 text-surface-300">
                {summary.blockedIds.length.toLocaleString()} blocked
              </span>
              <span className="rounded-full border border-surface-600 bg-surface-900/60 px-2 py-0.5 text-surface-300">
                {summary.guildIds.length.toLocaleString()} servers
              </span>
              {summary.ignoredPendingCount > 0 && (
                <span className="rounded-full border border-surface-600 bg-surface-900/60 px-2 py-0.5 text-surface-500">
                  {summary.ignoredPendingCount.toLocaleString()} pending requests skipped
                </span>
              )}
            </div>
          </div>

          <label className="flex items-start gap-3 text-xs text-surface-300 cursor-pointer">
            <input
              type="checkbox"
              checked={autoFriend}
              onChange={(event) => setAutoFriend(event.target.checked)}
              className="mt-0.5"
            />
            <span>
              Reconnect me automatically. When both people imported and listed each other, the
              friendship restores instantly; when only one side could import, it arrives as a
              normal friend request to accept. Nobody is ever told you are here otherwise.
            </span>
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => void handleImport()} className="nyptid-btn-primary text-sm">
              <Users size={14} />
              Import Social Graph
            </button>
            <button
              type="button"
              onClick={() => {
                setSummary(null);
                setPhase('idle');
              }}
              className="nyptid-btn-secondary text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {phase === 'importing' && (
        <div className="flex items-center gap-2 text-sm text-surface-300">
          <RefreshCw size={14} className="animate-spin text-nyptid-200" />
          Importing your graph and matching...
        </div>
      )}

      {phase === 'done' && result && (
        <div className="rounded-lg border border-green-500/25 bg-green-500/5 p-4 space-y-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-green-300">
            <CheckCircle size={15} />
            Import complete
          </div>
          <p className="text-xs text-surface-300">
            {result.friendshipsRestored > 0
              ? `${result.friendshipsRestored.toLocaleString()} friendship${result.friendshipsRestored === 1 ? '' : 's'} restored right now.`
              : 'No mutual matches yet.'}{' '}
            {result.requestsCreated > 0 &&
              `${result.requestsCreated.toLocaleString()} friend request${result.requestsCreated === 1 ? '' : 's'} sent to people you knew on Discord. `}
            {result.blocksApplied > 0 &&
              `${result.blocksApplied.toLocaleString()} block${result.blocksApplied === 1 ? '' : 's'} carried over. `}
            {result.friendsImported > 0
              ? `The rest reconnect automatically whenever those friends import their own packages — check your Friends tab for incoming requests too.`
              : `You are now findable: friends who import their packages will reconnect with you automatically or show up as incoming requests in your Friends tab.`}
          </p>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {status?.linked && (
        <div className="pt-1 border-t border-surface-700/60">
          <button
            type="button"
            onClick={() => void handleUnlink()}
            disabled={unlinking}
            className="inline-flex items-center gap-1.5 text-xs text-surface-500 hover:text-red-300 transition-colors"
          >
            <ShieldOff size={12} />
            {unlinking ? 'Removing...' : 'Unlink Discord identity and delete imported fingerprints'}
          </button>
        </div>
      )}
    </div>
  );
}
