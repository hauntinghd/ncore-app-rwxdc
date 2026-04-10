import { useState, useEffect } from 'react';
import { Calendar, Clock, MapPin, Users, Plus, Check, X, ChevronRight } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

interface ScheduledEvent {
  id: string;
  community_id: string;
  channel_id: string | null;
  created_by: string;
  title: string;
  description: string;
  cover_url: string | null;
  start_time: string;
  end_time: string | null;
  recurrence: string | null;
  status: string;
  rsvp_count: number;
  created_at: string;
}

interface EventRsvp {
  event_id: string;
  user_id: string;
  status: string;
}

interface Props {
  communityId: string;
  canManage?: boolean;
  channels?: Array<{ id: string; name: string }>;
}

export default function ScheduledEventsPanel({ communityId, canManage = false, channels = [] }: Props) {
  const { profile } = useAuth();
  const [events, setEvents] = useState<ScheduledEvent[]>([]);
  const [myRsvps, setMyRsvps] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  // Create form
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [channelId, setChannelId] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void loadEvents();
  }, [communityId]);

  async function loadEvents() {
    setLoading(true);
    try {
      const { data } = await supabase
        .from('scheduled_events')
        .select('*')
        .eq('community_id', communityId)
        .in('status', ['scheduled', 'active'])
        .order('start_time', { ascending: true })
        .limit(20);
      setEvents((data || []) as ScheduledEvent[]);

      if (profile) {
        const eventIds = (data || []).map((e: any) => e.id);
        if (eventIds.length) {
          const { data: rsvps } = await supabase
            .from('event_rsvps')
            .select('event_id, status')
            .eq('user_id', profile.id)
            .in('event_id', eventIds);
          const map = new Map<string, string>();
          (rsvps || []).forEach((r: any) => map.set(r.event_id, r.status));
          setMyRsvps(map);
        }
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleRsvp(eventId: string, status: 'going' | 'maybe' | 'not_going') {
    if (!profile) return;
    const current = myRsvps.get(eventId);
    if (current === status) {
      // Remove RSVP
      await supabase.from('event_rsvps').delete()
        .eq('event_id', eventId).eq('user_id', profile.id);
      setMyRsvps((prev) => { const next = new Map(prev); next.delete(eventId); return next; });
    } else {
      await supabase.from('event_rsvps').upsert({
        event_id: eventId,
        user_id: profile.id,
        status,
      });
      setMyRsvps((prev) => new Map(prev).set(eventId, status));
    }
    void loadEvents();
  }

  async function createEvent() {
    if (!profile || !title.trim() || !startTime || submitting) return;
    setSubmitting(true);
    try {
      await supabase.from('scheduled_events').insert({
        community_id: communityId,
        channel_id: channelId || null,
        created_by: profile.id,
        title: title.trim(),
        description: description.trim(),
        start_time: new Date(startTime).toISOString(),
        end_time: endTime ? new Date(endTime).toISOString() : null,
      });
      setTitle('');
      setDescription('');
      setChannelId('');
      setStartTime('');
      setEndTime('');
      setShowCreate(false);
      void loadEvents();
    } finally {
      setSubmitting(false);
    }
  }

  function formatEventTime(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = date.getTime() - now.getTime();
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffDays === 0) return `Today at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    if (diffDays === 1) return `Tomorrow at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    if (diffDays < 7) return date.toLocaleDateString([], { weekday: 'long', hour: '2-digit', minute: '2-digit' });
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function isLive(event: ScheduledEvent): boolean {
    const now = Date.now();
    const start = new Date(event.start_time).getTime();
    const end = event.end_time ? new Date(event.end_time).getTime() : start + 3600000;
    return now >= start && now <= end;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-surface-500 uppercase tracking-wider flex items-center gap-1.5">
          <Calendar size={13} />
          Scheduled Events
        </h3>
        {canManage && (
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="p-1 rounded hover:bg-surface-700/50 text-surface-400 hover:text-surface-200 transition"
          >
            <Plus size={14} />
          </button>
        )}
      </div>

      {showCreate && (
        <div className="bg-surface-800/60 rounded-lg border border-surface-700 p-3 space-y-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Event title"
            className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-1.5 text-surface-100 text-sm placeholder-surface-500 focus:outline-none focus:border-nyptid-500"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-1.5 text-surface-100 text-sm placeholder-surface-500 resize-none focus:outline-none focus:border-nyptid-500"
            rows={2}
          />
          {channels.length > 0 && (
            <select
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
              className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-1.5 text-surface-100 text-sm focus:outline-none focus:border-nyptid-500"
            >
              <option value="">No linked channel</option>
              {channels.map((ch) => <option key={ch.id} value={ch.id}>{ch.name}</option>)}
            </select>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-surface-500 mb-1 block">Start</label>
              <input type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)}
                className="w-full bg-surface-800 border border-surface-700 rounded-lg px-2 py-1.5 text-surface-100 text-xs focus:outline-none focus:border-nyptid-500" />
            </div>
            <div>
              <label className="text-xs text-surface-500 mb-1 block">End (optional)</label>
              <input type="datetime-local" value={endTime} onChange={(e) => setEndTime(e.target.value)}
                className="w-full bg-surface-800 border border-surface-700 rounded-lg px-2 py-1.5 text-surface-100 text-xs focus:outline-none focus:border-nyptid-500" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setShowCreate(false)} className="text-xs text-surface-400 px-2 py-1">Cancel</button>
            <button onClick={() => void createEvent()} disabled={!title.trim() || !startTime || submitting}
              className="px-3 py-1.5 rounded-lg bg-nyptid-600 hover:bg-nyptid-500 disabled:opacity-30 text-white text-xs font-medium transition">
              {submitting ? 'Creating...' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-surface-500 text-xs py-4 text-center">Loading events...</p>
      ) : events.length === 0 ? (
        <p className="text-surface-600 text-xs py-3 text-center">No upcoming events</p>
      ) : (
        events.map((event) => {
          const live = isLive(event);
          const rsvp = myRsvps.get(event.id);
          return (
            <div key={event.id} className={`rounded-lg border p-3 transition ${live ? 'border-green-500/30 bg-green-900/10' : 'border-surface-700 bg-surface-800/40'}`}>
              <div className="flex items-start gap-2">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${live ? 'bg-green-500/20' : 'bg-surface-700/50'}`}>
                  <Calendar size={14} className={live ? 'text-green-400' : 'text-surface-400'} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-surface-100 truncate">{event.title}</span>
                    {live && <span className="px-1.5 py-0.5 rounded bg-green-600 text-white text-[9px] font-bold animate-pulse">LIVE</span>}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Clock size={10} className="text-surface-500" />
                    <span className="text-xs text-surface-400">{formatEventTime(event.start_time)}</span>
                  </div>
                  {event.description && (
                    <p className="text-xs text-surface-500 mt-1 line-clamp-2">{event.description}</p>
                  )}
                  <div className="flex items-center gap-1.5 mt-2">
                    <button
                      onClick={() => handleRsvp(event.id, 'going')}
                      className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition ${
                        rsvp === 'going' ? 'bg-green-600/30 text-green-300 border border-green-600/40' : 'bg-surface-700/50 text-surface-400 hover:text-surface-200 border border-transparent'
                      }`}
                    >
                      <Check size={10} /> Going
                    </button>
                    <button
                      onClick={() => handleRsvp(event.id, 'maybe')}
                      className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition ${
                        rsvp === 'maybe' ? 'bg-yellow-600/30 text-yellow-300 border border-yellow-600/40' : 'bg-surface-700/50 text-surface-400 hover:text-surface-200 border border-transparent'
                      }`}
                    >
                      Maybe
                    </button>
                    <span className="text-[10px] text-surface-600 ml-auto flex items-center gap-1">
                      <Users size={10} />
                      {event.rsvp_count}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
