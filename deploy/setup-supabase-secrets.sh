#!/bin/bash
# ===========================================================================
# Set Supabase Edge Function secrets for NCore v12
#
# Usage:
#   chmod +x setup-supabase-secrets.sh
#   ./setup-supabase-secrets.sh
#
# Prerequisites:
#   - Supabase CLI installed (npx supabase)
#   - Logged in to Supabase CLI
# ===========================================================================

set -e

echo "=== NCore v12: Supabase Edge Function Secrets Setup ==="
echo ""

# LiveKit credentials
read -p "LiveKit API Key: " LIVEKIT_API_KEY
read -sp "LiveKit API Secret: " LIVEKIT_API_SECRET
echo ""

# Optional: LLM for Catch Up summarization
read -p "LLM API URL (press Enter to skip): " LLM_API_URL
if [ -n "$LLM_API_URL" ]; then
  read -sp "LLM API Key: " LLM_API_KEY
  echo ""
  read -p "LLM Model (default: gpt-4o-mini): " LLM_MODEL
  LLM_MODEL=${LLM_MODEL:-gpt-4o-mini}
fi

echo ""
echo "Setting secrets..."

npx supabase secrets set LIVEKIT_API_KEY="$LIVEKIT_API_KEY"
npx supabase secrets set LIVEKIT_API_SECRET="$LIVEKIT_API_SECRET"

if [ -n "$LLM_API_URL" ]; then
  npx supabase secrets set LLM_API_URL="$LLM_API_URL"
  npx supabase secrets set LLM_API_KEY="$LLM_API_KEY"
  npx supabase secrets set LLM_MODEL="$LLM_MODEL"
fi

echo ""
echo "Deploying edge functions..."

npx supabase functions deploy livekit-token
npx supabase functions deploy webhook-dispatch
npx supabase functions deploy bot-api
npx supabase functions deploy channel-summarize

echo ""
echo "=== Done! All secrets set and functions deployed. ==="
