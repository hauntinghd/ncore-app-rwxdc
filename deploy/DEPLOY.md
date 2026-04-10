# NCore v12 Deployment Guide

## Overview

5 steps to go live with the full v12 infrastructure:

1. Run database migrations (Supabase)
2. Deploy LiveKit server(s)
3. Build RNNoise WASM binary
4. Set environment variables
5. Deploy to Vercel

---

## Step 1: Database Migrations

Run the two new migrations on your Supabase instance.

```bash
# From project root
cd project

# Option A: Via Supabase CLI (if linked)
npx supabase db push

# Option B: Via SQL Editor in Supabase Dashboard
# Copy-paste the contents of these files into the SQL Editor:
#   supabase/migrations/20260409100000_security_hardening_v2.sql
#   supabase/migrations/20260409100100_marketplace_expansion.sql
```

**What this creates:**
- 9 security tables (sessions, anomalies, audit log, URL cache, join events, 2FA, bots, webhooks)
- 12 marketplace tables (briefs, applications, reviews, game categories, wishlists, bundles, mods, events)
- 2 functions (`detect_raid()`, `get_seller_commission_bps()`)
- Forum + stage channel types

---

## Step 2: Deploy LiveKit Server

### Quick Start (Single Server)

```bash
# On your VPS/cloud server (Ubuntu 22.04+ recommended)

# 1. Install Docker
curl -fsSL https://get.docker.com | sh

# 2. Copy deployment files
scp -r deploy/livekit/* user@your-server:/opt/ncore-livekit/

# 3. SSH into server
ssh user@your-server
cd /opt/ncore-livekit

# 4. Generate API keys
docker run --rm livekit/generate generate-keys
# Output:
#   API Key: APIdxxxxxxxxx
#   API Secret: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# 5. Create .env
cp .env.example .env
nano .env
# Set: DOMAIN, LIVEKIT_API_KEY, LIVEKIT_API_SECRET

# 6. Point DNS
# Add an A record: livekit-use.nyptidindustries.com -> server IP

# 7. Start
docker compose up -d

# 8. Verify
curl https://livekit-use.nyptidindustries.com
# Should return: "OK"
```

### Multi-Region (Global Edge Mesh)

Deploy one instance per region with the SAME API key/secret:

| Region | Domain | Provider Suggestion |
|--------|--------|-------------------|
| US-East | `livekit-use.nyptidindustries.com` | Hetzner Ashburn, DigitalOcean NYC |
| US-West | `livekit-usw.nyptidindustries.com` | Hetzner Hillsboro, DigitalOcean SFO |
| EU-West | `livekit-eu.nyptidindustries.com` | Hetzner Falkenstein, OVH |
| Asia-Pacific | `livekit-ap.nyptidindustries.com` | Hetzner Singapore, DigitalOcean SGP |

Each node uses Redis for room coordination. For multi-node, use a shared Redis cluster (Redis Cloud or self-hosted).

**Cost estimate:** ~$5-20/month per region on Hetzner/DigitalOcean (2 vCPU, 4GB RAM handles hundreds of concurrent rooms).

---

## Step 3: Build RNNoise WASM

```bash
# From project root (requires Docker)
cd deploy/rnnoise
chmod +x build-rnnoise-wasm.sh
./build-rnnoise-wasm.sh

# Build the AudioWorklet processor JS
cd ../../project
npx esbuild src/lib/rtc/noise/rnnoise-worklet-processor.ts \
  --bundle \
  --outfile=public/audio-processors/rnnoise-worklet-processor.js \
  --format=iife \
  --platform=browser
```

**Output files:**
- `public/audio-processors/rnnoise.wasm` (~90KB)
- `public/audio-processors/rnnoise.js` (~15KB)
- `public/audio-processors/rnnoise-worklet-processor.js` (~5KB)

---

## Step 4: Environment Variables

Add these to your `.env` file:

```bash
# === Existing (keep as-is) ===
VITE_SUPABASE_URL=https://pndfytihpwpdhkramuvm.supabase.co
VITE_SUPABASE_ANON_KEY=<your-key>
VITE_AGORA_APP_ID=51e492ca567045828ce968d4b6a15b79

# === NEW: LiveKit ===
VITE_RTC_PROVIDER=livekit
VITE_LIVEKIT_URL=wss://livekit-use.nyptidindustries.com

# === NEW: AI Summarization (optional) ===
# Use any OpenAI-compatible endpoint (OpenAI, Anthropic via proxy, local Ollama, etc.)
# LLM_API_URL=https://api.openai.com/v1/chat/completions
# LLM_API_KEY=sk-...
# LLM_MODEL=gpt-4o-mini
```

**Supabase Edge Function secrets** (set via Dashboard > Edge Functions > Secrets):

```
LIVEKIT_API_KEY=APIdxxxxxxxxx
LIVEKIT_API_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
LLM_API_URL=https://api.openai.com/v1/chat/completions  (optional)
LLM_API_KEY=sk-...  (optional)
LLM_MODEL=gpt-4o-mini  (optional)
```

---

## Step 5: Deploy Edge Functions

```bash
# Deploy all new edge functions
npx supabase functions deploy livekit-token
npx supabase functions deploy webhook-dispatch
npx supabase functions deploy bot-api
npx supabase functions deploy channel-summarize
```

---

## Step 6: Deploy to Vercel

```bash
# From project root
cd project

# Build and deploy
npm run release:web:auto
# This will: bump version, build, deploy to Vercel, alias domains
```

---

## Step 7: Switch from Agora to LiveKit

The switch is controlled by ONE environment variable:

```bash
# In .env, change:
VITE_RTC_PROVIDER=agora    # Current (keeps using Agora)
VITE_RTC_PROVIDER=livekit  # New (uses LiveKit)
```

**Rollback:** Change back to `agora` and redeploy. Zero code changes needed.

---

## Verification Checklist

- [ ] Migrations applied (check tables exist in Supabase SQL editor)
- [ ] LiveKit server responding (`curl https://your-livekit-domain`)
- [ ] LiveKit token function working (`curl -X POST https://your-supabase-url/functions/v1/livekit-token`)
- [ ] RNNoise WASM files in `public/audio-processors/`
- [ ] Voice call works between two users (test DM call)
- [ ] Screen share works
- [ ] Forum channel displays posts
- [ ] Game library page loads
- [ ] Developer portal creates bots
- [ ] Catch Up button generates summary
- [ ] Security shield blocks phishing links (test with `http://discоrd.com` using Cyrillic 'о')

---

## Cost Breakdown

| Service | Cost | Notes |
|---------|------|-------|
| LiveKit (1 region) | $5-10/mo | Hetzner CX22 (2 vCPU, 4GB) |
| LiveKit (4 regions) | $20-40/mo | One server per region |
| Supabase Pro | $25/mo | Required for read replicas |
| Supabase read replicas | $0-50/mo | Per-replica pricing |
| Vercel | $0-20/mo | Free tier covers most usage |
| LLM API (optional) | $0-10/mo | For Catch Up summaries |
| **Total** | **$25-120/mo** | **vs Agora: $0.99/1000 min** |

The LiveKit migration pays for itself once you have ~2,500 minutes of voice/video per month (Agora charges ~$2.50/mo for that, LiveKit is $5 flat).
