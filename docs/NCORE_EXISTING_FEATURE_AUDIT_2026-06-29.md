# NCore Existing Feature Audit

Date: 2026-06-29
Project: `D:\RWxDC\project`

This audit records what NCore already has before choosing the next build sprint.

## Executive Read

NCore is not starting from zero. The app already has serious foundations in:

- direct messages and group DMs
- E2E direct message encryption
- server/community chat
- direct calls, server voice, screen share, push-to-talk, device controls
- Agora RTC today, LiveKit self-host path prepared
- Discord-style custom roles and channel permission overrides
- Stripe billing, subscriptions, one-time purchases, marketplace orders
- seller wallets, escrow-like service order flow, game marketplace purchase flow
- marketplace seller/game/service surfaces
- developer portal, bots, webhooks
- forums, threads, reactions, pins, attachments, typing indicators, seen state
- mobile push and desktop auto-update foundations

The next work should harden and connect what exists, not blindly add duplicate systems.

## Encryption / Privacy

Status: **Real foundation, not production-finished as default private messaging.**

Already present:

- AES-256-GCM message encryption in `src/lib/crypto/e2e.ts`
- ECDH P-256 key agreement and HKDF-derived AES keys
- per-recipient encrypted payload fan-out in `src/lib/crypto/e2eManager.ts`
- public identity key table in `supabase/migrations/20260522212000_e2e_dms.sql`
- `direct_messages.ciphertext` and `direct_messages.e2e_version`
- DM send path encrypts content when E2E is enabled and peer keys are available
- encrypted messages store a placeholder in `content` and ciphertext in `ciphertext`

Hardening applied 2026-07-01:

- E2E now defaults on unless `VITE_ENABLE_E2E_DMS` is explicitly set to `false`, `0`, or `off`
- DM send now fails closed when recipient encryption keys cannot be resolved
- new DM attachments encrypt file bytes client-side before upload and store only an encrypted file-key envelope in `direct_message_attachments.encryption_metadata`
- E2E identity publishing now includes `e2e_device_keys`; new message and attachment envelopes fan out to every active recipient device while keeping a legacy per-user envelope slot

Remaining important gaps:

- device-key revocation and user-facing device management still need a settings surface
- private keys are stored in localStorage as exported JWK, which is not strong enough for a final threat model
- encrypted attachment UX still needs explicit trust/safety indicators and stronger failure recovery
- no visible user-facing safety verification flow was confirmed beyond lower-level code

Conclusion:

To satisfy "even the owner cannot read DMs," the next encryption sprint is **E2E hardening**, not first implementation:

1. force E2E on for all new DMs in production
2. remove silent plaintext fallback for E2E conversations
3. add encrypted attachments
4. add device management, revocation, and recovery
5. move private key storage to safer platform storage where possible
6. add user-visible safety numbers / key change warnings
7. add tests proving database rows contain no readable plaintext

## Monetization / Creator Money

Status: **Substantial foundation, creator subscriptions and paid roles not finished.**

Already present:

- Stripe checkout function supports:
  - `boost_subscription`
  - `one_time_purchase`
  - `marketplace_service_listing_fee`
  - `marketplace_service_order`
  - `marketplace_game_listing_fee`
  - `marketplace_game_purchase`
- Stripe webhook records subscriptions, purchases, marketplace GMV, fees, and recalculates entitlements
- Boost subscription exists as `boost_monthly`
- user entitlements table and `get_effective_entitlements()` RPC exist
- entitlement UI shows caps like message length, upload size, max screen-share quality
- marketplace has services, games, listing fees, purchases, reviews, seller analytics
- seller wallets and ledger exist
- service order flow credits seller pending balance net platform fee
- game purchase flow credits seller available balance net platform fee
- marketplace capability gates exist

Important gaps:

- creator/server subscriptions are not confirmed as a complete user-facing product
- paid roles/gated channels are not confirmed as a complete flow
- payout rails to external bank/Stripe Connect are not confirmed
- anti-pay-to-win policy is not encoded into product rules
- paid role access needs to connect billing entitlement -> role assignment -> channel permission gating

Conclusion:

NCore can make money without pay-to-win by using:

- creator memberships
- paid community roles
- paid private/gated channels
- marketplace services and game sales
- premium storage/upload/streaming quality
- cosmetics and identity perks
- developer/bot distribution later

The next monetization sprint should be **Paid Role Subscriptions**:

1. add server subscription products owned by community creators
2. map a paid plan to a community role
3. grant/revoke role from Stripe subscription webhook
4. use existing permission overrides to gate channels
5. keep monetized features community/content oriented, not competitive power

## Roles / Permissions

Status: **Strong Discord-style foundation.**

Already present:

- `community_roles`
- `community_member_roles`
- `channel_role_overrides`
- `community_member_permissions()`
- permission bits for view/read/send/attach/react/mention/manage/connect/speak/video/mute/deafen/manage roles/kick/ban/admin/audit log
- `CustomRolesSection` UI for creating/updating roles and toggling permissions

Important gaps:

- need audit of every channel/message action to verify it uses permission bits, not only legacy owner/admin checks
- need paid role assignment flow
- need channel override UI audit

Conclusion:

The role engine exists. The next move is enforcement coverage and paid-role connection.

## Voice / Calls

Status: **Feature-rich, but next leap is measurement and LiveKit production proof.**

Already present:

- direct call route and page
- server voice route and page
- mute/deafen
- push-to-talk
- screen share
- screen-share quality caps
- device picker
- network quality bars
- RTT/average ping state
- packet loss state
- Agora provider
- LiveKit provider
- LiveKit token edge function
- LiveKit deployment files
- RNNoise / AI denoising path
- persistent server voice bar/shell state

Important gaps:

- LiveKit path needs production proof
- best-region probing is not confirmed
- join-to-first-audio telemetry is not confirmed
- actual LiveKit stats are currently approximated from connection quality, not full RTT/loss telemetry
- multi-region SFU failover is not implemented

Conclusion:

Do not "add voice." NCore has voice. The next voice sprint is:

1. make LiveKit measurable
2. add region probing
3. record join-to-first-audio
4. deploy one LiveKit node
5. compare Agora vs LiveKit with real telemetry
6. expand to multi-region routing

## Discord-Class Messaging And Community Features

Status: **Many parity pieces already exist.**

Already present or strongly indicated:

- text channels
- voice channels
- forum channels
- threads panel
- message replies/thread roots
- message reactions
- message attachments
- direct message attachments
- pins
- typing indicators
- seen state for DMs
- group DMs
- invites
- scheduled events
- bots
- webhooks
- developer portal
- marketplace/discovery surfaces

Important gaps:

- global/full-text search needs confirmation
- moderation/reporting UX needs audit
- server templates/member screening need audit
- app directory/event gateway is not confirmed

## Correct Next Sprint

Given what already exists, the next sprint should not be "add Discord features" generically.

The highest-value sprint is:

1. **E2E hardening**
   - force E2E for DMs
   - stop silent plaintext fallback
   - encrypt attachments
   - add multi-device plan
   - add safety-number UI and tests

2. **Paid role subscriptions**
   - connect Stripe subscription -> entitlement -> community role
   - gate channels using existing permission overrides
   - build creator subscription management UI
   - add non-pay-to-win rules

3. **Voice measurement**
   - add join-to-first-audio telemetry
   - add region probing
   - expose diagnostics
   - prove LiveKit production route

This gets NCore closer to being better than Discord without rebuilding systems that already exist.
