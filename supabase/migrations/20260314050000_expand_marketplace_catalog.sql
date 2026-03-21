/*
  Expand NCore marketplace with additional permanent one-time cosmetics.
*/

INSERT INTO public.store_products (sku, name, description, kind, price_cents, currency, active, grant_key, grant_payload)
VALUES
  (
    'banner_fx_pack',
    'Banner FX Pack',
    'Animated profile banner effects and overlays.',
    'cosmetic_pack',
    399,
    'usd',
    true,
    'cosmetic.banner_fx_pack',
    '{"owned": true, "sku": "banner_fx_pack"}'::jsonb
  ),
  (
    'chat_sound_pack',
    'Chat Sound Pack',
    'Alternative notification and message sound set.',
    'cosmetic_pack',
    199,
    'usd',
    true,
    'cosmetic.chat_sound_pack',
    '{"owned": true, "sku": "chat_sound_pack"}'::jsonb
  ),
  (
    'stream_overlay_pack',
    'Stream Overlay Pack',
    'Premium call and screen-share overlay themes.',
    'cosmetic_pack',
    499,
    'usd',
    true,
    'cosmetic.stream_overlay_pack',
    '{"owned": true, "sku": "stream_overlay_pack"}'::jsonb
  ),
  (
    'server_theme_pack',
    'Server Theme Pack',
    'Expanded server color and gradient presets.',
    'cosmetic_pack',
    599,
    'usd',
    true,
    'cosmetic.server_theme_pack',
    '{"owned": true, "sku": "server_theme_pack"}'::jsonb
  ),
  (
    'elite_nameplate_pack',
    'Elite Nameplate Pack',
    'Exclusive display nameplate styles and accents.',
    'cosmetic_pack',
    299,
    'usd',
    true,
    'cosmetic.elite_nameplate_pack',
    '{"owned": true, "sku": "elite_nameplate_pack"}'::jsonb
  ),
  (
    'founders_badge_pack',
    'Founders Badge Pack',
    'Permanent Founders profile badge unlock.',
    'cosmetic_pack',
    499,
    'usd',
    true,
    'cosmetic.founders_badge_pack',
    '{"owned": true, "sku": "founders_badge_pack"}'::jsonb
  )
ON CONFLICT (sku) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  kind = EXCLUDED.kind,
  price_cents = EXCLUDED.price_cents,
  currency = EXCLUDED.currency,
  active = EXCLUDED.active,
  grant_key = EXCLUDED.grant_key,
  grant_payload = EXCLUDED.grant_payload,
  updated_at = now();
