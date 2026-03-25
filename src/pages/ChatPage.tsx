import { useState, useEffect, useMemo, useRef, type ClipboardEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { useParams } from 'react-router-dom';
import {
  BellOff,
  BellRing,
  Hash,
  MessageSquareQuote,
  Paperclip,
  Pin,
  Reply,
  Send,
  Smile,
  CreditCard as Edit3,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { AppShell } from '../components/layout/AppShell';
import { Avatar } from '../components/ui/Avatar';
import { useAuth } from '../contexts/AuthContext';
import { ensureFreshAuthSession } from '../lib/authSession';
import { useEntitlements } from '../lib/entitlements';
import { extractMentionHandles, hasBroadcastMention, isMentioningTarget } from '../lib/mentions';
import { supabase } from '../lib/supabase';
import type { Message, Channel, MessageAttachment } from '../lib/types';
import { formatFileSize, formatMessageTime, formatShortTime, EMOJI_LIST } from '../lib/utils';

interface MessageGroupProps {
  messages: Message[];
  onReact: (messageId: string, emoji: string) => void;
  onReply: (message: Message) => void;
  onEdit: (message: Message) => void;
  onTogglePin: (message: Message) => void;
  onDelete: (messageId: string) => void;
  onOpenContextMenu: (event: ReactMouseEvent, message: Message) => void;
  currentUserId?: string;
  canModerateMessages?: boolean;
}

interface ChatMember {
  id: string;
  role: 'owner' | 'admin' | 'moderator' | 'member' | string;
  profile: {
    id: string;
    username: string;
    display_name: string | null;
    avatar_url: string | null;
    status?: string | null;
  } | null;
}

interface MessageContextMenuState {
  x: number;
  y: number;
  message: Message;
}

function MessageGroup({
  messages,
  onReact,
  onReply,
  onEdit,
  onTogglePin,
  onDelete,
  onOpenContextMenu,
  currentUserId,
  canModerateMessages = false,
}: MessageGroupProps) {
  const [showEmojiFor, setShowEmojiFor] = useState<string | null>(null);
  const first = messages[0];

  const author = first.author as any;
  const authorName = author?.display_name || author?.username || 'Unknown';
  const authorAvatar = author?.avatar_url;

  return (
    <div className="flex gap-3 px-4 py-1 group hover:bg-surface-800/30 transition-colors">
      <div className="flex-shrink-0 w-10">
        <Avatar src={authorAvatar} name={authorName} size="md" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-0.5">
          <span className="font-semibold text-surface-100 text-sm hover:underline cursor-pointer">{authorName}</span>
          <span className="text-xs text-surface-600">{formatMessageTime(first.created_at)}</span>
        </div>
        {messages.map(msg => (
          <div
            key={msg.id}
            className="relative group/msg"
            onContextMenu={(event) => onOpenContextMenu(event, msg)}
          >
            <div className="text-sm text-surface-300 leading-relaxed break-words">
              {msg.content && (
                <div className="whitespace-pre-wrap break-words">{msg.content}</div>
              )}
              {(msg.attachments || []).length > 0 && (
                <div className={`${msg.content ? 'mt-2' : ''} space-y-2`}>
                  {(msg.attachments || []).map((attachment) => {
                    const isImage = String(attachment.file_type || '').startsWith('image/');
                    return (
                      <a
                        key={attachment.id}
                        href={attachment.file_url}
                        target="_blank"
                        rel="noreferrer"
                        className="block rounded-lg border border-surface-700/80 hover:border-surface-600 overflow-hidden text-xs"
                      >
                        {isImage ? (
                          <img
                            src={attachment.file_url}
                            alt={attachment.file_name}
                            className="max-h-72 w-auto object-contain bg-black/20"
                          />
                        ) : (
                          <div className="flex items-center gap-2 px-2.5 py-2">
                            <Paperclip size={13} className="text-surface-400" />
                            <div className="min-w-0">
                              <div className="truncate font-medium text-surface-200">{attachment.file_name}</div>
                              <div className="text-surface-500">{formatFileSize(Number(attachment.file_size || 0))}</div>
                            </div>
                          </div>
                        )}
                      </a>
                    );
                  })}
                </div>
              )}
              {msg.is_edited && <span className="text-xs text-surface-600 ml-1">(edited)</span>}
            </div>

            {msg.reactions && msg.reactions.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {Object.entries(
                  msg.reactions.reduce((acc, r) => {
                    acc[r.emoji] = (acc[r.emoji] || 0) + 1;
                    return acc;
                  }, {} as Record<string, number>)
                ).map(([emoji, count]) => (
                  <button
                    key={emoji}
                    onClick={() => onReact(msg.id, emoji)}
                    className="flex items-center gap-1 px-2 py-0.5 bg-surface-700 hover:bg-surface-600 rounded-full text-xs transition-colors"
                  >
                    {emoji} <span className="text-surface-300">{count}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="absolute -top-8 right-0 hidden group-hover/msg:flex items-center gap-1 bg-surface-800 border border-surface-700 rounded-lg px-1 py-1 shadow-lg z-10">
              <button
                onClick={() => setShowEmojiFor(showEmojiFor === msg.id ? null : msg.id)}
                className="p-1.5 rounded text-surface-400 hover:text-surface-200 hover:bg-surface-700 transition-colors"
                title="React"
              >
                <Smile size={14} />
              </button>
              <button
                onClick={() => onReply(msg)}
                className="p-1.5 rounded text-surface-400 hover:text-surface-200 hover:bg-surface-700 transition-colors"
                title="Reply"
              >
                <Reply size={14} />
              </button>
              {msg.author_id === currentUserId && (
                <button
                  onClick={() => onEdit(msg)}
                  className="p-1.5 rounded text-surface-400 hover:text-surface-200 hover:bg-surface-700 transition-colors"
                  title="Edit"
                >
                  <Edit3 size={14} />
                </button>
              )}
              {(msg.author_id === currentUserId || canModerateMessages) && (
                <button
                  onClick={() => onTogglePin(msg)}
                  className={`p-1.5 rounded transition-colors ${
                    msg.is_pinned
                      ? 'text-nyptid-300 hover:bg-nyptid-300/10'
                      : 'text-surface-400 hover:text-surface-200 hover:bg-surface-700'
                  }`}
                  title={msg.is_pinned ? 'Unpin message' : 'Pin message'}
                >
                  <Pin size={14} />
                </button>
              )}
              {(msg.author_id === currentUserId || canModerateMessages) && (
                <button
                  onClick={() => onDelete(msg.id)}
                  className="p-1.5 rounded text-red-400 hover:bg-red-500/10 transition-colors"
                  title="Delete"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>

            {showEmojiFor === msg.id && (
              <div className="flex flex-wrap gap-1 mt-2 p-2 bg-surface-800 border border-surface-700 rounded-xl w-fit shadow-xl z-20">
                {EMOJI_LIST.map(emoji => (
                  <button
                    key={emoji}
                    onClick={() => { onReact(msg.id, emoji); setShowEmojiFor(null); }}
                    className="w-8 h-8 flex items-center justify-center hover:bg-surface-700 rounded-lg text-lg transition-colors"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function groupMessages(messages: Message[]): Message[][] {
  const groups: Message[][] = [];
  let current: Message[] = [];

  messages.forEach((msg, i) => {
    const prev = messages[i - 1];
    const timeDiff = prev ? new Date(msg.created_at).getTime() - new Date(prev.created_at).getTime() : Infinity;
    const sameAuthor = prev?.author_id === msg.author_id;
    const withinTime = timeDiff < 5 * 60 * 1000;

    if (sameAuthor && withinTime && current.length > 0) {
      current.push(msg);
    } else {
      if (current.length > 0) groups.push(current);
      current = [msg];
    }
  });
  if (current.length > 0) groups.push(current);
  return groups;
}

function isAuthOrJwtError(error: any): boolean {
  const message = String(error?.message || '').toLowerCase();
  const code = String(error?.code || '').toUpperCase();
  const status = Number(error?.status || error?.statusCode || 0);
  return (
    status === 401
    || status === 403
    || code === 'PGRST301'
    || code === 'PGRST302'
    || message.includes('invalid jwt')
    || message.includes('jwt')
    || message.includes('unauthorized')
    || message.includes('permission denied')
  );
}

async function insertNotificationsWithRetry(rows: any[]) {
  if (!rows || rows.length === 0) return null;
  let { error } = await supabase.from('notifications').insert(rows as any);
  if (error && isAuthOrJwtError(error)) {
    const refreshed = await ensureFreshAuthSession(60, { forceRefresh: true, verifyOnServer: false });
    if (refreshed.ok) {
      const retry = await supabase.from('notifications').insert(rows as any);
      error = retry.error;
    }
  }
  return error || null;
}

export function ChatPage() {
  const { communityId, channelId } = useParams<{ communityId: string; channelId: string }>();
  const { profile } = useAuth();
  const { entitlements } = useEntitlements();
  const maxMessageLength = entitlements.messageLengthCap;
  const maxUploadBytes = entitlements.uploadBytesCap;
  const [channel, setChannel] = useState<Channel | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editingMsg, setEditingMsg] = useState<Message | null>(null);
  const [loading, setLoading] = useState(true);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [composerError, setComposerError] = useState('');
  const [communityRole, setCommunityRole] = useState<'owner' | 'admin' | 'moderator' | 'member'>('member');
  const [members, setMembers] = useState<ChatMember[]>([]);
  const [memberListHidden, setMemberListHidden] = useState(false);
  const [channelNotificationMode, setChannelNotificationMode] = useState<'all' | 'mentions' | 'none'>(() => {
    if (typeof window === 'undefined') return 'all';
    return (window.localStorage.getItem('ncore.chat.channelNotifMode') as 'all' | 'mentions' | 'none') || 'all';
  });
  const [showThreadsModal, setShowThreadsModal] = useState(false);
  const [showNotificationModal, setShowNotificationModal] = useState(false);
  const [showPinnedModal, setShowPinnedModal] = useState(false);
  const [messageContextMenu, setMessageContextMenu] = useState<MessageContextMenuState | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);

  const canModerateMessages = useMemo(() => (
    profile?.platform_role === 'owner'
    || communityRole === 'owner'
    || communityRole === 'admin'
    || communityRole === 'moderator'
  ), [communityRole, profile?.platform_role]);

  const pinnedMessages = useMemo(
    () => messages.filter((message) => Boolean(message.is_pinned)),
    [messages],
  );

  useEffect(() => {
    if (!channelId) return;
    supabase
      .from('channels')
      .select('*')
      .eq('id', channelId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setChannel(data as Channel);
      });
  }, [channelId]);

  useEffect(() => {
    if (!profile?.id || !communityId) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from('community_members')
        .select('role')
        .eq('community_id', communityId)
        .eq('user_id', profile.id)
        .maybeSingle();
      if (cancelled) return;
      const role = String((data as any)?.role || 'member').toLowerCase();
      if (role === 'owner' || role === 'admin' || role === 'moderator' || role === 'member') {
        setCommunityRole(role);
      } else {
        setCommunityRole('member');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [communityId, profile?.id]);

  useEffect(() => {
    if (!communityId) return;
    let cancelled = false;
    void (async () => {
      const { data: memberRows } = await supabase
        .from('community_members')
        .select('id,user_id,role')
        .eq('community_id', communityId)
        .limit(300);
      if (cancelled || !memberRows) return;

      const userIds = Array.from(new Set((memberRows as any[]).map((row) => String(row.user_id || '').trim()).filter(Boolean)));
      let profileRows: any[] = [];
      if (userIds.length > 0) {
        const { data } = await supabase
          .from('profiles')
          .select('id,username,display_name,avatar_url,status')
          .in('id', userIds);
        profileRows = (data || []) as any[];
      }
      if (cancelled) return;
      const profileMap = new Map(profileRows.map((row) => [String(row.id), row]));
      setMembers((memberRows as any[]).map((member) => ({
        id: String(member.id),
        role: String(member.role || 'member'),
        profile: profileMap.get(String(member.user_id)) || null,
      })));
    })();
    return () => {
      cancelled = true;
    };
  }, [communityId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const storageKey = channelId ? `ncore.chat.channelNotifMode.${channelId}` : 'ncore.chat.channelNotifMode';
    const next = window.localStorage.getItem(storageKey) as 'all' | 'mentions' | 'none' | null;
    if (next === 'all' || next === 'mentions' || next === 'none') {
      setChannelNotificationMode(next);
    } else {
      setChannelNotificationMode('all');
    }
  }, [channelId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const storageKey = channelId ? `ncore.chat.channelNotifMode.${channelId}` : 'ncore.chat.channelNotifMode';
    window.localStorage.setItem(storageKey, channelNotificationMode);
  }, [channelId, channelNotificationMode]);

  useEffect(() => {
    if (!messageContextMenu) return undefined;
    const close = () => setMessageContextMenu(null);
    const onEsc = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setMessageContextMenu(null);
    };
    window.addEventListener('click', close);
    window.addEventListener('contextmenu', close);
    window.addEventListener('keydown', onEsc);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('contextmenu', close);
      window.removeEventListener('keydown', onEsc);
    };
  }, [messageContextMenu]);

  useEffect(() => {
    if (!communityId || !channelId) return;
    const storageKey = `ncore.chat.prefill.${communityId}`;
    let pending = '';
    try {
      pending = String(localStorage.getItem(storageKey) || '');
    } catch {
      pending = '';
    }
    if (!pending.trim()) return;

    setInput((prev) => (prev.trim().length > 0 ? prev : pending));
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // Ignore local storage removal failures.
    }
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [communityId, channelId]);

  useEffect(() => {
    if (!channelId) return;
    loadMessages();
  }, [channelId]);

  async function loadMessages() {
    setLoading(true);
    const { data } = await supabase
      .from('messages')
      .select('*, author:profiles(*), reactions:message_reactions(*), attachments:message_attachments(*)')
      .eq('channel_id', channelId!)
      .order('created_at', { ascending: true })
      .limit(100);

    if (data) setMessages(data as Message[]);
    setLoading(false);
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  }

  useEffect(() => {
    if (!channelId) return;
    const channel = supabase
      .channel(`messages:${channelId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `channel_id=eq.${channelId}`,
      }, async (payload) => {
        const { data } = await supabase
          .from('messages')
          .select('*, author:profiles(*), reactions:message_reactions(*), attachments:message_attachments(*)')
          .eq('id', payload.new.id)
          .maybeSingle();
        if (data) {
          setMessages(prev => [...prev, data as Message]);
          setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
        }
      })
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'messages',
        filter: `channel_id=eq.${channelId}`,
      }, (payload) => {
        setMessages(prev => prev.filter(m => m.id !== payload.old.id));
      })
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'message_attachments',
      }, (payload) => {
        const attachment = payload.new as MessageAttachment;
        setMessages((prev) => prev.map((message) => {
          if (message.id !== attachment.message_id) return message;
          const existing = message.attachments || [];
          if (existing.some((item) => item.id === attachment.id)) return message;
          return {
            ...message,
            attachments: [...existing, attachment],
          };
        }));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [channelId]);

  function queueSelectedFiles(fileList: FileList | File[] | null | undefined) {
    if (!fileList) return;
    const nextFiles = Array.isArray(fileList) ? fileList : Array.from(fileList);
    if (nextFiles.length === 0) return;
    const validFiles: File[] = [];
    const tooLargeFiles: string[] = [];

    for (const file of nextFiles) {
      if (file.size > maxUploadBytes) {
        tooLargeFiles.push(file.name);
      } else {
        validFiles.push(file);
      }
    }

    if (tooLargeFiles.length > 0) {
      setComposerError(`These files are over ${formatFileSize(maxUploadBytes)} and were skipped: ${tooLargeFiles.join(', ')}`);
    }

    if (validFiles.length === 0) return;
    setPendingFiles((prev) => {
      const deduped = new Map<string, File>();
      for (const item of [...prev, ...validFiles]) {
        deduped.set(`${item.name}:${item.size}:${item.lastModified}`, item);
      }
      return Array.from(deduped.values());
    });
  }

  function handleComposerPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const clipboardItems = Array.from(event.clipboardData?.items || []);
    if (clipboardItems.length === 0) return;
    const imageFiles = clipboardItems
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));

    if (imageFiles.length === 0) return;
    event.preventDefault();
    queueSelectedFiles(imageFiles);
  }

  function removePendingFile(fileToRemove: File) {
    setPendingFiles((prev) => prev.filter((file) => (
      !(file.name === fileToRemove.name && file.size === fileToRemove.size && file.lastModified === fileToRemove.lastModified)
    )));
  }

  async function uploadMessageAttachments(messageId: string, files: File[]) {
    if (!profile || !channelId || files.length === 0) return;
    setUploadingFiles(true);
    try {
      for (const file of files) {
        const safeName = file.name.replace(/[^\w.\-() ]/g, '_');
        const storagePath = `${profile.id}/channels/${channelId}/${messageId}/${Date.now()}-${safeName}`;
        const { error: uploadError } = await supabase.storage.from('message-uploads').upload(storagePath, file, { upsert: false });
        if (uploadError) {
          setComposerError(`Upload failed for ${file.name}: ${uploadError.message}`);
          continue;
        }
        const { data: publicData } = supabase.storage.from('message-uploads').getPublicUrl(storagePath);
        const { error: attachmentError } = await supabase.from('message_attachments').insert({
          message_id: messageId,
          file_url: publicData.publicUrl,
          file_name: file.name,
          file_type: file.type || 'application/octet-stream',
          file_size: file.size,
        } as any);
        if (attachmentError) {
          setComposerError(`Attachment save failed for ${file.name}: ${attachmentError.message}`);
        }
      }
    } finally {
      setUploadingFiles(false);
    }
  }

  async function handleSend() {
    if (!profile || !channelId || sending) return;
    setComposerError('');

    const content = input.trim().slice(0, maxMessageLength);
    const filesToSend = [...pendingFiles];
    const hasText = content.length > 0;
    const hasFiles = filesToSend.length > 0;

    if (!hasText && !hasFiles) return;

    setInput('');
    setPendingFiles([]);
    setSending(true);

    if (editingMsg) {
      await supabase
        .from('messages')
        .update({ content, is_edited: true })
        .eq('id', editingMsg.id);
      setMessages(prev => prev.map(m => m.id === editingMsg.id ? { ...m, content, is_edited: true } : m));
      setEditingMsg(null);
      setSending(false);
      inputRef.current?.focus();
      return;
    }

    const { data: insertedMessage, error } = await supabase
      .from('messages')
      .insert({
        channel_id: channelId,
        author_id: profile.id,
        content,
        parent_message_id: replyTo?.id || null,
      })
      .select('id')
      .maybeSingle();

    if (error || !insertedMessage?.id) {
      setComposerError(error?.message || 'Failed to send message.');
      setInput(content);
      setPendingFiles(filesToSend);
      setSending(false);
      return;
    }

    if (filesToSend.length > 0) {
      await uploadMessageAttachments(String(insertedMessage.id), filesToSend);
      await loadMessages();
    }
    setReplyTo(null);

    try {
      const targetCommunityId = String((channel as any)?.community_id || communityId || '').trim();
      if (targetCommunityId) {
        const { data: memberRows } = await supabase
          .from('community_members')
          .select('user_id')
          .eq('community_id', targetCommunityId)
          .neq('user_id', profile.id);

        const recipientIds = Array.from(
          new Set((memberRows || []).map((row: any) => String(row.user_id || '')).filter(Boolean)),
        ) as string[];
        const mentionedRecipientIds = new Set<string>();
        const allowBroadcastMention = hasBroadcastMention(content);

        if (allowBroadcastMention) {
          recipientIds.forEach((id) => mentionedRecipientIds.add(id));
        }

        if ((content.includes('@') || content.includes('<@')) && recipientIds.length > 0) {
          const mentionHandles = extractMentionHandles(content);
          if (mentionHandles.size > 0 || content.includes('<@')) {
            const { data: recipientProfiles } = await supabase
              .from('profiles')
              .select('id, username, display_name')
              .in('id', recipientIds);
            for (const row of recipientProfiles || []) {
              const rowId = String((row as any).id || '').trim();
              if (!rowId) continue;
              if (isMentioningTarget(content, row as any, false)) {
                mentionedRecipientIds.add(rowId);
              }
            }
          }
        }

        if (mentionedRecipientIds.size > 0) {
          const senderName = profile.display_name || profile.username || 'Someone';
          const messagePreview = content || (filesToSend.length > 0 ? `Sent ${filesToSend.length} attachment${filesToSend.length > 1 ? 's' : ''}` : 'Sent a message');
          const mentionNotifications = Array.from(mentionedRecipientIds).map((recipientId) => ({
            user_id: recipientId,
            type: 'mention',
            title: `${senderName} mentioned you in #${channel?.name || 'channel'}`,
            body: messagePreview.slice(0, 220),
            data: {
              community_id: targetCommunityId,
              channel_id: channelId,
              message_id: insertedMessage.id,
              author_id: profile.id,
              mention: true,
            },
            is_read: false,
          }));
          const notifyError = await insertNotificationsWithRetry(mentionNotifications as any[]);
          if (notifyError) {
            console.warn('Failed to queue channel mention notifications:', notifyError);
          }
        }
      }
    } catch (notifyError) {
      console.warn('Failed to queue mention notifications:', notifyError);
    }

    try {
      await supabase.rpc('award_xp_for_activity', {
        p_source_type: 'channel_message',
        p_source_id: insertedMessage.id,
        p_points: 4,
      });
    } catch {
      // XP is best-effort.
    }

    setSending(false);
    inputRef.current?.focus();
  }

  async function handleReact(messageId: string, emoji: string) {
    if (!profile) return;
    const existing = messages
      .find(m => m.id === messageId)
      ?.reactions?.find(r => r.user_id === profile.id && r.emoji === emoji);

    if (existing) {
      await supabase.from('message_reactions').delete().eq('id', existing.id);
      setMessages(prev => prev.map(m =>
        m.id === messageId
          ? { ...m, reactions: m.reactions?.filter(r => r.id !== existing.id) }
          : m
      ));
    } else {
      const { data } = await supabase
        .from('message_reactions')
        .insert({ message_id: messageId, user_id: profile.id, emoji })
        .select()
        .single();
      if (data) {
        setMessages(prev => prev.map(m =>
          m.id === messageId
            ? { ...m, reactions: [...(m.reactions || []), data as any] }
            : m
        ));
      }
    }
  }

  async function handleDelete(messageId: string) {
    const { error: deleteError } = await supabase.from('messages').delete().eq('id', messageId);
    if (deleteError) {
      setComposerError(deleteError.message || 'Failed to delete message.');
      return;
    }
    setMessages(prev => prev.filter(m => m.id !== messageId));
  }

  async function handleTogglePin(message: Message) {
    if (!message?.id) return;
    const nextPinned = !Boolean(message.is_pinned);
    const { error: updateError } = await supabase
      .from('messages')
      .update({ is_pinned: nextPinned } as any)
      .eq('id', message.id);
    if (updateError) {
      setComposerError(updateError.message || 'Failed to update pin state.');
      return;
    }
    setMessages((prev) => prev.map((entry) => (
      entry.id === message.id ? { ...entry, is_pinned: nextPinned } : entry
    )));
  }

  function openMessageContextMenu(event: ReactMouseEvent, message: Message) {
    event.preventDefault();
    event.stopPropagation();
    setMessageContextMenu({
      x: event.clientX,
      y: event.clientY,
      message,
    });
  }

  function handleKeyDown(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === 'Escape') {
      setReplyTo(null);
      setEditingMsg(null);
    }
  }

  const messageGroups = groupMessages(messages);
  const topBarActions = (
    <div className="hidden md:flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => setShowThreadsModal(true)}
        className="w-8 h-8 rounded-lg flex items-center justify-center text-surface-400 hover:text-surface-200 hover:bg-surface-700 transition-colors"
        title="Threads"
      >
        <MessageSquareQuote size={15} />
      </button>
      <button
        type="button"
        onClick={() => setShowNotificationModal(true)}
        className="w-8 h-8 rounded-lg flex items-center justify-center text-surface-400 hover:text-surface-200 hover:bg-surface-700 transition-colors"
        title="Notification settings"
      >
        {channelNotificationMode === 'none' ? <BellOff size={15} /> : <BellRing size={15} />}
      </button>
      <button
        type="button"
        onClick={() => setShowPinnedModal(true)}
        className="w-8 h-8 rounded-lg flex items-center justify-center text-surface-400 hover:text-surface-200 hover:bg-surface-700 transition-colors"
        title="Pinned messages"
      >
        <Pin size={15} />
      </button>
      <button
        type="button"
        onClick={() => setMemberListHidden((prev) => !prev)}
        className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
          memberListHidden
            ? 'text-surface-500 hover:text-surface-300 hover:bg-surface-700'
            : 'text-nyptid-300 bg-nyptid-300/10 hover:bg-nyptid-300/20'
        }`}
        title={memberListHidden ? 'Show member list' : 'Hide member list'}
      >
        <Users size={15} />
      </button>
    </div>
  );

  return (
    <AppShell
      activeCommunityId={communityId}
      activeChannelId={channelId}
      title={channel ? `# ${channel.name}` : 'Loading...'}
      subtitle={channel?.description}
      topBarActions={topBarActions}
    >
      <div className="flex h-full">
        <div className="flex min-w-0 flex-1 flex-col">
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-nyptid-300 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto py-4 scrollbar-thin space-y-1">
            {messageGroups.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center px-6">
                <div className="w-16 h-16 bg-surface-800 rounded-2xl flex items-center justify-center mb-4">
                  <Hash size={28} className="text-surface-400" />
                </div>
                <h3 className="text-lg font-bold text-surface-200 mb-1">
                  Welcome to #{channel?.name || 'channel'}!
                </h3>
                <p className="text-surface-500 text-sm">
                  This is the beginning of the channel. Send a message to get started.
                </p>
              </div>
            )}

            {messageGroups.map((group) => (
              <MessageGroup
                key={group[0].id}
                messages={group}
                onReact={handleReact}
                onReply={msg => { setReplyTo(msg); setEditingMsg(null); inputRef.current?.focus(); }}
                onEdit={msg => { setEditingMsg(msg); setInput(msg.content); setReplyTo(null); inputRef.current?.focus(); }}
                onTogglePin={handleTogglePin}
                onDelete={handleDelete}
                onOpenContextMenu={openMessageContextMenu}
                currentUserId={profile?.id}
                canModerateMessages={canModerateMessages}
              />
            ))}

            {typingUsers.length > 0 && (
              <div className="px-4 py-1 text-xs text-surface-500 italic">
                {typingUsers.join(', ')} {typingUsers.length === 1 ? 'is' : 'are'} typing...
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}

        <div className="px-4 pb-4 flex-shrink-0">
          {(replyTo || editingMsg) && (
            <div className="flex items-center gap-2 px-3 py-2 bg-surface-800 rounded-t-lg border border-b-0 border-surface-700 text-xs">
              <Reply size={12} className="text-nyptid-300" />
              <span className="text-surface-400">
                {editingMsg ? 'Editing message' : `Replying to ${(replyTo?.author as any)?.display_name || 'message'}`}
              </span>
              <button
                onClick={() => { setReplyTo(null); setEditingMsg(null); setInput(''); }}
                className="ml-auto text-surface-500 hover:text-surface-300"
              >
                <X size={12} />
              </button>
            </div>
          )}
          {composerError && (
            <div className="mb-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {composerError}
            </div>
          )}
          {pendingFiles.length > 0 && (
            <div className="mb-2 rounded-lg border border-surface-700 bg-surface-900 px-2.5 py-2">
              <div className="mb-1 text-[11px] uppercase tracking-wide text-surface-500">
                Attachments ({pendingFiles.length}) {uploadingFiles ? ' - uploading...' : ''}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {pendingFiles.map((file) => (
                  <button
                    key={`${file.name}:${file.size}:${file.lastModified}`}
                    type="button"
                    onClick={() => removePendingFile(file)}
                    className="inline-flex items-center gap-1 rounded-full border border-surface-600 bg-surface-800 px-2 py-1 text-xs text-surface-200 hover:bg-surface-700"
                  >
                    <Paperclip size={11} />
                    <span className="max-w-[180px] truncate">{file.name}</span>
                    <span className="text-surface-500">{formatFileSize(file.size)}</span>
                    <X size={11} />
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className={`flex items-end gap-2 bg-surface-800 border border-surface-700 px-3 py-2 ${replyTo || editingMsg ? 'rounded-b-xl' : 'rounded-xl'}`}>
            <button
              type="button"
              onClick={() => attachmentInputRef.current?.click()}
              className="p-1.5 text-surface-500 hover:text-surface-300 transition-colors flex-shrink-0"
              title="Attach files"
            >
              <Paperclip size={18} />
            </button>
            <input
              ref={attachmentInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                queueSelectedFiles(event.target.files);
                event.target.value = '';
              }}
            />
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value.slice(0, maxMessageLength))}
              onPaste={handleComposerPaste}
              onKeyDown={handleKeyDown}
              placeholder={`Message #${channel?.name || 'channel'}`}
              className="flex-1 bg-transparent text-sm text-surface-100 placeholder-surface-600 resize-none outline-none max-h-32 min-h-[20px]"
              rows={1}
              maxLength={maxMessageLength}
              style={{ height: 'auto' }}
              onInput={e => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = 'auto';
                target.style.height = Math.min(target.scrollHeight, 128) + 'px';
              }}
            />
            <div className="flex items-center gap-1 flex-shrink-0">
              <button className="p-1.5 text-surface-500 hover:text-surface-300 transition-colors">
                <Smile size={18} />
              </button>
              <button
                onClick={handleSend}
                disabled={(!input.trim() && pendingFiles.length === 0) || sending || uploadingFiles}
                className={`p-1.5 rounded-lg transition-colors ${
                  input.trim() || pendingFiles.length > 0
                    ? 'text-nyptid-300 hover:bg-nyptid-300/10'
                    : 'text-surface-600 cursor-not-allowed'
                }`}
              >
                <Send size={18} />
              </button>
            </div>
          </div>
          <div className="mt-1 px-1 text-[11px] text-surface-500">
            Up to 10GB per file. Message limit: 20,000 characters.
          </div>
        </div>

        </div>

        {!memberListHidden && (
          <aside className="hidden lg:flex w-64 border-l border-surface-800 bg-surface-900/70 flex-col">
            <div className="px-3 py-2 border-b border-surface-800 text-xs font-bold uppercase tracking-wider text-surface-500">
              Members ({members.length})
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {members.map((member) => (
                <div key={member.id} className="rounded-lg border border-surface-700/70 bg-surface-900/60 px-2 py-1.5 flex items-center gap-2">
                  <Avatar
                    src={member.profile?.avatar_url || null}
                    name={member.profile?.display_name || member.profile?.username || 'User'}
                    size="sm"
                    status={member.profile?.status as any}
                  />
                  <div className="min-w-0">
                    <div className="text-xs text-surface-200 truncate">
                      {member.profile?.display_name || member.profile?.username || 'User'}
                    </div>
                    <div className="text-[10px] text-surface-500 uppercase">{member.role}</div>
                  </div>
                </div>
              ))}
              {members.length === 0 && (
                <div className="text-xs text-surface-500 px-1 py-2">No member list data available yet.</div>
              )}
            </div>
          </aside>
        )}

        {messageContextMenu && (
          <div className="fixed inset-0 z-[90] pointer-events-none">
            <div
              className="pointer-events-auto fixed w-56 rounded-xl border border-surface-700 bg-surface-900/95 py-2 shadow-2xl"
              style={{
                left: Math.max(8, Math.min(messageContextMenu.x, window.innerWidth - 224 - 8)),
                top: Math.max(8, Math.min(messageContextMenu.y, window.innerHeight - 220 - 8)),
              }}
              onClick={(event) => event.stopPropagation()}
              onContextMenu={(event) => event.preventDefault()}
            >
              <button
                type="button"
                onClick={() => {
                  setReplyTo(messageContextMenu.message);
                  setEditingMsg(null);
                  setMessageContextMenu(null);
                  inputRef.current?.focus();
                }}
                className="w-full px-3 py-2 text-left text-sm text-surface-200 hover:bg-surface-800 transition-colors flex items-center gap-2"
              >
                <Reply size={13} />
                Reply
              </button>
              {(String(messageContextMenu.message.author_id || '') === String(profile?.id || '') || canModerateMessages) && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      void handleTogglePin(messageContextMenu.message);
                      setMessageContextMenu(null);
                    }}
                    className="w-full px-3 py-2 text-left text-sm text-surface-200 hover:bg-surface-800 transition-colors flex items-center gap-2"
                  >
                    <Pin size={13} />
                    {messageContextMenu.message.is_pinned ? 'Unpin Message' : 'Pin Message'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void handleDelete(messageContextMenu.message.id);
                      setMessageContextMenu(null);
                    }}
                    className="w-full px-3 py-2 text-left text-sm text-red-300 hover:bg-red-500/10 transition-colors flex items-center gap-2"
                  >
                    <Trash2 size={13} />
                    Delete Message
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {showThreadsModal && (
          <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/70" onClick={() => setShowThreadsModal(false)} />
            <div className="relative w-full max-w-lg rounded-2xl border border-surface-700 bg-surface-800 p-5 animate-slide-up">
              <div className="text-lg font-semibold text-surface-100">Threads</div>
              <p className="text-sm text-surface-400 mt-2">
                Thread channels are being rolled out. This channel will support full thread creation and management in an upcoming patch.
              </p>
              <div className="mt-4 flex justify-end">
                <button type="button" className="nyptid-btn-secondary text-sm" onClick={() => setShowThreadsModal(false)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {showNotificationModal && (
          <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/70" onClick={() => setShowNotificationModal(false)} />
            <div className="relative w-full max-w-lg rounded-2xl border border-surface-700 bg-surface-800 p-5 animate-slide-up">
              <div className="text-lg font-semibold text-surface-100">Notification Settings</div>
              <p className="text-sm text-surface-400 mt-2">Choose how notifications work for this channel.</p>
              <div className="mt-4 space-y-2">
                {[
                  { id: 'all' as const, label: 'All Messages', desc: 'Receive notifications for all channel activity.' },
                  { id: 'mentions' as const, label: 'Only @mentions', desc: 'Only notify when you are directly mentioned.' },
                  { id: 'none' as const, label: 'Nothing', desc: 'Mute this channel.' },
                ].map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setChannelNotificationMode(option.id)}
                    className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                      channelNotificationMode === option.id
                        ? 'border-nyptid-300/40 bg-nyptid-300/10'
                        : 'border-surface-700 bg-surface-900/60 hover:border-surface-600'
                    }`}
                  >
                    <div className="text-sm font-semibold text-surface-100">{option.label}</div>
                    <div className="text-xs text-surface-500 mt-0.5">{option.desc}</div>
                  </button>
                ))}
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" className="nyptid-btn-secondary text-sm" onClick={() => setShowNotificationModal(false)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {showPinnedModal && (
          <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/70" onClick={() => setShowPinnedModal(false)} />
            <div className="relative w-full max-w-2xl rounded-2xl border border-surface-700 bg-surface-800 p-5 animate-slide-up">
              <div className="text-lg font-semibold text-surface-100">Pinned Messages</div>
              <div className="mt-3 max-h-[60vh] overflow-y-auto space-y-2">
                {pinnedMessages.map((message) => (
                  <div key={message.id} className="rounded-lg border border-surface-700 bg-surface-900/60 px-3 py-2">
                    <div className="text-xs text-surface-500">{formatShortTime(message.created_at)}</div>
                    <div className="text-sm text-surface-200 mt-1 whitespace-pre-wrap">{message.content || '(attachment only)'}</div>
                  </div>
                ))}
                {pinnedMessages.length === 0 && (
                  <div className="text-sm text-surface-500">No pinned messages in this channel yet.</div>
                )}
              </div>
              <div className="mt-4 flex justify-end">
                <button type="button" className="nyptid-btn-secondary text-sm" onClick={() => setShowPinnedModal(false)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
