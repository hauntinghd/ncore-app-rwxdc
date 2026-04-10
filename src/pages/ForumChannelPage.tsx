import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { MessageSquare, Plus, ArrowUp, ArrowDown, Clock, Flame, Tag, ChevronLeft, Send, Pin } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { Profile, Channel } from '../lib/types';
import AppShell from '../components/layout/AppShell';
import Avatar from '../components/ui/Avatar';

type SortMode = 'latest' | 'hot' | 'oldest';

interface ForumPost {
  id: string;
  channel_id: string;
  user_id: string;
  content: string;
  created_at: string;
  updated_at: string;
  profile?: Profile;
  reply_count: number;
  last_reply_at: string | null;
  tags: string[];
  is_pinned: boolean;
}

interface ForumReply {
  id: string;
  parent_message_id: string;
  user_id: string;
  content: string;
  created_at: string;
  profile?: Profile;
}

interface ForumTag {
  id: string;
  channel_id: string;
  name: string;
  color: string;
}

export default function ForumChannelPage() {
  const { communityId, channelId } = useParams<{ communityId: string; channelId: string }>();
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [channel, setChannel] = useState<Channel | null>(null);
  const [posts, setPosts] = useState<ForumPost[]>([]);
  const [tags, setTags] = useState<ForumTag[]>([]);
  const [sortMode, setSortMode] = useState<SortMode>('latest');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // New post state
  const [showNewPost, setShowNewPost] = useState(false);
  const [newPostTitle, setNewPostTitle] = useState('');
  const [newPostContent, setNewPostContent] = useState('');
  const [newPostTags, setNewPostTags] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Thread view state
  const [activePost, setActivePost] = useState<ForumPost | null>(null);
  const [replies, setReplies] = useState<ForumReply[]>([]);
  const [replyText, setReplyText] = useState('');
  const [loadingReplies, setLoadingReplies] = useState(false);

  const replyInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!channelId) return;
    void loadChannel();
    void loadPosts();
    void loadTags();
  }, [channelId]);

  async function loadChannel() {
    const { data } = await supabase
      .from('channels')
      .select('*')
      .eq('id', channelId)
      .maybeSingle();
    if (data) setChannel(data as Channel);
  }

  async function loadTags() {
    const { data } = await supabase
      .from('forum_tags')
      .select('*')
      .eq('channel_id', channelId)
      .order('sort_order');
    if (data) setTags(data as ForumTag[]);
  }

  async function loadPosts() {
    setLoading(true);
    try {
      // Posts are messages in this channel with no parent_message_id (top-level)
      let query = supabase
        .from('messages')
        .select('*, profile:profiles(*)')
        .eq('channel_id', channelId)
        .is('parent_message_id', null);

      if (sortMode === 'latest') {
        query = query.order('created_at', { ascending: false });
      } else if (sortMode === 'oldest') {
        query = query.order('created_at', { ascending: true });
      }

      const { data } = await query.limit(50);
      if (!data) { setPosts([]); return; }

      // Hydrate with reply counts
      const postIds = data.map((p: any) => p.id);
      const { data: replyCounts } = await supabase
        .from('messages')
        .select('parent_message_id')
        .in('parent_message_id', postIds);

      const replyMap = new Map<string, number>();
      (replyCounts || []).forEach((r: any) => {
        const current = replyMap.get(r.parent_message_id) || 0;
        replyMap.set(r.parent_message_id, current + 1);
      });

      // Load post tags
      const { data: postTags } = await supabase
        .from('forum_post_tags')
        .select('message_id, tag:forum_tags(*)')
        .in('message_id', postIds);

      const tagMap = new Map<string, string[]>();
      (postTags || []).forEach((pt: any) => {
        const existing = tagMap.get(pt.message_id) || [];
        if (pt.tag?.name) existing.push(pt.tag.name);
        tagMap.set(pt.message_id, existing);
      });

      const hydrated: ForumPost[] = data.map((msg: any) => ({
        id: msg.id,
        channel_id: msg.channel_id,
        user_id: msg.user_id,
        content: msg.content,
        created_at: msg.created_at,
        updated_at: msg.updated_at || msg.created_at,
        profile: msg.profile,
        reply_count: replyMap.get(msg.id) || 0,
        last_reply_at: null,
        tags: tagMap.get(msg.id) || [],
        is_pinned: false,
      }));

      // Sort "hot" by reply count
      if (sortMode === 'hot') {
        hydrated.sort((a, b) => b.reply_count - a.reply_count);
      }

      setPosts(hydrated);
    } finally {
      setLoading(false);
    }
  }

  async function createPost() {
    if (!newPostTitle.trim() || !channelId || !profile || submitting) return;
    setSubmitting(true);
    try {
      const content = `**${newPostTitle.trim()}**\n\n${newPostContent.trim()}`;
      const { data, error } = await supabase
        .from('messages')
        .insert({
          channel_id: channelId,
          user_id: profile.id,
          content,
        })
        .select()
        .single();

      if (error) throw error;

      // Add tags
      if (data && newPostTags.length > 0) {
        const tagRecords = tags
          .filter((t) => newPostTags.includes(t.name))
          .map((t) => ({ message_id: data.id, tag_id: t.id }));
        if (tagRecords.length) {
          await supabase.from('forum_post_tags').insert(tagRecords);
        }
      }

      setNewPostTitle('');
      setNewPostContent('');
      setNewPostTags([]);
      setShowNewPost(false);
      void loadPosts();
    } finally {
      setSubmitting(false);
    }
  }

  async function openThread(post: ForumPost) {
    setActivePost(post);
    setLoadingReplies(true);
    try {
      const { data } = await supabase
        .from('messages')
        .select('*, profile:profiles(*)')
        .eq('parent_message_id', post.id)
        .order('created_at', { ascending: true })
        .limit(100);
      setReplies((data || []).map((r: any) => ({
        id: r.id,
        parent_message_id: r.parent_message_id,
        user_id: r.user_id,
        content: r.content,
        created_at: r.created_at,
        profile: r.profile,
      })));
    } finally {
      setLoadingReplies(false);
    }
    setTimeout(() => replyInputRef.current?.focus(), 100);
  }

  async function submitReply() {
    if (!replyText.trim() || !activePost || !profile) return;
    const { error } = await supabase
      .from('messages')
      .insert({
        channel_id: channelId,
        user_id: profile.id,
        content: replyText.trim(),
        parent_message_id: activePost.id,
      });
    if (!error) {
      setReplyText('');
      void openThread(activePost);
      void loadPosts();
    }
  }

  function formatTimeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString();
  }

  function extractTitle(content: string): string {
    const boldMatch = content.match(/^\*\*(.+?)\*\*/);
    if (boldMatch) return boldMatch[1];
    const firstLine = content.split('\n')[0].trim();
    return firstLine.length > 80 ? `${firstLine.slice(0, 80)}...` : firstLine;
  }

  function extractBody(content: string): string {
    const withoutTitle = content.replace(/^\*\*.+?\*\*\s*\n*/, '').trim();
    return withoutTitle.length > 200 ? `${withoutTitle.slice(0, 200)}...` : withoutTitle;
  }

  const filteredPosts = selectedTag
    ? posts.filter((p) => p.tags.includes(selectedTag))
    : posts;

  // ---------- Thread View ----------
  if (activePost) {
    return (
      <AppShell>
        <div className="flex flex-col h-full bg-surface-900">
          {/* Thread header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-surface-700/50">
            <button
              onClick={() => setActivePost(null)}
              className="p-1.5 rounded-md hover:bg-surface-700/50 text-surface-400 hover:text-surface-100 transition"
            >
              <ChevronLeft size={20} />
            </button>
            <div className="flex-1 min-w-0">
              <h2 className="text-surface-100 font-semibold truncate">{extractTitle(activePost.content)}</h2>
              <p className="text-surface-500 text-xs">
                {activePost.profile?.display_name || activePost.profile?.username || 'Unknown'} · {formatTimeAgo(activePost.created_at)}
              </p>
            </div>
          </div>

          {/* Original post */}
          <div className="px-4 py-4 border-b border-surface-700/30">
            <div className="flex items-start gap-3">
              <Avatar url={activePost.profile?.avatar_url} username={activePost.profile?.username || '?'} size="md" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-surface-100 font-medium text-sm">{activePost.profile?.display_name || activePost.profile?.username}</span>
                  <span className="text-surface-600 text-xs">{formatTimeAgo(activePost.created_at)}</span>
                </div>
                <div className="text-surface-300 text-sm whitespace-pre-wrap break-words">{activePost.content.replace(/^\*\*.+?\*\*\s*\n*/, '')}</div>
                {activePost.tags.length > 0 && (
                  <div className="flex gap-1.5 mt-2">
                    {activePost.tags.map((tag) => (
                      <span key={tag} className="px-2 py-0.5 rounded-full bg-nyptid-900/40 text-nyptid-300 text-xs">{tag}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Replies */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {loadingReplies ? (
              <div className="text-center text-surface-500 text-sm py-8">Loading replies...</div>
            ) : replies.length === 0 ? (
              <div className="text-center text-surface-500 text-sm py-8">No replies yet. Start the conversation!</div>
            ) : (
              replies.map((reply) => (
                <div key={reply.id} className="flex items-start gap-3">
                  <Avatar url={reply.profile?.avatar_url} username={reply.profile?.username || '?'} size="sm" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-surface-200 font-medium text-sm">{reply.profile?.display_name || reply.profile?.username}</span>
                      <span className="text-surface-600 text-xs">{formatTimeAgo(reply.created_at)}</span>
                    </div>
                    <p className="text-surface-300 text-sm whitespace-pre-wrap break-words">{reply.content}</p>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Reply input */}
          <div className="px-4 py-3 border-t border-surface-700/50">
            <div className="flex items-end gap-2">
              <textarea
                ref={replyInputRef}
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submitReply(); } }}
                placeholder="Reply to this thread..."
                className="flex-1 bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-surface-100 text-sm placeholder-surface-500 resize-none focus:outline-none focus:border-nyptid-500 min-h-[40px] max-h-[120px]"
                rows={1}
              />
              <button
                onClick={() => void submitReply()}
                disabled={!replyText.trim()}
                className="p-2 rounded-lg bg-nyptid-600 hover:bg-nyptid-500 disabled:opacity-30 disabled:cursor-not-allowed text-white transition"
              >
                <Send size={18} />
              </button>
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  // ---------- Forum List View ----------
  return (
    <AppShell>
      <div className="flex flex-col h-full bg-surface-900">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-surface-700/50">
          <div className="flex items-center gap-2">
            <MessageSquare size={20} className="text-surface-400" />
            <h1 className="text-surface-100 font-semibold">{channel?.name || 'Forum'}</h1>
            {channel?.description && (
              <span className="text-surface-500 text-sm ml-2 hidden sm:inline">{channel.description}</span>
            )}
          </div>
          <button
            onClick={() => setShowNewPost(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-nyptid-600 hover:bg-nyptid-500 text-white text-sm font-medium transition"
          >
            <Plus size={16} />
            New Post
          </button>
        </div>

        {/* Sort & Filter bar */}
        <div className="flex items-center gap-3 px-4 py-2 border-b border-surface-700/30">
          <div className="flex items-center gap-1 bg-surface-800 rounded-lg p-0.5">
            {([
              { mode: 'latest' as SortMode, icon: Clock, label: 'Latest' },
              { mode: 'hot' as SortMode, icon: Flame, label: 'Hot' },
              { mode: 'oldest' as SortMode, icon: ArrowUp, label: 'Oldest' },
            ]).map(({ mode, icon: Icon, label }) => (
              <button
                key={mode}
                onClick={() => { setSortMode(mode); void loadPosts(); }}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition ${
                  sortMode === mode ? 'bg-surface-700 text-surface-100' : 'text-surface-400 hover:text-surface-200'
                }`}
              >
                <Icon size={13} />
                {label}
              </button>
            ))}
          </div>
          {tags.length > 0 && (
            <div className="flex items-center gap-1.5 ml-2">
              <Tag size={13} className="text-surface-500" />
              <button
                onClick={() => setSelectedTag(null)}
                className={`px-2 py-0.5 rounded-full text-xs transition ${!selectedTag ? 'bg-nyptid-900/50 text-nyptid-300' : 'text-surface-400 hover:text-surface-200'}`}
              >
                All
              </button>
              {tags.map((tag) => (
                <button
                  key={tag.id}
                  onClick={() => setSelectedTag(selectedTag === tag.name ? null : tag.name)}
                  className={`px-2 py-0.5 rounded-full text-xs transition ${selectedTag === tag.name ? 'bg-nyptid-900/50 text-nyptid-300' : 'text-surface-400 hover:text-surface-200'}`}
                >
                  {tag.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* New post form */}
        {showNewPost && (
          <div className="px-4 py-4 border-b border-surface-700/30 bg-surface-800/50">
            <input
              value={newPostTitle}
              onChange={(e) => setNewPostTitle(e.target.value)}
              placeholder="Post title"
              className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-surface-100 text-sm placeholder-surface-500 focus:outline-none focus:border-nyptid-500 mb-2"
            />
            <textarea
              value={newPostContent}
              onChange={(e) => setNewPostContent(e.target.value)}
              placeholder="Write your post content..."
              className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-surface-100 text-sm placeholder-surface-500 resize-none focus:outline-none focus:border-nyptid-500 min-h-[80px] mb-2"
              rows={3}
            />
            {tags.length > 0 && (
              <div className="flex items-center gap-1.5 mb-3">
                <Tag size={13} className="text-surface-500" />
                {tags.map((tag) => (
                  <button
                    key={tag.id}
                    onClick={() => setNewPostTags((prev) => prev.includes(tag.name) ? prev.filter((t) => t !== tag.name) : [...prev, tag.name])}
                    className={`px-2 py-0.5 rounded-full text-xs transition ${newPostTags.includes(tag.name) ? 'bg-nyptid-600 text-white' : 'bg-surface-700 text-surface-400 hover:text-surface-200'}`}
                  >
                    {tag.name}
                  </button>
                ))}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowNewPost(false); setNewPostTitle(''); setNewPostContent(''); }}
                className="px-3 py-1.5 rounded-lg text-surface-400 hover:text-surface-200 text-sm transition"
              >
                Cancel
              </button>
              <button
                onClick={() => void createPost()}
                disabled={!newPostTitle.trim() || submitting}
                className="px-4 py-1.5 rounded-lg bg-nyptid-600 hover:bg-nyptid-500 disabled:opacity-30 text-white text-sm font-medium transition"
              >
                {submitting ? 'Posting...' : 'Post'}
              </button>
            </div>
          </div>
        )}

        {/* Post list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="text-center text-surface-500 text-sm py-12">Loading posts...</div>
          ) : filteredPosts.length === 0 ? (
            <div className="text-center py-12">
              <MessageSquare size={40} className="text-surface-700 mx-auto mb-3" />
              <p className="text-surface-400 text-sm">No posts yet. Be the first to start a discussion!</p>
            </div>
          ) : (
            <div className="divide-y divide-surface-700/30">
              {filteredPosts.map((post) => (
                <button
                  key={post.id}
                  onClick={() => void openThread(post)}
                  className="w-full px-4 py-3 hover:bg-surface-800/50 transition text-left"
                >
                  <div className="flex items-start gap-3">
                    <Avatar url={post.profile?.avatar_url} username={post.profile?.username || '?'} size="sm" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        {post.is_pinned && <Pin size={12} className="text-nyptid-400" />}
                        <h3 className="text-surface-100 font-medium text-sm truncate">{extractTitle(post.content)}</h3>
                      </div>
                      <p className="text-surface-500 text-xs line-clamp-2 mb-1.5">{extractBody(post.content)}</p>
                      <div className="flex items-center gap-3 text-xs text-surface-600">
                        <span>{post.profile?.display_name || post.profile?.username}</span>
                        <span>{formatTimeAgo(post.created_at)}</span>
                        <span className="flex items-center gap-1">
                          <MessageSquare size={11} />
                          {post.reply_count} {post.reply_count === 1 ? 'reply' : 'replies'}
                        </span>
                      </div>
                      {post.tags.length > 0 && (
                        <div className="flex gap-1 mt-1.5">
                          {post.tags.map((tag) => (
                            <span key={tag} className="px-1.5 py-0.5 rounded bg-surface-800 text-surface-400 text-[10px]">{tag}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="text-surface-600 text-xs whitespace-nowrap flex items-center gap-1">
                      <ArrowDown size={12} />
                      {post.reply_count}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
