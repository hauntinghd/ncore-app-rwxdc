# NCore Ultra-Low-Latency Moonshot

Date: 2026-06-29
Project: `D:\RWxDC\project`

## Non-Negotiable Ambition

The target is sub-nanosecond global voice, join audio, calls, chat presence, and every Discord-class real-time interaction.

That is not possible with known physics over global distance. A nanosecond is roughly the time light needs to travel 30 cm in vacuum, and real network paths through fiber, routers, radios, operating systems, codecs, and audio devices are far slower. Japan-to-Jamaica cannot transmit actual newly spoken audio in under one nanosecond under known physics.

NCore will still be built around the ambition. The engineering rule is:

> Attack every latency source we can control, measure every source we cannot, and keep a separate research lane for technology beyond current infrastructure.

## What "Closest To Sub-Nanosecond" Means In Executable Terms

We optimize four layers:

- actual transport latency: how fast packets move
- media pipeline latency: capture, encode, jitter buffer, decode, playback
- session latency: how fast users join, reconnect, and hear first audio
- perceived latency: how instant the app feels while preserving truth and privacy

## Tier 1: Immediate Engineering Path

This is the path that can ship in NCore.

### Global SFU Mesh

- self-host LiveKit or a custom SFU network
- regions: US-East, US-West, EU-West, APAC, South America, Africa, Oceania
- every client probes candidate voice regions before joining
- room placement chooses the lowest median latency for all participants, not only the creator
- failover moves rooms when packet loss, RTT, or region health degrades
- voice nodes expose health, load, UDP reachability, and packet-loss probes

### Voice Fast Path

- prefer UDP media
- keep TCP/TURN as fallback only
- tune Opus for low-latency speech
- minimize jitter buffer when network quality allows it
- use voice activity detection to avoid wasted send path
- keep denoising optional and measurable because heavy processing can add delay
- use native desktop capture/audio paths in Electron where browser APIs add overhead

### Join Fast Path

- prewarm auth/session state
- prefetch RTC token before the user clicks join when intent is obvious
- keep media permissions and selected devices cached
- pre-probe voice regions after login and when network changes
- target warm join-to-first-audio under 500 ms, then drive down from there

### NCore Telemetry Required

Every call and voice channel must capture:

- selected voice region
- candidate region probe RTTs
- join start time
- RTC connected time
- first remote audio time
- first local publish time
- RTT samples
- jitter samples where available
- packet loss
- reconnect count
- failover count
- device setup time
- token fetch time
- SFU node ID

No latency claim counts unless NCore records it.

## Tier 2: Custom Infrastructure Path

If LiveKit is not enough, NCore builds its own media infrastructure.

### Custom Voice Edge

- Rust or C++ SFU optimized only for NCore's voice/channel model
- QUIC/WebTransport signaling experiments
- UDP/RTP media fast path
- kernel-bypass networking research for high-scale edge nodes
- programmable congestion control tuned for speech before video
- custom room placement algorithm using global latency matrices
- edge-local presence and signaling cache

### Private Backbone

If public internet routing is the bottleneck:

- lease cloud regions close to major internet exchanges
- use providers with premium backbone routing
- later evaluate dedicated inter-region transit
- monitor BGP path drift and route around bad paths
- keep voice edge close to users, not just close to cheap servers

## Tier 3: Beyond-Known-Physics Research Lane

This lane is not a promise that the impossible is currently buildable. It is where we track anything that could change the limits:

- quantum networking research
- photonic switching and optical interconnects
- edge prediction that reduces perceived turn-taking delay without pretending to transmit future audio
- local semantic/presence prediction for UI responsiveness
- new codecs with lower frame sizes and lower algorithmic delay
- hardware audio pipeline reductions
- operating-system real-time scheduling for capture/playback

Important boundary:

- prediction can make UI feel instant
- prediction cannot truthfully transmit words before the speaker produces them
- NCore must not fake another person's speech as if it were received audio

## Discord-Complete Scope

NCore must match or exceed Discord in:

- accounts, profiles, presence, friends
- DMs, group DMs, message search, attachments, embeds
- communities/servers, categories, channels
- roles, permissions, moderation, audit logs
- text, voice, video, screen share, stage/forum/thread equivalents
- bots, webhooks, developer portal, event APIs
- desktop app, web app, Android, later iOS
- push notifications, unread state, mentions, notification routing
- safety controls, anti-spam, trust signals
- subscriptions, paid roles, marketplace, creator monetization
- updates, crash handling, diagnostics, observability

## First Build Tasks

1. Add NCore region probing for candidate voice regions.
2. Record join-to-first-audio telemetry in direct calls and server voice.
3. Surface the selected voice region and RTT in the call diagnostics UI.
4. Deploy one LiveKit node and prove end-to-end voice on it.
5. Expand to four regions and add automatic best-region selection.
6. Compare Agora vs LiveKit vs custom prototype using the same telemetry.
7. Create a Discord parity board from the scope above and burn it down feature by feature.

## Success Standard

NCore does not claim victory because a doc says "low latency."

NCore wins when real users in different parts of the world can open the app, join a room, speak, hear each other with the lowest measurable delay their route allows, recover from failures quickly, and see the proof in diagnostics.
