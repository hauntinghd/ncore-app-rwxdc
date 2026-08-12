import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Pencil, Smile, Trash2, Upload, X } from 'lucide-react';
import {
  EMOJI_NAME_PATTERN,
  MAX_EMOJI_BYTES,
  createCommunityEmoji,
  deleteCommunityEmoji,
  fetchCommunityEmojis,
  renameCommunityEmoji,
  type CustomEmoji,
} from '../../lib/customEmoji';
import { useCustomEmojis } from '../../contexts/CustomEmojiContext';

interface CustomEmojiSectionProps {
  communityId: string;
  canManage: boolean;
}

const EMOJI_LIMIT = 100;

function deriveNameFromFile(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 32);
}

export function CustomEmojiSection({ communityId, canManage }: CustomEmojiSectionProps) {
  const { refresh: refreshGlobalEmojis } = useCustomEmojis();
  const [emojis, setEmojis] = useState<CustomEmoji[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingName, setPendingName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!communityId) return;
    setLoading(true);
    try {
      setEmojis(await fetchCommunityEmojis(communityId));
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load emoji.');
    } finally {
      setLoading(false);
    }
  }, [communityId]);

  useEffect(() => {
    void load();
  }, [load]);

  function handleFilePick(file: File | null) {
    setError('');
    setMessage('');
    if (!file) {
      setPendingFile(null);
      setPendingName('');
      return;
    }
    if (file.size > MAX_EMOJI_BYTES) {
      setError(`"${file.name}" is ${Math.round(file.size / 1024)} KB. Emoji must be under ${Math.floor(MAX_EMOJI_BYTES / 1024)} KB.`);
      return;
    }
    setPendingFile(file);
    setPendingName(deriveNameFromFile(file.name));
  }

  async function handleUpload() {
    if (!pendingFile || busy) return;
    if (!EMOJI_NAME_PATTERN.test(pendingName)) {
      setError('Emoji names must be 2-32 characters of letters, numbers, or underscores.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      await createCommunityEmoji(communityId, pendingName, pendingFile);
      setPendingFile(null);
      setPendingName('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      setMessage(`Added :${pendingName}:`);
      await load();
      await refreshGlobalEmojis();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRename(emojiId: string) {
    if (!EMOJI_NAME_PATTERN.test(renameValue)) {
      setError('Emoji names must be 2-32 characters of letters, numbers, or underscores.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await renameCommunityEmoji(emojiId, renameValue);
      setRenamingId(null);
      await load();
      await refreshGlobalEmojis();
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : 'Rename failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(emoji: CustomEmoji) {
    setBusy(true);
    setError('');
    try {
      await deleteCommunityEmoji(emoji.id);
      setMessage(`Removed :${emoji.name}:`);
      await load();
      await refreshGlobalEmojis();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Delete failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="nyptid-card p-5">
      <div className="mb-3 flex items-center gap-2">
        <Smile size={16} className="text-nyptid-300" />
        <h2 className="text-lg font-bold text-surface-100">Custom Emoji</h2>
        <span className="ml-auto text-xs text-surface-500">
          {emojis.length} / {EMOJI_LIMIT}
        </span>
      </div>

      <p className="mb-4 text-sm text-surface-400">
        Members type <code className="rounded bg-surface-700/80 px-1 text-xs">:name:</code> to use these
        anywhere in the app. Existing messages keep working after a rename.
      </p>

      {error && (
        <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}
      {message && !error && (
        <div className="mb-3 rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-200">
          {message}
        </div>
      )}

      {canManage && (
        <div className="mb-4 rounded-xl border border-surface-700 bg-surface-900/50 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              onChange={(event) => handleFilePick(event.target.files?.[0] ?? null)}
              className="hidden"
              id="emoji-upload-input"
            />
            <label
              htmlFor="emoji-upload-input"
              className="nyptid-btn-secondary inline-flex cursor-pointer items-center gap-1.5 px-3 py-1.5 text-xs"
            >
              <Upload size={13} />
              Choose image
            </label>

            {pendingFile && (
              <>
                <img
                  src={URL.createObjectURL(pendingFile)}
                  alt=""
                  className="h-8 w-8 rounded object-contain"
                />
                <span className="text-surface-500">:</span>
                <input
                  type="text"
                  value={pendingName}
                  onChange={(event) => setPendingName(event.target.value)}
                  placeholder="name"
                  aria-label="Emoji name"
                  className="w-32 rounded-lg border border-surface-700 bg-surface-950 px-2 py-1.5 text-xs text-surface-200 focus:border-nyptid-300 focus:outline-none"
                />
                <span className="text-surface-500">:</span>
                <button
                  type="button"
                  onClick={() => void handleUpload()}
                  disabled={busy || emojis.length >= EMOJI_LIMIT}
                  className="nyptid-btn-primary px-3 py-1.5 text-xs"
                >
                  {busy ? 'Uploading…' : 'Add'}
                </button>
                <button
                  type="button"
                  onClick={() => handleFilePick(null)}
                  aria-label="Cancel upload"
                  className="p-1.5 text-surface-400 hover:text-surface-200"
                >
                  <X size={14} />
                </button>
              </>
            )}
          </div>
          <p className="mt-2 text-xs text-surface-600">
            PNG, JPEG, GIF, or WebP, under {Math.floor(MAX_EMOJI_BYTES / 1024)} KB. Square images
            around 128×128 look best.
          </p>
        </div>
      )}

      {loading ? (
        <div className="py-6 text-center text-sm text-surface-500">Loading emoji…</div>
      ) : emojis.length === 0 ? (
        <div className="py-6 text-center text-sm text-surface-500">
          No custom emoji yet.{canManage ? ' Upload one above.' : ''}
        </div>
      ) : (
        <div className="space-y-1">
          {emojis.map((emoji) => (
            <div
              key={emoji.id}
              className="flex items-center gap-3 rounded-lg border border-surface-700/70 bg-surface-900/40 px-3 py-2"
            >
              <img src={emoji.imageUrl} alt={`:${emoji.name}:`} className="h-7 w-7 object-contain" />

              {renamingId === emoji.id ? (
                <>
                  <input
                    type="text"
                    value={renameValue}
                    onChange={(event) => setRenameValue(event.target.value)}
                    aria-label="New emoji name"
                    className="w-40 rounded-lg border border-surface-700 bg-surface-950 px-2 py-1 text-xs text-surface-200 focus:border-nyptid-300 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => void handleRename(emoji.id)}
                    disabled={busy}
                    aria-label="Save name"
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
                <span className="flex-1 font-mono text-sm text-surface-300">:{emoji.name}:</span>
              )}

              {canManage && renamingId !== emoji.id && (
                <div className="ml-auto flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setRenamingId(emoji.id);
                      setRenameValue(emoji.name);
                      setError('');
                    }}
                    aria-label={`Rename :${emoji.name}:`}
                    className="p-1.5 text-surface-400 transition-colors hover:text-surface-200"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(emoji)}
                    disabled={busy}
                    aria-label={`Delete :${emoji.name}:`}
                    className="p-1.5 text-red-400 transition-colors hover:text-red-300"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
