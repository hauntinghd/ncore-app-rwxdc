# NCore Discord Replacement Research

Date: 2026-06-29
Project: `D:\RWxDC\project`
Branch: `ncore/v12-infrastructure-overhaul`

## Goal

Build NCore into a Discord-class communication platform with a sharper promise:

- privacy-forward by default
- voice/video that is measurably faster and more reliable
- creator and community monetization built in
- desktop, web, mobile, and server workflows that feel complete

## Hard Latency Reality

Sub-nanosecond global voice latency is not physically possible. Light travels about 30 cm per nanosecond in vacuum, and fiber is slower. Japan-to-Jamaica traffic has a hard floor in the tens of milliseconds before routing, jitter buffers, codecs, device capture, audio playback, and packet loss recovery.

The correct engineering target is physics-aware real time:

- one-way audio target: 30-80 ms regional, 120-200 ms intercontinental when routing is good
- join-to-audio target: under 500 ms for warm sessions
- reconnection target: under 2 seconds for region/node failover
- jitter buffer target: adaptive, low-latency default for trusted networks, stability-biased when packet loss rises
- user-facing metric: show RTT, packet loss, region, route quality, and failover events

## What Discord Actually Built

Discord's durable advantages are product-system advantages, not only chat UI.

### Core Product Loop

- account identity and friend graph
- servers with channels, categories, roles, permissions, invites, discovery, and moderation
- direct messages, group DMs, message search, mentions, replies, reactions, uploads, embeds
- voice channels that are persistent spaces, not formal meetings
- instant direct calls, video, screen sharing, push-to-talk, mute/deafen, device controls
- mobile, desktop, browser parity
- bots, webhooks, developer APIs, gateway events, app directory
- subscriptions, Nitro perks, boosts, store cosmetics, quests, creator/server monetization

### Voice Architecture

Discord's public engineering writeup says the key decisions were:

- use client-server voice instead of peer-to-peer so IP addresses are hidden, moderation is possible, and large rooms do not collapse under mesh networking
- use WebRTC across clients, with custom native media engine behavior for desktop/mobile
- use a dedicated voice gateway plus UDP media path
- assign guilds/voice spaces to voice servers based on region, load, and health
- run an SFU/media relay optimized for their usage pattern
- avoid sending audio during silence to reduce bandwidth and CPU
- collect client quality metrics and use them for operations
- fail over voice servers by selecting a new voice endpoint and forcing clients to reconnect

### Security And Privacy

Discord has moved audio/video toward DAVE, an end-to-end encrypted A/V protocol:

- media keys are not known to Discord during E2EE calls
- keys rotate as participants join and leave
- protocol design is public and externally reviewed
- calls expose privacy/verification codes
- the SFU still forwards packets, but media inside packets is encrypted

Messages are still not end-to-end encrypted on Discord.

### Current User Backlash Area

Discord is testing age assurance methods in June-July 2026, including Incode for selfie and ID scan flows. Discord's support page says the Incode selfie flow is intended to keep biometric data on device, and ID scan data is sent to the vendor, processed automatically, then deleted after age confirmation. The user concern is still strategically useful for NCore: do not normalize invasive identity checks as a default product path.

## NCore Current State

NCore already has a strong foundation:

- React/Vite web app
- Electron desktop app
- Capacitor Android app
- Supabase auth/database/realtime/functions
- communities, channels, DMs, friends, marketplace, billing, push, notifications
- direct calls and server voice
- Agora RTC provider with token function
- LiveKit RTC provider and deployment files for self-hosted SFU
- RNNoise/AI denoising assets
- E2E direct message crypto on this branch
- voice privacy code UI concept already present in call state

Current branch status on 2026-06-29:

- clean working tree
- `npm.cmd run typecheck` passes
- `npm.cmd run lint` passes with existing warnings only

## Strategic Positioning

NCore should not merely copy Discord. The wedge should be:

> Discord-class communities with better privacy, lower-latency voice, and native creator monetization.

That gives us a reason to exist beyond "another chat app."

## Build Priorities

### 1. Voice Reliability And Latency

This is the main technical differentiator.

- finish LiveKit production path instead of staying dependent on Agora
- deploy regional LiveKit SFUs: US-East, US-West, EU-West, APAC first
- add region selection and automatic best-region probing
- add latency telemetry events: join time, time-to-first-audio, RTT, packet loss, reconnects, selected region
- add a call diagnostics panel that explains the route and failure reason plainly
- add SFU health checks and endpoint failover
- tune Opus/WebRTC for low latency while preserving intelligibility
- keep push-to-talk, mute/deafen, VAD, RNNoise, device switching, and screen-share fallback paths solid

### 2. Privacy Better Than Discord

- default to E2E for DMs and call media where feasible
- expose privacy codes in a way users can understand
- publish a human-readable privacy promise
- avoid mandatory biometric/ID checks unless legally unavoidable
- if age gating is required, prefer privacy-preserving vendor choices, local processing, minimal retention, clear appeals, and region-scoped enforcement

### 3. Discord Feature Parity That Matters

Must-have:

- servers/communities, categories, text/voice/forum/stage-like channels
- roles, custom permissions, audit logs, moderation tools
- friends, DMs, group DMs, active call cards
- invites, onboarding, member screening, server templates
- threads, forums, pins, search, reactions, mentions, reply chains
- robust notification controls
- bots, webhooks, developer portal, app tokens
- desktop tray/background behavior and auto-update
- mobile push and Android install path

Nice-to-have after core reliability:

- activities/games
- server discovery
- soundboard
- custom themes/cosmetics
- rich presence and game overlay
- streaming/Go Live equivalent

### 4. Monetization

NCore should make money through platform utility, not only cosmetics.

- creator/server subscriptions
- paid roles and gated channels
- marketplace service fees
- premium storage/upload tiers
- high-quality streaming tier
- team/community admin tier
- bot/developer paid distribution
- payment rails through Stripe/Supabase functions already present in repo

### 5. Developer Ecosystem

Discord became sticky because communities could automate themselves.

- public bot API
- webhooks
- event subscriptions
- OAuth/app install flow
- permissions/scopes
- app directory
- rate limits and audit logs

## Immediate Execution Plan

1. Add a current-state audit for NCore feature parity against Discord.
2. Make LiveKit the measurable path: local provider test, token function test, then one production SFU.
3. Add best-region probing and a voice diagnostics surface.
4. Add production telemetry for call connection quality.
5. Build the privacy/age-assurance policy page before any controversial checks exist.
6. Harden creator monetization flows and make paid roles/gated channels real.
7. Run E2E tests for auth, DM, call, server voice, marketplace, and updates.

## Key Sources

- Discord voice architecture: https://discord.com/blog/how-discord-handles-two-and-half-million-concurrent-voice-users-using-webrtc
- Discord DAVE E2EE A/V: https://discord.com/blog/meet-dave-e2ee-for-audio-video
- Discord voice connection docs: https://docs.discord.com/developers/topics/voice-connections
- Discord age assurance support: https://support.discord.com/hc/en-us/articles/30326565624343-How-to-Complete-Age-Assurance-on-Discord
- Discord threads FAQ: https://support.discord.com/hc/en-us/articles/4403205878423-Threads-FAQ
- Discord forums FAQ: https://support.discord.com/hc/en-us/articles/6208479917079-Forum-Channels-FAQ
- Discord Nitro page: https://discord.com/nitro
