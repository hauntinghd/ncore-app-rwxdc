import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  BadgeCheck,
  BookOpen,
  Briefcase,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileText,
  Gamepad2,
  Gift,
  Info,
  Plus,
  Search,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Wand2,
  Wallet,
} from 'lucide-react';
import { AppShell } from '../components/layout/AppShell';
import { Modal } from '../components/ui/Modal';
import { useEntitlements } from '../lib/entitlements';
import { ensureFreshAuthSession } from '../lib/authSession';
import { supabase } from '../lib/supabase';
import { resolveBillingReturnUrl } from '../lib/billingUrl';
import { useAuth } from '../contexts/AuthContext';
import type {
  MarketplaceGameOrder,
  MarketplaceGameListing,
  MarketplaceSellerProfile,
  MarketplaceServiceCategory,
  MarketplaceServiceDispute,
  MarketplaceServiceListing,
  MarketplaceServiceOrder,
  NcoreWalletAccount,
  StoreProduct,
} from '../lib/types';

function formatUsdFromCents(priceCents: number): string {
  return `$${(priceCents / 100).toFixed(2)}`;
}

interface CosmeticPreviewMeta {
  headline: string;
  summary: string;
  effects: string[];
  tags: string[];
}

type MarketplaceTrack = 'cosmetics' | 'quickdraw' | 'games';
type QuickdrawRoleView = 'hiring' | 'specialist';
type QuickdrawBriefingId = 'terms' | 'tier2' | 'protocols' | null;
type QuickdrawNavId = 'my_contracts' | 'listed_contracts' | 'working_contracts' | 'escrow_history' | 'find_contracts' | 'contract_radar';
type GameStoreSection = 'store' | 'new_trending' | 'top_sellers' | 'recently_updated' | 'library';

interface QuickdrawContractDraft {
  id: string;
  title: string;
  description: string;
  deliverables: string[];
  budgetUsd: number;
  durationDays: number;
  tags: string[];
  createdAt: string;
  status: 'draft' | 'queued';
}

const QUICKDRAW_DRAFTS_STORAGE_PREFIX = 'ncore.marketplace.quickdraw.drafts';

const QUICKDRAW_BRIEFINGS: Record<Exclude<QuickdrawBriefingId, null>, { title: string; subtitle: string; blocks: { title: string; body: string }[] }> = {
  terms: {
    title: 'Terms of Engagement',
    subtitle: 'Marketplace operating doctrine',
    blocks: [
      {
        title: '1. Escrow Perimeter',
        body: 'All funded service orders are escrow-backed. Funds release when work is accepted or when the release timer expires with no dispute.',
      },
      {
        title: '2. Contract Accuracy',
        body: 'Buyers must define requirements clearly. Specialists must confirm scope before starting execution to prevent avoidable disputes.',
      },
      {
        title: '3. Dispute Enforcement',
        body: 'Dispute actions freeze auto-release and route to moderation review. False claims or abuse can reduce account standing.',
      },
    ],
  },
  tier2: {
    title: 'Tier II Clearance',
    subtitle: 'Operational requirement for specialist publishing access',
    blocks: [
      {
        title: '1. Verified Proof',
        body: 'Submit niche, portfolio/proof URL, and verified earnings. Clearance is required before publishing listings or bidding in restricted tracks.',
      },
      {
        title: '2. Quality Standard',
        body: 'Moderation checks profile quality, delivery consistency, and prior dispute outcomes before granting Tier II specialist access.',
      },
      {
        title: '3. Access Gate',
        body: 'Without approved Tier II, users can browse and hire but cannot publish specialist listings in Quickdraw.',
      },
    ],
  },
  protocols: {
    title: 'Operational Protocols',
    subtitle: 'How Quickdraw contracts move from issue to settlement',
    blocks: [
      {
        title: 'Founder Protocol (Hiring)',
        body: 'Issue requirement, fund escrow, review specialist bids, and release payment on delivery approval.',
      },
      {
        title: 'Specialist Protocol (Being Hired)',
        body: 'Maintain approved clearance, publish accurate offer terms, deliver before deadline, and provide revision notes in order updates.',
      },
      {
        title: 'Escrow Sequence',
        body: 'Orders begin funded, move to in-progress, then delivered. Buyer confirmation or timeout triggers release unless dispute is opened.',
      },
    ],
  },
};

function getTrackFromPath(pathname: string): MarketplaceTrack {
  const path = String(pathname || '').toLowerCase();
  if (path.endsWith('/marketplace/quickdraw')) return 'quickdraw';
  if (path.endsWith('/marketplace/games')) return 'games';
  return 'cosmetics';
}

function isMissingDisputesTableError(error: unknown): boolean {
  const code = String((error as any)?.code || '').toUpperCase();
  const message = String((error as any)?.message || '').toLowerCase();
  return (
    code === 'PGRST205'
    || (message.includes('marketplace_service_disputes') && message.includes('schema cache'))
    || (message.includes("could not find the table 'public.marketplace_service_disputes'"))
  );
}

function formatUsdWholeFromCents(priceCents: number): string {
  return `$${(Math.max(priceCents, 0) / 100).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function formatDateTime(value: string | null | undefined): string {
  const raw = String(value || '').trim();
  if (!raw) return 'N/A';
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return 'N/A';
  return parsed.toLocaleString();
}

const DEFAULT_PREVIEW: CosmeticPreviewMeta = {
  headline: 'NCore Cosmetic Unlock',
  summary: 'Adds account-bound visual customization that stays permanently on your profile.',
  effects: [
    'Instant account unlock after successful purchase.',
    'Permanent cosmetic entitlement with no consumable charges.',
    'Visible across profile, DMs, and server interactions where supported.',
  ],
  tags: ['Permanent', 'Account-bound', 'Cosmetic'],
};

const COSMETIC_PREVIEWS: Record<string, CosmeticPreviewMeta> = {
  profile_flair_pack: {
    headline: 'Profile Flair Effects',
    summary: 'Animated profile flair accents around your profile card and user identity surfaces.',
    effects: [
      'Adds premium flair accents to your profile card.',
      'Displays an enhanced identity ribbon in profile surfaces.',
      'Supports future flair variants as NCore style packs expand.',
    ],
    tags: ['Profile', 'Animated', 'Identity'],
  },
  avatar_frame_pack: {
    headline: 'Avatar Frame Pack',
    summary: 'Adds premium avatar rings and framed accents around profile pictures.',
    effects: [
      'Unlocks multiple framed avatar ring styles.',
      'Frame rendering appears around your profile image in app surfaces.',
      'Switch frame styles from profile customization settings.',
    ],
    tags: ['Avatar', 'Frame', 'Profile'],
  },
  nameplate_color_pack: {
    headline: 'Nameplate Color Pack',
    summary: 'Unlocks premium display-name gradients and nameplate color treatments.',
    effects: [
      'Adds custom name gradients for your display name.',
      'Improves profile identity visibility in chats and member lists.',
      'Works with supporter badges and future profile cosmetics.',
    ],
    tags: ['Nameplate', 'Gradient', 'Identity'],
  },
  supporter_badge_pack: {
    headline: 'Supporter Badge Pack',
    summary: 'Adds supporter badge marks that appear next to your profile identity.',
    effects: [
      'Displays supporter badge on compatible profile surfaces.',
      'Highlights account supporter status in social contexts.',
      'Pairs cleanly with flair and nameplate customizations.',
    ],
    tags: ['Badge', 'Supporter', 'Identity'],
  },
  banner_fx_pack: {
    headline: 'Banner FX Pack',
    summary: 'Adds animated profile banner overlays and motion effects.',
    effects: [
      'Unlocks animated banner visual overlays.',
      'Enhances profile banner presence with dynamic motion effects.',
      'Designed for profile headers and identity showcases.',
    ],
    tags: ['Banner', 'FX', 'Animated'],
  },
  chat_sound_pack: {
    headline: 'Chat Sound Pack',
    summary: 'Adds alternate notification and message alert sound profiles.',
    effects: [
      'Unlocks alternate chat and ping sound themes.',
      'Supports future expanded sound profiles in settings.',
      'Lets users pick styles that match their preferred tone.',
    ],
    tags: ['Audio', 'Notifications', 'Chat'],
  },
  stream_overlay_pack: {
    headline: 'Stream Overlay Pack',
    summary: 'Adds premium call and screen-share overlay treatments.',
    effects: [
      'Unlocks additional live-call overlay style options.',
      'Applies cosmetic frame treatments to stream presentation surfaces.',
      'Designed to improve visual polish during live sessions.',
    ],
    tags: ['Call', 'Stream', 'Overlay'],
  },
  server_theme_pack: {
    headline: 'Server Theme Pack',
    summary: 'Unlocks additional server color and gradient theme presets.',
    effects: [
      'Adds premium server color presets.',
      'Enables extended gradient combinations for server theming.',
      'Designed for community owners to improve visual identity.',
    ],
    tags: ['Server', 'Theme', 'Customization'],
  },
  elite_nameplate_pack: {
    headline: 'Elite Nameplate Pack',
    summary: 'Adds higher-tier identity styling for display names and nameplates.',
    effects: [
      'Unlocks elite-tier nameplate styling.',
      'Adds stronger contrast and premium identity accents.',
      'Built to layer with supporter and profile flair cosmetics.',
    ],
    tags: ['Elite', 'Nameplate', 'Premium'],
  },
  founders_badge_pack: {
    headline: 'Founders Badge Pack',
    summary: 'Adds a permanent founder identity badge to your profile.',
    effects: [
      'Grants permanent founder badge entitlement.',
      'Displays founder identity marker on profile surfaces.',
      'Useful for early supporters and community recognition.',
    ],
    tags: ['Founder', 'Badge', 'Permanent'],
  },
};

function isInvalidJwtMessage(value: unknown): boolean {
  const normalized = String(value || '').toLowerCase();
  return normalized.includes('invalid jwt')
    || normalized.includes('jwt')
    || normalized.includes('unauthorized')
    || normalized.includes('auth')
    || normalized.includes('token');
}

interface CheckoutInvokeResult {
  data?: { checkoutUrl?: string; error?: string };
  error?: string;
  status?: number;
}

async function invokeCheckoutWithToken(accessToken: string, requestBody: Record<string, unknown>): Promise<CheckoutInvokeResult> {
  const baseUrl = String(import.meta.env.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const anonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();
  const normalizedToken = String(accessToken || '').trim();
  if (!baseUrl || !anonKey) {
    return { error: 'Supabase environment is missing in this build.' };
  }
  if (!normalizedToken) {
    return { error: 'Missing checkout auth token.' };
  }

  try {
    const response = await fetch(`${baseUrl}/functions/v1/billing-create-checkout-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${normalizedToken}`,
      },
      body: JSON.stringify({
        ...requestBody,
        accessToken: normalizedToken,
      }),
    });

    const raw = await response.text();
    let payload: any = {};
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      payload = {};
    }

    if (!response.ok) {
      return {
        error: String(payload?.error || payload?.message || raw || `Checkout failed (${response.status})`),
        status: response.status,
      };
    }

    return {
      data: payload as { checkoutUrl?: string; error?: string },
      status: response.status,
    };
  } catch (error: unknown) {
    return {
      error: String((error as Error)?.message || error),
    };
  }
}

function normalizeExternalHttpUrl(targetUrl: string, label: string): string {
  const raw = String(targetUrl || '').trim().replace(/^['"]|['"]$/g, '');
  if (!raw) {
    throw new Error(`${label} is missing.`);
  }

  const toHttpUrl = (value: string): string => {
    const parsed = new URL(value);
    if (!['https:', 'http:'].includes(parsed.protocol)) {
      throw new Error('Only http/https URLs are supported.');
    }
    return parsed.toString();
  };

  try {
    return toHttpUrl(raw);
  } catch {
    // Try alternate URL forms below.
  }

  if (raw.startsWith('//')) {
    try {
      return toHttpUrl(`https:${raw}`);
    } catch {
      // continue
    }
  }

  if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(raw)) {
    try {
      return toHttpUrl(`https://${raw}`);
    } catch {
      // continue
    }
  }

  try {
    const relative = raw.startsWith('/') ? raw : `/${raw}`;
    return toHttpUrl(new URL(relative, window.location.origin).toString());
  } catch {
    throw new Error(`Invalid ${label}: ${raw}`);
  }
}

async function openCheckoutUrl(checkoutUrl: string): Promise<void> {
  const normalized = normalizeExternalHttpUrl(checkoutUrl, 'checkout URL');

  if (window.desktopBridge?.openExternalUrl) {
    const result = await window.desktopBridge.openExternalUrl(normalized);
    if (!result.ok) {
      throw new Error(result.message || 'Could not open Stripe checkout.');
    }
    return;
  }

  const popup = window.open(normalized, '_blank', 'noopener,noreferrer');
  if (!popup) {
    window.location.assign(normalized);
  }
}

export function MarketplacePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const routeTrack = useMemo(() => getTrackFromPath(location.pathname), [location.pathname]);
  const isOpsExperience = routeTrack === 'quickdraw' || routeTrack === 'games';
  const { profile } = useAuth();
  const { entitlements, loading: entitlementsLoading, refresh: refreshEntitlements } = useEntitlements();
  const [activeTrack, setActiveTrack] = useState<MarketplaceTrack>(routeTrack);
  const [storeProducts, setStoreProducts] = useState<StoreProduct[]>([]);
  const [loadingStoreProducts, setLoadingStoreProducts] = useState(false);
  const [checkoutLoadingKey, setCheckoutLoadingKey] = useState<string | null>(null);
  const [billingActionMessage, setBillingActionMessage] = useState('');
  const [selectedSku, setSelectedSku] = useState<string>('');
  const [quickdrawMessage, setQuickdrawMessage] = useState('');
  const [loadingQuickdraw, setLoadingQuickdraw] = useState(false);
  const [sellerProfile, setSellerProfile] = useState<MarketplaceSellerProfile | null>(null);
  const [walletAccount, setWalletAccount] = useState<NcoreWalletAccount | null>(null);
  const [serviceCategories, setServiceCategories] = useState<MarketplaceServiceCategory[]>([]);
  const [serviceListings, setServiceListings] = useState<MarketplaceServiceListing[]>([]);
  const [myServiceListings, setMyServiceListings] = useState<MarketplaceServiceListing[]>([]);
  const [serviceOrders, setServiceOrders] = useState<MarketplaceServiceOrder[]>([]);
  const [serviceDisputes, setServiceDisputes] = useState<MarketplaceServiceDispute[]>([]);
  const [gameListings, setGameListings] = useState<MarketplaceGameListing[]>([]);
  const [myGameListings, setMyGameListings] = useState<MarketplaceGameListing[]>([]);
  const [gameOrders, setGameOrders] = useState<MarketplaceGameOrder[]>([]);
  const [sellerNiche, setSellerNiche] = useState('');
  const [sellerProofUrl, setSellerProofUrl] = useState('');
  const [sellerBio, setSellerBio] = useState('');
  const [sellerEarnings, setSellerEarnings] = useState('1000');
  const [newServiceCategorySlug, setNewServiceCategorySlug] = useState('');
  const [newServiceTitle, setNewServiceTitle] = useState('');
  const [newServiceDescription, setNewServiceDescription] = useState('');
  const [newServicePriceUsd, setNewServicePriceUsd] = useState('250');
  const [newServiceDeliveryDays, setNewServiceDeliveryDays] = useState('3');
  const [newServicePortfolio, setNewServicePortfolio] = useState('');
  const [newGameTitle, setNewGameTitle] = useState('');
  const [newGameSlug, setNewGameSlug] = useState('');
  const [newGameDescription, setNewGameDescription] = useState('');
  const [newGamePriceUsd, setNewGamePriceUsd] = useState('9.99');
  const [newGameInstallerUrl, setNewGameInstallerUrl] = useState('');
  const [newGameCoverUrl, setNewGameCoverUrl] = useState('');
  const [newGameProvenanceType, setNewGameProvenanceType] = useState<'self_developed' | 'steam_authorized'>('self_developed');
  const [newGameProofUrl, setNewGameProofUrl] = useState('');
  const [orderActionLoadingKey, setOrderActionLoadingKey] = useState<string | null>(null);
  const [quickdrawRoleView, setQuickdrawRoleView] = useState<QuickdrawRoleView>('hiring');
  const [quickdrawNavId, setQuickdrawNavId] = useState<QuickdrawNavId>('my_contracts');
  const [quickdrawBriefingId, setQuickdrawBriefingId] = useState<QuickdrawBriefingId>(null);
  const [quickdrawSearch, setQuickdrawSearch] = useState('');
  const [gamesSearch, setGamesSearch] = useState('');
  const [gameStoreSection, setGameStoreSection] = useState<GameStoreSection>('store');
  const [showIssueContractModal, setShowIssueContractModal] = useState(false);
  const [issueContractTitle, setIssueContractTitle] = useState('');
  const [issueContractDescription, setIssueContractDescription] = useState('');
  const [issueContractDeliverablesText, setIssueContractDeliverablesText] = useState('');
  const [issueContractDurationDays, setIssueContractDurationDays] = useState('30');
  const [issueContractBudgetUsd, setIssueContractBudgetUsd] = useState('10');
  const [issueContractTagsText, setIssueContractTagsText] = useState('');
  const [issueContractAcknowledged, setIssueContractAcknowledged] = useState(false);
  const [quickdrawContractDrafts, setQuickdrawContractDrafts] = useState<QuickdrawContractDraft[]>([]);

  const ownedSkus = useMemo(() => new Set(entitlements.ownedSkus || []), [entitlements.ownedSkus]);
  const selectedProduct = useMemo(
    () => storeProducts.find((item) => item.sku === selectedSku) || storeProducts[0] || null,
    [storeProducts, selectedSku],
  );
  const selectedPreview = selectedProduct ? (COSMETIC_PREVIEWS[selectedProduct.sku] || DEFAULT_PREVIEW) : DEFAULT_PREVIEW;
  const serviceDisputeByOrderId = useMemo(() => {
    const map = new Map<string, MarketplaceServiceDispute>();
    for (const dispute of serviceDisputes) {
      const key = String(dispute.order_id || '').trim();
      if (!key) continue;
      map.set(key, dispute);
    }
    return map;
  }, [serviceDisputes]);
  const myServiceOrdersAsBuyer = useMemo(
    () => serviceOrders.filter((order) => String(order.buyer_id) === String(profile?.id || '')),
    [serviceOrders, profile?.id],
  );
  const myServiceOrdersAsSeller = useMemo(
    () => serviceOrders.filter((order) => String(order.seller_id) === String(profile?.id || '')),
    [serviceOrders, profile?.id],
  );
  const myGameOrdersAsBuyer = useMemo(
    () => gameOrders.filter((order) => String(order.buyer_id) === String(profile?.id || '')),
    [gameOrders, profile?.id],
  );
  const quickdrawNavItems = useMemo(() => (
    quickdrawRoleView === 'hiring'
      ? [
          { id: 'my_contracts' as QuickdrawNavId, label: 'My Contracts', subtitle: 'Founder command center' },
          { id: 'listed_contracts' as QuickdrawNavId, label: 'Listed Contracts', subtitle: 'Drafted and staged' },
          { id: 'working_contracts' as QuickdrawNavId, label: 'Working Contracts', subtitle: 'Live escrow orders' },
          { id: 'escrow_history' as QuickdrawNavId, label: 'Escrow History', subtitle: 'Closed settlements' },
        ]
      : [
          { id: 'find_contracts' as QuickdrawNavId, label: 'Find Contracts', subtitle: 'Open specialist opportunities' },
          { id: 'contract_radar' as QuickdrawNavId, label: 'Contract Radar', subtitle: 'Live demand pulse' },
          { id: 'escrow_history' as QuickdrawNavId, label: 'Escrow History', subtitle: 'Delivered and disputed' },
        ]
  ), [quickdrawRoleView]);
  const activeQuickdrawNav = useMemo(
    () => quickdrawNavItems.find((item) => item.id === quickdrawNavId) || quickdrawNavItems[0],
    [quickdrawNavId, quickdrawNavItems],
  );
  const searchedServiceListings = useMemo(() => {
    const needle = quickdrawSearch.trim().toLowerCase();
    if (!needle) return serviceListings;
    return serviceListings.filter((listing) => {
      const haystack = [
        listing.title,
        listing.description,
        listing.category?.name,
        listing.seller_profile?.display_name,
        listing.seller_profile?.username,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [quickdrawSearch, serviceListings]);
  const visibleServiceListings = useMemo(() => {
    if (quickdrawRoleView === 'hiring') {
      if (quickdrawNavId === 'working_contracts' || quickdrawNavId === 'escrow_history' || quickdrawNavId === 'listed_contracts') {
        return [];
      }
      return searchedServiceListings;
    }
    if (quickdrawNavId === 'escrow_history') {
      return [];
    }
    if (quickdrawNavId === 'contract_radar') {
      return [...searchedServiceListings].sort((a, b) => {
        const aCreated = Date.parse(String(a.created_at || ''));
        const bCreated = Date.parse(String(b.created_at || ''));
        if (Number.isFinite(aCreated) && Number.isFinite(bCreated) && aCreated !== bCreated) {
          return bCreated - aCreated;
        }
        return b.base_price_cents - a.base_price_cents;
      });
    }
    return searchedServiceListings;
  }, [quickdrawNavId, quickdrawRoleView, searchedServiceListings]);
  const searchedGameListings = useMemo(() => {
    const needle = gamesSearch.trim().toLowerCase();
    if (!needle) return gameListings;
    return gameListings.filter((game) => {
      const haystack = [
        game.title,
        game.slug,
        game.description,
        game.seller_profile?.display_name,
        game.seller_profile?.username,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [gameListings, gamesSearch]);
  const gameOrderCountsByListingId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const order of gameOrders) {
      const key = String(order.game_listing_id || '').trim();
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }, [gameOrders]);
  const purchasedGameListingIds = useMemo(
    () => new Set(myGameOrdersAsBuyer.map((order) => String(order.game_listing_id || '').trim()).filter(Boolean)),
    [myGameOrdersAsBuyer],
  );
  const filteredGameListings = useMemo(() => {
    const working = [...searchedGameListings];
    if (gameStoreSection === 'library') {
      return working
        .filter((listing) => purchasedGameListingIds.has(String(listing.id)))
        .sort((a, b) => Date.parse(String(b.updated_at || '')) - Date.parse(String(a.updated_at || '')));
    }
    if (gameStoreSection === 'new_trending') {
      return working.sort((a, b) => Date.parse(String(b.created_at || '')) - Date.parse(String(a.created_at || '')));
    }
    if (gameStoreSection === 'recently_updated') {
      return working.sort((a, b) => Date.parse(String(b.updated_at || '')) - Date.parse(String(a.updated_at || '')));
    }
    if (gameStoreSection === 'top_sellers') {
      return working.sort((a, b) => {
        const aOrders = gameOrderCountsByListingId.get(String(a.id)) || 0;
        const bOrders = gameOrderCountsByListingId.get(String(b.id)) || 0;
        if (aOrders !== bOrders) return bOrders - aOrders;
        return b.price_cents - a.price_cents;
      });
    }
    return working;
  }, [gameOrderCountsByListingId, gameStoreSection, purchasedGameListingIds, searchedGameListings]);
  const activeServiceOrdersForRole = useMemo(() => {
    const roleOrders = quickdrawRoleView === 'hiring' ? myServiceOrdersAsBuyer : myServiceOrdersAsSeller;
    return roleOrders.filter((order) => ['funded', 'in_progress', 'delivered'].includes(String(order.status || '').toLowerCase()));
  }, [myServiceOrdersAsBuyer, myServiceOrdersAsSeller, quickdrawRoleView]);
  const historicalServiceOrdersForRole = useMemo(() => {
    const roleOrders = quickdrawRoleView === 'hiring' ? myServiceOrdersAsBuyer : myServiceOrdersAsSeller;
    return roleOrders.filter((order) => !['funded', 'in_progress', 'delivered'].includes(String(order.status || '').toLowerCase()));
  }, [myServiceOrdersAsBuyer, myServiceOrdersAsSeller, quickdrawRoleView]);
  const featuredGameListing = filteredGameListings[0] || null;
  const hiringContractDrafts = useMemo(
    () => quickdrawContractDrafts.filter((draft) => draft.status === 'draft'),
    [quickdrawContractDrafts],
  );
  const queuedContractDrafts = useMemo(
    () => quickdrawContractDrafts.filter((draft) => draft.status === 'queued'),
    [quickdrawContractDrafts],
  );
  const marketplaceTrackMeta: Record<MarketplaceTrack, { label: string; summary: string; count: number; countLabel: string }> = {
    quickdraw: {
      label: 'Quickdraw Services',
      summary: 'Hire vetted experts with escrow-backed delivery and dispute protection.',
      count: serviceListings.length,
      countLabel: 'live services',
    },
    games: {
      label: 'Buy / Sell Games',
      summary: 'Buy approved game listings or publish your own title through moderation review.',
      count: gameListings.length,
      countLabel: 'live game listings',
    },
    cosmetics: {
      label: 'Permanent Unlocks',
      summary: 'Permanent account cosmetics with live previews before checkout.',
      count: storeProducts.length,
      countLabel: 'cosmetics',
    },
  };
  const activeTrackMeta = marketplaceTrackMeta[activeTrack];
  const hasMarketplaceErrorBanner = Boolean(billingActionMessage)
    || /(failed|could not|invalid|missing|error|expired|unable)/i.test(String(quickdrawMessage || ''));

  useEffect(() => {
    setActiveTrack(routeTrack);
  }, [routeTrack]);

  useEffect(() => {
    const validIds = new Set(quickdrawNavItems.map((item) => item.id));
    if (!validIds.has(quickdrawNavId)) {
      setQuickdrawNavId(quickdrawNavItems[0]?.id || 'my_contracts');
    }
  }, [quickdrawNavId, quickdrawNavItems]);

  useEffect(() => {
    let cancelled = false;
    setLoadingStoreProducts(true);
    setBillingActionMessage('');
    void refreshEntitlements();

    (async () => {
      const { data, error } = await supabase
        .from('store_products')
        .select('*')
        .eq('active', true)
        .order('price_cents', { ascending: true });

      if (cancelled) return;
      if (error) {
        setBillingActionMessage(error.message || 'Failed to load marketplace items.');
        setStoreProducts([]);
      } else {
        const nextProducts = (data || []) as StoreProduct[];
        setStoreProducts(nextProducts);
        if (nextProducts.length > 0 && !selectedSku) {
          setSelectedSku(nextProducts[0].sku);
        }
      }
      setLoadingStoreProducts(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [refreshEntitlements]);

  useEffect(() => {
    if (!profile?.id) return;
    void reloadMarketplacePanels();
  }, [profile?.id]);

  useEffect(() => {
    if (!profile?.id) {
      setQuickdrawContractDrafts([]);
      return;
    }
    const storageKey = `${QUICKDRAW_DRAFTS_STORAGE_PREFIX}.${profile.id}`;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) {
        setQuickdrawContractDrafts([]);
        return;
      }
      const parsed = JSON.parse(raw) as QuickdrawContractDraft[];
      if (!Array.isArray(parsed)) {
        setQuickdrawContractDrafts([]);
        return;
      }
      setQuickdrawContractDrafts(parsed.filter((entry) => entry && typeof entry === 'object' && String(entry.title || '').trim().length > 0));
    } catch {
      setQuickdrawContractDrafts([]);
    }
  }, [profile?.id]);

  useEffect(() => {
    if (!profile?.id) return;
    const storageKey = `${QUICKDRAW_DRAFTS_STORAGE_PREFIX}.${profile.id}`;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(quickdrawContractDrafts.slice(0, 40)));
    } catch {
      // best-effort local draft cache
    }
  }, [profile?.id, quickdrawContractDrafts]);

  async function reloadMarketplacePanels() {
    if (!profile?.id) return;
    setLoadingQuickdraw(true);
    setQuickdrawMessage('');
    try {
      const [
        sellerResult,
        walletResult,
        categoriesResult,
        approvedServicesResult,
        myServicesResult,
        approvedGamesResult,
        myGamesResult,
        serviceOrdersResult,
        gameOrdersResult,
        serviceDisputesResult,
      ] = await Promise.all([
        supabase.from('marketplace_seller_profiles').select('*').eq('user_id', profile.id).maybeSingle(),
        supabase.from('ncore_wallet_accounts').select('*').eq('user_id', profile.id).maybeSingle(),
        supabase.from('marketplace_service_categories').select('*').eq('active', true).order('name', { ascending: true }),
        supabase.from('marketplace_service_listings').select('*').eq('status', 'approved').order('created_at', { ascending: false }).limit(30),
        supabase.from('marketplace_service_listings').select('*').eq('seller_id', profile.id).order('created_at', { ascending: false }).limit(30),
        supabase.from('marketplace_game_listings').select('*').eq('status', 'approved').order('created_at', { ascending: false }).limit(30),
        supabase.from('marketplace_game_listings').select('*').eq('seller_id', profile.id).order('created_at', { ascending: false }).limit(30),
        supabase.from('marketplace_service_orders').select('*').or(`buyer_id.eq.${profile.id},seller_id.eq.${profile.id}`).order('created_at', { ascending: false }).limit(40),
        supabase.from('marketplace_game_orders').select('*').or(`buyer_id.eq.${profile.id},seller_id.eq.${profile.id}`).order('created_at', { ascending: false }).limit(40),
        supabase.from('marketplace_service_disputes').select('*').order('created_at', { ascending: false }).limit(40),
      ]);

      const disputesTableMissing = isMissingDisputesTableError(serviceDisputesResult.error);
      if (serviceDisputesResult.error && disputesTableMissing) {
        console.warn('marketplace_service_disputes table is not available yet; continuing without disputes data.');
      }

      if (
        sellerResult.error
        || categoriesResult.error
        || approvedServicesResult.error
        || myServicesResult.error
        || approvedGamesResult.error
        || myGamesResult.error
        || serviceOrdersResult.error
        || gameOrdersResult.error
        || (serviceDisputesResult.error && !disputesTableMissing)
      ) {
        throw new Error(
          sellerResult.error?.message
            || categoriesResult.error?.message
            || approvedServicesResult.error?.message
            || myServicesResult.error?.message
            || approvedGamesResult.error?.message
            || myGamesResult.error?.message
            || serviceOrdersResult.error?.message
            || gameOrdersResult.error?.message
            || (serviceDisputesResult.error && !disputesTableMissing ? serviceDisputesResult.error.message : '')
            || 'Failed to refresh marketplace data.',
        );
      }

      const categories = (categoriesResult.data || []) as MarketplaceServiceCategory[];
      const approvedServices = (approvedServicesResult.data || []) as MarketplaceServiceListing[];
      const ownedServices = (myServicesResult.data || []) as MarketplaceServiceListing[];
      const approvedGames = (approvedGamesResult.data || []) as MarketplaceGameListing[];
      const ownedGames = (myGamesResult.data || []) as MarketplaceGameListing[];
      const serviceOrdersRaw = (serviceOrdersResult.data || []) as MarketplaceServiceOrder[];
      const gameOrdersRaw = (gameOrdersResult.data || []) as MarketplaceGameOrder[];
      const disputesRaw = disputesTableMissing
        ? []
        : ((serviceDisputesResult.data || []) as MarketplaceServiceDispute[]);

      const allServiceRows: MarketplaceServiceListing[] = [...approvedServices, ...ownedServices];
      const allGameRows: MarketplaceGameListing[] = [...approvedGames, ...ownedGames];

      const serviceListingMap = new Map<string, MarketplaceServiceListing>();
      for (const row of allServiceRows) {
        serviceListingMap.set(String(row.id), row);
      }
      const missingServiceListingIds = Array.from(new Set(
        serviceOrdersRaw
          .map((order) => String(order.listing_id || ''))
          .filter((id) => id && !serviceListingMap.has(id)),
      ));
      if (missingServiceListingIds.length > 0) {
        const missingResult = await supabase
          .from('marketplace_service_listings')
          .select('*')
          .in('id', missingServiceListingIds);
        if (!missingResult.error) {
          for (const row of ((missingResult.data || []) as MarketplaceServiceListing[])) {
            serviceListingMap.set(String(row.id), row);
          }
        }
      }

      const gameListingMap = new Map<string, MarketplaceGameListing>();
      for (const row of allGameRows) {
        gameListingMap.set(String(row.id), row);
      }
      const missingGameListingIds = Array.from(new Set(
        gameOrdersRaw
          .map((order) => String(order.game_listing_id || ''))
          .filter((id) => id && !gameListingMap.has(id)),
      ));
      if (missingGameListingIds.length > 0) {
        const missingResult = await supabase
          .from('marketplace_game_listings')
          .select('*')
          .in('id', missingGameListingIds);
        if (!missingResult.error) {
          for (const row of ((missingResult.data || []) as MarketplaceGameListing[])) {
            gameListingMap.set(String(row.id), row);
          }
        }
      }

      const categoryMap = new Map(categories.map((category) => [String(category.id), category]));
      const profileIds = new Set<string>();
      for (const listing of serviceListingMap.values()) {
        if (listing.seller_id) profileIds.add(String(listing.seller_id));
      }
      for (const game of gameListingMap.values()) {
        if (game.seller_id) profileIds.add(String(game.seller_id));
      }
      for (const order of serviceOrdersRaw) {
        if (order.buyer_id) profileIds.add(String(order.buyer_id));
        if (order.seller_id) profileIds.add(String(order.seller_id));
      }
      for (const order of gameOrdersRaw) {
        if (order.buyer_id) profileIds.add(String(order.buyer_id));
        if (order.seller_id) profileIds.add(String(order.seller_id));
      }
      for (const dispute of disputesRaw) {
        if (dispute.opened_by) profileIds.add(String(dispute.opened_by));
        if (dispute.resolved_by) profileIds.add(String(dispute.resolved_by));
      }

      let profileMap = new Map<string, { id: string; username: string; display_name: string | null; avatar_url: string | null }>();
      const profileIdList = Array.from(profileIds);
      if (profileIdList.length > 0) {
        const profilesResult = await supabase
          .from('profiles')
          .select('id, username, display_name, avatar_url')
          .in('id', profileIdList);
        if (!profilesResult.error) {
          profileMap = new Map(((profilesResult.data || []) as any[]).map((row) => [String(row.id), row]));
        }
      }

      const hydratedServiceListings = Array.from(serviceListingMap.values()).map((row) => ({
        ...row,
        category: categoryMap.get(String(row.category_id)) || null,
        seller_profile: profileMap.get(String(row.seller_id)) || null,
      }));
      const hydratedGameListings = Array.from(gameListingMap.values()).map((row) => ({
        ...row,
        seller_profile: profileMap.get(String(row.seller_id)) || null,
      }));

      const hydratedApprovedServices = approvedServices.map((row) => ({
        ...row,
        category: categoryMap.get(String(row.category_id)) || null,
        seller_profile: profileMap.get(String(row.seller_id)) || null,
      }));
      const hydratedMyServices = ownedServices.map((row) => ({
        ...row,
        category: categoryMap.get(String(row.category_id)) || null,
        seller_profile: profileMap.get(String(row.seller_id)) || null,
      }));
      const hydratedApprovedGames = approvedGames.map((row) => ({
        ...row,
        seller_profile: profileMap.get(String(row.seller_id)) || null,
      }));
      const hydratedMyGames = ownedGames.map((row) => ({
        ...row,
        seller_profile: profileMap.get(String(row.seller_id)) || null,
      }));

      const hydratedServiceOrders = serviceOrdersRaw.map((order) => ({
        ...order,
        listing: hydratedServiceListings.find((listing) => String(listing.id) === String(order.listing_id)) || null,
        buyer_profile: profileMap.get(String(order.buyer_id)) || null,
        seller_profile: profileMap.get(String(order.seller_id)) || null,
      }));
      const serviceOrderMap = new Map(hydratedServiceOrders.map((order) => [String(order.id), order]));
      const hydratedDisputes = disputesRaw.map((dispute) => ({
        ...dispute,
        order: serviceOrderMap.get(String(dispute.order_id)) || null,
      }));
      const hydratedGameOrders = gameOrdersRaw.map((order) => ({
        ...order,
        game: hydratedGameListings.find((game) => String(game.id) === String(order.game_listing_id)) || null,
        buyer_profile: profileMap.get(String(order.buyer_id)) || null,
        seller_profile: profileMap.get(String(order.seller_id)) || null,
      }));

      setSellerProfile((sellerResult.data || null) as MarketplaceSellerProfile | null);
      setWalletAccount((walletResult.data || null) as NcoreWalletAccount | null);
      setServiceCategories(categories);
      setServiceListings(hydratedApprovedServices);
      setMyServiceListings(hydratedMyServices);
      setServiceOrders(hydratedServiceOrders);
      setServiceDisputes(hydratedDisputes);
      setGameListings(hydratedApprovedGames);
      setMyGameListings(hydratedMyGames);
      setGameOrders(hydratedGameOrders);
      if (!newServiceCategorySlug && categories[0]?.slug) {
        setNewServiceCategorySlug(categories[0].slug);
      }
    } catch (error: unknown) {
      setQuickdrawMessage(String((error as Error)?.message || error));
    } finally {
      setLoadingQuickdraw(false);
    }
  }

  async function startMarketplaceCheckout(
    mode: 'marketplace_service_listing_fee' | 'marketplace_service_order' | 'marketplace_game_listing_fee' | 'marketplace_game_purchase',
    payload: Record<string, unknown>,
    loadingKey: string,
  ) {
    setQuickdrawMessage('');
    setCheckoutLoadingKey(loadingKey);
    const successUrl = resolveBillingReturnUrl('/app/marketplace');
    const cancelUrl = resolveBillingReturnUrl('/app/marketplace');

    try {
      const authState = await ensureFreshAuthSession(120, { verifyOnServer: true });
      if (!authState.ok || !authState.accessToken) {
        setQuickdrawMessage(authState.message || 'Session expired. Please sign in again.');
        return;
      }

      let firstTry = await invokeCheckoutWithToken(authState.accessToken, {
        mode,
        ...payload,
        successUrl,
        cancelUrl,
      });

      if (firstTry.error && isInvalidJwtMessage(firstTry.error)) {
        const refreshed = await ensureFreshAuthSession(120, { forceRefresh: true, verifyOnServer: true });
        if (!refreshed.ok || !refreshed.accessToken) {
          setQuickdrawMessage(refreshed.message || 'Session refresh failed. Please sign in again.');
          return;
        }
        firstTry = await invokeCheckoutWithToken(refreshed.accessToken, {
          mode,
          ...payload,
          successUrl,
          cancelUrl,
        });
      }

      if (firstTry.error) {
        setQuickdrawMessage(firstTry.error);
        return;
      }

      const checkoutUrl = String(firstTry.data?.checkoutUrl || '').trim();
      if (!checkoutUrl) {
        setQuickdrawMessage('Stripe checkout URL was not returned.');
        return;
      }

      await openCheckoutUrl(checkoutUrl);
    } catch (error: unknown) {
      setQuickdrawMessage(String((error as Error)?.message || error));
    } finally {
      setCheckoutLoadingKey(null);
    }
  }

  async function submitClearanceProfile() {
    if (!profile?.id) return;
    setQuickdrawMessage('');
    const earningsCents = Math.max(0, Math.round(Number(sellerEarnings || '0') * 100));
    if (!sellerNiche.trim()) {
      setQuickdrawMessage('Primary niche is required for clearance submission.');
      return;
    }
    const { error } = await (supabase as any).rpc('submit_marketplace_clearance', {
      p_primary_niche: sellerNiche.trim(),
      p_bio: sellerBio.trim(),
      p_proof_url: sellerProofUrl.trim() || null,
      p_verified_earnings_cents: earningsCents,
    });
    if (error) {
      setQuickdrawMessage(error.message || 'Could not submit clearance profile.');
      return;
    }
    setQuickdrawMessage('Clearance submitted. Once approved, you can publish services and games.');
    await reloadMarketplacePanels();
  }

  async function createServiceListing() {
    setQuickdrawMessage('');
    if (!newServiceCategorySlug.trim() || !newServiceTitle.trim()) {
      setQuickdrawMessage('Category and title are required.');
      return;
    }
    const priceCents = Math.round(Number(newServicePriceUsd || '0') * 100);
    const deliveryDays = Math.max(1, Math.round(Number(newServiceDeliveryDays || '3')));
    const { data, error } = await (supabase as any).rpc('create_marketplace_service_listing', {
      p_category_slug: newServiceCategorySlug.trim(),
      p_title: newServiceTitle.trim(),
      p_description: newServiceDescription.trim(),
      p_base_price_cents: priceCents,
      p_delivery_days: deliveryDays,
      p_portfolio_url: newServicePortfolio.trim() || null,
    });
    if (error) {
      setQuickdrawMessage(error.message || 'Could not create service listing.');
      return;
    }

    const listingId = String(data || '').trim();
    setNewServiceTitle('');
    setNewServiceDescription('');
    setNewServicePortfolio('');
    setQuickdrawMessage('Service listing created. Pay listing fee to queue review.');
    await reloadMarketplacePanels();

    if (listingId) {
      await startMarketplaceCheckout('marketplace_service_listing_fee', { serviceListingId: listingId }, `svc-fee:${listingId}`);
    }
  }

  async function createGameListing() {
    setQuickdrawMessage('');
    if (!newGameTitle.trim() || !newGameSlug.trim()) {
      setQuickdrawMessage('Game title and slug are required.');
      return;
    }
    const priceCents = Math.round(Number(newGamePriceUsd || '0') * 100);
    const { data, error } = await (supabase as any).rpc('create_marketplace_game_listing', {
      p_title: newGameTitle.trim(),
      p_slug: newGameSlug.trim().toLowerCase(),
      p_description: newGameDescription.trim(),
      p_price_cents: priceCents,
      p_installer_url: newGameInstallerUrl.trim() || null,
      p_cover_url: newGameCoverUrl.trim() || null,
      p_provenance_type: newGameProvenanceType,
      p_provenance_proof_url: newGameProofUrl.trim() || null,
    });
    if (error) {
      setQuickdrawMessage(error.message || 'Could not create game listing.');
      return;
    }
    const listingId = String(data || '').trim();
    setNewGameTitle('');
    setNewGameSlug('');
    setNewGameDescription('');
    setNewGameInstallerUrl('');
    setNewGameCoverUrl('');
    setNewGameProofUrl('');
    setQuickdrawMessage('Game listing created. Pay publish fee to queue review.');
    await reloadMarketplacePanels();

    if (listingId) {
      await startMarketplaceCheckout('marketplace_game_listing_fee', { gameListingId: listingId }, `game-fee:${listingId}`);
    }
  }

  async function markServiceOrderDelivered(orderId: string) {
    const normalizedOrderId = String(orderId || '').trim();
    if (!normalizedOrderId) return;
    setOrderActionLoadingKey(`svc-deliver:${normalizedOrderId}`);
    setQuickdrawMessage('');
    const { error } = await (supabase as any).rpc('marketplace_mark_service_delivered', {
      p_order_id: normalizedOrderId,
    });
    if (error) {
      setQuickdrawMessage(error.message || 'Could not mark this order as delivered.');
    } else {
      setQuickdrawMessage('Order marked as delivered. Escrow will release automatically after 7 days unless disputed.');
      await reloadMarketplacePanels();
    }
    setOrderActionLoadingKey(null);
  }

  async function releaseServiceOrder(orderId: string) {
    const normalizedOrderId = String(orderId || '').trim();
    if (!normalizedOrderId) return;
    setOrderActionLoadingKey(`svc-release:${normalizedOrderId}`);
    setQuickdrawMessage('');
    const { data, error } = await (supabase as any).rpc('marketplace_release_service_order', {
      p_order_id: normalizedOrderId,
    });
    if (error) {
      setQuickdrawMessage(error.message || 'Could not release escrow right now.');
    } else {
      const result = String(data || 'released').trim();
      setQuickdrawMessage(result === 'released' ? 'Escrow released to seller wallet.' : `Order state: ${result}`);
      await reloadMarketplacePanels();
    }
    setOrderActionLoadingKey(null);
  }

  async function openServiceDispute(orderId: string) {
    const normalizedOrderId = String(orderId || '').trim();
    if (!normalizedOrderId) return;
    const reasonRaw = window.prompt('Enter dispute reason (required):', '');
    const reason = String(reasonRaw || '').trim();
    if (!reason) return;
    const evidenceRaw = window.prompt('Evidence URL (optional):', '');
    const evidence = String(evidenceRaw || '').trim();
    setOrderActionLoadingKey(`svc-dispute:${normalizedOrderId}`);
    setQuickdrawMessage('');
    const { data, error } = await (supabase as any).rpc('marketplace_open_service_dispute', {
      p_order_id: normalizedOrderId,
      p_reason: reason,
      p_evidence_url: evidence || null,
    });
    if (error) {
      setQuickdrawMessage(error.message || 'Could not open dispute.');
    } else {
      setQuickdrawMessage(`Dispute opened successfully (${String(data || '').slice(0, 8)}...).`);
      await reloadMarketplacePanels();
    }
    setOrderActionLoadingKey(null);
  }

  async function startCheckout(params: { sku: string; giftToUsername?: string; marketItem?: StoreProduct | null }) {
    const { sku, giftToUsername, marketItem } = params;
    setBillingActionMessage('');
    setCheckoutLoadingKey(giftToUsername ? `gift:${sku}` : `sku:${sku}`);

    function handleSessionExpired(message?: string) {
      setBillingActionMessage(message || 'Session expired. Please sign out and sign in again, then retry checkout.');
    }

    const successUrl = resolveBillingReturnUrl('/app/marketplace');
    const cancelUrl = resolveBillingReturnUrl('/app/marketplace');
    const requestBody = {
      mode: 'one_time_purchase',
      sku,
      ...(giftToUsername ? { giftToUsername } : {}),
      ...(marketItem
        ? {
            marketItem: {
              sku: marketItem.sku,
              name: marketItem.name,
              description: marketItem.description,
              kind: marketItem.kind,
              priceCents: marketItem.price_cents,
              currency: marketItem.currency,
              grantKey: marketItem.grant_key || marketItem.sku,
              grantPayload: marketItem.grant_payload || {},
            },
          }
        : {}),
      successUrl,
      cancelUrl,
    };

    try {
      const authState = await ensureFreshAuthSession(120, { verifyOnServer: true });
      if (!authState.ok || !authState.accessToken) {
        handleSessionExpired(authState.message);
        return;
      }

      let firstTry = await invokeCheckoutWithToken(authState.accessToken, requestBody);
      if (firstTry.error && !isInvalidJwtMessage(firstTry.error)) {
        setBillingActionMessage(firstTry.error);
        return;
      }

      if (firstTry.error && isInvalidJwtMessage(firstTry.error)) {
        const refreshed = await ensureFreshAuthSession(120, { forceRefresh: true, verifyOnServer: true });
        if (!refreshed.ok || !refreshed.accessToken) {
          handleSessionExpired(refreshed.message || 'Session refresh failed. Please sign in again, then retry checkout.');
          return;
        }
        firstTry = await invokeCheckoutWithToken(refreshed.accessToken, requestBody);
      }

      if (firstTry.error) {
        if (isInvalidJwtMessage(firstTry.error) || firstTry.status === 401) {
          handleSessionExpired(`Checkout auth failed: ${firstTry.error}`);
          return;
        }
        setBillingActionMessage(firstTry.error);
        return;
      }

      const payload = firstTry.data as { checkoutUrl?: string; error?: string };
      if (payload?.error) {
        setBillingActionMessage(payload.error);
        return;
      }

      const checkoutUrl = String(payload?.checkoutUrl || '').trim();
      if (!checkoutUrl) {
        setBillingActionMessage('Stripe checkout URL was not returned for this purchase.');
        return;
      }

      await openCheckoutUrl(checkoutUrl);
    } catch (err: unknown) {
      setBillingActionMessage(String((err as Error)?.message || err));
    } finally {
      setCheckoutLoadingKey(null);
    }
  }

  async function handleBuyStoreProduct(product: StoreProduct) {
    await startCheckout({ sku: product.sku, marketItem: product });
  }

  async function handleGiftStoreProduct(product: StoreProduct) {
    const recipientRaw = window.prompt(`Gift "${product.name}" to which @username?`, '');
    const recipientUsername = String(recipientRaw || '').trim().replace(/^@+/, '');
    if (!recipientUsername) return;
    await startCheckout({
      sku: product.sku,
      giftToUsername: recipientUsername,
      marketItem: product,
    });
  }

  function resetIssueContractDraftComposer() {
    setIssueContractTitle('');
    setIssueContractDescription('');
    setIssueContractDeliverablesText('');
    setIssueContractDurationDays('30');
    setIssueContractBudgetUsd('10');
    setIssueContractTagsText('');
    setIssueContractAcknowledged(false);
  }

  function closeIssueContractModal() {
    setShowIssueContractModal(false);
    resetIssueContractDraftComposer();
  }

  function createQuickdrawContractDraft(status: 'draft' | 'queued') {
    const title = issueContractTitle.trim();
    const description = issueContractDescription.trim();
    if (title.length < 6 || description.length < 20) {
      setQuickdrawMessage('Contract title and description need more detail before deployment.');
      return;
    }

    if (status === 'queued' && !issueContractAcknowledged) {
      setQuickdrawMessage('Acknowledge the fixed-capital warning before queueing this contract.');
      return;
    }

    const budgetUsd = Number(issueContractBudgetUsd || 0);
    if (!Number.isFinite(budgetUsd) || budgetUsd < 10) {
      setQuickdrawMessage('Contract value must be at least $10.');
      return;
    }

    const durationDays = Number(issueContractDurationDays || 0);
    if (!Number.isFinite(durationDays) || durationDays < 1) {
      setQuickdrawMessage('Project duration must be at least 1 day.');
      return;
    }

    const deliverables = issueContractDeliverablesText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 10);
    const tags = issueContractTagsText
      .split(/[,\n]/g)
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 8);

    const nextDraft: QuickdrawContractDraft = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title,
      description,
      deliverables,
      budgetUsd,
      durationDays,
      tags,
      createdAt: new Date().toISOString(),
      status,
    };

    setQuickdrawContractDrafts((prev) => [nextDraft, ...prev].slice(0, 40));
    setQuickdrawMessage(
      status === 'queued'
        ? 'Contract queued for funding handoff. Stripe escrow wiring is next in backend rollout.'
        : 'Contract draft saved. You can queue it from Deploy when ready.',
    );
    setShowIssueContractModal(false);
    resetIssueContractDraftComposer();
  }

  return (
    <AppShell showChannelSidebar={false} title="NCore Marketplace">
      <div className={`h-full overflow-y-auto ${isOpsExperience ? 'ncore-marketplace-ops' : ''}`}>
        <div className={`mx-auto p-6 space-y-6 ${isOpsExperience ? 'max-w-[1320px]' : 'max-w-6xl'}`}>
          <div className="rounded-2xl border border-nyptid-300/25 bg-gradient-to-br from-surface-800/95 via-surface-800/92 to-surface-900/95 p-5">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-nyptid-300/15 border border-nyptid-300/30 flex items-center justify-center flex-shrink-0">
                <ShoppingBag size={20} className="text-nyptid-300" />
              </div>
              <div>
                <h1 className="text-2xl font-black text-surface-100">NCore Marketplace</h1>
                <p className="text-sm text-surface-300 mt-1 max-w-2xl">
                  {activeTrackMeta.summary}
                </p>
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 max-w-3xl">
                  {(['quickdraw', 'games', 'cosmetics'] as MarketplaceTrack[]).map((track) => {
                    const meta = marketplaceTrackMeta[track];
                    const isActive = activeTrack === track;
                    const targetPath = track === 'cosmetics'
                      ? '/app/marketplace'
                      : track === 'quickdraw'
                        ? '/app/marketplace/quickdraw'
                        : '/app/marketplace/games';
                    return (
                      <button
                        key={`track-${track}`}
                        type="button"
                        onClick={() => navigate(targetPath)}
                        className={`rounded-xl border px-3 py-2.5 text-left transition-all ${
                          isActive
                            ? 'border-nyptid-300/45 bg-nyptid-300/15 text-nyptid-100 shadow-glow-sm'
                            : 'border-surface-600 bg-surface-800 text-surface-300 hover:border-surface-500'
                        }`}
                      >
                        <div className="flex items-center gap-2 text-xs font-bold">
                          {track === 'quickdraw' && <Briefcase size={13} className={isActive ? 'text-nyptid-200' : 'text-surface-400'} />}
                          {track === 'games' && <Gamepad2 size={13} className={isActive ? 'text-nyptid-200' : 'text-surface-400'} />}
                          {track === 'cosmetics' && <Wand2 size={13} className={isActive ? 'text-nyptid-200' : 'text-surface-400'} />}
                          <span>{meta.label}</span>
                        </div>
                        <div className={`mt-1 text-[11px] ${isActive ? 'text-nyptid-200/90' : 'text-surface-500'}`}>
                          {meta.count} {meta.countLabel}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {(billingActionMessage || quickdrawMessage || entitlementsLoading || loadingQuickdraw) && (
            <div className={`rounded-xl border px-3 py-2.5 text-sm flex items-start gap-2 ${
              hasMarketplaceErrorBanner
                ? 'border-red-500/40 bg-red-500/10 text-red-200'
                : 'border-nyptid-300/30 bg-nyptid-300/10 text-nyptid-100'
            }`}>
              <Info size={15} className={hasMarketplaceErrorBanner ? 'text-red-300 mt-0.5' : 'text-nyptid-300 mt-0.5'} />
              <div>
                {entitlementsLoading || loadingQuickdraw
                  ? 'Refreshing marketplace data...'
                  : (billingActionMessage || quickdrawMessage)}
              </div>
            </div>
          )}

          {activeTrack === 'cosmetics' && (
          <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_0.8fr] gap-5">
            <div className="nyptid-card p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="font-bold text-surface-100">Available Cosmetics</div>
                  <div className="text-xs text-surface-500">Select an item to preview the effect before checkout.</div>
                </div>
                {loadingStoreProducts && <div className="text-xs text-surface-500">Loading...</div>}
              </div>

              <div className="space-y-2.5">
              {storeProducts.map((product) => {
                const owned = ownedSkus.has(product.sku);
                const loadingForProduct = checkoutLoadingKey === `sku:${product.sku}`;
                const previewMeta = COSMETIC_PREVIEWS[product.sku] || DEFAULT_PREVIEW;
                const isSelected = selectedProduct?.sku === product.sku;

                return (
                  <div
                    key={product.sku}
                    className={`rounded-xl border px-3 py-3 transition-all ${
                      isSelected
                        ? 'border-nyptid-300/45 bg-nyptid-300/10 shadow-glow-sm'
                        : 'border-surface-700/70 bg-surface-800/40 hover:border-surface-600'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => setSelectedSku(product.sku)}
                        className="min-w-0 text-left flex-1"
                      >
                        <div className="font-semibold text-surface-100 truncate">{product.name}</div>
                        <div className="text-xs text-surface-500 mt-0.5 line-clamp-1">{product.description}</div>
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {previewMeta.tags.slice(0, 3).map((tag) => (
                            <span key={`${product.sku}-${tag}`} className="px-2 py-0.5 rounded-md border border-surface-600 bg-surface-800 text-[10px] font-semibold text-surface-300">
                              {tag}
                            </span>
                          ))}
                        </div>
                      </button>
                      <div className="text-sm font-black text-surface-100 flex-shrink-0">
                        {formatUsdFromCents(product.price_cents)}
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-end gap-2">
                      {owned ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border border-green-500/40 bg-green-500/15 text-green-300 text-xs font-semibold">
                          <CheckCircle2 size={12} />
                          Owned
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleBuyStoreProduct(product)}
                          disabled={checkoutLoadingKey !== null}
                          className="nyptid-btn-primary text-xs px-3 py-2"
                        >
                          {loadingForProduct ? 'Opening...' : 'Buy'}
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => handleGiftStoreProduct(product)}
                        disabled={checkoutLoadingKey !== null}
                        className="nyptid-btn-secondary text-xs px-3 py-2"
                      >
                        <Gift size={12} />
                        {checkoutLoadingKey === `gift:${product.sku}` ? 'Opening...' : 'Gift'}
                      </button>
                    </div>
                  </div>
                );
              })}

              {!loadingStoreProducts && storeProducts.length === 0 && (
                <div className="text-sm text-surface-500">No active store items.</div>
              )}
              </div>
            </div>

            <div className="nyptid-card p-4 lg:sticky lg:top-5 h-fit">
              <div className="flex items-center gap-2 mb-3">
                <Wand2 size={15} className="text-nyptid-300" />
                <div className="text-sm font-bold text-surface-100">Cosmetic Preview</div>
              </div>

              {selectedProduct ? (
                <div className="space-y-4">
                  <div className="rounded-xl border border-nyptid-300/20 bg-gradient-to-br from-nyptid-300/15 via-surface-900 to-surface-900 p-3">
                    <div className="text-sm font-black text-surface-100">{selectedPreview.headline}</div>
                    <div className="text-xs text-surface-400 mt-1">{selectedPreview.summary}</div>
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {selectedPreview.tags.map((tag) => (
                        <span key={`preview-tag-${tag}`} className="px-2 py-0.5 rounded-md text-[10px] border border-nyptid-300/30 bg-nyptid-300/10 text-nyptid-200 font-semibold">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-xl border border-surface-700 bg-surface-900/80 p-3">
                    <div className="text-[11px] font-bold uppercase tracking-wide text-surface-500 mb-2">Visual Sample</div>
                    <div className="rounded-xl border border-surface-700 bg-surface-800/70 p-3">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-nyptid-300 via-nyptid-500 to-nyptid-700 p-[2px]">
                          <div className="w-full h-full rounded-full bg-surface-950 flex items-center justify-center text-surface-100 font-bold text-sm">
                            N
                          </div>
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-bold text-gradient truncate">NCore Elite</div>
                          <div className="text-[11px] text-surface-500">Cosmetic preview representation</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-surface-700 bg-surface-900/80 p-3">
                    <div className="text-[11px] font-bold uppercase tracking-wide text-surface-500 mb-2">What You Get</div>
                    <ul className="space-y-2">
                      {selectedPreview.effects.map((effect) => (
                        <li key={`${selectedProduct.sku}-${effect}`} className="text-xs text-surface-300 flex items-start gap-2">
                          <Sparkles size={12} className="text-nyptid-300 mt-0.5 flex-shrink-0" />
                          <span>{effect}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-surface-500">Select a cosmetic to preview it.</div>
              )}
            </div>
          </div>
          )}

                    {activeTrack === 'quickdraw' && (
            <div className="grid grid-cols-1 xl:grid-cols-[260px_1fr] gap-5">
              <aside className="nyptid-card p-4 h-fit xl:sticky xl:top-5 space-y-4">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-surface-400 mb-2">Quickdraw Command</div>
                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={() => setQuickdrawRoleView('specialist')}
                      className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                        quickdrawRoleView === 'specialist'
                          ? 'border-nyptid-300/45 bg-nyptid-300/10 text-nyptid-100'
                          : 'border-surface-700 bg-surface-900/60 text-surface-300 hover:border-surface-600'
                      }`}
                    >
                      <div className="font-semibold">Find Contracts</div>
                      <div className="text-[11px] text-surface-500 mt-0.5">Being hired view</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setQuickdrawRoleView('hiring')}
                      className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                        quickdrawRoleView === 'hiring'
                          ? 'border-nyptid-300/45 bg-nyptid-300/10 text-nyptid-100'
                          : 'border-surface-700 bg-surface-900/60 text-surface-300 hover:border-surface-600'
                      }`}
                    >
                      <div className="font-semibold">Deploy</div>
                      <div className="text-[11px] text-surface-500 mt-0.5">Hiring view</div>
                    </button>
                  </div>
                </div>

                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-surface-400 mb-2">
                    {quickdrawRoleView === 'hiring' ? 'Deploy Terminal' : 'Specialist Console'}
                  </div>
                  <div className="space-y-1.5">
                    {quickdrawNavItems.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setQuickdrawNavId(item.id)}
                        className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                          quickdrawNavId === item.id
                            ? 'border-nyptid-300/35 bg-nyptid-300/10 text-nyptid-100'
                            : 'border-surface-700 bg-surface-900/60 text-surface-300 hover:border-surface-600'
                        }`}
                      >
                        <div className="font-semibold">{item.label}</div>
                        <div className="text-[11px] text-surface-500 mt-0.5">{item.subtitle}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-surface-400 mb-2">Briefings</div>
                  <div className="space-y-2">
                    <button type="button" onClick={() => setQuickdrawBriefingId('terms')} className="w-full rounded-lg border border-surface-700 bg-surface-900/70 px-3 py-2 text-left text-sm text-surface-200 hover:border-surface-600 transition-colors">
                      <div className="flex items-center gap-2"><FileText size={14} className="text-nyptid-300" />Terms of Engagement</div>
                    </button>
                    <button type="button" onClick={() => setQuickdrawBriefingId('tier2')} className="w-full rounded-lg border border-surface-700 bg-surface-900/70 px-3 py-2 text-left text-sm text-surface-200 hover:border-surface-600 transition-colors">
                      <div className="flex items-center gap-2"><BadgeCheck size={14} className="text-nyptid-300" />Tier II Clearance</div>
                    </button>
                    <button type="button" onClick={() => setQuickdrawBriefingId('protocols')} className="w-full rounded-lg border border-surface-700 bg-surface-900/70 px-3 py-2 text-left text-sm text-surface-200 hover:border-surface-600 transition-colors">
                      <div className="flex items-center gap-2"><BookOpen size={14} className="text-nyptid-300" />Operational Protocols</div>
                    </button>
                  </div>
                </div>

                <div className="rounded-lg border border-surface-700 bg-surface-900/70 px-3 py-2.5 text-xs">
                  <div className="text-surface-500">Clearance status</div>
                  <div className="text-sm font-semibold text-surface-100 mt-1">{sellerProfile?.clearance_status || 'pending'}</div>
                  <div className="text-surface-500 mt-2">Level</div>
                  <div className="text-sm font-semibold text-surface-100 mt-1">{sellerProfile?.clearance_level || 'none'}</div>
                </div>
              </aside>

              <div className="space-y-5">
                <div className="nyptid-card p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-lg font-black text-surface-100">{activeQuickdrawNav?.label || 'Contract Grid'}</div>
                      <div className="text-sm text-surface-500">
                        {quickdrawRoleView === 'hiring'
                          ? (quickdrawNavId === 'listed_contracts'
                            ? 'Track your drafted and staged contracts before they move into escrow.'
                            : quickdrawNavId === 'working_contracts'
                              ? 'Monitor active escrow-backed orders currently in execution.'
                              : quickdrawNavId === 'escrow_history'
                                ? 'Review historical orders, releases, and closed disputes.'
                                : 'Browse specialist contracts and issue escrow-backed hires.')
                          : (quickdrawNavId === 'contract_radar'
                            ? 'Live specialist demand radar with newest contracts and category momentum.'
                            : quickdrawNavId === 'escrow_history'
                              ? 'Review your completed deliveries and settlement outcomes.'
                              : 'Manage your specialist profile, listings, and active contract flow.')}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {quickdrawRoleView === 'hiring' && (quickdrawNavId === 'my_contracts' || quickdrawNavId === 'listed_contracts') && (
                        <button
                          type="button"
                          onClick={() => setShowIssueContractModal(true)}
                          className="nyptid-btn-primary text-xs px-3 py-2"
                        >
                          <Plus size={13} />
                          Issue New Contract
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => { void reloadMarketplacePanels(); }}
                        className="nyptid-btn-secondary text-xs px-3 py-2"
                      >
                        Refresh
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2 rounded-lg border border-surface-700 bg-surface-900/70 px-3 py-2">
                    <Search size={14} className="text-surface-500" />
                    <input
                      value={quickdrawSearch}
                      onChange={(event) => setQuickdrawSearch(event.target.value)}
                      placeholder={
                        quickdrawNavId === 'contract_radar'
                          ? 'Scan radar by category, contract type, specialist...'
                          : quickdrawNavId === 'listed_contracts'
                            ? 'Search your listed contracts and drafts...'
                            : 'Search contracts, categories, specialists...'
                      }
                      className="w-full bg-transparent border-0 outline-none text-sm text-surface-200 placeholder:text-surface-600"
                    />
                  </div>
                  {quickdrawRoleView === 'hiring' && (quickdrawNavId === 'my_contracts' || quickdrawNavId === 'listed_contracts') && (
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div className="rounded-lg border border-surface-700 bg-surface-900/70 px-3 py-2">
                        <div className="text-[10px] uppercase tracking-wide text-surface-500">Contracts Tracked</div>
                        <div className="mt-1 text-xl font-black text-surface-100">{hiringContractDrafts.length + queuedContractDrafts.length}</div>
                      </div>
                      <div className="rounded-lg border border-surface-700 bg-surface-900/70 px-3 py-2">
                        <div className="text-[10px] uppercase tracking-wide text-surface-500">Drafted Contracts</div>
                        <div className="mt-1 text-xl font-black text-surface-100">{hiringContractDrafts.length}</div>
                      </div>
                      <div className="rounded-lg border border-surface-700 bg-surface-900/70 px-3 py-2">
                        <div className="text-[10px] uppercase tracking-wide text-surface-500">Queued for Funding</div>
                        <div className="mt-1 text-xl font-black text-surface-100">{queuedContractDrafts.length}</div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  {visibleServiceListings.map((listing) => {
                    const loadingKey = `svc-buy:${listing.id}`;
                    const sellerLabel = listing.seller_profile?.display_name || listing.seller_profile?.username || 'Verified specialist';
                    return (
                      <div key={listing.id} className="nyptid-card p-4">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="text-lg font-bold text-surface-100">{listing.title}</div>
                            <div className="text-sm text-surface-300 mt-2 line-clamp-3">
                              {listing.description || 'No description yet.'}
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                              <span className="px-2 py-0.5 rounded-md border border-surface-600 bg-surface-900/70 text-surface-300">{listing.category?.name || 'Service'}</span>
                              <span className="px-2 py-0.5 rounded-md border border-surface-600 bg-surface-900/70 text-surface-300">{sellerLabel}</span>
                              <span className="px-2 py-0.5 rounded-md border border-surface-600 bg-surface-900/70 text-surface-300">{listing.delivery_days} day delivery</span>
                            </div>
                          </div>
                          <div className="text-right min-w-[170px]">
                            <div className="text-xl font-black text-surface-100">{formatUsdFromCents(listing.base_price_cents)}</div>
                            <div className="text-xs text-surface-500 mt-1">Escrow-backed</div>
                            <div className="mt-3 flex items-center justify-end gap-2">
                              <button type="button" className="nyptid-btn-secondary text-xs px-3 py-2">
                                View Details
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  void startMarketplaceCheckout(
                                    'marketplace_service_order',
                                    { serviceListingId: listing.id },
                                    loadingKey,
                                  );
                                }}
                                disabled={checkoutLoadingKey !== null}
                                className="nyptid-btn-primary text-xs px-3 py-2"
                              >
                                {checkoutLoadingKey === loadingKey ? 'Opening...' : (quickdrawRoleView === 'hiring' ? 'Hire' : 'Bid')}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {!loadingQuickdraw && visibleServiceListings.length === 0 && (
                    <div className="nyptid-card p-4 text-sm text-surface-500">
                      {quickdrawNavId === 'listed_contracts'
                        ? 'No listed contracts found yet. Use Issue New Contract to stage your first contract.'
                        : quickdrawNavId === 'working_contracts'
                          ? 'No active contracts in execution right now.'
                          : quickdrawNavId === 'escrow_history'
                            ? 'No historical settlements yet.'
                            : 'No approved Quickdraw listings found for this filter.'}
                    </div>
                  )}
                </div>

                {quickdrawRoleView === 'hiring' && (quickdrawNavId === 'my_contracts' || quickdrawNavId === 'listed_contracts') && (
                  <div className="nyptid-card p-4">
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <div>
                        <div className="font-bold text-surface-100">Deploy Queue</div>
                        <div className="text-xs text-surface-500">Draft and staged contracts before escrow funding starts.</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowIssueContractModal(true)}
                        className="nyptid-btn-secondary text-xs px-3 py-2"
                      >
                        <Plus size={13} />
                        New Draft
                      </button>
                    </div>
                    <div className="space-y-2">
                      {quickdrawContractDrafts.slice(0, 6).map((draft) => (
                        <div key={draft.id} className="rounded-lg border border-surface-700 bg-surface-900/70 px-3 py-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-sm font-semibold text-surface-100 truncate">{draft.title}</div>
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                              draft.status === 'queued'
                                ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                                : 'border-surface-600 bg-surface-800 text-surface-300'
                            }`}>
                              {draft.status === 'queued' ? 'QUEUED' : 'DRAFT'}
                            </span>
                          </div>
                          <div className="mt-1 text-[11px] text-surface-500 flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className="inline-flex items-center gap-1"><Wallet size={11} />${draft.budgetUsd.toLocaleString()} funded cap</span>
                            <span className="inline-flex items-center gap-1"><Clock3 size={11} />{draft.durationDays} days</span>
                            <span>{new Date(draft.createdAt).toLocaleString()}</span>
                          </div>
                        </div>
                      ))}
                      {quickdrawContractDrafts.length === 0 && (
                        <div className="rounded-lg border border-dashed border-surface-700 bg-surface-900/50 px-3 py-4 text-sm text-surface-500">
                          No contract drafts yet. Click <span className="text-surface-300 font-semibold">Issue New Contract</span> to open the deploy composer.
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {quickdrawNavId === 'working_contracts' && (
                  <div className="nyptid-card p-4">
                    <div className="font-bold text-surface-100 mb-2">Working Contracts</div>
                    <div className="space-y-2">
                      {activeServiceOrdersForRole.slice(0, 10).map((order) => (
                        <div key={order.id} className="rounded-lg border border-surface-700 bg-surface-900/60 p-2.5">
                          <div className="text-sm font-semibold text-surface-100">{order.listing?.title || 'Service Order'}</div>
                          <div className="text-[11px] text-surface-500 mt-1">
                            {formatUsdFromCents(order.amount_cents)} - {String(order.status || 'unknown')} - Escrow due {formatDateTime(order.escrow_release_due_at)}
                          </div>
                        </div>
                      ))}
                      {activeServiceOrdersForRole.length === 0 && (
                        <div className="text-xs text-surface-500">No active contracts right now.</div>
                      )}
                    </div>
                  </div>
                )}

                {quickdrawNavId === 'escrow_history' && (
                  <div className="nyptid-card p-4">
                    <div className="font-bold text-surface-100 mb-2">Escrow History</div>
                    <div className="space-y-2">
                      {historicalServiceOrdersForRole.slice(0, 12).map((order) => (
                        <div key={order.id} className="rounded-lg border border-surface-700 bg-surface-900/60 p-2.5">
                          <div className="text-sm font-semibold text-surface-100">{order.listing?.title || 'Service Order'}</div>
                          <div className="text-[11px] text-surface-500 mt-1">
                            {formatUsdFromCents(order.amount_cents)} - {String(order.status || 'unknown')} - Updated {formatDateTime(order.updated_at)}
                          </div>
                        </div>
                      ))}
                      {historicalServiceOrdersForRole.length === 0 && (
                        <div className="text-xs text-surface-500">No closed settlements yet.</div>
                      )}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                  <div className="nyptid-card p-4">
                    <div className="font-bold text-surface-100 flex items-center gap-2 mb-2">
                      <Wallet size={16} className="text-nyptid-300" />
                      NCore Wallet Snapshot
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-lg border border-surface-700 bg-surface-800/60 p-2.5">
                        <div className="text-surface-500">Available</div>
                        <div className="text-sm font-black text-surface-100 mt-1">{formatUsdFromCents(walletAccount?.available_balance_cents || 0)}</div>
                      </div>
                      <div className="rounded-lg border border-surface-700 bg-surface-800/60 p-2.5">
                        <div className="text-surface-500">Pending</div>
                        <div className="text-sm font-black text-surface-100 mt-1">{formatUsdFromCents(walletAccount?.pending_balance_cents || 0)}</div>
                      </div>
                    </div>
                  </div>

                  <div className="nyptid-card p-4">
                    <div className="font-bold text-surface-100 mb-2">My Service Orders</div>
                    <div className="space-y-2">
                      {[...myServiceOrdersAsBuyer, ...myServiceOrdersAsSeller]
                        .sort((a, b) => Date.parse(String(b.created_at || '')) - Date.parse(String(a.created_at || '')))
                        .slice(0, 6)
                        .map((order) => {
                          const orderId = String(order.id);
                          const isSeller = String(order.seller_id) === String(profile?.id || '');
                          const dispute = serviceDisputeByOrderId.get(orderId);
                          const loadingDeliver = orderActionLoadingKey === `svc-deliver:${orderId}`;
                          const loadingRelease = orderActionLoadingKey === `svc-release:${orderId}`;
                          const loadingDispute = orderActionLoadingKey === `svc-dispute:${orderId}`;
                          const canMarkDelivered = isSeller && ['funded', 'in_progress'].includes(String(order.status || '').toLowerCase());
                          const canRelease = ['funded', 'in_progress', 'delivered'].includes(String(order.status || '').toLowerCase());
                          const canDispute = ['funded', 'in_progress', 'delivered'].includes(String(order.status || '').toLowerCase()) && !dispute;
                          return (
                            <div key={orderId} className="rounded-lg border border-surface-700 bg-surface-900/60 p-2.5 space-y-2">
                              <div className="text-sm font-semibold text-surface-100 truncate">{order.listing?.title || 'Service Order'}</div>
                              <div className="text-[11px] text-surface-500">{formatUsdFromCents(order.amount_cents)} - {String(order.status || 'unknown')}</div>
                              <div className="text-[11px] text-surface-500">Escrow due: {formatDateTime(order.escrow_release_due_at)}</div>
                              <div className="flex flex-wrap gap-1.5">
                                {canMarkDelivered && (
                                  <button
                                    type="button"
                                    onClick={() => { void markServiceOrderDelivered(orderId); }}
                                    disabled={orderActionLoadingKey !== null}
                                    className="nyptid-btn-secondary text-[11px] px-2 py-1"
                                  >
                                    {loadingDeliver ? 'Saving...' : 'Mark Delivered'}
                                  </button>
                                )}
                                {canRelease && (
                                  <button
                                    type="button"
                                    onClick={() => { void releaseServiceOrder(orderId); }}
                                    disabled={orderActionLoadingKey !== null}
                                    className="nyptid-btn-primary text-[11px] px-2 py-1"
                                  >
                                    {loadingRelease ? 'Releasing...' : 'Release Escrow'}
                                  </button>
                                )}
                                {canDispute && (
                                  <button
                                    type="button"
                                    onClick={() => { void openServiceDispute(orderId); }}
                                    disabled={orderActionLoadingKey !== null}
                                    className="nyptid-btn-ghost text-[11px] px-2 py-1 text-amber-300 hover:bg-amber-500/10"
                                  >
                                    {loadingDispute ? 'Opening...' : 'Open Dispute'}
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      {[...myServiceOrdersAsBuyer, ...myServiceOrdersAsSeller].length === 0 && (
                        <div className="text-xs text-surface-500">No service orders yet.</div>
                      )}
                    </div>
                  </div>
                </div>

                {quickdrawRoleView === 'specialist' && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                    <div className="nyptid-card p-4 space-y-3">
                      <div className="font-bold text-surface-100 flex items-center gap-2">
                        <BadgeCheck size={16} className="text-nyptid-300" />
                        Specialist Clearance
                      </div>
                      <div className="rounded-lg border border-surface-700 bg-surface-900/70 px-3 py-2 text-xs text-surface-300">
                        <div>Status: <span className="font-semibold text-surface-100">{sellerProfile?.clearance_status || 'pending'}</span></div>
                        <div>Level: <span className="font-semibold text-surface-100">{sellerProfile?.clearance_level || 'none'}</span></div>
                        <div>Quickdraw enabled: <span className="font-semibold text-surface-100">{sellerProfile?.quickdraw_enabled ? 'Yes' : 'Not yet'}</span></div>
                      </div>
                      <input
                        type="text"
                        value={sellerNiche}
                        onChange={(event) => setSellerNiche(event.target.value)}
                        className="nyptid-input text-sm"
                        placeholder="Primary niche (e.g. Video Editing)"
                      />
                      <input
                        type="text"
                        value={sellerProofUrl}
                        onChange={(event) => setSellerProofUrl(event.target.value)}
                        className="nyptid-input text-sm"
                        placeholder="Proof URL (payments/portfolio)"
                      />
                      <input
                        type="number"
                        min={0}
                        step={10}
                        value={sellerEarnings}
                        onChange={(event) => setSellerEarnings(event.target.value)}
                        className="nyptid-input text-sm"
                        placeholder="Verified earnings USD (e.g. 1000)"
                      />
                      <textarea
                        value={sellerBio}
                        onChange={(event) => setSellerBio(event.target.value)}
                        className="nyptid-input text-sm resize-none"
                        rows={3}
                        placeholder="Short seller bio"
                      />
                      <button type="button" onClick={() => { void submitClearanceProfile(); }} className="nyptid-btn-primary w-full text-sm">
                        Submit / Update Clearance
                      </button>
                    </div>

                    <div className="space-y-5">
                      <div className="nyptid-card p-4 space-y-3">
                        <div className="font-bold text-surface-100">Create Service Listing</div>
                        <select
                          value={newServiceCategorySlug}
                          onChange={(event) => setNewServiceCategorySlug(event.target.value)}
                          className="nyptid-input text-sm"
                        >
                          {serviceCategories.map((category) => (
                            <option key={category.id} value={category.slug}>
                              {category.name} ({formatUsdWholeFromCents(category.listing_fee_min_cents)} - {formatUsdWholeFromCents(category.listing_fee_max_cents)} vetting fee)
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          value={newServiceTitle}
                          onChange={(event) => setNewServiceTitle(event.target.value)}
                          className="nyptid-input text-sm"
                          placeholder="Service title"
                        />
                        <textarea
                          value={newServiceDescription}
                          onChange={(event) => setNewServiceDescription(event.target.value)}
                          className="nyptid-input text-sm resize-none"
                          rows={3}
                          placeholder="What do you deliver?"
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            type="number"
                            min={1}
                            step={1}
                            value={newServicePriceUsd}
                            onChange={(event) => setNewServicePriceUsd(event.target.value)}
                            className="nyptid-input text-sm"
                            placeholder="Price USD"
                          />
                          <input
                            type="number"
                            min={1}
                            step={1}
                            value={newServiceDeliveryDays}
                            onChange={(event) => setNewServiceDeliveryDays(event.target.value)}
                            className="nyptid-input text-sm"
                            placeholder="Delivery days"
                          />
                        </div>
                        <input
                          type="text"
                          value={newServicePortfolio}
                          onChange={(event) => setNewServicePortfolio(event.target.value)}
                          className="nyptid-input text-sm"
                          placeholder="Portfolio URL (optional)"
                        />
                        <button
                          type="button"
                          onClick={() => { void createServiceListing(); }}
                          className="nyptid-btn-primary w-full text-sm"
                          disabled={!sellerProfile || sellerProfile.clearance_status !== 'approved' || !['level_ii', 'level_iii'].includes(String(sellerProfile.clearance_level))}
                        >
                          Create Listing + Pay Vetting Fee
                        </button>
                        {(!sellerProfile || sellerProfile.clearance_status !== 'approved' || !['level_ii', 'level_iii'].includes(String(sellerProfile.clearance_level))) && (
                          <div className="text-[11px] text-amber-300/90 flex items-start gap-1.5">
                            <AlertTriangle size={12} className="mt-0.5" />
                            Level II approved clearance is required before publishing service listings.
                          </div>
                        )}
                      </div>

                      <div className="nyptid-card p-4">
                        <div className="font-bold text-surface-100 mb-2">My Service Listings</div>
                        <div className="space-y-2">
                          {myServiceListings.slice(0, 6).map((listing) => {
                            const feeKey = `svc-fee:${listing.id}`;
                            return (
                              <div key={listing.id} className="rounded-lg border border-surface-700 bg-surface-900/60 p-2.5">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="text-sm font-semibold text-surface-100 truncate">{listing.title}</div>
                                    <div className="text-[11px] text-surface-500">{listing.status} - fee {formatUsdFromCents(listing.listing_fee_cents)}</div>
                                  </div>
                                  {!listing.listing_fee_paid && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        void startMarketplaceCheckout(
                                          'marketplace_service_listing_fee',
                                          { serviceListingId: listing.id },
                                          feeKey,
                                        );
                                      }}
                                      disabled={checkoutLoadingKey !== null}
                                      className="nyptid-btn-secondary text-xs px-2 py-1"
                                    >
                                      {checkoutLoadingKey === feeKey ? 'Opening...' : 'Pay Fee'}
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                          {myServiceListings.length === 0 && <div className="text-xs text-surface-500">No service listings yet.</div>}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="nyptid-card p-4">
                  <div className="font-bold text-surface-100 mb-2">Disputes</div>
                  <div className="space-y-2">
                    {serviceDisputes.slice(0, 8).map((dispute) => (
                      <div key={dispute.id} className="rounded-lg border border-surface-700 bg-surface-900/60 p-2.5">
                        <div className="text-sm font-semibold text-surface-100">
                          {dispute.order?.listing?.title || 'Service dispute'}
                        </div>
                        <div className="text-[11px] text-surface-500 mt-0.5">
                          {String(dispute.status || 'open')} - Opened {formatDateTime(dispute.created_at)}
                        </div>
                        <div className="text-[11px] text-surface-300 mt-1 line-clamp-2">{dispute.reason}</div>
                      </div>
                    ))}
                    {serviceDisputes.length === 0 && <div className="text-xs text-surface-500">No disputes on your orders.</div>}
                  </div>
                </div>
              </div>
            </div>
          )}

                    {activeTrack === 'games' && (
            <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-5">
              <div className="space-y-5">
                <div className="nyptid-card p-5 overflow-hidden">
                  <div className="text-xs font-bold uppercase tracking-wider text-surface-500">NCore Marketplace - Games</div>
                  <div className="mt-1 text-2xl font-black text-surface-100">Storefront + library delivery</div>
                  <div className="text-sm text-surface-400 mt-2 max-w-3xl">
                    Steam-style browsing surface with featured capsules, publisher cards, and direct installer delivery from purchase history.
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {[
                      { id: 'store' as GameStoreSection, label: 'Store' },
                      { id: 'new_trending' as GameStoreSection, label: 'New & Trending' },
                      { id: 'top_sellers' as GameStoreSection, label: 'Top Sellers' },
                      { id: 'recently_updated' as GameStoreSection, label: 'Recently Updated' },
                      { id: 'library' as GameStoreSection, label: 'Your Library' },
                    ].map((chip) => (
                      <button
                        key={chip.id}
                        type="button"
                        onClick={() => setGameStoreSection(chip.id)}
                        className={`px-2.5 py-1 rounded-full text-[11px] border transition-colors ${
                          gameStoreSection === chip.id
                            ? 'border-nyptid-300/40 bg-nyptid-300/15 text-nyptid-100'
                            : 'border-surface-700 bg-surface-900/70 text-surface-300 hover:border-surface-600'
                        }`}
                      >
                        {chip.label}
                      </button>
                    ))}
                  </div>
                  <div className="mt-4 flex items-center gap-2 rounded-lg border border-surface-700 bg-surface-900/70 px-3 py-2">
                    <Search size={14} className="text-surface-500" />
                    <input
                      value={gamesSearch}
                      onChange={(event) => setGamesSearch(event.target.value)}
                      placeholder="Search games, publishers, or slugs..."
                      className="w-full bg-transparent border-0 outline-none text-sm text-surface-200 placeholder:text-surface-600"
                    />
                  </div>

                  {featuredGameListing && (
                    <div className="mt-4 rounded-xl border border-surface-700 bg-surface-900/70 overflow-hidden">
                      <div
                        className="h-48 bg-cover bg-center"
                        style={{
                          backgroundImage: featuredGameListing.cover_url
                            ? `linear-gradient(140deg, rgba(4,10,22,0.55), rgba(4,10,22,0.85)), url(${featuredGameListing.cover_url})`
                            : 'linear-gradient(135deg, rgba(24,70,141,0.5), rgba(11,33,69,0.8))',
                        }}
                      />
                      <div className="p-4">
                        <div className="text-xs uppercase tracking-wide text-nyptid-200 font-bold">Featured</div>
                        <div className="text-lg font-bold text-surface-100 mt-1">{featuredGameListing.title}</div>
                        <div className="text-sm text-surface-400 mt-1 line-clamp-2">{featuredGameListing.description || 'No description yet.'}</div>
                        <div className="mt-3 flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded-md border border-surface-600 bg-surface-900/70 text-[11px] text-surface-300">
                            {featuredGameListing.provenance_type === 'steam_authorized' ? 'Steam Authorized' : 'Self Developed'}
                          </span>
                          <span className="px-2 py-0.5 rounded-md border border-surface-600 bg-surface-900/70 text-[11px] text-surface-300">
                            {featuredGameListing.seller_profile?.display_name || featuredGameListing.seller_profile?.username || 'Game publisher'}
                          </span>
                          <span className="ml-auto text-xl font-black text-surface-100">{formatUsdFromCents(featuredGameListing.price_cents)}</span>
                        </div>
                        <div className="mt-3">
                          <button
                            type="button"
                            onClick={() => {
                              void startMarketplaceCheckout(
                                'marketplace_game_purchase',
                                { gameListingId: featuredGameListing.id },
                                `game-buy:${featuredGameListing.id}`,
                              );
                            }}
                            disabled={checkoutLoadingKey !== null}
                            className="nyptid-btn-primary text-xs px-3 py-2"
                          >
                            {checkoutLoadingKey === `game-buy:${featuredGameListing.id}` ? 'Opening...' : 'Play Now'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  {filteredGameListings.map((game) => {
                    const loadingKey = `game-buy:${game.id}`;
                    const sellerLabel = game.seller_profile?.display_name || game.seller_profile?.username || 'Game publisher';
                    return (
                      <div key={game.id} className="nyptid-card p-4 hover:border-nyptid-300/40 transition-colors">
                        <div className="flex flex-wrap items-start gap-4">
                          <div
                            className="h-24 w-44 rounded-lg border border-surface-700 bg-surface-900/70 bg-cover bg-center flex-shrink-0"
                            style={{ backgroundImage: game.cover_url ? `url(${game.cover_url})` : undefined }}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="text-lg font-bold text-surface-100">{game.title}</div>
                            <div className="text-sm text-surface-400 mt-1 line-clamp-2">{game.description || 'No description yet.'}</div>
                            <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                              <span className="px-2 py-0.5 rounded-md border border-surface-600 bg-surface-900/70 text-surface-300">{sellerLabel}</span>
                              <span className="px-2 py-0.5 rounded-md border border-surface-600 bg-surface-900/70 text-surface-300">{game.provenance_type === 'steam_authorized' ? 'Steam Authorized' : 'Self Developed'}</span>
                              <span className="px-2 py-0.5 rounded-md border border-surface-600 bg-surface-900/70 text-surface-300">Store slug: {game.slug}</span>
                            </div>
                          </div>
                          <div className="text-right min-w-[180px]">
                            <div className="text-xl font-black text-surface-100">{formatUsdFromCents(game.price_cents)}</div>
                            <div className="mt-3 flex items-center justify-end gap-2">
                              <button type="button" className="nyptid-btn-secondary text-xs px-3 py-2">View Store Page</button>
                              <button
                                type="button"
                                onClick={() => {
                                  void startMarketplaceCheckout(
                                    'marketplace_game_purchase',
                                    { gameListingId: game.id },
                                    loadingKey,
                                  );
                                }}
                                disabled={checkoutLoadingKey !== null}
                                className="nyptid-btn-primary text-xs px-3 py-2"
                              >
                                {checkoutLoadingKey === loadingKey ? 'Opening...' : 'Buy Game'}
                              </button>
                            </div>
                            {game.installer_url && (
                              <a
                                href={game.installer_url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-[11px] text-nyptid-200 mt-2 hover:text-nyptid-100"
                              >
                                <ExternalLink size={12} />Installer URL
                              </a>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {!loadingQuickdraw && filteredGameListings.length === 0 && (
                    <div className="nyptid-card p-4 text-sm text-surface-500">
                      {gameStoreSection === 'library'
                        ? 'No purchases in your library yet. Buy a game to unlock direct installer access here.'
                        : 'No approved game listings found for this filter.'}
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-5">
                <div className="nyptid-card p-4 space-y-3">
                  <div className="font-bold text-surface-100">Publish Game Listing</div>
                  <div className="text-xs text-surface-500">
                    Pay a one-time $100 publish fee, then listing enters review. On each sale, publisher receives 96% net.
                  </div>
                  <input
                    type="text"
                    value={newGameTitle}
                    onChange={(event) => setNewGameTitle(event.target.value)}
                    className="nyptid-input text-sm"
                    placeholder="Game title"
                  />
                  <input
                    type="text"
                    value={newGameSlug}
                    onChange={(event) => setNewGameSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-'))}
                    className="nyptid-input text-sm"
                    placeholder="game-slug"
                  />
                  <textarea
                    value={newGameDescription}
                    onChange={(event) => setNewGameDescription(event.target.value)}
                    className="nyptid-input text-sm resize-none"
                    rows={3}
                    placeholder="Game description"
                  />
                  <input
                    type="number"
                    min={1}
                    step={0.01}
                    value={newGamePriceUsd}
                    onChange={(event) => setNewGamePriceUsd(event.target.value)}
                    className="nyptid-input text-sm"
                    placeholder="Game price USD"
                  />
                  <input
                    type="text"
                    value={newGameInstallerUrl}
                    onChange={(event) => setNewGameInstallerUrl(event.target.value)}
                    className="nyptid-input text-sm"
                    placeholder="Installer URL (.exe/.zip)"
                  />
                  <input
                    type="text"
                    value={newGameCoverUrl}
                    onChange={(event) => setNewGameCoverUrl(event.target.value)}
                    className="nyptid-input text-sm"
                    placeholder="Cover image URL (optional)"
                  />
                  <select
                    value={newGameProvenanceType}
                    onChange={(event) => setNewGameProvenanceType(event.target.value === 'steam_authorized' ? 'steam_authorized' : 'self_developed')}
                    className="nyptid-input text-sm"
                  >
                    <option value="self_developed">Self Developed</option>
                    <option value="steam_authorized">Steam Authorized</option>
                  </select>
                  <input
                    type="text"
                    value={newGameProofUrl}
                    onChange={(event) => setNewGameProofUrl(event.target.value)}
                    className="nyptid-input text-sm"
                    placeholder="Provenance proof URL"
                  />
                  <button
                    type="button"
                    onClick={() => { void createGameListing(); }}
                    className="nyptid-btn-primary w-full text-sm"
                    disabled={!sellerProfile || sellerProfile.clearance_status !== 'approved' || !sellerProfile.can_publish_games}
                  >
                    Create Game Listing + Pay $100 Fee
                  </button>
                  {(!sellerProfile || sellerProfile.clearance_status !== 'approved' || !sellerProfile.can_publish_games) && (
                    <div className="text-[11px] text-amber-300/90 flex items-start gap-1.5">
                      <AlertTriangle size={12} className="mt-0.5" />
                      Game publishing requires approved clearance and game publishing access.
                    </div>
                  )}
                </div>

                <div className="nyptid-card p-4">
                  <div className="font-bold text-surface-100 mb-2">My Game Listings</div>
                  <div className="space-y-2">
                    {myGameListings.slice(0, 6).map((game) => {
                            const feeKey = `game-fee:${game.id}`;
                      return (
                        <div key={game.id} className="rounded-lg border border-surface-700 bg-surface-900/60 p-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-surface-100 truncate">{game.title}</div>
                              <div className="text-[11px] text-surface-500">
                                {game.status} - fee {formatUsdFromCents(game.listing_fee_cents)} - platform fee {(game.platform_fee_bps / 100).toFixed(2)}%
                              </div>
                            </div>
                            {!game.listing_fee_paid && (
                              <button
                                type="button"
                                onClick={() => {
                                  void startMarketplaceCheckout(
                                    'marketplace_game_listing_fee',
                                    { gameListingId: game.id },
                                    feeKey,
                                  );
                                }}
                                disabled={checkoutLoadingKey !== null}
                                className="nyptid-btn-secondary text-xs px-2 py-1"
                              >
                                {checkoutLoadingKey === feeKey ? 'Opening...' : 'Pay Fee'}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {myGameListings.length === 0 && <div className="text-xs text-surface-500">No game listings yet.</div>}
                  </div>
                </div>

                <div className="nyptid-card p-4">
                  <div className="font-bold text-surface-100 mb-2">My Game Purchases</div>
                  <div className="space-y-2">
                    {myGameOrdersAsBuyer.slice(0, 10).map((order) => (
                      <div key={order.id} className="rounded-lg border border-surface-700 bg-surface-900/60 p-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-surface-100 truncate">
                              {order.game?.title || 'Game Purchase'}
                            </div>
                            <div className="text-[11px] text-surface-500 mt-0.5">
                              {formatUsdFromCents(order.amount_cents)} - {String(order.status || 'pending_payment')}
                            </div>
                            <div className="text-[11px] text-surface-500 mt-0.5">
                              Ordered: {formatDateTime(order.created_at)}
                            </div>
                          </div>
                          {order.game?.installer_url && ['paid', 'fulfilled'].includes(String(order.status || '').toLowerCase()) && (
                            <a
                              href={order.game.installer_url}
                              target="_blank"
                              rel="noreferrer"
                              className="nyptid-btn-secondary text-[11px] px-2 py-1"
                            >
                              Download Installer
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                    {myGameOrdersAsBuyer.length === 0 && (
                      <div className="text-xs text-surface-500">No game purchases yet.</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          <Modal
            isOpen={showIssueContractModal}
            onClose={closeIssueContractModal}
            title="Issue a New Contract"
            size="xl"
            className="max-w-3xl"
          >
            <div className="space-y-4">
              <div className="text-sm text-surface-400">
                Deploy capital and hire cleared specialists with escrow-backed execution.
              </div>

              <div className="rounded-lg border border-surface-700 bg-surface-900/70 p-3 space-y-3">
                <div className="text-xs font-bold uppercase tracking-wide text-surface-500">Contract Details</div>
                <input
                  type="text"
                  value={issueContractTitle}
                  onChange={(event) => setIssueContractTitle(event.target.value)}
                  className="nyptid-input text-sm"
                  placeholder="e.g. Launch campaign funnel + ad creative sprint"
                />
                <textarea
                  value={issueContractDescription}
                  onChange={(event) => setIssueContractDescription(event.target.value)}
                  className="nyptid-input text-sm resize-none"
                  rows={4}
                  placeholder="Describe scope, constraints, acceptance criteria, and expected execution quality."
                />
              </div>

              <div className="rounded-lg border border-surface-700 bg-surface-900/70 p-3 space-y-3">
                <div className="text-xs font-bold uppercase tracking-wide text-surface-500">Deliverables + Timeline</div>
                <textarea
                  value={issueContractDeliverablesText}
                  onChange={(event) => setIssueContractDeliverablesText(event.target.value)}
                  className="nyptid-input text-sm resize-none"
                  rows={3}
                  placeholder={`One deliverable per line\nLanding page copy\nAd creative pack\nReporting dashboard`}
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={issueContractDurationDays}
                    onChange={(event) => setIssueContractDurationDays(event.target.value)}
                    className="nyptid-input text-sm"
                    placeholder="Duration (days)"
                  />
                  <input
                    type="number"
                    min={10}
                    step={5}
                    value={issueContractBudgetUsd}
                    onChange={(event) => setIssueContractBudgetUsd(event.target.value)}
                    className="nyptid-input text-sm"
                    placeholder="Contract value (USD)"
                  />
                </div>
                <input
                  type="text"
                  value={issueContractTagsText}
                  onChange={(event) => setIssueContractTagsText(event.target.value)}
                  className="nyptid-input text-sm"
                  placeholder="Tags (comma separated): Copywriting, Automation, SEO"
                />
              </div>

              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
                <div className="text-[11px] font-black uppercase tracking-[0.18em] text-amber-300">Warning: Fixed Capital Only</div>
                <div className="mt-1 text-sm text-amber-100/90 leading-relaxed">
                  Contracts must be funded in guaranteed capital via escrow. Unpaid partnerships and commission-only structures are not valid for Quickdraw deployment.
                </div>
                <label className="mt-3 inline-flex items-start gap-2 text-sm text-surface-200">
                  <input
                    type="checkbox"
                    checked={issueContractAcknowledged}
                    onChange={(event) => setIssueContractAcknowledged(event.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-surface-500 bg-surface-900 text-nyptid-300"
                  />
                  <span>I acknowledge this contract must be funded with escrow-backed capital.</span>
                </label>
              </div>

              <div className="flex items-center justify-between gap-2">
                <button type="button" onClick={closeIssueContractModal} className="nyptid-btn-secondary text-sm px-3 py-2">
                  Cancel
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => createQuickdrawContractDraft('draft')}
                    className="nyptid-btn-secondary text-sm px-3 py-2"
                  >
                    Save Draft
                  </button>
                  <button
                    type="button"
                    onClick={() => createQuickdrawContractDraft('queued')}
                    className="nyptid-btn-primary text-sm px-3 py-2"
                  >
                    <ShieldCheck size={14} />
                    Queue Funding
                  </button>
                </div>
              </div>
            </div>
          </Modal>

          <Modal
            isOpen={quickdrawBriefingId !== null}
            onClose={() => setQuickdrawBriefingId(null)}
            title={quickdrawBriefingId ? QUICKDRAW_BRIEFINGS[quickdrawBriefingId].title : ''}
            size="xl"
          >
            {quickdrawBriefingId && (
              <div className="space-y-4">
                <div className="text-sm text-surface-400">{QUICKDRAW_BRIEFINGS[quickdrawBriefingId].subtitle}</div>
                {QUICKDRAW_BRIEFINGS[quickdrawBriefingId].blocks.map((block) => (
                  <div key={block.title} className="rounded-lg border border-surface-700 bg-surface-900/60 p-3">
                    <div className="text-sm font-semibold text-surface-100">{block.title}</div>
                    <div className="text-sm text-surface-300 mt-1 leading-relaxed">{block.body}</div>
                  </div>
                ))}
              </div>
            )}
          </Modal>
        </div>
      </div>
    </AppShell>
  );
}

