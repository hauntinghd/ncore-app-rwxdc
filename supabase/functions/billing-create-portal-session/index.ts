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

function inferReturnUrl(req: Request): string {
  const origin = req.headers.get('origin') || '';
  if (origin.startsWith('http://') || origin.startsWith('https://')) {
    return `${origin}/app/settings`;
  }
  return 'https://ncore.nyptidindustries.com/app/settings';
}

function sanitizeReturnUrl(value: unknown, fallback: string): string {
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

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey || !stripeSecretKey) {
      return jsonResponse(500, { error: 'Missing required environment configuration' });
    }

    const payload = await req.json().catch(() => ({}));
    const bodyAccessToken = String(payload?.accessToken || '').trim();
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

    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' });
    const returnUrl = sanitizeReturnUrl(payload?.returnUrl, inferReturnUrl(req));

    const { data: billingCustomer, error: billingCustomerError } = await serviceClient
      .from('billing_customers')
      .select('stripe_customer_id')
      .eq('user_id', authData.user.id)
      .maybeSingle();

    if (billingCustomerError) {
      return jsonResponse(500, { error: billingCustomerError.message });
    }

    if (!billingCustomer?.stripe_customer_id) {
      return jsonResponse(404, { error: 'No billing customer found for this account' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: String(billingCustomer.stripe_customer_id),
      return_url: returnUrl,
    });

    return jsonResponse(200, {
      ok: true,
      portalUrl: session.url,
    });
  } catch (error) {
    return jsonResponse(500, { error: String(error) });
  }
});
