import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@16.10.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function getBearerToken(req: Request): string {
  const authHeader = req.headers.get('Authorization') || '';
  return authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : '';
}

function inferRedirectBase(req: Request): string {
  const origin = req.headers.get('origin') || '';
  if (origin.startsWith('http://') || origin.startsWith('https://')) {
    return origin;
  }
  return 'https://ncore.nyptidindustries.com';
}

function sanitizeRedirectUrl(value: unknown, fallback: string): string {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
  } catch {
    // noop
  }
  return fallback;
}

function sanitizeSku(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeSourceChannel(value: unknown): string {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\-]/g, '')
    .slice(0, 64);
  return normalized || 'organic';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asPositiveInteger(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.round(parsed);
  return rounded > 0 ? rounded : fallback;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY') || '';
    const boostPriceId = Deno.env.get('STRIPE_PRICE_BOOST_MONTHLY') || '';
    const boostMonthlyCentsRaw = Number(Deno.env.get('STRIPE_BOOST_MONTHLY_CENTS') || '999');
    const boostMonthlyCents = Number.isFinite(boostMonthlyCentsRaw) && boostMonthlyCentsRaw > 0
      ? Math.round(boostMonthlyCentsRaw)
      : 999;

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey || !stripeSecretKey) {
      return jsonResponse(500, { error: 'Missing required environment configuration' });
    }

    const body = await req.json().catch(() => ({}));
    const bodyAccessToken = String(body?.accessToken || '').trim();
    const headerAccessToken = String(getBearerToken(req) || '').trim();
    const bearerToken = bodyAccessToken || headerAccessToken;
    if (!bearerToken) {
      return jsonResponse(401, { error: 'Missing Authorization token' });
    }

    const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: authData, error: authError } = await anonClient.auth.getUser(bearerToken);
    if (authError || !authData?.user) {
      return jsonResponse(401, { error: 'Unauthorized user' });
    }

    const mode = String(body?.mode || '').trim();
    const requestedSku = String(body?.sku || body?.marketItem?.sku || '').trim();
    const sku = sanitizeSku(requestedSku);
    const sourceChannel = normalizeSourceChannel(
      body?.sourceChannel
      || body?.source_channel
      || body?.utm_source
      || body?.campaign,
    );
    const requestedGiftToUserId = String(body?.giftToUserId || '').trim();
    const requestedGiftToUsername = sanitizeSku(String(body?.giftToUsername || body?.giftTo || '').replace(/^@+/, '').trim());
    const redirectBase = inferRedirectBase(req);
    const successUrl = sanitizeRedirectUrl(body?.successUrl, `${redirectBase}/app/settings`);
    const cancelUrl = sanitizeRedirectUrl(body?.cancelUrl, `${redirectBase}/app/settings`);

    const allowedModes = new Set([
      'boost_subscription',
      'one_time_purchase',
      'marketplace_service_listing_fee',
      'marketplace_service_order',
      'marketplace_game_listing_fee',
      'marketplace_game_purchase',
    ]);
    if (!allowedModes.has(mode)) {
      return jsonResponse(400, { error: 'Unsupported checkout mode' });
    }

    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' });

    const user = authData.user;

    let stripeCustomerId = '';
    const { data: existingCustomer, error: existingCustomerError } = await serviceClient
      .from('billing_customers')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (existingCustomerError) {
      return jsonResponse(500, { error: existingCustomerError.message });
    }

    if (existingCustomer?.stripe_customer_id) {
      stripeCustomerId = String(existingCustomer.stripe_customer_id);
    } else {
      const createdCustomer = await stripe.customers.create({
        email: user.email || undefined,
        metadata: {
          user_id: user.id,
          username: String(user.user_metadata?.username || ''),
        },
      });
      stripeCustomerId = createdCustomer.id;
      const { error: insertCustomerError } = await serviceClient.from('billing_customers').upsert({
        user_id: user.id,
        stripe_customer_id: stripeCustomerId,
      } as never, { onConflict: 'user_id' });
      if (insertCustomerError) {
        return jsonResponse(500, { error: insertCustomerError.message });
      }
    }

    if (mode === 'boost_subscription') {
      const { data: activeSubscription } = await serviceClient
        .from('billing_subscriptions')
        .select('id')
        .eq('user_id', user.id)
        .eq('plan_code', 'boost_monthly')
        .in('status', ['trialing', 'active', 'past_due'])
        .maybeSingle();

      if (activeSubscription?.id) {
        return jsonResponse(409, {
          error: 'NYPTID Boost is already active for this account.',
          code: 'already_active',
        });
      }

      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: stripeCustomerId,
        line_items: boostPriceId
          ? [{ price: boostPriceId, quantity: 1 }]
          : [{
              price_data: {
                currency: 'usd',
                unit_amount: boostMonthlyCents,
                recurring: { interval: 'month' },
                product_data: {
                  name: 'NYPTID Boost',
                  description: 'Boost subscription for higher limits and premium performance tiers.',
                },
              },
              quantity: 1,
            }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        allow_promotion_codes: true,
        subscription_data: {
          metadata: {
            user_id: user.id,
            plan_code: 'boost_monthly',
            source_channel: sourceChannel,
          },
        },
        metadata: {
          user_id: user.id,
          plan_code: 'boost_monthly',
          source_channel: sourceChannel,
        },
      });

      return jsonResponse(200, {
        ok: true,
        sessionId: session.id,
        checkoutUrl: session.url,
      });
    }

    if (mode === 'marketplace_service_listing_fee') {
      const listingId = String(body?.serviceListingId || '').trim();
      if (!listingId) {
        return jsonResponse(400, { error: 'serviceListingId is required.' });
      }

      const { data: listing, error: listingError } = await serviceClient
        .from('marketplace_service_listings')
        .select('id, seller_id, title, description, listing_fee_cents, listing_fee_paid, status')
        .eq('id', listingId)
        .maybeSingle();
      if (listingError) {
        return jsonResponse(500, { error: listingError.message });
      }
      if (!listing) {
        return jsonResponse(404, { error: 'Service listing not found.' });
      }
      if (String(listing.seller_id) !== String(user.id)) {
        return jsonResponse(403, { error: 'Only the listing owner can pay this listing fee.' });
      }
      if (Boolean(listing.listing_fee_paid)) {
        return jsonResponse(409, { error: 'Listing fee already paid for this service.' });
      }

      const feeCents = asPositiveInteger((listing as any).listing_fee_cents, 0);
      if (feeCents <= 0) {
        return jsonResponse(400, { error: 'Invalid service listing fee amount.' });
      }

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer: stripeCustomerId,
        line_items: [{
          price_data: {
            currency: 'usd',
            unit_amount: feeCents,
            product_data: {
              name: `Quickdraw Listing Fee - ${String((listing as any).title || 'Service Listing')}`,
              description: 'One-time listing fee to unlock Quickdraw service publishing.',
            },
          },
          quantity: 1,
        }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        allow_promotion_codes: false,
        metadata: {
          marketplace_mode: 'service_listing_fee',
          user_id: String(user.id),
          service_listing_id: String((listing as any).id),
          source_channel: sourceChannel,
        },
      });

      await serviceClient
        .from('marketplace_service_listings')
        .update({ status: 'pending_fee' } as never)
        .eq('id', String((listing as any).id));

      return jsonResponse(200, {
        ok: true,
        sessionId: session.id,
        checkoutUrl: session.url,
      });
    }

    if (mode === 'marketplace_service_order') {
      const listingId = String(body?.serviceListingId || '').trim();
      if (!listingId) {
        return jsonResponse(400, { error: 'serviceListingId is required.' });
      }

      const { data: listing, error: listingError } = await serviceClient
        .from('marketplace_service_listings')
        .select('id, seller_id, title, description, base_price_cents, listing_fee_paid, status')
        .eq('id', listingId)
        .maybeSingle();
      if (listingError) {
        return jsonResponse(500, { error: listingError.message });
      }
      if (!listing) {
        return jsonResponse(404, { error: 'Service listing not found.' });
      }
      if (String((listing as any).seller_id) === String(user.id)) {
        return jsonResponse(409, { error: 'You cannot hire your own service listing.' });
      }
      if (String((listing as any).status) !== 'approved' || !Boolean((listing as any).listing_fee_paid)) {
        return jsonResponse(409, { error: 'This service listing is not yet purchasable.' });
      }

      const amountCents = asPositiveInteger((listing as any).base_price_cents, 0);
      if (amountCents <= 0) {
        return jsonResponse(400, { error: 'Invalid service listing price.' });
      }

      const servicePlatformFeeBps = asPositiveInteger(Deno.env.get('MARKETPLACE_SERVICE_PLATFORM_FEE_BPS') || '400', 400);
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer: stripeCustomerId,
        line_items: [{
          price_data: {
            currency: 'usd',
            unit_amount: amountCents,
            product_data: {
              name: `Quickdraw Hire - ${String((listing as any).title || 'Service')}`,
              description: String((listing as any).description || 'Quickdraw service order'),
            },
          },
          quantity: 1,
        }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        allow_promotion_codes: false,
        metadata: {
          marketplace_mode: 'service_order',
          user_id: String(user.id),
          buyer_user_id: String(user.id),
          seller_user_id: String((listing as any).seller_id),
          service_listing_id: String((listing as any).id),
          platform_fee_bps: String(servicePlatformFeeBps),
          source_channel: sourceChannel,
        },
      });

      const { error: orderInsertError } = await serviceClient
        .from('marketplace_service_orders')
        .insert({
          listing_id: String((listing as any).id),
          buyer_id: String(user.id),
          seller_id: String((listing as any).seller_id),
          amount_cents: amountCents,
          platform_fee_bps: servicePlatformFeeBps,
          status: 'pending_payment',
          stripe_checkout_session_id: session.id,
        } as never);

      if (orderInsertError) {
        return jsonResponse(500, { error: orderInsertError.message });
      }

      return jsonResponse(200, {
        ok: true,
        sessionId: session.id,
        checkoutUrl: session.url,
      });
    }

    if (mode === 'marketplace_game_listing_fee') {
      const gameListingId = String(body?.gameListingId || '').trim();
      if (!gameListingId) {
        return jsonResponse(400, { error: 'gameListingId is required.' });
      }

      const { data: gameListing, error: gameListingError } = await serviceClient
        .from('marketplace_game_listings')
        .select('id, seller_id, title, listing_fee_cents, listing_fee_paid, status')
        .eq('id', gameListingId)
        .maybeSingle();
      if (gameListingError) {
        return jsonResponse(500, { error: gameListingError.message });
      }
      if (!gameListing) {
        return jsonResponse(404, { error: 'Game listing not found.' });
      }
      if (String((gameListing as any).seller_id) !== String(user.id)) {
        return jsonResponse(403, { error: 'Only the listing owner can pay this game listing fee.' });
      }
      if (Boolean((gameListing as any).listing_fee_paid)) {
        return jsonResponse(409, { error: 'Game listing fee already paid.' });
      }

      const listingFeeCents = asPositiveInteger((gameListing as any).listing_fee_cents, 10000);
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer: stripeCustomerId,
        line_items: [{
          price_data: {
            currency: 'usd',
            unit_amount: listingFeeCents,
            product_data: {
              name: `Game Publish Fee - ${String((gameListing as any).title || 'Game Listing')}`,
              description: 'One-time $100 publish fee for selling games on NCore Marketplace.',
            },
          },
          quantity: 1,
        }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        allow_promotion_codes: false,
        metadata: {
          marketplace_mode: 'game_listing_fee',
          user_id: String(user.id),
          game_listing_id: String((gameListing as any).id),
          source_channel: sourceChannel,
        },
      });

      await serviceClient
        .from('marketplace_game_listings')
        .update({ status: 'pending_fee' } as never)
        .eq('id', String((gameListing as any).id));

      return jsonResponse(200, {
        ok: true,
        sessionId: session.id,
        checkoutUrl: session.url,
      });
    }

    if (mode === 'marketplace_game_purchase') {
      const gameListingId = String(body?.gameListingId || '').trim();
      if (!gameListingId) {
        return jsonResponse(400, { error: 'gameListingId is required.' });
      }

      const { data: gameListing, error: gameListingError } = await serviceClient
        .from('marketplace_game_listings')
        .select('id, seller_id, title, description, price_cents, platform_fee_bps, listing_fee_paid, status')
        .eq('id', gameListingId)
        .maybeSingle();
      if (gameListingError) {
        return jsonResponse(500, { error: gameListingError.message });
      }
      if (!gameListing) {
        return jsonResponse(404, { error: 'Game listing not found.' });
      }
      if (String((gameListing as any).seller_id) === String(user.id)) {
        return jsonResponse(409, { error: 'You cannot purchase your own game listing.' });
      }
      if (String((gameListing as any).status) !== 'approved' || !Boolean((gameListing as any).listing_fee_paid)) {
        return jsonResponse(409, { error: 'This game listing is not available for purchase yet.' });
      }

      const priceCents = asPositiveInteger((gameListing as any).price_cents, 0);
      if (priceCents <= 0) {
        return jsonResponse(400, { error: 'Invalid game listing price.' });
      }

      const platformFeeBps = asPositiveInteger((gameListing as any).platform_fee_bps, 400);
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer: stripeCustomerId,
        line_items: [{
          price_data: {
            currency: 'usd',
            unit_amount: priceCents,
            product_data: {
              name: String((gameListing as any).title || 'NCore Marketplace Game'),
              description: String((gameListing as any).description || 'NCore Marketplace game purchase'),
            },
          },
          quantity: 1,
        }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        allow_promotion_codes: true,
        metadata: {
          marketplace_mode: 'game_purchase',
          user_id: String(user.id),
          buyer_user_id: String(user.id),
          seller_user_id: String((gameListing as any).seller_id),
          game_listing_id: String((gameListing as any).id),
          platform_fee_bps: String(platformFeeBps),
          source_channel: sourceChannel,
        },
      });

      const { error: gameOrderError } = await serviceClient
        .from('marketplace_game_orders')
        .insert({
          game_listing_id: String((gameListing as any).id),
          buyer_id: String(user.id),
          seller_id: String((gameListing as any).seller_id),
          amount_cents: priceCents,
          platform_fee_bps: platformFeeBps,
          status: 'pending_payment',
          stripe_checkout_session_id: session.id,
        } as never);

      if (gameOrderError) {
        return jsonResponse(500, { error: gameOrderError.message });
      }

      return jsonResponse(200, {
        ok: true,
        sessionId: session.id,
        checkoutUrl: session.url,
      });
    }

    if (!sku) {
      return jsonResponse(400, { error: 'sku is required for one_time_purchase mode' });
    }

    let targetUserId = String(user.id);
    let giftFromUserId: string | null = null;
    let giftRecipientUsername = '';
    if (requestedGiftToUserId || requestedGiftToUsername) {
      let recipient: { id: string; username: string | null } | null = null;

      if (requestedGiftToUserId) {
        const { data: byId, error: byIdError } = await serviceClient
          .from('profiles')
          .select('id, username')
          .eq('id', requestedGiftToUserId)
          .maybeSingle();
        if (byIdError) {
          return jsonResponse(500, { error: byIdError.message });
        }
        recipient = byId ? { id: String(byId.id), username: String(byId.username || '') } : null;
      } else if (requestedGiftToUsername) {
        const { data: byUsername, error: byUsernameError } = await serviceClient
          .from('profiles')
          .select('id, username')
          .eq('username', requestedGiftToUsername)
          .maybeSingle();
        if (byUsernameError) {
          return jsonResponse(500, { error: byUsernameError.message });
        }
        recipient = byUsername ? { id: String(byUsername.id), username: String(byUsername.username || '') } : null;
      }

      if (!recipient?.id) {
        return jsonResponse(404, { error: 'Gift recipient was not found.' });
      }

      if (String(recipient.id) !== String(user.id)) {
        targetUserId = String(recipient.id);
        giftFromUserId = String(user.id);
        giftRecipientUsername = String(recipient.username || '').trim();
      }
    }

    let { data: product, error: productError } = await serviceClient
      .from('store_products')
      .select('sku, name, description, price_cents, currency, active')
      .eq('sku', sku)
      .eq('active', true)
      .maybeSingle();

    if (productError) {
      return jsonResponse(500, { error: productError.message });
    }
    if (!product) {
      const marketItem = isPlainObject(body?.marketItem) ? body.marketItem : null;
      if (!marketItem) {
        return jsonResponse(404, { error: 'Store product not found or inactive' });
      }

      const { data: profileRow, error: profileError } = await serviceClient
        .from('profiles')
        .select('platform_role')
        .eq('id', user.id)
        .maybeSingle();

      if (profileError) {
        return jsonResponse(500, { error: profileError.message });
      }
      if (String(profileRow?.platform_role || '') !== 'owner') {
        return jsonResponse(403, { error: 'Only owner can create marketplace products from checkout.' });
      }

      const priceCents = Number(marketItem.priceCents);
      const currency = String(marketItem.currency || 'usd').trim().toLowerCase();
      const name = String(marketItem.name || sku).trim();
      const description = String(marketItem.description || '').trim();
      const kind = String(marketItem.kind || 'cosmetic').trim();
      const grantKey = String(marketItem.grantKey || sku).trim();
      const grantPayload = isPlainObject(marketItem.grantPayload) ? marketItem.grantPayload : {};

      if (!name) {
        return jsonResponse(400, { error: 'marketItem.name is required when auto-creating a SKU' });
      }
      if (!Number.isFinite(priceCents) || priceCents <= 0) {
        return jsonResponse(400, { error: 'marketItem.priceCents must be a positive integer' });
      }
      if (!/^[a-z]{3}$/.test(currency)) {
        return jsonResponse(400, { error: 'marketItem.currency must be a 3-letter ISO code' });
      }

      const { error: createProductError } = await serviceClient.from('store_products').upsert({
        sku,
        name,
        description,
        kind,
        price_cents: Math.round(priceCents),
        currency,
        active: true,
        grant_key: grantKey || sku,
        grant_payload: grantPayload,
      } as never, {
        onConflict: 'sku',
      });
      if (createProductError) {
        return jsonResponse(500, { error: createProductError.message });
      }

      const productFetch = await serviceClient
        .from('store_products')
        .select('sku, name, description, price_cents, currency, active')
        .eq('sku', sku)
        .eq('active', true)
        .maybeSingle();
      product = productFetch.data || null;
      if (!product) {
        return jsonResponse(500, { error: 'SKU auto-created but could not be reloaded.' });
      }
    }

    const { data: existingPurchase } = await serviceClient
      .from('user_purchases')
      .select('id, status')
      .eq('user_id', targetUserId)
      .eq('sku', sku)
      .eq('status', 'paid')
      .maybeSingle();

    if (existingPurchase?.id) {
      return jsonResponse(409, {
        error: 'This item is already owned on your account.',
        code: 'already_owned',
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer: stripeCustomerId,
      line_items: [
        {
          price_data: {
            currency: String(product.currency || 'usd').toLowerCase(),
            unit_amount: Number(product.price_cents || 0),
            product_data: {
              name: String(product.name || sku),
              description: String(product.description || ''),
            },
          },
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        user_id: targetUserId,
        target_user_id: targetUserId,
        purchaser_user_id: String(user.id),
        sku,
        source_channel: sourceChannel,
        ...(giftFromUserId ? {
          gift_from_user_id: giftFromUserId,
          gift_to_username: giftRecipientUsername,
        } : {}),
      },
    });

    const { error: pendingInsertError } = await serviceClient.from('user_purchases').upsert({
      user_id: targetUserId,
      sku,
      stripe_checkout_session_id: session.id,
      status: 'pending',
    } as never, {
      onConflict: 'user_id,sku',
    });

    if (pendingInsertError) {
      return jsonResponse(500, { error: pendingInsertError.message });
    }

    return jsonResponse(200, {
      ok: true,
      sessionId: session.id,
      checkoutUrl: session.url,
      gifted: Boolean(giftFromUserId),
      recipientUserId: targetUserId,
    });
  } catch (error) {
    return jsonResponse(500, { error: String(error) });
  }
});
