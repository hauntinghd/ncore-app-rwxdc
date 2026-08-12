# NCore Discord Parity Backlog

Date: 2026-06-29
Project: `D:\RWxDC\project`

This is the execution backlog for making NCore a better Discord-class product.

Status meanings:

- Present: repo already appears to have a working implementation
- Partial: repo has some implementation, but needs audit/hardening
- Missing: not confirmed in repo yet
- Unknown: needs deeper code/product verification

## Identity And Social Graph

| Capability | Status | Notes |
|---|---:|---|
| Accounts/auth | Present | Supabase auth exists |
| Profiles, avatars, banners, status | Present | Profile page and profile fields exist |
| Friends | Present | Friends page exists |
| Blocking/reporting | Unknown | Needs trust/safety audit |
| Rich presence | Missing | Needed for game/activity parity |
| User settings | Present | Settings page exists |

## Messaging

| Capability | Status | Notes |
|---|---:|---|
| Direct messages | Present | DM page exists |
| Group DMs | Partial | Schema/code suggests support; needs UX audit |
| E2E DMs | Partial | Branch commit indicates E2E direct messages |
| Message search | Unknown | Needs audit |
| Replies | Unknown | Needs audit |
| Reactions | Unknown | Needs audit |
| Mentions | Present | Mention rendering exists |
| Attachments/uploads | Unknown | Needs audit |
| Embeds/link previews | Unknown | Needs audit |
| Threads | Partial | Threads panel exists |
| Pins | Unknown | Needs audit |
| Read/unread state | Unknown | Needs audit |

## Communities / Servers

| Capability | Status | Notes |
|---|---:|---|
| Communities/servers | Present | AppShell/community pages exist |
| Categories/channels | Present | Text/voice channel creation exists |
| Roles | Present | Custom roles migration/component exist |
| Permissions | Partial | Needs complete Discord-style matrix audit |
| Invites | Present | Invite route/lib exists |
| Community settings | Present | Community settings page exists |
| Server templates | Missing | Needed for growth |
| Onboarding/member screening | Partial | Onboarding page exists; server screening unknown |
| Discovery | Partial | Discover page exists |
| Audit logs | Partial | Security audit tables exist; UX unknown |
| Moderation queue | Unknown | Needs audit |

## Voice / Video / Screen Share

| Capability | Status | Notes |
|---|---:|---|
| Direct voice/video calls | Present | DirectCallPage exists |
| Server voice channels | Present | VoiceChannelPage/server voice store exist |
| Screen share | Present | Direct and server screen-share paths exist |
| Push-to-talk | Present | `usePushToTalk` exists |
| Mute/deafen | Present | Direct and server voice support it |
| Device switching | Present | In-call device picker exists |
| Network quality UI | Present | NetworkQualityBars exists |
| RNNoise / denoise | Present | RNNoise assets/provider path exist |
| LiveKit self-host path | Partial | Provider and deploy files exist; production proof needed |
| Best-region selection | Missing | First latency build task |
| Join-to-first-audio telemetry | Missing | First latency build task |
| Call diagnostics panel | Partial | Quality UI exists; full diagnostics missing |
| Stage channels | Partial | Migrations mention stage type; UX unknown |
| Activities/watch together | Missing | Later parity |

## Developer Platform

| Capability | Status | Notes |
|---|---:|---|
| Developer portal | Present | DeveloperPortalPage exists |
| Bots | Partial | Bot API function exists |
| Webhooks | Partial | Webhook dispatch function exists |
| OAuth app installs | Unknown | Needs audit |
| Event gateway/subscriptions | Missing | Needed for serious bot ecosystem |
| App directory | Missing | Needed after bot API matures |
| Rate limits/scopes | Unknown | Needs security audit |

## Safety / Privacy

| Capability | Status | Notes |
|---|---:|---|
| E2E message crypto | Partial | Branch says E2E DMs |
| A/V privacy code | Partial | Privacy code state exists |
| Anti-phishing | Partial | Security shield exists |
| Spam/raid detection | Partial | `detect_raid()` migration exists |
| Reporting flow | Unknown | Needs audit |
| Privacy policy UX | Missing | Needed before public push |
| Age assurance policy | Missing | Must be privacy-first and legally scoped |

## Monetization

| Capability | Status | Notes |
|---|---:|---|
| Billing checkout | Present | Supabase billing functions exist |
| Customer portal | Present | Billing portal function exists |
| Entitlements | Present | Entitlements lib exists |
| Marketplace | Present | Marketplace pages exist |
| Paid roles/gated channels | Partial | Needs direct product hardening |
| Creator/server subscriptions | Partial | Needs product flow audit |
| Premium streaming/storage | Missing | Strong revenue path |
| Bot/developer marketplace | Missing | Strong platform path |

## Desktop / Mobile / Distribution

| Capability | Status | Notes |
|---|---:|---|
| Web app | Present | Vite app |
| Desktop app | Present | Electron build exists |
| Auto-update | Present | Update feed/build scripts exist |
| Android app | Present | Capacitor Android exists |
| Push notifications | Partial | Push setup/function exists |
| iOS app | Missing | Later expansion |
| Crash/error telemetry | Partial | Runtime telemetry exists; needs production audit |

## Priority Order

1. Voice latency proof: region probing, join telemetry, diagnostics, LiveKit node.
2. Discord parity audit: turn every Unknown into Present/Partial/Missing with file evidence.
3. Privacy wedge: public policy, E2E clarity, no default biometric/ID flow.
4. Monetization wedge: paid roles, gated channels, creator/server subscriptions.
5. Developer ecosystem: bot permissions, webhooks, event subscriptions, app directory.
6. Growth polish: onboarding, templates, discovery, mobile push, desktop reliability.
