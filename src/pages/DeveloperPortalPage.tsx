import { useState, useEffect } from 'react';
import { Bot, Plus, Key, Webhook, Trash2, Copy, Check, RefreshCw, Eye, EyeOff, Globe, AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { AppShell } from '../components/layout/AppShell';
import { Avatar } from '../components/ui/Avatar';

interface BotUser {
  id: string;
  owner_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  description: string;
  is_active: boolean;
  created_at: string;
}

interface WebhookEntry {
  id: string;
  community_id: string;
  name: string;
  url: string;
  events: string[];
  is_active: boolean;
  failure_count: number;
  last_triggered_at: string | null;
  last_failure_at: string | null;
  created_at: string;
}

type Tab = 'bots' | 'webhooks';

const WEBHOOK_EVENTS = [
  'message.create', 'message.update', 'message.delete',
  'member.join', 'member.leave',
  'voice.join', 'voice.leave',
];

export default function DeveloperPortalPage() {
  const { profile } = useAuth();
  const [tab, setTab] = useState<Tab>('bots');
  const [loading, setLoading] = useState(true);

  // Bots
  const [bots, setBots] = useState<BotUser[]>([]);
  const [showCreateBot, setShowCreateBot] = useState(false);
  const [newBotUsername, setNewBotUsername] = useState('');
  const [newBotDescription, setNewBotDescription] = useState('');
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState(false);
  const [showToken, setShowToken] = useState(false);

  // Webhooks
  const [webhooks, setWebhooks] = useState<WebhookEntry[]>([]);
  const [showCreateWebhook, setShowCreateWebhook] = useState(false);
  const [webhookName, setWebhookName] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookCommunityId, setWebhookCommunityId] = useState('');
  const [webhookEvents, setWebhookEvents] = useState<string[]>([]);
  const [communities, setCommunities] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    if (!profile) return;
    void loadData();
    void loadCommunities();
  }, [profile, tab]);

  async function loadData() {
    setLoading(true);
    try {
      if (tab === 'bots') await loadBots();
      else await loadWebhooks();
    } finally {
      setLoading(false);
    }
  }

  async function loadBots() {
    if (!profile) return;
    const { data } = await supabase
      .from('bot_users')
      .select('*')
      .eq('owner_id', profile.id)
      .order('created_at', { ascending: false });
    setBots((data || []) as BotUser[]);
  }

  async function loadWebhooks() {
    if (!profile) return;
    const { data } = await supabase
      .from('community_webhooks')
      .select('*')
      .eq('created_by', profile.id)
      .order('created_at', { ascending: false });
    setWebhooks((data || []) as WebhookEntry[]);
  }

  async function loadCommunities() {
    if (!profile) return;
    const { data } = await supabase
      .from('community_members')
      .select('community_id, community:communities(id, name)')
      .eq('user_id', profile.id)
      .in('role', ['owner', 'admin']);
    const list = (data || [])
      .map((d: any) => d.community)
      .filter(Boolean)
      .map((c: any) => ({ id: c.id, name: c.name }));
    setCommunities(list);
  }

  async function createBot() {
    if (!profile || !newBotUsername.trim()) return;
    // Generate a random token
    const tokenBytes = new Uint8Array(32);
    crypto.getRandomValues(tokenBytes);
    const token = Array.from(tokenBytes).map((b) => b.toString(16).padStart(2, '0')).join('');

    // Hash for storage
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(token));
    const tokenHash = Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');

    const { error } = await supabase.from('bot_users').insert({
      owner_id: profile.id,
      username: newBotUsername.trim().toLowerCase().replace(/[^a-z0-9_-]/g, ''),
      display_name: newBotUsername.trim(),
      description: newBotDescription.trim(),
      token_hash: tokenHash,
    });

    if (error) {
      console.error('Failed to create bot:', error);
      return;
    }

    setGeneratedToken(token);
    setNewBotUsername('');
    setNewBotDescription('');
    void loadBots();
  }

  async function deleteBot(botId: string) {
    await supabase.from('bot_users').delete().eq('id', botId);
    void loadBots();
  }

  async function toggleBotActive(botId: string, isActive: boolean) {
    await supabase.from('bot_users').update({ is_active: !isActive }).eq('id', botId);
    void loadBots();
  }

  async function createWebhook() {
    if (!profile || !webhookUrl.trim() || !webhookCommunityId || webhookEvents.length === 0) return;

    // Generate signing secret
    const secretBytes = new Uint8Array(32);
    crypto.getRandomValues(secretBytes);
    const secret = Array.from(secretBytes).map((b) => b.toString(16).padStart(2, '0')).join('');

    const { error } = await supabase.from('community_webhooks').insert({
      community_id: webhookCommunityId,
      created_by: profile.id,
      name: webhookName.trim() || 'Webhook',
      url: webhookUrl.trim(),
      secret_hash: secret,
      events: webhookEvents,
    });

    if (error) {
      console.error('Failed to create webhook:', error);
      return;
    }

    setShowCreateWebhook(false);
    setWebhookName('');
    setWebhookUrl('');
    setWebhookEvents([]);
    void loadWebhooks();
  }

  async function deleteWebhook(webhookId: string) {
    await supabase.from('community_webhooks').delete().eq('id', webhookId);
    void loadWebhooks();
  }

  function copyToken(token: string) {
    navigator.clipboard.writeText(token);
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 2000);
  }

  return (
    <AppShell>
      <div className="flex flex-col h-full bg-surface-900">
        {/* Header */}
        <div className="px-4 py-3 border-b border-surface-700/50">
          <div className="flex items-center gap-2 mb-1">
            <Bot size={22} className="text-nyptid-400" />
            <h1 className="text-surface-100 font-bold text-lg">Developer Portal</h1>
          </div>
          <p className="text-surface-500 text-sm">Create bots and webhooks for your NCore communities.</p>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 px-4 py-2 border-b border-surface-700/30">
          <button
            onClick={() => setTab('bots')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition ${tab === 'bots' ? 'bg-surface-700 text-surface-100' : 'text-surface-400 hover:text-surface-200'}`}
          >
            <Bot size={15} />
            Bots
            {bots.length > 0 && <span className="ml-1 px-1.5 py-0.5 rounded-full bg-surface-600 text-surface-300 text-[10px]">{bots.length}</span>}
          </button>
          <button
            onClick={() => setTab('webhooks')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition ${tab === 'webhooks' ? 'bg-surface-700 text-surface-100' : 'text-surface-400 hover:text-surface-200'}`}
          >
            <Webhook size={15} />
            Webhooks
            {webhooks.length > 0 && <span className="ml-1 px-1.5 py-0.5 rounded-full bg-surface-600 text-surface-300 text-[10px]">{webhooks.length}</span>}
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* ---------- BOTS TAB ---------- */}
          {tab === 'bots' && (
            <div className="space-y-4 max-w-2xl">
              {/* Generated token alert */}
              {generatedToken && (
                <div className="nyptid-card p-4 border border-yellow-600/30 bg-yellow-900/10">
                  <div className="flex items-start gap-2 mb-2">
                    <AlertTriangle size={16} className="text-yellow-400 mt-0.5" />
                    <div>
                      <p className="text-yellow-300 font-medium text-sm">Bot token generated - copy it now!</p>
                      <p className="text-surface-400 text-xs mt-1">This token will not be shown again. Store it securely.</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-3">
                    <code className="flex-1 bg-surface-800 rounded px-3 py-2 text-xs text-surface-200 font-mono overflow-hidden">
                      {showToken ? generatedToken : `${'*'.repeat(32)}...`}
                    </code>
                    <button onClick={() => setShowToken(!showToken)} className="p-2 rounded-lg hover:bg-surface-700 text-surface-400">
                      {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                    <button onClick={() => copyToken(generatedToken)} className="p-2 rounded-lg hover:bg-surface-700 text-surface-400">
                      {copiedToken ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                    </button>
                  </div>
                  <button onClick={() => setGeneratedToken(null)} className="text-xs text-surface-500 hover:text-surface-300 mt-2">
                    Dismiss
                  </button>
                </div>
              )}

              <button
                onClick={() => setShowCreateBot(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-nyptid-600 hover:bg-nyptid-500 text-white text-sm font-medium transition"
              >
                <Plus size={16} />
                Create Bot
              </button>

              {showCreateBot && (
                <div className="nyptid-card p-4 space-y-3">
                  <input
                    value={newBotUsername}
                    onChange={(e) => setNewBotUsername(e.target.value)}
                    placeholder="Bot username (lowercase, no spaces)"
                    className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-surface-100 text-sm placeholder-surface-500 focus:outline-none focus:border-nyptid-500"
                  />
                  <textarea
                    value={newBotDescription}
                    onChange={(e) => setNewBotDescription(e.target.value)}
                    placeholder="What does this bot do?"
                    className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-surface-100 text-sm placeholder-surface-500 resize-none focus:outline-none focus:border-nyptid-500"
                    rows={2}
                  />
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setShowCreateBot(false)} className="px-3 py-1.5 rounded-lg text-surface-400 text-sm">Cancel</button>
                    <button
                      onClick={() => void createBot()}
                      disabled={!newBotUsername.trim()}
                      className="px-4 py-1.5 rounded-lg bg-nyptid-600 hover:bg-nyptid-500 disabled:opacity-30 text-white text-sm font-medium transition"
                    >
                      Create
                    </button>
                  </div>
                </div>
              )}

              {loading ? (
                <p className="text-surface-500 text-sm py-8 text-center">Loading bots...</p>
              ) : bots.length === 0 && !showCreateBot ? (
                <div className="text-center py-12">
                  <Bot size={48} className="text-surface-700 mx-auto mb-3" />
                  <p className="text-surface-400 text-sm">No bots created yet.</p>
                </div>
              ) : (
                bots.map((bot) => (
                  <div key={bot.id} className="nyptid-card p-4 flex items-center gap-3">
                    <Avatar src={bot.avatar_url} name={bot.username} size="md" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-surface-100 font-medium text-sm">{bot.display_name || bot.username}</span>
                        <span className="px-1.5 py-0.5 rounded bg-nyptid-900/40 text-nyptid-300 text-[10px] font-bold">BOT</span>
                        {!bot.is_active && <span className="px-1.5 py-0.5 rounded bg-red-900/30 text-red-400 text-[10px]">DISABLED</span>}
                      </div>
                      <p className="text-surface-500 text-xs mt-0.5">{bot.description || 'No description'}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => void toggleBotActive(bot.id, bot.is_active)}
                        className={`p-2 rounded-lg transition ${bot.is_active ? 'text-green-400 hover:bg-green-900/20' : 'text-surface-500 hover:bg-surface-700'}`}
                        title={bot.is_active ? 'Disable bot' : 'Enable bot'}
                      >
                        <Key size={14} />
                      </button>
                      <button
                        onClick={() => void deleteBot(bot.id)}
                        className="p-2 rounded-lg text-surface-500 hover:text-red-400 hover:bg-red-900/20 transition"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* ---------- WEBHOOKS TAB ---------- */}
          {tab === 'webhooks' && (
            <div className="space-y-4 max-w-2xl">
              <button
                onClick={() => setShowCreateWebhook(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-nyptid-600 hover:bg-nyptid-500 text-white text-sm font-medium transition"
              >
                <Plus size={16} />
                Create Webhook
              </button>

              {showCreateWebhook && (
                <div className="nyptid-card p-4 space-y-3">
                  <input
                    value={webhookName}
                    onChange={(e) => setWebhookName(e.target.value)}
                    placeholder="Webhook name"
                    className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-surface-100 text-sm placeholder-surface-500 focus:outline-none focus:border-nyptid-500"
                  />
                  <input
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    placeholder="https://your-server.com/webhook"
                    className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-surface-100 text-sm placeholder-surface-500 focus:outline-none focus:border-nyptid-500"
                  />
                  <select
                    value={webhookCommunityId}
                    onChange={(e) => setWebhookCommunityId(e.target.value)}
                    className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-surface-100 text-sm focus:outline-none focus:border-nyptid-500"
                  >
                    <option value="">Select community</option>
                    {communities.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <div>
                    <p className="text-surface-400 text-xs mb-2">Events to subscribe:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {WEBHOOK_EVENTS.map((event) => (
                        <button
                          key={event}
                          onClick={() => setWebhookEvents((prev) => prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event])}
                          className={`px-2 py-1 rounded text-xs transition ${webhookEvents.includes(event) ? 'bg-nyptid-600 text-white' : 'bg-surface-700 text-surface-400 hover:text-surface-200'}`}
                        >
                          {event}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setShowCreateWebhook(false)} className="px-3 py-1.5 rounded-lg text-surface-400 text-sm">Cancel</button>
                    <button
                      onClick={() => void createWebhook()}
                      disabled={!webhookUrl.trim() || !webhookCommunityId || webhookEvents.length === 0}
                      className="px-4 py-1.5 rounded-lg bg-nyptid-600 hover:bg-nyptid-500 disabled:opacity-30 text-white text-sm font-medium transition"
                    >
                      Create
                    </button>
                  </div>
                </div>
              )}

              {loading ? (
                <p className="text-surface-500 text-sm py-8 text-center">Loading webhooks...</p>
              ) : webhooks.length === 0 && !showCreateWebhook ? (
                <div className="text-center py-12">
                  <Webhook size={48} className="text-surface-700 mx-auto mb-3" />
                  <p className="text-surface-400 text-sm">No webhooks configured yet.</p>
                </div>
              ) : (
                webhooks.map((wh) => (
                  <div key={wh.id} className="nyptid-card p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-surface-100 font-medium text-sm">{wh.name}</span>
                          {!wh.is_active && <span className="px-1.5 py-0.5 rounded bg-red-900/30 text-red-400 text-[10px]">DISABLED</span>}
                          {wh.failure_count > 5 && <span className="px-1.5 py-0.5 rounded bg-yellow-900/30 text-yellow-400 text-[10px]">{wh.failure_count} failures</span>}
                        </div>
                        <div className="flex items-center gap-1 mt-1">
                          <Globe size={11} className="text-surface-500" />
                          <span className="text-surface-500 text-xs font-mono truncate max-w-xs">{wh.url}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => void deleteWebhook(wh.id)}
                        className="p-1.5 rounded-lg text-surface-500 hover:text-red-400 hover:bg-red-900/20 transition"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {wh.events.map((event) => (
                        <span key={event} className="px-1.5 py-0.5 rounded bg-surface-700 text-surface-400 text-[10px]">{event}</span>
                      ))}
                    </div>
                    {wh.last_triggered_at && (
                      <p className="text-surface-600 text-xs mt-2">Last triggered: {new Date(wh.last_triggered_at).toLocaleString()}</p>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
