/**
 * Cosmetic Auto-Generator
 *
 * Generates new cosmetic variations with randomized colors, gradients,
 * and styles to keep the storefront rotation fresh.
 */

import { supabase } from './supabase';

const ADJECTIVES = [
  'Aurora', 'Crimson', 'Midnight', 'Solar', 'Frost', 'Ember', 'Neon', 'Phantom',
  'Crystal', 'Shadow', 'Prism', 'Cosmic', 'Velvet', 'Storm', 'Jade', 'Obsidian',
  'Blaze', 'Lunar', 'Coral', 'Twilight', 'Radiant', 'Onyx', 'Sapphire', 'Nova',
  'Mystic', 'Thunder', 'Inferno', 'Arctic', 'Vortex', 'Eclipse',
];

const GRADIENT_PAIRS: [string, string][] = [
  ['#FF6B6B', '#4ECDC4'], ['#A855F7', '#EC4899'], ['#F59E0B', '#EF4444'],
  ['#10B981', '#3B82F6'], ['#8B5CF6', '#06B6D4'], ['#F97316', '#FACC15'],
  ['#E11D48', '#7C3AED'], ['#14B8A6', '#A78BFA'], ['#F43F5E', '#FB923C'],
  ['#6366F1', '#22D3EE'], ['#D946EF', '#F472B6'], ['#84CC16', '#22C55E'],
  ['#0EA5E9', '#6366F1'], ['#F97316', '#DC2626'], ['#8B5CF6', '#F59E0B'],
  ['#059669', '#7DD3FC'], ['#BE185D', '#FDE047'], ['#1D4ED8', '#06B6D4'],
];

const RING_STYLES = [
  'solid-gold', 'neon-pulse', 'crystal-frost', 'fire-ring', 'electric-blue',
  'rainbow-shift', 'shadow-glow', 'diamond-edge', 'plasma-arc', 'holographic',
];

const BADGE_ICONS = ['star', 'diamond', 'crown', 'flame', 'bolt', 'shield', 'heart', 'moon', 'sun', 'gem'];

interface CosmeticType {
  prefix: string;
  name: string;
  basePriceRange: [number, number];
  descriptionTemplate: (adj: string) => string;
}

const COSMETIC_TYPES: CosmeticType[] = [
  { prefix: 'nameplate_color_pack', name: 'Nameplate', basePriceRange: [199, 499], descriptionTemplate: (adj) => `${adj} gradient nameplate for your display name.` },
  { prefix: 'avatar_frame_pack', name: 'Avatar Frame', basePriceRange: [299, 699], descriptionTemplate: (adj) => `${adj} animated ring around your profile picture.` },
  { prefix: 'profile_flair_pack', name: 'Profile Flair', basePriceRange: [149, 399], descriptionTemplate: (adj) => `${adj} animated flair accent on your profile.` },
  { prefix: 'banner_fx_pack', name: 'Banner FX', basePriceRange: [399, 999], descriptionTemplate: (adj) => `${adj} animated overlay for your profile banner.` },
  { prefix: 'supporter_badge_pack', name: 'Badge', basePriceRange: [99, 299], descriptionTemplate: (adj) => `${adj} supporter badge displayed on your profile.` },
];

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomPrice(min: number, max: number): number {
  return Math.round((Math.random() * (max - min) + min) / 50) * 50 + 49; // e.g., 249, 349, etc.
}

export function generateCosmeticVariations(
  existingSkus: Set<string>,
  count: number = 8,
): Array<{
  sku: string;
  name: string;
  description: string;
  kind: string;
  price_cents: number;
  currency: string;
  active: boolean;
  grant_key: string;
  grant_payload: Record<string, any>;
  auto_generated: boolean;
}> {
  const results: ReturnType<typeof generateCosmeticVariations> = [];
  let attempts = 0;

  while (results.length < count && attempts < count * 5) {
    attempts++;
    const type = randomFrom(COSMETIC_TYPES);
    const adj = randomFrom(ADJECTIVES);
    const version = Math.floor(Math.random() * 100) + 1;
    const sku = `${type.prefix}_${adj.toLowerCase()}_v${version}`;

    if (existingSkus.has(sku)) continue;
    existingSkus.add(sku);

    const gradientPair = randomFrom(GRADIENT_PAIRS);
    const ringStyle = randomFrom(RING_STYLES);
    const badgeIcon = randomFrom(BADGE_ICONS);

    results.push({
      sku,
      name: `${adj} ${type.name} Pack`,
      description: type.descriptionTemplate(adj),
      kind: 'cosmetic',
      price_cents: randomPrice(type.basePriceRange[0], type.basePriceRange[1]),
      currency: 'usd',
      active: true,
      grant_key: type.prefix,
      grant_payload: {
        type: type.prefix,
        adjective: adj,
        gradient_start: gradientPair[0],
        gradient_end: gradientPair[1],
        ring_style: ringStyle,
        badge_icon: badgeIcon,
        generated_at: new Date().toISOString(),
      },
      auto_generated: true,
    });
  }

  return results;
}

/**
 * Ensure the cosmetic pool has at least `minCount` items.
 * If not, auto-generate and insert new ones.
 */
export async function ensureCosmeticPool(minCount: number = 20): Promise<number> {
  const { data: existing } = await supabase
    .from('store_products')
    .select('sku')
    .eq('kind', 'cosmetic')
    .eq('active', true);

  const existingSkus = new Set((existing || []).map((p: any) => p.sku));
  const currentCount = existingSkus.size;

  if (currentCount >= minCount) return 0;

  const needed = minCount - currentCount;
  const newItems = generateCosmeticVariations(existingSkus, needed);

  if (newItems.length === 0) return 0;

  const { error } = await supabase.from('store_products').insert(newItems);
  if (error) {
    console.warn('Failed to insert generated cosmetics:', error.message);
    return 0;
  }

  return newItems.length;
}
