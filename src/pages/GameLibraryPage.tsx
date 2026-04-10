import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Library, Download, Play, Clock, Star, Heart, Search, Grid3X3, List, ExternalLink, Gamepad2, TrendingUp } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { AppShell } from '../components/layout/AppShell';

type ViewMode = 'grid' | 'list';
type Tab = 'library' | 'store' | 'wishlist';

interface GameListing {
  id: string;
  seller_id: string;
  title: string;
  slug: string;
  description: string;
  cover_url: string | null;
  installer_url: string | null;
  price_cents: number;
  discount_percent: number;
  sale_ends_at: string | null;
  status: string;
  provenance_type: string;
  total_reviews: number;
  positive_review_pct: number;
  created_at: string;
}

interface OwnedGame {
  id: string;
  game_listing_id: string;
  buyer_id: string;
  amount_cents: number;
  status: string;
  download_token: string | null;
  created_at: string;
  game?: GameListing;
}

interface WishlistEntry {
  user_id: string;
  game_listing_id: string;
  added_at: string;
  game?: GameListing;
}

export default function GameLibraryPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('library');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  const [ownedGames, setOwnedGames] = useState<OwnedGame[]>([]);
  const [storeGames, setStoreGames] = useState<GameListing[]>([]);
  const [wishlist, setWishlist] = useState<WishlistEntry[]>([]);

  useEffect(() => {
    if (!profile) return;
    void loadData();
  }, [profile, tab]);

  async function loadData() {
    setLoading(true);
    try {
      if (tab === 'library') await loadLibrary();
      else if (tab === 'store') await loadStore();
      else if (tab === 'wishlist') await loadWishlist();
    } finally {
      setLoading(false);
    }
  }

  async function loadLibrary() {
    if (!profile) return;
    const { data } = await supabase
      .from('marketplace_game_orders')
      .select('*, game:marketplace_game_listings(*)')
      .eq('buyer_id', profile.id)
      .in('status', ['paid', 'fulfilled'])
      .order('created_at', { ascending: false });
    setOwnedGames((data || []) as OwnedGame[]);
  }

  async function loadStore() {
    const { data } = await supabase
      .from('marketplace_game_listings')
      .select('*')
      .eq('status', 'approved')
      .order('created_at', { ascending: false })
      .limit(50);
    setStoreGames((data || []) as GameListing[]);
  }

  async function loadWishlist() {
    if (!profile) return;
    const { data } = await supabase
      .from('game_wishlists')
      .select('*, game:marketplace_game_listings(*)')
      .eq('user_id', profile.id)
      .order('added_at', { ascending: false });
    setWishlist((data || []) as WishlistEntry[]);
  }

  async function toggleWishlist(gameId: string) {
    if (!profile) return;
    const existing = wishlist.find((w) => w.game_listing_id === gameId);
    if (existing) {
      await supabase.from('game_wishlists').delete()
        .eq('user_id', profile.id).eq('game_listing_id', gameId);
    } else {
      await supabase.from('game_wishlists').insert({ user_id: profile.id, game_listing_id: gameId });
    }
    void loadWishlist();
  }

  function formatPrice(cents: number, discountPct: number = 0): { original: string; final: string; hasDiscount: boolean } {
    const original = cents === 0 ? 'Free' : `$${(cents / 100).toFixed(2)}`;
    if (discountPct > 0 && cents > 0) {
      const discounted = Math.round(cents * (1 - discountPct / 100));
      return { original, final: `$${(discounted / 100).toFixed(2)}`, hasDiscount: true };
    }
    return { original, final: original, hasDiscount: false };
  }

  function getReviewLabel(pct: number, total: number): { text: string; color: string } {
    if (total < 5) return { text: 'No reviews yet', color: 'text-surface-500' };
    if (pct >= 90) return { text: 'Overwhelmingly Positive', color: 'text-blue-400' };
    if (pct >= 80) return { text: 'Very Positive', color: 'text-blue-400' };
    if (pct >= 70) return { text: 'Mostly Positive', color: 'text-blue-300' };
    if (pct >= 50) return { text: 'Mixed', color: 'text-yellow-400' };
    if (pct >= 30) return { text: 'Mostly Negative', color: 'text-orange-400' };
    return { text: 'Negative', color: 'text-red-400' };
  }

  function filterBySearch<T extends { game?: GameListing | null; title?: string }>(items: T[]): T[] {
    if (!searchQuery.trim()) return items;
    const q = searchQuery.toLowerCase();
    return items.filter((item) => {
      const title = (item.game?.title || item.title || '').toLowerCase();
      return title.includes(q);
    });
  }

  function launchGame(game: GameListing) {
    if (game.installer_url && window.desktopBridge?.launchExternalUrl) {
      window.desktopBridge.launchExternalUrl(game.installer_url);
    } else if (game.installer_url) {
      window.open(game.installer_url, '_blank', 'noopener');
    }
  }

  // ---------- Game Card ----------
  function GameCard({ game, owned, wishlisted }: { game: GameListing; owned?: boolean; wishlisted?: boolean }) {
    const price = formatPrice(game.price_cents, game.discount_percent);
    const review = getReviewLabel(game.positive_review_pct, game.total_reviews);

    return (
      <div className={`group rounded-xl overflow-hidden transition ${viewMode === 'grid' ? 'bg-surface-800/60 hover:bg-surface-800' : 'bg-surface-800/40 hover:bg-surface-800/70 flex items-center gap-4 p-3'}`}>
        {/* Cover */}
        <div className={viewMode === 'grid' ? 'aspect-[16/9] bg-surface-700 relative overflow-hidden' : 'w-24 h-14 rounded-lg bg-surface-700 flex-shrink-0 overflow-hidden'}>
          {game.cover_url ? (
            <img src={game.cover_url} alt={game.title} className="w-full h-full object-cover" loading="lazy" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Gamepad2 size={viewMode === 'grid' ? 32 : 20} className="text-surface-600" />
            </div>
          )}
          {game.discount_percent > 0 && (
            <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-green-600 text-white text-xs font-bold">
              -{game.discount_percent}%
            </div>
          )}
        </div>

        {/* Info */}
        <div className={viewMode === 'grid' ? 'p-3' : 'flex-1 min-w-0'}>
          <h3 className={`font-semibold text-surface-100 truncate ${viewMode === 'grid' ? 'text-sm mb-1' : 'text-sm'}`}>{game.title}</h3>

          {viewMode === 'grid' && (
            <p className={`text-xs mb-2 ${review.color}`}>{review.text}</p>
          )}

          <div className="flex items-center gap-2">
            {price.hasDiscount && (
              <span className="text-surface-500 text-xs line-through">{price.original}</span>
            )}
            <span className={`text-sm font-bold ${price.final === 'Free' ? 'text-green-400' : 'text-surface-100'}`}>
              {price.final}
            </span>
          </div>

          {/* Actions */}
          <div className={`flex items-center gap-2 ${viewMode === 'grid' ? 'mt-3' : 'mt-1'}`}>
            {owned ? (
              <button
                onClick={() => launchGame(game)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-500 text-white text-xs font-medium transition"
              >
                <Play size={13} />
                Play
              </button>
            ) : (
              <button
                onClick={() => navigate('/app/marketplace')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-nyptid-600 hover:bg-nyptid-500 text-white text-xs font-medium transition"
              >
                <Download size={13} />
                {price.final === 'Free' ? 'Get' : 'Buy'}
              </button>
            )}
            <button
              onClick={() => toggleWishlist(game.id)}
              className={`p-1.5 rounded-lg transition ${wishlisted ? 'text-red-400 hover:text-red-300 bg-red-900/20' : 'text-surface-500 hover:text-surface-300 hover:bg-surface-700'}`}
            >
              <Heart size={14} fill={wishlisted ? 'currentColor' : 'none'} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  const wishlistedIds = new Set(wishlist.map((w) => w.game_listing_id));
  const ownedIds = new Set(ownedGames.map((o) => o.game_listing_id));

  return (
    <AppShell>
      <div className="flex flex-col h-full bg-surface-900">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-surface-700/50">
          <div className="flex items-center gap-3">
            <Library size={22} className="text-nyptid-400" />
            <h1 className="text-surface-100 font-bold text-lg">Game Library</h1>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-surface-500" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search games..."
                className="bg-surface-800 border border-surface-700 rounded-lg pl-8 pr-3 py-1.5 text-surface-100 text-sm placeholder-surface-500 focus:outline-none focus:border-nyptid-500 w-48"
              />
            </div>
            <button
              onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
              className="p-2 rounded-lg hover:bg-surface-700/50 text-surface-400 hover:text-surface-200 transition"
            >
              {viewMode === 'grid' ? <List size={16} /> : <Grid3X3 size={16} />}
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 px-4 py-2 border-b border-surface-700/30">
          {([
            { id: 'library' as Tab, icon: Library, label: 'My Library', count: ownedGames.length },
            { id: 'store' as Tab, icon: TrendingUp, label: 'Store' },
            { id: 'wishlist' as Tab, icon: Heart, label: 'Wishlist', count: wishlist.length },
          ]).map(({ id, icon: Icon, label, count }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                tab === id ? 'bg-surface-700 text-surface-100' : 'text-surface-400 hover:text-surface-200 hover:bg-surface-800'
              }`}
            >
              <Icon size={15} />
              {label}
              {typeof count === 'number' && count > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded-full bg-surface-600 text-surface-300 text-[10px]">{count}</span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="text-center text-surface-500 text-sm py-12">Loading...</div>
          ) : tab === 'library' ? (
            filterBySearch(ownedGames).length === 0 ? (
              <div className="text-center py-12">
                <Gamepad2 size={48} className="text-surface-700 mx-auto mb-3" />
                <p className="text-surface-400 text-sm">No games in your library yet.</p>
                <button
                  onClick={() => setTab('store')}
                  className="mt-3 px-4 py-2 rounded-lg bg-nyptid-600 hover:bg-nyptid-500 text-white text-sm font-medium transition"
                >
                  Browse Store
                </button>
              </div>
            ) : (
              <div className={viewMode === 'grid' ? 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4' : 'space-y-2'}>
                {filterBySearch(ownedGames).map((entry) => entry.game && (
                  <GameCard key={entry.id} game={entry.game} owned wishlisted={wishlistedIds.has(entry.game_listing_id)} />
                ))}
              </div>
            )
          ) : tab === 'store' ? (
            <div className={viewMode === 'grid' ? 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4' : 'space-y-2'}>
              {filterBySearch(storeGames).map((game) => (
                <GameCard key={game.id} game={game} owned={ownedIds.has(game.id)} wishlisted={wishlistedIds.has(game.id)} />
              ))}
            </div>
          ) : (
            filterBySearch(wishlist).length === 0 ? (
              <div className="text-center py-12">
                <Heart size={48} className="text-surface-700 mx-auto mb-3" />
                <p className="text-surface-400 text-sm">Your wishlist is empty.</p>
              </div>
            ) : (
              <div className={viewMode === 'grid' ? 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4' : 'space-y-2'}>
                {filterBySearch(wishlist).map((entry) => entry.game && (
                  <GameCard key={entry.game_listing_id} game={entry.game} owned={ownedIds.has(entry.game_listing_id)} wishlisted />
                ))}
              </div>
            )
          )}
        </div>
      </div>
    </AppShell>
  );
}
