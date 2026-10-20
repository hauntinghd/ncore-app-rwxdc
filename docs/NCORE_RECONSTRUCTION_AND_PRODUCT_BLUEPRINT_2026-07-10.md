# NCore reconstruction and product blueprint

## What NCore is

NCore is a cross-platform communications platform: React/Vite for web and desktop (Electron), Capacitor Android, Supabase for data/auth/realtime, and a swappable Agora/LiveKit real-time calling layer. It is intended to replace Discord's communication layer while giving communities and creators a stronger privacy, safety, and earning model.

It already has a serious base: communities and permissions, text/voice/forum channels, DMs and group DMs, threads/replies/reactions/pins/attachments, direct and server calls, screen sharing, push-to-talk, device controls, screen-quality caps, bots/webhooks/developer portal surfaces, scheduled events, Stripe-backed subscriptions/purchases, marketplace/seller flows, mobile push, and desktop updates.

The differentiator is **private by default, community-owned, creator-profitable, and measurable in production**. The goal is not visual Discord imitation; it is a safer and more capable place to communicate, build communities, sell legitimate work, and run real-time experiences.

## Exact continuation point recovered on 2026-07-10

The live branch is `ncore/v12-infrastructure-overhaul`, at `d02ece9` (`feat(e2e): end-to-end encrypted direct messages`). The local worktree is intentionally dirty and contains the next privacy slice. Do not discard it.

| State | Work |
| --- | --- |
| Committed | Markdown, mobile push fan-out, custom roles/channel permission overrides, and the first E2E DM path. |
| In progress, uncommitted | E2E DM attachments and multi-device key fan-out: `e2e_device_keys`, v2 envelopes, sender-device key selection, and encrypted attachment metadata. |
| Verified locally | `npm.cmd run typecheck` and `git diff --check` pass on the current worktree. |
| Still required before release | Apply the existing E2E/push/role migrations, deploy `notify-mobile`, provision push credentials, and test the actual production flow. |

The E2E implementation is real progress, but it is not finished security work. It still needs a device-management/revocation screen, safety-number/key-change UX, secure platform key storage where available, and negative tests proving the database never receives readable E2E DM content.

## Account and security reality check

The current signup screen collects only email and password. The current Settings screen advertises TOTP, WebAuthn, and recovery codes, but its buttons and QR code are placeholders; it must not be presented as functional protection.

The desired account flow should be:

1. Signup: email, username, display name (optional), password, date of birth, and terms/privacy acceptance.
2. Verify the email before meaningful community actions.
3. Offer authenticator-app enrollment immediately after verification, but do not force it for every new user by default. Require it for privileged roles, creator payouts, security-sensitive changes, and risk-based challenges.
4. Use standard TOTP, not a Google-only integration. Google Authenticator, 1Password, Authy, and similar apps all scan the same QR secret format.
5. Generate single-use recovery codes at enrollment; show them once and require the user to acknowledge they saved them.
6. Add passkeys/WebAuthn next. TOTP plus passkeys and recovery codes is much safer than treating a phone number as the only recovery route.
7. For an email change, require a recent password or MFA step-up, notify the old email, verify the new email, and impose a short security hold on high-risk actions. If the old email is unavailable, allow a recovery-code/passkey route; otherwise use a manual support/recovery review with cooldowns. Never let an already-authenticated attacker silently replace both email and MFA.

Supabase has native MFA TOTP APIs for enrollment, challenge, verification, and assurance-level checks. NCore should use those instead of storing a client-managed TOTP secret in the legacy `user_2fa_config` table. The table can remain only for product policy such as `mfa_required_for_creator`, not as the MFA secret source of truth.

## Discord parity map: build value, not a clone

The following is the relevant scope to beat. It is grouped as product capabilities so implementation can be phased and measured.

| Product area | NCore status | Direction that beats Discord |
| --- | --- | --- |
| Identity and safety | Partial; auth exists, account standing and security telemetry exist, MFA UI is placeholder | Real TOTP/passkeys, recovery, trusted devices, risk-based checks, transparent standing/appeals, privacy-preserving teen/family controls. |
| Messaging | Strong; DMs, groups, reactions, threads, attachments, typing, seen state | Finish E2E devices/attachments, key verification, message request/spam inbox, global search, reliable export/import and deletion controls. |
| Communities | Strong; channels, forums, roles, permission overrides, invites, events | Audit every action against the new permission system, then add onboarding/member applications/templates, AutoMod/raid controls, reports and moderator queues. |
| Voice/video | Strong foundation; direct/server calls, screen share, PTT, controls, Agora + LiveKit abstraction | Ship region selection, join-to-first-audio/RTT/loss telemetry, a proven LiveKit route, multi-region failover, and user-visible diagnostics. No product can promise impossible latency across continents. |
| Discovery and apps | Partial; discovery/marketplace and developer surfaces exist | Searchable community discovery, a versioned public API/event gateway, OAuth scopes, app directory, interactive embedded activities, and clear review/security rules. |
| Monetization | Strong base; Stripe, entitlements, marketplace, seller wallet/order flows | Creator subscriptions -> paid role -> gated channel, payouts, transparent fees, cosmetics/storage/quality perks, and strict non-pay-to-win rules. |
| Engagement | Partial | Events, quests/rewards, profiles/cosmetics, games/activities—but only when consent and privacy controls are explicit. |
| Operations | Partial | Audit trails, abuse workflows, incident controls, retention rules, observability, backups, SLOs, staged rollouts, and cost/performance dashboards. |

Discord's current benchmark includes multiple MFA options and backup codes, server verification levels, safety filters/message requests, account standing, family controls, discoverable communities/quests, app directories and embedded activities, scheduled events, boosts, and creator/app monetization. NCore does not need to copy every surface before launch; it needs a safe, reliable core that converts communities because it is materially better at privacy, moderation, ownership, and creator earnings.

## The release-grade sequence

1. **Protect the existing privacy work.** Finish, test, migrate, and commit the E2E multi-device + attachment patch as an isolated release candidate.
2. **Make accounts honest and secure.** Fix profile creation during signup; collect identity fields and age gate; implement Supabase TOTP end-to-end; implement recovery codes, step-up checks, and secure email change. Remove all placeholder security claims until each works.
3. **Make community safety operational.** Message requests/spam, reporting, moderator queues, AutoMod/raid controls, account standing/appeals, and permission-enforcement coverage.
4. **Prove calls in production.** Measure every call; test Agora against LiveKit; deploy regional routing and failover based on evidence rather than claims.
5. **Make communities earn.** Paid role subscriptions and gated channels first, then payout rails and a reviewed app/marketplace ecosystem.
6. **Scale discovery and extensibility.** Community/app discovery, API/gateway/OAuth, activities, public docs, partner review, and abuse economics.

## Sources consulted for this blueprint

- Discord MFA: https://support.discord.com/hc/en-us/articles/219576828-Setting-up-Multi-Factor-Authentication
- Discord verification levels: https://support.discord.com/hc/en-us/articles/216679607-Verification-Levels
- Discord safer messaging: https://support.discord.com/hc/en-us/articles/115000068672-Safer-Messaging-on-Discord
- Discord account standing: https://support.discord.com/hc/en-us/articles/18210965981847-Discord-Warning-System
- Discord apps and activities: https://docs.discord.com/developers/quick-start/overview-of-apps
- Supabase TOTP MFA: https://supabase.com/docs/guides/auth/auth-mfa/totp
