import { useState } from 'react';
import { Star, Send } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface Props {
  orderId: string;
  sellerId: string;
  reviewerId: string;
  onSubmitted?: () => void;
}

function StarRating({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-surface-400 w-28">{label}</span>
      <div className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map((star) => (
          <button key={star} onClick={() => onChange(star)} className="p-0.5 transition">
            <Star size={16} className={star <= value ? 'text-yellow-400 fill-yellow-400' : 'text-surface-600'} />
          </button>
        ))}
      </div>
    </div>
  );
}

export default function ServiceReviewForm({ orderId, sellerId, reviewerId, onSubmitted }: Props) {
  const [overall, setOverall] = useState(0);
  const [quality, setQuality] = useState(0);
  const [communication, setCommunication] = useState(0);
  const [responseTime, setResponseTime] = useState(0);
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  async function submit() {
    if (overall === 0) { setError('Please provide an overall rating.'); return; }
    setSubmitting(true);
    setError('');
    try {
      const { error: insertError } = await supabase.from('marketplace_service_reviews').insert({
        order_id: orderId,
        reviewer_id: reviewerId,
        seller_id: sellerId,
        overall_rating: overall,
        quality_rating: quality || null,
        communication_rating: communication || null,
        response_time_rating: responseTime || null,
        content: content.trim(),
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
        <Star size={24} className="text-yellow-400 fill-yellow-400 mx-auto mb-2" />
        <p className="text-surface-200 text-sm font-medium">Review submitted!</p>
        <p className="text-surface-500 text-xs mt-1">Your feedback helps the community.</p>
      </div>
    );
  }

  return (
    <div className="nyptid-card p-4 space-y-3">
      <div className="text-xs font-bold text-surface-500 uppercase tracking-wider">Leave a Review</div>
      {error && <p className="text-red-400 text-xs">{error}</p>}
      <StarRating value={overall} onChange={setOverall} label="Overall" />
      <StarRating value={quality} onChange={setQuality} label="Quality" />
      <StarRating value={communication} onChange={setCommunication} label="Communication" />
      <StarRating value={responseTime} onChange={setResponseTime} label="Response Time" />
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Share your experience (optional)"
        className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-surface-100 text-sm placeholder-surface-500 resize-none focus:outline-none focus:border-nyptid-500"
        rows={3}
      />
      <button onClick={() => void submit()} disabled={overall === 0 || submitting}
        className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-nyptid-600 hover:bg-nyptid-500 disabled:opacity-30 text-white text-sm font-medium transition">
        <Send size={14} />
        {submitting ? 'Submitting...' : 'Submit Review'}
      </button>
    </div>
  );
}
