# NCore core-app ingestion

Date: 2026-07-10  
Scope: static ingestion of the NCore source tree, Supabase migrations, routes, current worktree, and the supplied Discord settings/profile checklist.

## Inventory

- 101 TypeScript/TSX source files, about 43,536 source lines.
- 25 routed product pages, with desktop Electron, web, and Capacitor Android support.
- 40 Supabase migrations, including community, marketplace, billing, voice, security, push, custom role, E2E, encrypted attachment, and device-key migrations.
- The largest implementation concentrations are Settings (4,464 lines), DMs (3,984), Marketplace (3,317), direct calling (1,670), app shell (1,564), text channels (1,552), and admin controls (1,532).

This is a real product base. It should be evolved through verification and consolidation, not visually rebuilt.

## Functional core already present

| Area | Evidence in source | Status |
| --- | --- | --- |
| Identity | password auth, email confirmation/reset, profiles, onboarding, session state | **Partial** — signup begins with email/password, then a separate onboarding insert collects username/display name/bio. It omits DOB and is not yet an atomic, fully verified account-creation transaction. |
| Messaging | DMs, group DMs, replies, threads, reactions, pins, typing, seen state, attachments | **Strong** — E2E multi-device/attachments are the active uncommitted hardening slice. |
| Communities | servers/communities, text/voice/forum channels, invites, roles, per-channel overrides, server profiles, events | **Strong but needs enforcement audit.** |
| Calls | direct/server calls, mute/deafen, PTT, devices, screen share, quality controls, Agora/LiveKit abstraction | **Strong foundation** — production telemetry, routing, and failover remain. |
| Safety | client phishing/token checks, account standing, admin risk cases, friend requests, active-session table | **Partial** — do not claim a safety feature is live until the data path and enforcement are live. |
| Commerce | Stripe entitlements, subscriptions, marketplace games/services/orders, seller wallet foundations | **Strong foundation** — creator paid-role subscriptions and payouts remain. |
| Developer ecosystem | developer portal, bots/webhooks schema and UI surfaces | **Partial** — public API/event gateway/app review must be defined and shipped. |
| Gaming | game library/detail pages, games marketplace, Steam listed as a future connection provider | **Early foundation** — not yet a Steam replacement. |

## Settings and profile: actual state, not visual state

The supplied Discord list is a useful product checklist, not proof of NCore parity. The current NCore settings page is a large mixed surface: some controls are functional, some are local preferences, and some intentionally say they are deferred.

| NCore surface | Current state | What makes it production-ready |
| --- | --- | --- |
| My account/profile | Profile, avatar/banner, bio, custom status and account UI exist | Real email-change, verified-email state, editable username policy, signup fields, and a reliable profile-creation transaction. |
| Server profiles | Per-community display name, bio and pronouns persist in `server_profiles` | Add per-server avatar/banner/theme only after permission/privacy rules and storage safeguards are proven. |
| Privacy/status | Main privacy choices and status UI exist | Persist every setting server-side where cross-device behavior matters; add message requests and sensitive-media policy/enforcement. |
| Notifications | UI exists | Audit delivery and per-channel/server overrides against actual desktop/mobile push delivery. |
| Voice/video | Device, PTT, noise processing and calling integrations exist | Validate device selection, diagnostics, quality controls, and failure recovery on all three client surfaces. |
| Appearance/accessibility | UI/preferences exist | Wire preference values to rendering and ensure reduced-motion/high-contrast behavior is testable. |
| Chat/keybind/language/activity/game overlay | Several rows are local rollout toggles or planned configuration | Do not market them as shipped until each has persistent settings plus observable runtime behavior. |
| Connections | Provider catalog is visible | Explicitly staged/not live in source. OAuth/token lifecycle, provider compliance, revocation, and privacy controls must precede launch. |
| Security | Password change and active-session UI exist | The displayed TOTP, WebAuthn and recovery-code controls are placeholders. Build Supabase MFA TOTP, passkeys, recovery, and step-up before claiming 2FA. |
| Billing/boost/gifts | Entitlement/billing foundations exist; several settings are presentation toggles | Tie every account setting to actual Stripe state, invoices, receipts, and supportable entitlement changes. |
| Cosmetics | Marketplace includes cosmetic catalog/preview behavior | Add equipped-item ownership, moderated assets, accessibility/reduced motion, and server/global scoping before profile effects/nameplates/decorations are sold. |
| Notes | Private friend notes are stored locally | Keep their privacy model explicit; add encrypted cross-device sync only if it preserves note-taker-only visibility. |

## Discord profile checklist: NCore product decision

Build the identity system in this order:

1. Account identity and recovery: a single verified signup/onboarding transaction for email, username, display name, DOB/age tier, terms acceptance, real TOTP/passkey/recovery codes, email-change step-up, and session revocation.
2. Expression: global profile, server profile, avatar/banner, custom status, pronouns, bio, connections, and private notes.
3. Trust and privacy: profile visibility, activity visibility, sensitive-media/message-request controls, blocks/reports, account standing.
4. Monetizable cosmetics: decorations, effects, nameplates, profile themes, and badges—only after ownership, moderation, accessibility, and refunds/entitlements are real.
5. Profile board/widgets: favorite/playing/wishlist games and verified game data. This becomes the bridge to the later gaming product, not a superficial clone of Discord's board.

This sequence prevents selling cosmetics before users can trust their account, privacy, and purchase ownership.

## Core release gate

NCore core is ready to move into the Steam/freelancing expansion only when all of these are true:

- Signup, profile creation, confirmation, password reset, MFA, recovery, email change, and session revocation are proven in a test environment.
- The current E2E multi-device + encrypted-attachment work is committed, migrated, and tested on web/desktop/mobile.
- Every permission-sensitive message/channel/community action is covered by the role/override enforcement path.
- Push, calls, uploads, moderation reporting, billing, and support flows have an owner-visible production health check.
- No UI claims that a feature is secure, live, or available when it is a placeholder or a local-only preference.

## Steam and freelancing after the core gate

The Steam layer does **not** need to be web-only. The right design is one shared commerce/library service with web as the canonical storefront and account/library management surface, plus desktop/mobile clients consuming the same APIs. Later desktop work can add an optional launcher, install/update manager, overlay, and game runtime integration.

The next research phase should study Steam/Valve as a legal value-creation system: convenient purchase, reliable updates, cloud/library continuity, community, creator/developer distribution, trust, pricing, and legitimate alternatives that make piracy less attractive. It must not be framed as bypassing copyright controls or DRM.
