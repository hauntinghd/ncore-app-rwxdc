#!/usr/bin/env bash
set -euo pipefail

# Deploy Supabase migrations and Edge Functions.
# Usage:
#  PROJECT_REF=<your-project-ref> PG_CONN="<postgres-connection-string>" \
#    AGORA_APP_ID=... AGORA_APP_CERTIFICATE=... SUPABASE_ANON_KEY=... SUPABASE_URL=... \
#    ./scripts/deploy_supabase.sh

if ! command -v supabase >/dev/null 2>&1; then
  echo "supabase CLI is not installed. Install from https://supabase.com/docs/guides/cli"
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is not installed. Install PostgreSQL client tooling."
  exit 1
fi

: ${PROJECT_REF:?"PROJECT_REF env var is required (Supabase project ref)"}
: ${PG_CONN:?"PG_CONN env var is required (Postgres connection string)"}

echo "Linking supabase CLI to project ${PROJECT_REF}"
supabase link --project-ref "$PROJECT_REF"

echo "Applying SQL migrations from supabase/migrations/"
for f in "$(pwd)"/supabase/migrations/*.sql; do
  echo "-- Applying: $f"
  psql "$PG_CONN" -f "$f"
done

echo "Deploying Edge Functions: agora-token, send-call-push, billing-*"
supabase functions deploy agora-token --project-ref "$PROJECT_REF"
supabase functions deploy send-call-push --project-ref "$PROJECT_REF"
supabase functions deploy billing-create-checkout-session --project-ref "$PROJECT_REF"
supabase functions deploy billing-create-portal-session --project-ref "$PROJECT_REF"
supabase functions deploy billing-webhook --project-ref "$PROJECT_REF"

echo "Setting required function secrets (AGORA_*, STRIPE_*, optional FCM_SERVER_KEY)."
if [ -n "${AGORA_APP_ID:-}" ]; then
  supabase secrets set AGORA_APP_ID="$AGORA_APP_ID" --project-ref "$PROJECT_REF"
fi
if [ -n "${AGORA_APP_CERTIFICATE:-}" ]; then
  supabase secrets set AGORA_APP_CERTIFICATE="$AGORA_APP_CERTIFICATE" --project-ref "$PROJECT_REF"
fi
if [ -n "${STRIPE_SECRET_KEY:-}" ]; then
  supabase secrets set STRIPE_SECRET_KEY="$STRIPE_SECRET_KEY" --project-ref "$PROJECT_REF"
fi
if [ -n "${STRIPE_WEBHOOK_SECRET:-}" ]; then
  supabase secrets set STRIPE_WEBHOOK_SECRET="$STRIPE_WEBHOOK_SECRET" --project-ref "$PROJECT_REF"
fi
if [ -n "${STRIPE_PRICE_BOOST_MONTHLY:-}" ]; then
  supabase secrets set STRIPE_PRICE_BOOST_MONTHLY="$STRIPE_PRICE_BOOST_MONTHLY" --project-ref "$PROJECT_REF"
fi
if [ -n "${FCM_SERVER_KEY:-}" ]; then
  supabase secrets set FCM_SERVER_KEY="$FCM_SERVER_KEY" --project-ref "$PROJECT_REF"
fi

echo "Deploy complete. Please verify migrations and functions in Supabase dashboard."
