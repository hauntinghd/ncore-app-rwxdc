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
      }
    }

    if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') {
      const invoice = event.data.object as Stripe.Invoice;
      const stripeCustomerId = typeof invoice.customer === 'string' ? invoice.customer : null;
      const userId = await resolveUserIdFromStripeCustomer(serviceClient, stripeCustomerId);
      if (userId) {
        affectedUsers.add(userId);
      }

      if (userId && typeof invoice.subscription === 'string') {
        const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
        await upsertSubscriptionFromStripe(serviceClient, userId, subscription);
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
