import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@16.10.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, stripe-signature',
};

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['trialing', 'active', 'past_due']);

function jsonResponse(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function asIsoFromUnix(seconds: number | null | undefined): string | null {
  if (!seconds || Number.isNaN(seconds)) return null;
  return new Date(seconds * 1000).toISOString();
}

function extractPlanCodeFromSubscription(subscription: Stripe.Subscription): string {
  return String(subscription.metadata?.plan_code || 'boost_monthly');
}

function normalizeSourceChannel(value: unknown): string {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\-]/g, '')
    .slice(0, 64);
  return normalized || 'organic';
}

function asPositiveInteger(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.round(parsed);
}

async function safeUpsertOperatorDailyMetrics(
  serviceClient: ReturnType<typeof createClient>,
  params: {
    sourceChannel: string;
    checkoutPaidDelta?: number;
    checkoutFailedDelta?: number;
    boostMrrCentsDelta?: number;
    marketplaceGmvCentsDelta?: number;
    marketplaceFeeCentsDelta?: number;
  },
) {
  const sourceChannel = normalizeSourceChannel(params.sourceChannel);
  const payload = {
    p_source_channel: sourceChannel,
    p_delta_checkout_paid: asPositiveInteger(params.checkoutPaidDelta || 0),
    p_delta_checkout_failed: asPositiveInteger(params.checkoutFailedDelta || 0),
    p_delta_boost_mrr_cents: Math.max(0, Math.round(Number(params.boostMrrCentsDelta || 0))),
    p_delta_marketplace_gmv_cents: Math.max(0, Math.round(Number(params.marketplaceGmvCentsDelta || 0))),
    p_delta_marketplace_fee_cents: Math.max(0, Math.round(Number(params.marketplaceFeeCentsDelta || 0))),
  };

  try {
    const { error } = await serviceClient.rpc('upsert_operator_daily_metrics', payload);
    if (!error) return;
  } catch {
    // Continue to fallback.
  }

  try {
    const today = new Date().toISOString().slice(0, 10);
    const { data: existing } = await serviceClient
      .from('operator_daily_metrics')
      .select('checkout_started_count, checkout_paid_count, checkout_failed_count, boost_mrr_cents, marketplace_gmv_cents, marketplace_fee_cents, call_attempts_count, call_connected_count, call_drop_count')
      .eq('metric_date', today)
      .eq('source_channel', sourceChannel)
      .maybeSingle();

    await serviceClient.from('operator_daily_metrics').upsert({
      metric_date: today,
      source_channel: sourceChannel,
      checkout_started_count: Number(existing?.checkout_started_count || 0),
      checkout_paid_count: Number(existing?.checkout_paid_count || 0) + payload.p_delta_checkout_paid,
      checkout_failed_count: Number(existing?.checkout_failed_count || 0) + payload.p_delta_checkout_failed,
      boost_mrr_cents: Number(existing?.boost_mrr_cents || 0) + payload.p_delta_boost_mrr_cents,
      marketplace_gmv_cents: Number(existing?.marketplace_gmv_cents || 0) + payload.p_delta_marketplace_gmv_cents,
      marketplace_fee_cents: Number(existing?.marketplace_fee_cents || 0) + payload.p_delta_marketplace_fee_cents,
      call_attempts_count: Number(existing?.call_attempts_count || 0),
      call_connected_count: Number(existing?.call_connected_count || 0),
      call_drop_count: Number(existing?.call_drop_count || 0),
    } as never, {
      onConflict: 'metric_date,source_channel',
    });
  } catch {
    // Best-effort metrics only; webhook must not fail on analytics updates.
  }
}

async function safeTrackGrowthEvent(
  serviceClient: ReturnType<typeof createClient>,
  params: {
    userId?: string | null;
    eventName: string;
    sourceChannel: string;
    payload: Record<string, unknown>;
  },
) {
  const sourceChannel = normalizeSourceChannel(params.sourceChannel);
  const eventName = String(params.eventName || '').trim().toLowerCase() || 'unknown';
  const payload = params.payload || {};

  try {
    const { error } = await serviceClient.rpc('track_growth_event', {
      p_event_name: eventName,
      p_payload: payload,
      p_source_channel: sourceChannel,
      p_event_source: 'billing_webhook',
      p_user_id: params.userId || null,
    });
    if (!error) return;
  } catch {
    // Continue to fallback insert.
  }

  try {
    await serviceClient.from('growth_events').insert({
      user_id: params.userId || null,
      event_name: eventName,
      event_source: 'billing_webhook',
      source_channel: sourceChannel,
      payload,
    } as never);
  } catch {
    // Best-effort event tracking only.
  }
}

async function resolveUserIdFromStripeCustomer(
  serviceClient: ReturnType<typeof createClient>,
  stripeCustomerId: string | null | undefined,
): Promise<string | null> {
  if (!stripeCustomerId) return null;
  const { data } = await serviceClient
    .from('billing_customers')
    .select('user_id')
    .eq('stripe_customer_id', stripeCustomerId)
    .maybeSingle();
  return data?.user_id ? String(data.user_id) : null;
}

async function upsertSubscriptionFromStripe(
  serviceClient: ReturnType<typeof createClient>,
  userId: string,
  subscription: Stripe.Subscription,
) {
  const status = String(subscription.status || 'incomplete');
  await serviceClient.from('billing_subscriptions').upsert({
    user_id: userId,
    plan_code: extractPlanCodeFromSubscription(subscription),
    status,
    current_period_end: asIsoFromUnix(subscription.current_period_end),
    stripe_subscription_id: subscription.id,
  } as never, {
    onConflict: 'stripe_subscription_id',
  });
}

async function recalculateEntitlements(
  serviceClient: ReturnType<typeof createClient>,
  userId: string,
) {
  await serviceClient.rpc('recalculate_user_entitlements', {
    p_user_id: userId,
  });
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
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY') || '';
    const stripeWebhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') || '';

    if (!supabaseUrl || !supabaseServiceRoleKey || !stripeSecretKey || !stripeWebhookSecret) {
      return jsonResponse(500, { error: 'Missing required webhook environment configuration' });
    }

    const signature = req.headers.get('stripe-signature');
    if (!signature) {
      return jsonResponse(400, { error: 'Missing Stripe signature header' });
    }

    const payload = await req.text();
    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' });
    const event = stripe.webhooks.constructEvent(payload, signature, stripeWebhookSecret);

    const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: alreadyProcessed } = await serviceClient
      .from('billing_webhook_events')
      .select('event_id')
      .eq('event_id', event.id)
      .maybeSingle();

    if (alreadyProcessed?.event_id) {
      return jsonResponse(200, { ok: true, duplicate: true });
    }

    const affectedUsers = new Set<string>();

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const marketplaceMode = String(session.metadata?.marketplace_mode || '').trim();
      const sourceChannel = normalizeSourceChannel(session.metadata?.source_channel);
      const serviceListingId = String(session.metadata?.service_listing_id || '').trim();
      const gameListingId = String(session.metadata?.game_listing_id || '').trim();
      const targetUserIdFromMetadata =
        String(session.metadata?.target_user_id || session.metadata?.user_id || '').trim() || null;
      const purchaserUserIdFromMetadata =
        String(session.metadata?.purchaser_user_id || '').trim() || null;
      const giftFromUserId =
        String(session.metadata?.gift_from_user_id || '').trim() || null;
      const sku = String(session.metadata?.sku || '').trim();
      const stripeCustomerId = typeof session.customer === 'string' ? session.customer : null;
      const resolvedUserId = targetUserIdFromMetadata || await resolveUserIdFromStripeCustomer(serviceClient, stripeCustomerId);
      const billingCustomerOwnerUserId =
        purchaserUserIdFromMetadata
        || targetUserIdFromMetadata
        || await resolveUserIdFromStripeCustomer(serviceClient, stripeCustomerId);

      const isGiftPurchase = Boolean(
        session.mode === 'payment'
        && giftFromUserId
        && resolvedUserId
        && String(giftFromUserId) !== String(resolvedUserId),
      );
      const sessionAmountCents = asPositiveInteger(session.amount_total || 0);
      let metricsBoostMrrCents = 0;
      let metricsMarketplaceGmvCents = 0;
      let metricsMarketplaceFeeCents = 0;

      if (resolvedUserId) {
        affectedUsers.add(resolvedUserId);
      }

      if (!isGiftPurchase && billingCustomerOwnerUserId && stripeCustomerId) {
        await serviceClient.from('billing_customers').upsert({
          user_id: billingCustomerOwnerUserId,
          stripe_customer_id: stripeCustomerId,
        } as never, {
          onConflict: 'user_id',
        });
      }

      if (marketplaceMode === 'service_listing_fee' && serviceListingId) {
        await serviceClient
          .from('marketplace_service_listings')
          .update({
            listing_fee_paid: true,
            status: 'pending_review',
          } as never)
          .eq('id', serviceListingId);
        metricsMarketplaceFeeCents += sessionAmountCents;
      }

      if (marketplaceMode === 'service_order') {
        await serviceClient
          .from('marketplace_service_orders')
          .update({
            status: 'funded',
            stripe_payment_intent_id: typeof session.payment_intent === 'string' ? session.payment_intent : null,
            escrow_release_due_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          } as never)
          .eq('stripe_checkout_session_id', session.id);

        const { data: orderRow } = await serviceClient
          .from('marketplace_service_orders')
          .select('id, seller_id, buyer_id, amount_cents, platform_fee_bps')
          .eq('stripe_checkout_session_id', session.id)
          .maybeSingle();

        if (orderRow?.seller_id) {
          const sellerId = String(orderRow.seller_id);
          const buyerId = String(orderRow.buyer_id || '');
          const amountCents = Number(orderRow.amount_cents || 0);
          const feeBps = Number(orderRow.platform_fee_bps || 400);
          const feeCents = Math.floor((amountCents * feeBps) / 10000);
          const sellerNet = Math.max(amountCents - feeCents, 0);
          metricsMarketplaceGmvCents += Math.max(amountCents, 0);
          metricsMarketplaceFeeCents += Math.max(feeCents, 0);

          affectedUsers.add(sellerId);
          if (buyerId) affectedUsers.add(buyerId);

          await serviceClient.rpc('marketplace_ensure_wallet', {
            p_user_id: sellerId,
          });
          const { data: pendingWalletRow } = await serviceClient
            .from('ncore_wallet_accounts')
            .select('pending_balance_cents')
            .eq('user_id', sellerId)
            .maybeSingle();
          const currentPending = Number(pendingWalletRow?.pending_balance_cents || 0);
          await serviceClient
            .from('ncore_wallet_accounts')
            .update({
              pending_balance_cents: Math.max(0, currentPending) + sellerNet,
            } as never)
            .eq('user_id', sellerId);

          await serviceClient.from('ncore_wallet_ledger').insert({
            user_id: sellerId,
            entry_type: 'service_escrow_funded',
            amount_cents: sellerNet,
            currency: 'usd',
            reference_type: 'marketplace_service_order',
            reference_id: orderRow.id,
            note: 'Quickdraw escrow funded',
          } as never);
        }
      }

      if (marketplaceMode === 'game_listing_fee' && gameListingId) {
        await serviceClient
          .from('marketplace_game_listings')
          .update({
            listing_fee_paid: true,
            status: 'pending_review',
          } as never)
          .eq('id', gameListingId);
        metricsMarketplaceFeeCents += sessionAmountCents;
      }

      if (marketplaceMode === 'game_purchase') {
        const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : null;
        await serviceClient
          .from('marketplace_game_orders')
          .update({
            status: 'paid',
            stripe_payment_intent_id: paymentIntentId,
            download_token: crypto.randomUUID(),
            download_expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          } as never)
          .eq('stripe_checkout_session_id', session.id);

        const { data: gameOrderRow } = await serviceClient
          .from('marketplace_game_orders')
          .select('id, seller_id, buyer_id, amount_cents, platform_fee_bps')
          .eq('stripe_checkout_session_id', session.id)
          .maybeSingle();

        if (gameOrderRow?.seller_id) {
          const sellerId = String(gameOrderRow.seller_id);
          const buyerId = String(gameOrderRow.buyer_id || '');
          const amountCents = Number(gameOrderRow.amount_cents || 0);
          const feeBps = Number(gameOrderRow.platform_fee_bps || 400);
          const feeCents = Math.floor((amountCents * feeBps) / 10000);
          const sellerNet = Math.max(amountCents - feeCents, 0);
          metricsMarketplaceGmvCents += Math.max(amountCents, 0);
          metricsMarketplaceFeeCents += Math.max(feeCents, 0);

          affectedUsers.add(sellerId);
          if (buyerId) affectedUsers.add(buyerId);

          await serviceClient.rpc('marketplace_ensure_wallet', {
            p_user_id: sellerId,
          });
          const { data: walletRow } = await serviceClient
            .from('ncore_wallet_accounts')
            .select('available_balance_cents')
            .eq('user_id', sellerId)
            .maybeSingle();
          const currentAvailable = Number(walletRow?.available_balance_cents || 0);
          await serviceClient
            .from('ncore_wallet_accounts')
            .update({
              available_balance_cents: Math.max(0, currentAvailable) + sellerNet,
            } as never)
            .eq('user_id', sellerId);

          await serviceClient.from('ncore_wallet_ledger').insert({
            user_id: sellerId,
            entry_type: 'game_sale_credit',
            amount_cents: sellerNet,
            currency: 'usd',
            reference_type: 'marketplace_game_order',
            reference_id: gameOrderRow.id,
            note: 'Game sale payout (net after platform fee)',
          } as never);
        }
      }

      if (resolvedUserId && session.mode === 'payment' && sku) {
        await serviceClient.from('user_purchases').upsert({
          user_id: resolvedUserId,
          sku,
          stripe_payment_intent_id: typeof session.payment_intent === 'string' ? session.payment_intent : null,
          stripe_checkout_session_id: session.id,
          status: 'paid',
        } as never, {
          onConflict: 'user_id,sku',
        });
      }

      if (resolvedUserId && session.mode === 'subscription' && typeof session.subscription === 'string') {
        const subscription = await stripe.subscriptions.retrieve(session.subscription);
        await upsertSubscriptionFromStripe(serviceClient, resolvedUserId, subscription);
        metricsBoostMrrCents += sessionAmountCents;
      }

      const trackingUserId = resolvedUserId || billingCustomerOwnerUserId || null;
      await safeTrackGrowthEvent(serviceClient, {
        userId: trackingUserId,
        eventName: 'checkout_paid',
        sourceChannel,
        payload: {
          mode: session.mode || null,
          marketplace_mode: marketplaceMode || null,
          amount_cents: sessionAmountCents,
          currency: String(session.currency || 'usd').toLowerCase(),
          checkout_session_id: session.id,
        },
      });
      await safeUpsertOperatorDailyMetrics(serviceClient, {
        sourceChannel,
        checkoutPaidDelta: 1,
        boostMrrCentsDelta: metricsBoostMrrCents,
        marketplaceGmvCentsDelta: metricsMarketplaceGmvCents,
        marketplaceFeeCentsDelta: metricsMarketplaceFeeCents,
      });
    }

    if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') {
      const invoice = event.data.object as Stripe.Invoice;
      const stripeCustomerId = typeof invoice.customer === 'string' ? invoice.customer : null;
      const userId = await resolveUserIdFromStripeCustomer(serviceClient, stripeCustomerId);
      let sourceChannel = normalizeSourceChannel(invoice.metadata?.source_channel);
      if (userId) {
        affectedUsers.add(userId);
      }

      if (userId && typeof invoice.subscription === 'string') {
        const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
        sourceChannel = normalizeSourceChannel(subscription.metadata?.source_channel || sourceChannel);
        await upsertSubscriptionFromStripe(serviceClient, userId, subscription);

        if (event.type === 'invoice.payment_failed') {
          await safeTrackGrowthEvent(serviceClient, {
            userId,
            eventName: 'checkout_failed',
            sourceChannel,
            payload: {
              mode: 'subscription_invoice',
              reason: 'invoice_payment_failed',
              invoice_id: invoice.id,
              subscription_id: subscription.id,
              amount_due_cents: asPositiveInteger(invoice.amount_due || 0),
            },
          });
          await safeUpsertOperatorDailyMetrics(serviceClient, {
            sourceChannel,
            checkoutFailedDelta: 1,
          });
        } else if (event.type === 'invoice.paid' && String(invoice.billing_reason || '') === 'subscription_cycle') {
          await safeTrackGrowthEvent(serviceClient, {
            userId,
            eventName: 'checkout_paid',
            sourceChannel,
            payload: {
              mode: 'subscription_renewal',
              invoice_id: invoice.id,
              subscription_id: subscription.id,
              amount_paid_cents: asPositiveInteger(invoice.amount_paid || 0),
            },
          });
          await safeUpsertOperatorDailyMetrics(serviceClient, {
            sourceChannel,
            checkoutPaidDelta: 1,
            boostMrrCentsDelta: asPositiveInteger(invoice.amount_paid || 0),
          });
        }
      }
    }

    if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object as Stripe.Subscription;
      const stripeCustomerId = typeof subscription.customer === 'string' ? subscription.customer : null;
      const userId = await resolveUserIdFromStripeCustomer(serviceClient, stripeCustomerId);

      if (userId) {
        affectedUsers.add(userId);
        await upsertSubscriptionFromStripe(serviceClient, userId, subscription);
      }
    }

    for (const userId of affectedUsers) {
      await recalculateEntitlements(serviceClient, userId);
    }

    await serviceClient.from('billing_webhook_events').insert({
      event_id: event.id,
      event_type: event.type,
    } as never);

    return jsonResponse(200, {
      ok: true,
      processed: true,
      affectedUsers: Array.from(affectedUsers),
      activeStatuses: Array.from(ACTIVE_SUBSCRIPTION_STATUSES),
    });
  } catch (error) {
    return jsonResponse(400, { error: String(error) });
  }
});
