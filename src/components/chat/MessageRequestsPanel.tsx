import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Ban, Check, Inbox, Users, X } from 'lucide-react';
import { Avatar } from '../ui/Avatar';
import { Modal } from '../ui/Modal';
import {
  acceptMessageRequest,
  blockMessageRequest,
  fetchMessageRequests,
  ignoreMessageRequest,
  requestSenderName,
  type MessageRequest,
} from '../../lib/messageRequests';
import { formatRelativeTime } from '../../lib/utils';

interface MessageRequestsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after any action so the caller can refresh its badge. */
  onChanged?: () => void;
}

/**
 * Pending DMs from people you have not spoken to.
 *
 * No message preview is shown. DM content is end-to-end encrypted, so the
 * server has ciphertext it cannot read — the same constraint that keeps DM
 * search client-side. What is shown instead is who, when, and how many servers
 * you share, which is what the decision actually turns on.
 */
export function MessageRequestsPanel({ isOpen, onClose, onChanged }: MessageRequestsPanelProps) {
  const navigate = useNavigate();
  const [requests, setRequests] = useState<MessageRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRequests(await fetchMessageRequests());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load requests.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) void load();
  }, [isOpen, load]);

  async function run(
    conversationId: string,
    action: () => Promise<void>,
    afterAccept = false,
  ) {
    setBusyId(conversationId);
    setError('');
    try {
      await action();
      setRequests((current) =>
        current.filter((request) => request.conversationId !== conversationId),
      );
      onChanged?.();
      if (afterAccept) {
        onClose();
        navigate(`/app/dm/${conversationId}`);
      }
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'That action failed.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Message Requests" size="lg">
      <div className="space-y-3">
        <p className="text-sm text-surface-400">
          Messages from people you have not spoken to before wait here. Nobody is told whether you
          opened, ignored, or accepted their request.
        </p>

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className="max-h-[60vh] space-y-2 overflow-y-auto">
          {loading && requests.length === 0 ? (
            <div className="py-8 text-center text-sm text-surface-500">Loading…</div>
          ) : requests.length === 0 ? (
            <div className="py-8 text-center text-sm text-surface-500">
              <Inbox size={22} className="mx-auto mb-2 text-surface-700" />
              No pending message requests.
            </div>
          ) : (
            requests.map((request) => (
              <div
                key={request.conversationId}
                className="rounded-lg border border-surface-700/70 bg-surface-900/40 px-3 py-3"
              >
                <div className="flex items-center gap-2.5">
                  <Avatar
                    src={request.senderAvatarUrl}
                    name={requestSenderName(request)}
                    size="md"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-surface-100">
                      {requestSenderName(request)}
                      <span className="ml-1.5 text-xs font-normal text-surface-500">
                        @{request.senderUsername}
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-surface-500">
                      <span>
                        {request.messageCount} message{request.messageCount === 1 ? '' : 's'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{formatRelativeTime(request.lastMessageAt || request.requestedAt)}</span>
                      {request.mutualCommunities > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="flex items-center gap-1 text-surface-400">
                            <Users size={10} />
                            {request.mutualCommunities} shared server
                            {request.mutualCommunities === 1 ? '' : 's'}
                          </span>
                        </>
                      )}
                      {request.isGroup && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>Group</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-2.5 flex flex-wrap justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      void run(request.conversationId, () =>
                        blockMessageRequest(request.conversationId),
                      )
                    }
                    disabled={busyId === request.conversationId}
                    className="nyptid-btn-secondary flex items-center gap-1 px-2.5 py-1 text-xs text-red-200 hover:bg-red-500/10"
                  >
                    <Ban size={12} /> Block
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void run(request.conversationId, () =>
                        ignoreMessageRequest(request.conversationId),
                      )
                    }
                    disabled={busyId === request.conversationId}
                    className="nyptid-btn-secondary flex items-center gap-1 px-2.5 py-1 text-xs"
                  >
                    <X size={12} /> Ignore
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void run(
                        request.conversationId,
                        () => acceptMessageRequest(request.conversationId),
                        true,
                      )
                    }
                    disabled={busyId === request.conversationId}
                    className="nyptid-btn-primary flex items-center gap-1 px-2.5 py-1 text-xs"
                  >
                    <Check size={12} /> Accept
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <p className="border-t border-surface-700 pt-3 text-xs text-surface-600">
          Message previews are not shown here because direct messages are end-to-end encrypted —
          the server holds ciphertext it cannot read.
        </p>
      </div>
    </Modal>
  );
}
