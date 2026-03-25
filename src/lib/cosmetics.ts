import type { StoreProduct } from './types';

export interface CosmeticPreviewMeta {
  headline: string;
  summary: string;
  effects: string[];
  tags: string[];
}

export interface CosmeticPreviewEffects {
  profileFlair: boolean;
  avatarFrame: boolean;
  nameplateGradient: boolean;
  supporterBadge: boolean;
  founderBadge: boolean;
  bannerFx: boolean;
  chatSound: boolean;
  streamOverlay: boolean;
  serverTheme: boolean;
}

export interface CosmeticRotationSnapshot {
  collectionSize: number;
  windowDays: number;
  rotationIndex: number;
  totalRotations: number;
  currentCollection: StoreProduct[];
  nextCollection: StoreProduct[];
  archivedCollection: StoreProduct[];
  rotationStartedAt: Date | null;
  nextRotationAt: Date | null;
}

const ROTATION_ANCHOR_UTC = Date.UTC(2026, 0, 1, 0, 0, 0, 0);
export const COSMETIC_ROTATION_DAYS = 4;
export const COSMETIC_ROTATION_COLLECTION_SIZE = 4;

export const DEFAULT_COSMETIC_PREVIEW: CosmeticPreviewMeta = {
  headline: 'NCore Cosmetic Unlock',
  summary: 'Adds account-bound visual customization that stays permanently on your profile.',
  effects: [
    'Instant account unlock after successful purchase.',
    'Permanent cosmetic entitlement with no consumable charges.',
    'Visible across profile, DMs, and server interactions where supported.',
  ],
  tags: ['Permanent', 'Account-bound', 'Cosmetic'],
};

export const COSMETIC_PREVIEWS: Record<string, CosmeticPreviewMeta> = {
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

function normalizeSku(value: string): string {
  return String(value || '').trim().toLowerCase();
}

export function resolveCosmeticPreviewMeta(skuRaw: string): CosmeticPreviewMeta {
  return COSMETIC_PREVIEWS[normalizeSku(skuRaw)] || DEFAULT_COSMETIC_PREVIEW;
}

export function resolveCosmeticPreviewEffects(skuRaw: string): CosmeticPreviewEffects {
  const sku = normalizeSku(skuRaw);
  return {
    profileFlair: sku.includes('profile_flair'),
    avatarFrame: sku.includes('avatar_frame'),
    nameplateGradient: sku.includes('nameplate') || sku.includes('elite_nameplate'),
    supporterBadge: sku.includes('supporter_badge'),
    founderBadge: sku.includes('founders_badge'),
    bannerFx: sku.includes('banner_fx'),
    chatSound: sku.includes('chat_sound'),
    streamOverlay: sku.includes('stream_overlay'),
    serverTheme: sku.includes('server_theme'),
  };
}

export function mergeCosmeticPreviewEffects(skus: string[]): CosmeticPreviewEffects {
  return (Array.isArray(skus) ? skus : []).reduce<CosmeticPreviewEffects>((combined, sku) => {
    const next = resolveCosmeticPreviewEffects(sku);
    return {
      profileFlair: combined.profileFlair || next.profileFlair,
      avatarFrame: combined.avatarFrame || next.avatarFrame,
      nameplateGradient: combined.nameplateGradient || next.nameplateGradient,
      supporterBadge: combined.supporterBadge || next.supporterBadge,
      founderBadge: combined.founderBadge || next.founderBadge,
      bannerFx: combined.bannerFx || next.bannerFx,
      chatSound: combined.chatSound || next.chatSound,
      streamOverlay: combined.streamOverlay || next.streamOverlay,
      serverTheme: combined.serverTheme || next.serverTheme,
    };
  }, {
    profileFlair: false,
    avatarFrame: false,
    nameplateGradient: false,
    supporterBadge: false,
    founderBadge: false,
    bannerFx: false,
    chatSound: false,
    streamOverlay: false,
    serverTheme: false,
  });
}

function sortCosmeticProducts(products: StoreProduct[]): StoreProduct[] {
  return [...products].sort((a, b) => {
    const createdDiff = Date.parse(String(a.created_at || '')) - Date.parse(String(b.created_at || ''));
    if (Number.isFinite(createdDiff) && createdDiff !== 0) return createdDiff;
    return normalizeSku(a.sku).localeCompare(normalizeSku(b.sku));
  });
}

function chunkProducts(products: StoreProduct[], size: number): StoreProduct[][] {
  const normalizedSize = Math.max(1, Math.floor(size));
  const chunks: StoreProduct[][] = [];
  for (let index = 0; index < products.length; index += normalizedSize) {
    chunks.push(products.slice(index, index + normalizedSize));
  }
  return chunks;
}

function positiveModulo(value: number, mod: number): number {
  return ((value % mod) + mod) % mod;
}

export function buildCosmeticRotationSnapshot(
  products: StoreProduct[],
  now: Date = new Date(),
  collectionSize: number = COSMETIC_ROTATION_COLLECTION_SIZE,
  windowDays: number = COSMETIC_ROTATION_DAYS,
): CosmeticRotationSnapshot {
  const sortedProducts = sortCosmeticProducts(products);
  if (sortedProducts.length === 0) {
    return {
      collectionSize,
      windowDays,
      rotationIndex: 0,
      totalRotations: 0,
      currentCollection: [],
      nextCollection: [],
      archivedCollection: [],
      rotationStartedAt: null,
      nextRotationAt: null,
    };
  }

  const collections = chunkProducts(sortedProducts, collectionSize);
  const totalRotations = collections.length;
  const windowMs = Math.max(1, windowDays) * 24 * 60 * 60 * 1000;
  const elapsedWindows = Math.floor((now.getTime() - ROTATION_ANCHOR_UTC) / windowMs);
  const rotationIndex = positiveModulo(elapsedWindows, totalRotations);
  const currentCollection = collections[rotationIndex] || collections[0] || [];
  const nextCollection = collections[positiveModulo(rotationIndex + 1, totalRotations)] || currentCollection;
  const archivedCollection = sortedProducts.filter((product) => !currentCollection.some((current) => current.sku === product.sku));

  return {
    collectionSize,
    windowDays,
    rotationIndex,
    totalRotations,
    currentCollection,
    nextCollection,
    archivedCollection,
    rotationStartedAt: new Date(ROTATION_ANCHOR_UTC + (elapsedWindows * windowMs)),
    nextRotationAt: new Date(ROTATION_ANCHOR_UTC + ((elapsedWindows + 1) * windowMs)),
  };
}
