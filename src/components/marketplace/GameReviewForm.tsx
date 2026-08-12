import { useState } from 'react';
import { ThumbsUp, ThumbsDown, Send } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface Props {
  gameListingId: string;
  userId: string;
  hoursPlayed?: number;
  onSubmitted?: () => void;
}

export default function GameReviewForm({ gameListingId, userId, hoursPlayed = 0, onSubmitted }: Props) {
  const [recommended, setRecommended] = useState<boolean | null>(null);
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  async function submit() {
    if (recommended === null) { setError('Please select recommended or not.'); return; }
    setSubmitting(true);
    setError('');
    try {
      const { error: insertError } = await supabase.from('marketplace_game_reviews').insert({
        game_listing_id: gameListingId,
        user_id: userId,
        recommended,
        content: content.trim(),
        hours_played: hoursPlayed,
      });
      if (insertError) throw insertError;
      setSuccess(true);
      onSubmitted?.();
    } catch (e: any) {
      setError(e?.message || 'Failed to submit review.');
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="nyptid-card p-4 text-center">
        <ThumbsUp size={24} className="text-blue-400 mx-auto mb-2" />
        <p className="text-surface-200 text-sm font-medium">Review posted!</p>
      </div>
    );
  }

  return (
    <div className="nyptid-card p-4 space-y-3">
      <div className="text-xs font-bold text-surface-500 uppercase tracking-wider">Write a Review</div>
      {error && <p className="text-red-400 text-xs">{error}</p>}
      <div className="flex gap-3">
        <button onClick={() => setRecommended(true)}
          className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg border transition font-medium text-sm ${
            recommended === true ? 'border-blue-500 bg-blue-500/10 text-blue-300' : 'border-surface-700 text-surface-400 hover:text-surface-200'
          }`}>
          <ThumbsUp size={18} /> Recommended
        </button>
        <button onClick={() => setRecommended(false)}
          className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg border transition font-medium text-sm ${
            recommended === false ? 'border-red-500 bg-red-500/10 text-red-300' : 'border-surface-700 text-surface-400 hover:text-surface-200'
          }`}>
          <ThumbsDown size={18} /> Not Recommended
        </button>
      </div>
      {hoursPlayed > 0 && (
        <p className="text-xs text-surface-500">{hoursPlayed.toFixed(1)} hours played</p>
      )}
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="What did you think about this game?"
        className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-surface-100 text-sm placeholder-surface-500 resize-none focus:outline-none focus:border-nyptid-500"
        rows={3}
      />
      <button onClick={() => void submit()} disabled={recommended === null || submitting}
        className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-nyptid-600 hover:bg-nyptid-500 disabled:opacity-30 text-white text-sm font-medium transition">
        <Send size={14} />
        {submitting ? 'Posting...' : 'Post Review'}
      </button>
    </div>
  );
}
