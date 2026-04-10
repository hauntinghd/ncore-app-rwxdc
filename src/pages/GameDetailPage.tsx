import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, Heart, Download, Star, ThumbsUp, ThumbsDown, Monitor, Cpu, HardDrive, Tag, Calendar, User, ExternalLink } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { MarketplaceGameListing } from '../lib/types';
import { AppShell } from '../components/layout/AppShell';
import { Avatar } from '../components/ui/Avatar';
import GameReviewForm from '../components/marketplace/GameReviewForm';

interface GameReview {
  id: string;
  game_listing_id: string;
  user_id: string;
  recommended: boolean;
  content: string;
  hours_played: number;
  created_at: string;
  profile?: { username: string; display_name: string | null; avatar_url: string | null };
}

export default function GameDetailPage() {
  const { gameSlug } = useParams<{ gameSlug: string }>();
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [game, setGame] = useState<MarketplaceGameListing | null>(null);
  const [reviews, setReviews] = useState<GameReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeScreenshot, setActiveScreenshot] = useState(0);
  const [wishlisted, setWishlisted] = useState(false);
  const [owned, setOwned] = useState(false);

  useEffect(() => {
    if (!gameSlug) return;
    void loadGame();
  }, [gameSlug]);

  async function loadGame() {
    setLoading(true);
    try {
      const { data } = await supabase
        .from('marketplace_game_listings')
        .select('*, seller_profile:profiles(id, username, display_name, avatar_url)')
        .eq('slug', gameSlug)
        .maybeSingle();
      if (!data) { setLoading(false); return; }
      setGame(data as any);

      // Load reviews
      const { data: reviewData } = await supabase
        .from('marketplace_game_reviews')
        .select('*, profile:profiles(username, display_name, avatar_url)')
        .eq('game_listing_id', data.id)
        .order('created_at', { ascending: false })
        .limit(50);
      setReviews((reviewData || []) as GameReview[]);

      // Check ownership + wishlist
      if (profile) {
        const { data: order } = await supabase
          .from('marketplace_game_orders')
          .select('id')
          .eq('game_listing_id', data.id)
          .eq('buyer_id', profile.id)
          .in('status', ['paid', 'fulfilled'])
          .maybeSingle();
        setOwned(Boolean(order));

        const { data: wl } = await supabase
          .from('game_wishlists')
          .select('user_id')
          .eq('game_listing_id', data.id)
          .eq('user_id', profile.id)
          .maybeSingle();
        setWishlisted(Boolean(wl));
      }
    } finally {
      setLoading(false);
    }
  }

  async function toggleWishlist() {
    if (!profile || !game) return;
    if (wishlisted) {
      await supabase.from('game_wishlists').delete().eq('user_id', profile.id).eq('game_listing_id', game.id);
    } else {
      await supabase.from('game_wishlists').insert({ user_id: profile.id, game_listing_id: game.id });
    }
    setWishlisted(!wishlisted);
  }

  function formatPrice(cents: number, discountPct: number = 0) {
    if (cents === 0) return { original: 'Free', final: 'Free', hasDiscount: false };
    const original = `$${(cents / 100).toFixed(2)}`;
    if (discountPct > 0) {
      const discounted = Math.round(cents * (1 - discountPct / 100));
      return { original, final: `$${(discounted / 100).toFixed(2)}`, hasDiscount: true };
    }
    return { original, final: original, hasDiscount: false };
  }

  const positiveCount = reviews.filter((r) => r.recommended).length;
  const negativeCount = reviews.filter((r) => !r.recommended).length;
  const totalReviews = reviews.length;
  const positivePct = totalReviews > 0 ? Math.round((positiveCount / totalReviews) * 100) : 0;

  function getReviewSentiment(): { text: string; color: string } {
    if (totalReviews < 3) return { text: 'No reviews yet', color: 'text-surface-500' };
    if (positivePct >= 90) return { text: 'Overwhelmingly Positive', color: 'text-blue-400' };
    if (positivePct >= 80) return { text: 'Very Positive', color: 'text-blue-400' };
    if (positivePct >= 70) return { text: 'Mostly Positive', color: 'text-blue-300' };
    if (positivePct >= 50) return { text: 'Mixed', color: 'text-yellow-400' };
    if (positivePct >= 30) return { text: 'Mostly Negative', color: 'text-orange-400' };
    return { text: 'Negative', color: 'text-red-400' };
  }

  if (loading) {
    return <AppShell><div className="flex items-center justify-center h-full"><div className="w-8 h-8 border-2 border-nyptid-300 border-t-transparent rounded-full animate-spin" /></div></AppShell>;
  }

  if (!game) {
    return <AppShell><div className="flex flex-col items-center justify-center h-full text-surface-400"><p>Game not found.</p><button onClick={() => navigate(-1)} className="mt-3 nyptid-btn-secondary text-sm">Go back</button></div></AppShell>;
  }

  const price = formatPrice(game.price_cents, game.discount_percent || 0);
  const screenshots = game.screenshots || [];
  const sysReqs = game.system_requirements || {};
  const tags = game.tags || [];
  const sentiment = getReviewSentiment();
  const seller = game.seller_profile;

  return (
    <AppShell>
      <div className="h-full overflow-y-auto bg-surface-900">
        {/* Hero */}
        <div className="relative h-64 md:h-80 bg-surface-800 overflow-hidden">
          {game.cover_url && <img src={game.cover_url} alt="" className="w-full h-full object-cover opacity-60" />}
          <div className="absolute inset-0 bg-gradient-to-t from-surface-900 via-surface-900/60 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-6">
            <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-surface-400 hover:text-surface-200 text-sm mb-3 transition">
              <ChevronLeft size={16} /> Back to store
            </button>
            <h1 className="text-3xl md:text-4xl font-black text-white">{game.title}</h1>
            {game.short_description && <p className="text-surface-300 mt-2 max-w-2xl">{game.short_description}</p>}
            {tags.length > 0 && (
              <div className="flex gap-1.5 mt-3">
                {tags.map((tag) => (
                  <span key={tag} className="px-2 py-0.5 rounded-full bg-white/10 text-white/70 text-xs">{tag}</span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="max-w-6xl mx-auto px-4 py-6">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
            {/* Left column */}
            <div className="space-y-6">
              {/* Screenshots */}
              {screenshots.length > 0 && (
                <div>
                  <div className="rounded-xl overflow-hidden border border-surface-700 bg-black aspect-video mb-2">
                    <img src={screenshots[activeScreenshot]} alt="Screenshot" className="w-full h-full object-contain" />
                  </div>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {screenshots.map((url, i) => (
                      <button key={i} onClick={() => setActiveScreenshot(i)}
                        className={`flex-shrink-0 w-24 h-14 rounded-lg overflow-hidden border-2 transition ${i === activeScreenshot ? 'border-nyptid-400' : 'border-surface-700 opacity-60 hover:opacity-100'}`}>
                        <img src={url} alt="" className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Description */}
              <div className="nyptid-card p-5">
                <h2 className="text-lg font-bold text-surface-100 mb-3">About This Game</h2>
                <div className="text-sm text-surface-300 whitespace-pre-wrap leading-relaxed">{game.description}</div>
              </div>

              {/* System Requirements */}
              {Object.keys(sysReqs).length > 0 && (
                <div className="nyptid-card p-5">
                  <h2 className="text-lg font-bold text-surface-100 mb-3">System Requirements</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {['minimum', 'recommended'].map((tier) => sysReqs[tier] && (
                      <div key={tier}>
                        <h3 className="text-sm font-bold text-surface-300 uppercase mb-2">{tier}</h3>
                        <div className="space-y-1.5 text-xs text-surface-400">
                          {sysReqs[tier].os && <div className="flex gap-2"><Monitor size={12} className="mt-0.5 flex-shrink-0" /> <span><b className="text-surface-300">OS:</b> {sysReqs[tier].os}</span></div>}
                          {sysReqs[tier].processor && <div className="flex gap-2"><Cpu size={12} className="mt-0.5 flex-shrink-0" /> <span><b className="text-surface-300">CPU:</b> {sysReqs[tier].processor}</span></div>}
                          {sysReqs[tier].memory && <div><b className="text-surface-300">RAM:</b> {sysReqs[tier].memory}</div>}
                          {sysReqs[tier].graphics && <div><b className="text-surface-300">GPU:</b> {sysReqs[tier].graphics}</div>}
                          {sysReqs[tier].storage && <div className="flex gap-2"><HardDrive size={12} className="mt-0.5 flex-shrink-0" /> <span><b className="text-surface-300">Storage:</b> {sysReqs[tier].storage}</span></div>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Reviews */}
              <div className="nyptid-card p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-bold text-surface-100">User Reviews</h2>
                  <span className={`text-sm font-semibold ${sentiment.color}`}>{sentiment.text}</span>
                </div>
                {totalReviews > 0 && (
                  <div className="flex items-center gap-3 mb-4 p-3 rounded-lg bg-surface-800">
                    <ThumbsUp size={16} className="text-blue-400" />
                    <div className="flex-1 h-2 bg-surface-700 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-400 rounded-full" style={{ width: `${positivePct}%` }} />
                    </div>
                    <ThumbsDown size={16} className="text-red-400" />
                    <span className="text-xs text-surface-400">{positivePct}% of {totalReviews} reviews</span>
                  </div>
                )}
                {profile && !owned && <p className="text-xs text-surface-500 mb-3">Purchase this game to leave a review.</p>}
                {profile && owned && (
                  <div className="mb-4">
                    <GameReviewForm gameListingId={game.id} userId={profile.id} onSubmitted={() => void loadGame()} />
                  </div>
                )}
                <div className="space-y-3">
                  {reviews.map((review) => (
                    <div key={review.id} className="p-3 rounded-lg bg-surface-800/60 border border-surface-700/50">
                      <div className="flex items-center gap-2 mb-2">
                        <Avatar src={review.profile?.avatar_url} name={review.profile?.display_name || review.profile?.username || '?'} size="sm" />
                        <div>
                          <span className="text-sm text-surface-200 font-medium">{review.profile?.display_name || review.profile?.username}</span>
                          <span className="text-xs text-surface-500 ml-2">{review.hours_played}h played</span>
                        </div>
                        <span className={`ml-auto text-xs font-bold ${review.recommended ? 'text-blue-400' : 'text-red-400'}`}>
                          {review.recommended ? 'Recommended' : 'Not Recommended'}
                        </span>
                      </div>
                      {review.content && <p className="text-sm text-surface-300">{review.content}</p>}
                    </div>
                  ))}
                  {reviews.length === 0 && <p className="text-sm text-surface-500 text-center py-4">No reviews yet.</p>}
                </div>
              </div>
            </div>

            {/* Right column — Purchase card */}
            <div className="space-y-4">
              <div className="nyptid-card p-5 sticky top-4">
                {game.cover_url && <img src={game.cover_url} alt="" className="w-full aspect-video rounded-lg object-cover mb-4" />}
                <div className="flex items-center gap-3 mb-4">
                  {price.hasDiscount && (
                    <span className="px-2 py-1 rounded bg-green-600 text-white text-sm font-bold">-{game.discount_percent}%</span>
                  )}
                  {price.hasDiscount && <span className="text-surface-500 line-through text-sm">{price.original}</span>}
                  <span className={`text-2xl font-black ${price.final === 'Free' ? 'text-green-400' : 'text-surface-100'}`}>{price.final}</span>
                </div>
                {owned ? (
                  <button
                    onClick={() => game.installer_url && window.open(game.installer_url, '_blank')}
                    className="w-full py-3 rounded-lg bg-green-600 hover:bg-green-500 text-white font-bold text-sm transition flex items-center justify-center gap-2"
                  >
                    <Download size={16} /> Download & Play
                  </button>
                ) : (
                  <button
                    onClick={() => navigate('/app/marketplace')}
                    className="w-full py-3 rounded-lg bg-nyptid-600 hover:bg-nyptid-500 text-white font-bold text-sm transition"
                  >
                    {price.final === 'Free' ? 'Get Game' : `Buy — ${price.final}`}
                  </button>
                )}
                <button
                  onClick={() => void toggleWishlist()}
                  className={`w-full py-2.5 rounded-lg border text-sm font-medium mt-2 transition flex items-center justify-center gap-2 ${
                    wishlisted ? 'border-red-500/30 bg-red-500/10 text-red-400' : 'border-surface-600 text-surface-400 hover:text-surface-200'
                  }`}
                >
                  <Heart size={14} fill={wishlisted ? 'currentColor' : 'none'} />
                  {wishlisted ? 'On Wishlist' : 'Add to Wishlist'}
                </button>

                {/* Publisher info */}
                {seller && (
                  <div className="mt-4 pt-4 border-t border-surface-700/50">
                    <div className="flex items-center gap-2">
                      <Avatar src={seller.avatar_url} name={seller.display_name || seller.username} size="sm" />
                      <div>
                        <p className="text-xs text-surface-500">Publisher</p>
                        <p className="text-sm text-surface-200">{seller.display_name || seller.username}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Meta */}
                <div className="mt-4 pt-4 border-t border-surface-700/50 space-y-2 text-xs text-surface-500">
                  <div className="flex justify-between"><span>Release Date</span><span className="text-surface-300">{new Date(game.created_at).toLocaleDateString()}</span></div>
                  <div className="flex justify-between"><span>Provenance</span><span className="text-surface-300">{game.provenance_type === 'self_developed' ? 'Self Developed' : 'Steam Authorized'}</span></div>
                  {tags.length > 0 && <div className="flex justify-between"><span>Tags</span><span className="text-surface-300">{tags.join(', ')}</span></div>}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
