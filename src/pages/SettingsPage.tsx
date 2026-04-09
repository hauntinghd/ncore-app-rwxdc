import { useState, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { User, Lock, Bell, Eye, ChevronRight, Save, AlertCircle, CheckCircle, LogOut, Shield, Monitor, Volume2, Mic, Video, Camera, Upload, X, Star, Zap, Globe, Moon, Sun, Hash, MessageSquare, Trash2, Key, RefreshCw, CreditCard, Award, AlertTriangle, CheckSquare, Info, Server, Download, CreditCard as Edit2, Link2, Keyboard, Languages, Cpu, Gamepad2, Gift } from 'lucide-react';
import {
  siBattledotnet,
  siBungie,
  siCrunchyroll,
  siEpicgames,
  siGithub,
  siLeagueoflegends,
  siPaypal,
  siPlaystation,
  siReddit,
  siRiotgames,
  siRoblox,
  siSpotify,
  siSteam,
  siTiktok,
  siTwitch,
  siX,
  siYoutube,
  type SimpleIcon,
} from 'simple-icons';
import JSZip from 'jszip';
import { AppShell } from '../components/layout/AppShell';
import { Avatar } from '../components/ui/Avatar';
import { Modal } from '../components/ui/Modal';
import { useAuth } from '../contexts/AuthContext';
import { useEntitlements } from '../lib/entitlements';
import { supabase } from '../lib/supabase';
import { resolveBillingReturnUrl } from '../lib/billingUrl';
import { getShieldProtectionItems } from '../lib/securityShield';
import { safeOpenExternalUrl } from '../lib/safeExternal';
import type { UserStatus, ServerProfile, AccountStandingEvent } from '../lib/types';
import { formatFileSize, getRankInfo } from '../lib/utils';
import { enumerateCallDevices, loadCallSettings, saveCallSettings, type MediaDeviceOption } from '../lib/callSettings';
import { applyDirectCallSettings } from '../lib/directCallShell';
import { getCapabilityLockReason, useGrowthCapabilities } from '../lib/growthCapabilities';
import {
  applyReleaseBadges,
  DEFAULT_UPDATE_FEED_URL,
  buildFallbackReleaseLog,
  compareSemver,
  dedupeAndSortReleaseLog,
  fetchLatestInstallerAssetPath,
  fetchLatestMobileInstaller,
  fetchLatestReleaseVersion,
  fetchReleaseNotesFromFeed,
  normalizeUpdateFeedBase,
  resolveFeedAssetUrl,
  type ReleaseLogEntry,
  resolveUpdateFeedBase,
} from '../lib/releaseFeed';
import { promptPwaInstall } from '../lib/pwaRuntime';
import { ROLLOUT_SETTINGS_STORAGE_KEY } from '../lib/streamerMode';
import { resolveGrowthSourceChannel } from '../lib/growthEvents';

type SectionId =
  | 'my-account'
  | 'profile'
  | 'server-profiles'
  | 'privacy'
  | 'notifications'
  | 'voice-video'
  | 'appearance'
  | 'accessibility'
  | 'chat'
  | 'keybinds'
  | 'language-time'
  | 'windows-settings'
  | 'streamer-mode'
  | 'advanced'
  | 'security'
  | 'standing'
  | 'activity-privacy'
  | 'registered-games'
  | 'game-overlay'
  | 'nitro'
  | 'server-boost'
  | 'subscriptions'
  | 'gift-inventory'
  | 'billing'
  | 'connections'
  | 'membership'
  | 'whats-new'
  | 'data-import';

function detectMobileSettingsLayout(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = String(window.navigator.userAgent || '').toLowerCase();
  const isMobileUa = /android|iphone|ipad|ipod|mobile/.test(ua);
  const isTouchDevice = Number(window.navigator.maxTouchPoints || 0) > 0;
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const noHover = window.matchMedia('(hover: none)').matches;
  const compactViewport = window.matchMedia('(max-width: 1023px)').matches;
  const touchViewport = window.matchMedia('(max-width: 1366px)').matches;
  const runtimeMobileClass = document.documentElement.classList.contains('ncore-mobile');
  return (
    isMobileUa
    || compactViewport
    || runtimeMobileClass
    || ((isTouchDevice || coarsePointer || noHover) && touchViewport)
  );
}

interface SectionGroup {
  label?: string;
  items: { id: SectionId; label: string; icon: React.ElementType; danger?: boolean }[];
}

interface RolloutRow {
  key: string;
  label: string;
  description: string;
  defaultEnabled?: boolean;
}

interface RolloutSection {
  title: string;
  subtitle: string;
  groups: { title: string; rows: RolloutRow[] }[];
  notes?: string[];
}

interface ConnectionProvider {
  name: string;
  icon: SimpleIcon | null;
  comingSoon?: boolean;
}

type MediaPermissionState = 'granted' | 'prompt' | 'denied' | 'unsupported' | 'unknown';

interface VoiceDeviceHealth {
  microphonePermission: MediaPermissionState;
  cameraPermission: MediaPermissionState;
  hasMicrophoneDevice: boolean;
  hasSpeakerDevice: boolean;
  hasCameraDevice: boolean;
  inputDeviceValid: boolean;
  outputDeviceValid: boolean;
  cameraDeviceValid: boolean;
  selectedInputLabel: string;
  selectedOutputLabel: string;
  selectedCameraLabel: string;
  checkedAt: string | null;
}

type UpdateLauncherStage = 'checking' | 'downloading' | 'ready' | 'installing' | 'no-update' | 'error';

const EMPTY_DESKTOP_UPDATE_RUNTIME_STATE: DesktopUpdateRuntimeState = {
  ok: true,
  portable: false,
  ready: false,
  checking: false,
  downloading: false,
  progress: 0,
  installing: false,
  version: '',
  latestVersion: '',
  message: '',
};

const DEFAULT_VOICE_DEVICE_HEALTH: VoiceDeviceHealth = {
  microphonePermission: 'unknown',
  cameraPermission: 'unknown',
  hasMicrophoneDevice: false,
  hasSpeakerDevice: false,
  hasCameraDevice: false,
  inputDeviceValid: true,
  outputDeviceValid: true,
  cameraDeviceValid: true,
  selectedInputLabel: 'System Default',
  selectedOutputLabel: 'System Default',
  selectedCameraLabel: 'System Default',
  checkedAt: null,
};

const UPDATE_LAUNCHER_FACTS = [
  'NCore ships desktop installers from the same managed feed that powers What\'s New.',
  'Desktop updates only light up when the installer package and public feed both agree on the same version.',
  'Native capture is preferred first on desktop now to make screen sharing more reliable in Electron.',
  'NCore rotates release badges automatically so only the newest build is marked Current Build.',
  'Your updater feed can serve desktop installers and Android packages from one settings surface.',
  'A clean release path for desktop is `npm run release:update`, not a plain site deploy.',
];

type StandingResourceId = 'guidelines' | 'terms' | 'appeal';

const STANDING_RESOURCE_CONTENT: Record<StandingResourceId, {
  title: string;
  subtitle: string;
  highlights: string[];
  body: string[];
  actionLabel: string;
}> = {
  guidelines: {
    title: 'Community Guidelines',
    subtitle: 'NCore participation standards',
    highlights: ['Respect members', 'No harassment', 'No coordinated abuse'],
    body: [
      'Freedom of speech is supported across NCore, but direct harassment, targeted abuse, and doxxing are not allowed.',
      'Spam, scam automation, impersonation, and malicious account behavior can trigger warnings, restrictions, or removals.',
      'Owners and moderators can remove content that violates community safety constraints.',
    ],
    actionLabel: 'Acknowledge Guidelines',
  },
  terms: {
    title: 'Terms of Service',
    subtitle: 'Account and platform obligations',
    highlights: ['Protect account access', 'Follow payment rules', 'No platform abuse'],
    body: [
      'Accounts are personal and cannot be transferred or used to evade moderation actions.',
      'Billing misuse, chargeback abuse, and fraudulent marketplace behavior are treated as severe violations.',
      'Repeated policy evasion may result in permanent restrictions at account or platform level.',
    ],
    actionLabel: 'Acknowledge Terms',
  },
  appeal: {
    title: 'Appeal a Decision',
    subtitle: 'Request moderation review',
    highlights: ['Reference action ID', 'Provide evidence', 'Keep appeal concise'],
    body: [
      'Appeals should include the action date, decision type, and why you believe the action was inaccurate.',
      'Attach objective evidence where possible (message links, timestamps, screenshots).',
      'Submitted appeals are reviewed in order of severity and volume.',
    ],
    actionLabel: 'Start Appeal Flow',
  },
};

const SECTION_GROUPS: SectionGroup[] = [
  {
    label: 'User Settings',
    items: [
      { id: 'my-account', label: 'My Account', icon: User },
      { id: 'profile', label: 'Profile', icon: Star },
      { id: 'server-profiles', label: 'Server Profiles', icon: Server },
      { id: 'privacy', label: 'Privacy & Status', icon: Eye },
      { id: 'notifications', label: 'Notifications', icon: Bell },
    ],
  },
  {
    label: 'App Settings',
    items: [
      { id: 'voice-video', label: 'Voice & Video', icon: Mic },
      { id: 'appearance', label: 'Appearance', icon: Monitor },
      { id: 'accessibility', label: 'Accessibility', icon: Globe },
      { id: 'chat', label: 'Chat', icon: MessageSquare },
      { id: 'keybinds', label: 'Keybinds', icon: Keyboard },
      { id: 'language-time', label: 'Language & Time', icon: Languages },
      { id: 'windows-settings', label: 'Windows Settings', icon: Monitor },
      { id: 'streamer-mode', label: 'Streamer Mode', icon: Video },
      { id: 'advanced', label: 'Advanced', icon: Cpu },
    ],
  },
  {
    label: 'Activity Settings',
    items: [
      { id: 'activity-privacy', label: 'Activity Privacy', icon: Eye },
      { id: 'registered-games', label: 'Registered Games', icon: Gamepad2 },
      { id: 'game-overlay', label: 'Game Overlay', icon: Monitor },
    ],
  },
  {
    label: 'Billing Settings',
    items: [
      { id: 'nitro', label: 'NCore Boost', icon: Zap },
      { id: 'server-boost', label: 'Server Boost', icon: Shield },
      { id: 'subscriptions', label: 'Subscriptions', icon: CreditCard },
      { id: 'gift-inventory', label: 'Gift Inventory', icon: Gift },
      { id: 'billing', label: 'Billing', icon: CreditCard },
    ],
  },
  {
    label: 'Account',
    items: [
      { id: 'security', label: 'Security', icon: Lock },
      { id: 'standing', label: 'Standing', icon: Shield },
      { id: 'connections', label: 'Connections', icon: Link2 },
      { id: 'membership', label: 'My Membership', icon: CreditCard },
      { id: 'whats-new', label: "What's New", icon: Zap },
      { id: 'data-import', label: 'Data Import', icon: Upload },
    ],
  },
];

const COMING_SOON_SECTION_CONTENT: Partial<Record<SectionId, { title: string; subtitle: string; points: string[] }>> = {
  chat: {
    title: 'Chat',
    subtitle: 'Fine-tune message experience and conversation behavior.',
    points: [
      'Per-channel compact mode and rich media density controls.',
      'Compose toolbar preferences (emoji, GIF, sticker, slash command order).',
      'Typing indicator and reply/mention behavior tuning.',
    ],
  },
  keybinds: {
    title: 'Keybinds',
    subtitle: 'Customize keyboard shortcuts across messaging and calls.',
    points: [
      'Push-to-talk and mute/deafen shortcuts.',
      'Message composer actions (send, newline, edit, jump-to-latest).',
      'Window navigation and quick-open bindings.',
    ],
  },
  'language-time': {
    title: 'Language & Time',
    subtitle: 'Localization preferences and timestamp formatting.',
    points: [
      'UI language and locale-aware formatting controls.',
      '12-hour vs 24-hour timestamp display.',
      'Relative-time and full-date rendering preferences.',
    ],
  },
  'windows-settings': {
    title: 'Windows Settings',
    subtitle: 'Desktop behavior and launch/startup options.',
    points: [
      'System startup behavior and minimize-to-tray preferences.',
      'Hardware acceleration and desktop notification controls.',
      'Autostart, deep-link handling, and desktop integration toggles.',
    ],
  },
  'streamer-mode': {
    title: 'Streamer Mode',
    subtitle: 'Privacy controls for content capture and broadcast sessions.',
    points: [
      'Hide sensitive account details while streaming.',
      'Suppress invite links and private identifiers in overlays.',
      'One-click quick toggle for live sessions.',
    ],
  },
  advanced: {
    title: 'Advanced',
    subtitle: 'Power-user runtime controls and diagnostics.',
    points: [
      'Client debug logging, transport diagnostics, and cache actions.',
      'Experimental feature flags and staged rollout toggles.',
      'Network fallback tuning for unstable links.',
    ],
  },
  'activity-privacy': {
    title: 'Activity Privacy',
    subtitle: 'Control what activity others can see in real time.',
    points: [
      'Show/hide game and app activity from profile surfaces.',
      'Per-surface visibility for voice and screen-share sessions.',
      'Granular privacy defaults for new servers and DMs.',
    ],
  },
  'registered-games': {
    title: 'Registered Games',
    subtitle: 'Manage recognized games and app activity sources.',
    points: [
      'Add or remove detected game executables.',
      'Alias display names for cleaner profile presence.',
      'Whitelist/blacklist specific processes from presence detection.',
    ],
  },
  'game-overlay': {
    title: 'Game Overlay',
    subtitle: 'In-game overlay visibility and interaction options.',
    points: [
      'Overlay position, opacity, and click-through behavior.',
      'Voice controls and call widgets while in-game.',
      'Per-title enable/disable overrides.',
    ],
  },
  nitro: {
    title: 'NCore Boost',
    subtitle: 'NCore premium perks and account-wide enhancements.',
    points: [
      'View premium benefit pack and active status.',
      'Manage plan lifecycle and renewal details.',
      'Track perks unlocked across profile, messaging, and calls.',
    ],
  },
  'server-boost': {
    title: 'Server Boost',
    subtitle: 'Boost allocation and server-level enhancement controls.',
    points: [
      'Assign boost slots across joined servers.',
      'Review active boost impact on media quality and limits.',
      'Transfer or reclaim boost allocations.',
    ],
  },
  subscriptions: {
    title: 'Subscriptions',
    subtitle: 'Manage recurring plans and billing-cycle details.',
    points: [
      'Review active and historical subscriptions.',
      'Update payment methods and billing contact settings.',
      'Cancel or reactivate plans with transparent proration.',
    ],
  },
  'gift-inventory': {
    title: 'Gift Inventory',
    subtitle: 'Track gifts, claims, and redeemable account items.',
    points: [
      'View unclaimed gifts and claim status history.',
      'Redeem and transfer eligible giftable cosmetics.',
      'Review gift codes and entitlement grants.',
    ],
  },
  billing: {
    title: 'Billing',
    subtitle: 'Invoices, receipts, and payment management.',
    points: [
      'Download invoices and payment receipts.',
      'Manage payment methods and tax/billing profile.',
      'View charge history and transaction outcomes.',
    ],
  },
};

const ROLLED_OUT_SECTION_CONTENT: Partial<Record<SectionId, RolloutSection>> = {
  chat: {
    title: 'Chat',
    subtitle: 'Control message density, compose behavior, and moderation-safe defaults.',
    groups: [
      {
        title: 'Compose',
        rows: [
          { key: 'chat_enter_send', label: 'Enter to Send', description: 'Press Enter to send and Shift+Enter for newline.', defaultEnabled: true },
          { key: 'chat_slash_hints', label: 'Slash Command Hints', description: 'Show contextual slash suggestions while typing.', defaultEnabled: true },
          { key: 'chat_emoji_suggest', label: 'Emoji Suggestions', description: 'Suggest emoji aliases while composing messages.', defaultEnabled: true },
        ],
      },
      {
        title: 'Display',
        rows: [
          { key: 'chat_media_embed', label: 'Inline Media Previews', description: 'Render rich embeds for links and media URLs.', defaultEnabled: true },
          { key: 'chat_compact_mode', label: 'Compact Message Layout', description: 'Use denser spacing for high-volume channels.' },
          { key: 'chat_profanity_filter', label: 'Safe Content Filter', description: 'Hide flagged spam/adult content snippets in public surfaces.', defaultEnabled: true },
        ],
      },
    ],
    notes: ['Chat controls are live and stored locally on this client build.'],
  },
  keybinds: {
    title: 'Keybinds',
    subtitle: 'Bind shortcuts for voice, navigation, and chat execution.',
    groups: [
      {
        title: 'Voice',
        rows: [
          { key: 'keybind_ptt', label: 'Push to Talk', description: 'Enable push-to-talk mode for calls and voice channels.' },
          { key: 'keybind_toggle_mute', label: 'Toggle Mute Shortcut', description: 'Allow one-key mute toggle while in-app or in overlay.', defaultEnabled: true },
          { key: 'keybind_toggle_deafen', label: 'Toggle Deafen Shortcut', description: 'Allow one-key deafen toggle.', defaultEnabled: true },
        ],
      },
      {
        title: 'Navigation',
        rows: [
          { key: 'keybind_quick_switcher', label: 'Quick Switcher', description: 'Enable Ctrl+K style quick jump navigation.', defaultEnabled: true },
          { key: 'keybind_mark_read', label: 'Mark Channel Read', description: 'Enable shortcut to clear unread channel badge state.', defaultEnabled: true },
        ],
      },
    ],
  },
  'language-time': {
    title: 'Language & Time',
    subtitle: 'Choose localization and timestamp rendering behavior.',
    groups: [
      {
        title: 'Formatting',
        rows: [
          { key: 'locale_24h', label: '24-Hour Time', description: 'Render timestamps in 24-hour format.' },
          { key: 'locale_relative_time', label: 'Relative Timestamps', description: 'Show "2m ago" style time labels where supported.', defaultEnabled: true },
          { key: 'locale_compact_dates', label: 'Compact Date Format', description: 'Use shorter MM/DD/YYYY style date strings.', defaultEnabled: true },
        ],
      },
      {
        title: 'Translation',
        rows: [
          { key: 'locale_auto_translate', label: 'Auto-Translate Preview', description: 'Display translation controls for foreign-language messages.' },
          { key: 'locale_language_hints', label: 'Language Detection Hints', description: 'Surface language tags on untranslated content.', defaultEnabled: true },
        ],
      },
    ],
  },
  'windows-settings': {
    title: 'Windows Settings',
    subtitle: 'Desktop startup, tray behavior, and native integration controls.',
    groups: [
      {
        title: 'Startup',
        rows: [
          { key: 'win_open_startup', label: 'Open on Startup', description: 'Launch NCore when Windows starts.' },
          { key: 'win_minimize_tray', label: 'Minimize to Tray', description: 'Keep app running in tray when closing window.', defaultEnabled: true },
          { key: 'win_start_minimized', label: 'Start Minimized', description: 'Open in background instead of foreground window.' },
        ],
      },
      {
        title: 'Performance',
        rows: [
          { key: 'win_hw_accel', label: 'Hardware Acceleration', description: 'Use GPU acceleration for rendering and media tasks.', defaultEnabled: true },
          { key: 'win_native_notifs', label: 'Native Notifications', description: 'Use OS-native toast notifications.', defaultEnabled: true },
        ],
      },
    ],
  },
  'streamer-mode': {
    title: 'Streamer Mode',
    subtitle: 'Protect private data while streaming or sharing your screen.',
    groups: [
      {
        title: 'Privacy Masking',
        rows: [
          { key: 'streamer_mode_enabled', label: 'Enable Streamer Mode', description: 'Mask sensitive fields and hide account details when live.' },
          { key: 'streamer_hide_invites', label: 'Hide Invite Links', description: 'Prevent invite links from rendering in overlays.', defaultEnabled: true },
          { key: 'streamer_hide_dm_previews', label: 'Hide DM Message Previews', description: 'Suppress direct message preview text in notifications.', defaultEnabled: true },
        ],
      },
      {
        title: 'Automation',
        rows: [
          { key: 'streamer_auto_enable_obs', label: 'Auto-enable with OBS', description: 'Automatically enable streamer mode when OBS is detected.' },
          { key: 'streamer_silent_notifs', label: 'Silent Notifications', description: 'Mute notification sounds while streamer mode is active.', defaultEnabled: true },
        ],
      },
    ],
  },
  'activity-privacy': {
    title: 'Activity Privacy',
    subtitle: 'Decide who can see your activity and rich presence.',
    groups: [
      {
        title: 'Presence Visibility',
        rows: [
          { key: 'activity_show_games', label: 'Display Active Game', description: 'Show currently detected game in your profile presence.', defaultEnabled: true },
          { key: 'activity_show_music', label: 'Display Listening Activity', description: 'Show music listening activity where available.', defaultEnabled: true },
          { key: 'activity_hide_from_non_friends', label: 'Friends-only Activity', description: 'Hide activity from non-friends and unknown users.' },
        ],
      },
      {
        title: 'Session Sharing',
        rows: [
          { key: 'activity_show_call_status', label: 'Show In-call Status', description: 'Expose call activity in profile presence.', defaultEnabled: true },
          { key: 'activity_allow_join', label: 'Allow Join From Presence', description: 'Allow direct join prompt from trusted friends.' },
        ],
      },
    ],
  },
  'registered-games': {
    title: 'Registered Games',
    subtitle: 'Manage process detection and title mappings for game presence.',
    groups: [
      {
        title: 'Detection',
        rows: [
          { key: 'registered_auto_scan', label: 'Auto Detect Installed Games', description: 'Continuously scan common libraries for new game executables.', defaultEnabled: true },
          { key: 'registered_include_manual', label: 'Include Manual Paths', description: 'Include manually-added executable paths in detection.', defaultEnabled: true },
          { key: 'registered_ignore_launchers', label: 'Ignore Launcher Processes', description: 'Suppress launcher process names from profile activity.', defaultEnabled: true },
        ],
      },
      {
        title: 'Publishing',
        rows: [
          { key: 'registered_share_titles', label: 'Share Detected Titles', description: 'Allow detected titles to appear in your profile and status.', defaultEnabled: true },
          { key: 'registered_allow_aliases', label: 'Use Custom Game Aliases', description: 'Apply custom display names for detected executables.', defaultEnabled: true },
        ],
      },
    ],
  },
  'game-overlay': {
    title: 'Game Overlay',
    subtitle: 'Control in-game overlay behavior and quick actions.',
    groups: [
      {
        title: 'Overlay',
        rows: [
          { key: 'overlay_enabled', label: 'Enable Overlay', description: 'Show NCore overlay in supported fullscreen and borderless titles.', defaultEnabled: true },
          { key: 'overlay_clickthrough', label: 'Click-through Mode', description: 'Allow mouse click-through when overlay is pinned.' },
          { key: 'overlay_show_voice', label: 'Show Voice Controls', description: 'Expose mute/deafen controls in overlay HUD.', defaultEnabled: true },
        ],
      },
      {
        title: 'Capture',
        rows: [
          { key: 'overlay_stream_safe', label: 'Streamer-safe Overlay', description: 'Hide private controls while streaming.', defaultEnabled: true },
          { key: 'overlay_fps_counter', label: 'Overlay FPS Counter', description: 'Show lightweight FPS counter in supported titles.' },
        ],
      },
    ],
  },
  nitro: {
    title: 'NCore Boost',
    subtitle: 'Manage account-wide premium boost status and perks.',
    groups: [
      {
        title: 'Boost Perks',
        rows: [
          { key: 'boost_hd_stream', label: 'HD Stream Unlock', description: 'Unlock higher quality stream and call media presets.', defaultEnabled: true },
          { key: 'boost_profile_perks', label: 'Profile Cosmetics Boost', description: 'Enable boost-only profile and theme cosmetic slots.', defaultEnabled: true },
          { key: 'boost_priority_support', label: 'Priority Support Queue', description: 'Route support tickets through the boosted queue.' },
        ],
      },
    ],
  },
  'server-boost': {
    title: 'Server Boost',
    subtitle: 'Allocate boost slots to servers and track active boost impact.',
    groups: [
      {
        title: 'Allocation',
        rows: [
          { key: 'server_boost_auto_renew', label: 'Auto Renew Boost Slots', description: 'Keep assigned boosts active when cycle renews.', defaultEnabled: true },
          { key: 'server_boost_transfer_guard', label: 'Transfer Guard', description: 'Require confirmation before moving boost slots.', defaultEnabled: true },
          { key: 'server_boost_visible_badge', label: 'Show Boost Badge', description: 'Display boosted supporter badge in boosted communities.', defaultEnabled: true },
        ],
      },
    ],
  },
  subscriptions: {
    title: 'Subscriptions',
    subtitle: 'Control recurring plans, renewals, and billing lifecycle.',
    groups: [
      {
        title: 'Lifecycle',
        rows: [
          { key: 'sub_auto_renew', label: 'Auto Renew', description: 'Automatically renew active subscriptions on billing date.', defaultEnabled: true },
          { key: 'sub_email_receipts', label: 'Email Receipts', description: 'Send billing receipts to your account email.', defaultEnabled: true },
          { key: 'sub_grace_period', label: 'Grace Period Protection', description: 'Maintain features briefly if payment needs retry.', defaultEnabled: true },
        ],
      },
    ],
  },
  'gift-inventory': {
    title: 'Gift Inventory',
    subtitle: 'Track, redeem, and transfer purchased gift entitlements.',
    groups: [
      {
        title: 'Inventory',
        rows: [
          { key: 'gift_auto_claim', label: 'Auto Claim Gifts', description: 'Automatically claim gifts addressed to your account.' },
          { key: 'gift_notify_unclaimed', label: 'Notify Unclaimed Gifts', description: 'Send notifications when unclaimed gifts are available.', defaultEnabled: true },
          { key: 'gift_allow_transfer', label: 'Allow Gift Transfers', description: 'Permit transfer of eligible gift inventory items.', defaultEnabled: true },
        ],
      },
    ],
  },
  billing: {
    title: 'Billing',
    subtitle: 'Manage payment methods, invoices, and account billing profile.',
    groups: [
      {
        title: 'Payments',
        rows: [
          { key: 'billing_store_card', label: 'Store Payment Methods', description: 'Allow secure card/token storage for faster checkout.', defaultEnabled: true },
          { key: 'billing_invoice_emails', label: 'Invoice Email Delivery', description: 'Send invoices and tax receipts to your email.', defaultEnabled: true },
          { key: 'billing_tax_profile', label: 'Business Tax Profile', description: 'Enable tax fields for business purchases and invoicing.' },
        ],
      },
    ],
  },
};

const CONNECTION_PROVIDERS: ConnectionProvider[] = [
  { name: 'Roblox', icon: siRoblox },
  { name: 'Spotify', icon: siSpotify },
  { name: 'Twitch', icon: siTwitch },
  { name: 'Steam', icon: siSteam },
  { name: 'YouTube', icon: siYoutube },
  { name: 'Reddit', icon: siReddit },
  { name: 'GitHub', icon: siGithub },
  { name: 'X', icon: siX },
  { name: 'PlayStation', icon: siPlaystation },
  { name: 'TikTok', icon: siTiktok },
  { name: 'Crunchyroll', icon: siCrunchyroll },
  { name: 'PayPal', icon: siPaypal },
  { name: 'Battle.net', icon: siBattledotnet, comingSoon: true },
  { name: 'Epic Games', icon: siEpicgames, comingSoon: true },
  { name: 'Riot Games', icon: siRiotgames, comingSoon: true },
  { name: 'League of Legends', icon: siLeagueoflegends, comingSoon: true },
  { name: 'Xbox', icon: null, comingSoon: true },
  { name: 'Bungie', icon: siBungie, comingSoon: true },
];

const MAX_DISCORD_IMPORT_MESSAGES = 2000;
const SECTION_IDS: SectionId[] = SECTION_GROUPS.flatMap((group) => group.items.map((item) => item.id));

function buildRolloutToggleDefaults(): Record<string, boolean> {
  const defaults: Record<string, boolean> = {};
  for (const section of Object.values(ROLLED_OUT_SECTION_CONTENT)) {
    if (!section) continue;
    for (const group of section.groups) {
      for (const row of group.rows) {
        defaults[row.key] = Boolean(row.defaultEnabled);
      }
    }
  }
  return defaults;
}

function BrandIconGlyph({ icon, label }: { icon: SimpleIcon | null; label: string }) {
  if (!icon) {
    return (
      <span className="inline-flex h-5 w-5 items-center justify-center rounded text-[10px] font-black text-surface-200">
        {label.slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" fill={`#${icon.hex}`}>
      <path d={icon.path} />
    </svg>
  );
}

function parseSection(value: string | null | undefined): SectionId | null {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  return SECTION_IDS.includes(normalized as SectionId) ? (normalized as SectionId) : null;
}

interface DiscordImportMessage {
  source: string;
  author: string;
  content: string;
  timestamp: string | null;
}

function sanitizeImportText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeImportTimestamp(value: unknown): string | null {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function collectMessagesFromJson(value: unknown, source: string, sink: DiscordImportMessage[], depth = 0) {
  if (!value || depth > 6) return;

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (entry && typeof entry === 'object') {
        const row = entry as any;
        const content = sanitizeImportText(
          row.content ?? row.message ?? row.text ?? row.body ?? row.message_content,
        );
        const author = sanitizeImportText(
          row.author?.username ?? row.author?.name ?? row.author ?? row.sender ?? row.user ?? 'Unknown',
        );
        const timestamp = normalizeImportTimestamp(
          row.timestamp ?? row.created_at ?? row.sent_at ?? row.time,
        );
        if (content) {
          sink.push({
            source,
            author: author || 'Unknown',
            content,
            timestamp,
          });
        }
      }
      if (sink.length >= MAX_DISCORD_IMPORT_MESSAGES) return;
      collectMessagesFromJson(entry, source, sink, depth + 1);
      if (sink.length >= MAX_DISCORD_IMPORT_MESSAGES) return;
    }
    return;
  }

  if (typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  const keysToWalk = ['messages', 'entries', 'data', 'results', 'channel', 'dm'];
  for (const key of keysToWalk) {
    if (key in record) {
      collectMessagesFromJson(record[key], source, sink, depth + 1);
      if (sink.length >= MAX_DISCORD_IMPORT_MESSAGES) return;
    }
  }
}

function collectMessagesFromCsv(csvText: string, source: string): DiscordImportMessage[] {
  const lines = csvText.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].toLowerCase();
  const timestampIndex = header.includes('timestamp') ? header.split(',').findIndex((h) => h.includes('timestamp')) : 0;
  const authorIndex = header.includes('author') ? header.split(',').findIndex((h) => h.includes('author')) : 1;
  const contentIndex = header.includes('content') ? header.split(',').findIndex((h) => h.includes('content')) : 2;
  if (contentIndex < 0) return [];

  const output: DiscordImportMessage[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i].split(',');
    if (cols.length <= contentIndex) continue;
    const content = sanitizeImportText(cols.slice(contentIndex).join(','));
    if (!content) continue;
    output.push({
      source,
      author: sanitizeImportText(cols[authorIndex]) || 'Unknown',
      content,
      timestamp: normalizeImportTimestamp(cols[timestampIndex]),
    });
    if (output.length >= MAX_DISCORD_IMPORT_MESSAGES) break;
  }
  return output;
}

async function extractInvokeErrorMessage(invokeError: any, fallback: string): Promise<string> {
  const base = String(invokeError?.message || fallback);
  const context = invokeError?.context;
  if (!context) return base;

  try {
    if (typeof context.json === 'function') {
      const payload = await context.json();
      const candidate = String(payload?.error || payload?.message || '').trim();
      if (candidate) return candidate;
    }
  } catch {
    // no-op
  }

  try {
    if (typeof context.text === 'function') {
      const raw = String(await context.text()).trim();
      if (raw) return raw;
    }
  } catch {
    // no-op
  }

  return base;
}

function isInvalidJwtMessage(value: unknown): boolean {
  const normalized = String(value || '').toLowerCase();
  return normalized.includes('invalid jwt')
    || normalized.includes('jwt')
    || normalized.includes('unauthorized');
}

async function ensureSessionPresent(): Promise<{ ok: boolean; message?: string; accessToken?: string }> {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    return {
      ok: false,
      message: error.message || 'Authentication session lookup failed.',
    };
  }
  const accessToken = String(data.session?.access_token || '').trim();
  if (!accessToken) {
    return {
      ok: false,
      message: 'Your session has expired. Please sign in again.',
    };
  }
  return { ok: true, accessToken };
}

async function tryRefreshSession(): Promise<{ ok: boolean; accessToken?: string }> {
  const { data, error } = await supabase.auth.refreshSession();
  const accessToken = String(data.session?.access_token || '').trim();
  if (error || !accessToken) {
    return { ok: false };
  }
  return { ok: true, accessToken };
}

function normalizeExternalHttpUrl(targetUrl: string, label: string): string {
  const raw = String(targetUrl || '').trim().replace(/^['"]|['"]$/g, '');
  if (!raw) {
    throw new Error(`${label} is missing.`);
  }

  const toHttpUrl = (value: string): string => {
    const parsed = new URL(value);
    if (!['https:', 'http:'].includes(parsed.protocol)) {
      throw new Error('Only http/https URLs are supported.');
    }
    return parsed.toString();
  };

  try {
    return toHttpUrl(raw);
  } catch {
    // Try alternate URL forms below.
  }

  if (raw.startsWith('//')) {
    try {
      return toHttpUrl(`https:${raw}`);
    } catch {
      // continue
    }
  }

  if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(raw)) {
    try {
      return toHttpUrl(`https://${raw}`);
    } catch {
      // continue
    }
  }

  try {
    const relative = raw.startsWith('/') ? raw : `/${raw}`;
    return toHttpUrl(new URL(relative, window.location.origin).toString());
  } catch {
    throw new Error(`Invalid ${label}: ${raw}`);
  }
}

async function openExternalUrl(targetUrl: string): Promise<void> {
  const normalized = normalizeExternalHttpUrl(targetUrl, 'URL');
  await safeOpenExternalUrl(normalized, {
    trustedDomains: ['nyptidindustries.com', 'ncore.nyptidindustries.com', 'stripe.com', 'supabase.co'],
  });
}

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${checked ? 'bg-nyptid-300' : 'bg-surface-600'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  );
}

function SettingRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-4 border-b border-surface-700/60 last:border-0">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-surface-200">{label}</div>
        {description && <div className="text-xs text-surface-500 mt-0.5 leading-relaxed">{description}</div>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

export function SettingsPage() {
  const { profile, user, updateProfile, signOut } = useAuth();
  const { entitlements, loading: entitlementsLoading, refresh: refreshEntitlements } = useEntitlements();
  const {
    capabilities: growthCapabilities,
    contract,
    loading: growthCapabilitiesLoading,
    refresh: refreshGrowthCapabilities,
  } = useGrowthCapabilities();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeSection, setActiveSection] = useState<SectionId>(() => parseSection(searchParams.get('section')) || 'my-account');
  const [username, setUsername] = useState(profile?.username || '');
  const [displayName, setDisplayName] = useState(profile?.display_name || '');
  const [bio, setBio] = useState(profile?.bio || '');
  const [status, setStatus] = useState<UserStatus>(profile?.status || 'online');
  const [customStatus, setCustomStatus] = useState(profile?.custom_status || '');
  const [customStatusEmoji, setCustomStatusEmoji] = useState(profile?.custom_status_emoji || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [bannerPreview, setBannerPreview] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  const [notifSettings, setNotifSettings] = useState({
    directMessages: true,
    mentions: true,
    communityAnnouncements: true,
    achievements: true,
    newLessons: false,
    friendRequests: true,
    voiceCalls: true,
    systemAlerts: true,
  });

  const [callSettings, setCallSettings] = useState(loadCallSettings);
  const [audioInputs, setAudioInputs] = useState<MediaDeviceOption[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceOption[]>([]);
  const [videoInputs, setVideoInputs] = useState<MediaDeviceOption[]>([]);
  const [applyingVoiceSettings, setApplyingVoiceSettings] = useState(false);
  const [voiceDeviceHealth, setVoiceDeviceHealth] = useState<VoiceDeviceHealth>(DEFAULT_VOICE_DEVICE_HEALTH);
  const [voiceHealthChecking, setVoiceHealthChecking] = useState(false);
  const [voiceHealthMessage, setVoiceHealthMessage] = useState('');
  const [microphoneTesting, setMicrophoneTesting] = useState(false);
  const [speakerTesting, setSpeakerTesting] = useState(false);
  const [cameraTesting, setCameraTesting] = useState(false);
  const [microphoneLevel, setMicrophoneLevel] = useState(0);
  const cameraPreviewRef = useRef<HTMLVideoElement>(null);
  const cameraPreviewStreamRef = useRef<MediaStream | null>(null);
  const microphoneTestStreamRef = useRef<MediaStream | null>(null);
  const microphoneAudioContextRef = useRef<AudioContext | null>(null);
  const microphoneAnimationFrameRef = useRef<number | null>(null);

  const [privacySettings, setPrivacySettings] = useState({
    showOnlineStatus: true,
    allowDmsFromAll: false,
    allowFriendRequests: true,
    showCurrentActivity: true,
    readReceipts: true,
    typingIndicators: true,
  });

  const [serverProfiles, setServerProfiles] = useState<ServerProfile[]>([]);
  const [editingServerProfile, setEditingServerProfile] = useState<ServerProfile | null>(null);
  const [serverProfileForm, setServerProfileForm] = useState({ display_name: '', bio: '', pronouns: '' });
  const [standingEvents, setStandingEvents] = useState<AccountStandingEvent[]>([]);
  const [standingLoaded, setStandingLoaded] = useState(false);
  const [serverProfilesLoaded, setServerProfilesLoaded] = useState(false);
  const buildVersion = __APP_VERSION__;
  const buildDate = new Date(__BUILD_TIME__).toLocaleString();
  const [downloadingUpdate, setDownloadingUpdate] = useState(false);
  const [desktopUpdateRuntimeState, setDesktopUpdateRuntimeState] = useState<DesktopUpdateRuntimeState>(EMPTY_DESKTOP_UPDATE_RUNTIME_STATE);
  const [installingDownloadedUpdate, setInstallingDownloadedUpdate] = useState(false);
  const [updateDownloadMessage, setUpdateDownloadMessage] = useState('');
  const [updateFeedUrlInput, setUpdateFeedUrlInput] = useState(DEFAULT_UPDATE_FEED_URL);
  const [showUpdateLauncher, setShowUpdateLauncher] = useState(false);
  const [updateLauncherStage, setUpdateLauncherStage] = useState<UpdateLauncherStage>('checking');
  const [updateLauncherDetail, setUpdateLauncherDetail] = useState('Contacting the NCore update feed...');
  const [updateLauncherFactIndex, setUpdateLauncherFactIndex] = useState(0);
  const [savingUpdateFeedUrl, setSavingUpdateFeedUrl] = useState(false);
  const discordImportInputRef = useRef<HTMLInputElement>(null);
  const [importingDiscord, setImportingDiscord] = useState(false);
  const [discordImportMessage, setDiscordImportMessage] = useState('');
  const [checkoutLoadingKey, setCheckoutLoadingKey] = useState<string | null>(null);
  const [billingActionMessage, setBillingActionMessage] = useState('');
  const [inviteCodeInput, setInviteCodeInput] = useState('');
  const [redeemingInviteCode, setRedeemingInviteCode] = useState(false);
  const [growthUnlockMessage, setGrowthUnlockMessage] = useState('');
  const [releaseLog, setReleaseLog] = useState<ReleaseLogEntry[]>([]);
  const [latestFeedVersion, setLatestFeedVersion] = useState('');
  const [isMobileSettings, setIsMobileSettings] = useState(() => detectMobileSettingsLayout());
  const [rolloutSettings, setRolloutSettings] = useState<Record<string, boolean>>(() => {
    const defaults = buildRolloutToggleDefaults();
    if (typeof window === 'undefined') return defaults;
    try {
      const raw = window.localStorage.getItem(ROLLOUT_SETTINGS_STORAGE_KEY);
      if (!raw) return defaults;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object') return defaults;
      const merged: Record<string, boolean> = { ...defaults };
      for (const [key, value] of Object.entries(parsed)) {
        if (Object.prototype.hasOwnProperty.call(merged, key)) {
          merged[key] = Boolean(value);
        }
      }
      return merged;
    } catch {
      return defaults;
    }
  });

  useEffect(() => {
    if (!showUpdateLauncher) return undefined;
    const timer = window.setInterval(() => {
      setUpdateLauncherFactIndex((prev) => (prev + 1) % UPDATE_LAUNCHER_FACTS.length);
    }, 1800);
    return () => window.clearInterval(timer);
  }, [showUpdateLauncher]);
  const [connectedProviders, setConnectedProviders] = useState<string[]>([]);
  const [standingResourceModal, setStandingResourceModal] = useState<StandingResourceId | null>(null);
  const rolledOutSection = ROLLED_OUT_SECTION_CONTENT[activeSection];
  const comingSoonSection = rolledOutSection ? null : COMING_SOON_SECTION_CONTENT[activeSection];
  const shieldProtectionItems = getShieldProtectionItems();

  function setRolloutToggle(key: string, value: boolean) {
    setRolloutSettings((prev) => ({ ...prev, [key]: value }));
  }

  function activateSection(section: SectionId) {
    setActiveSection(section);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (section === 'my-account') {
        next.delete('section');
      } else {
        next.set('section', section);
      }
      return next;
    }, { replace: true });
  }

  useEffect(() => {
    const requestedSection = parseSection(searchParams.get('section'));
    const nextSection = requestedSection || 'my-account';
    if (nextSection !== activeSection) {
      setActiveSection(nextSection);
    }
  }, [searchParams, activeSection]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const media = window.matchMedia('(max-width: 1023px)');
    const update = () => setIsMobileSettings(detectMobileSettingsLayout());
    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    const addListener = media.addEventListener?.bind(media);
    const removeListener = media.removeEventListener?.bind(media);
    if (addListener && removeListener) {
      addListener('change', update);
      return () => {
        removeListener('change', update);
        window.removeEventListener('resize', update);
        window.removeEventListener('orientationchange', update);
      };
    }
    media.addListener(update);
    return () => {
      media.removeListener(update);
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(ROLLOUT_SETTINGS_STORAGE_KEY, JSON.stringify(rolloutSettings));
      window.dispatchEvent(new CustomEvent('ncore:rollout-settings-updated'));
    } catch {
      // best-effort local settings persistence
    }
  }, [rolloutSettings]);

  useEffect(() => {
    if (!window.desktopBridge?.setStreamerModeConfig) return;
    void window.desktopBridge.setStreamerModeConfig({
      enabled: Boolean(rolloutSettings.streamer_mode_enabled),
      hideDmPreviews: Boolean(rolloutSettings.streamer_hide_dm_previews),
      silentNotifications: Boolean(rolloutSettings.streamer_silent_notifs),
    });
  }, [
    rolloutSettings.streamer_mode_enabled,
    rolloutSettings.streamer_hide_dm_previews,
    rolloutSettings.streamer_silent_notifs,
  ]);

  useEffect(() => {
    if (!profile) return;
    setUsername(profile.username || '');
    setDisplayName(profile.display_name || '');
    setBio(profile.bio || '');
    setStatus(profile.status || 'online');
    setCustomStatus(profile.custom_status || '');
    setCustomStatusEmoji(profile.custom_status_emoji || '');
  }, [profile]);

  useEffect(() => {
    if (activeSection === 'server-profiles' && !serverProfilesLoaded && profile) {
      supabase
        .from('server_profiles')
        .select('*, community:communities(id, name, icon_url)')
        .eq('user_id', profile.id)
        .then(({ data }) => {
          if (data) setServerProfiles(data as ServerProfile[]);
          setServerProfilesLoaded(true);
        });
    }
  }, [activeSection, serverProfilesLoaded, profile]);

  useEffect(() => {
    if (activeSection === 'standing' && !standingLoaded && profile) {
      supabase
        .from('account_standing_events')
        .select('*')
        .eq('user_id', profile.id)
        .order('created_at', { ascending: false })
        .then(({ data }) => {
          if (data) setStandingEvents(data as AccountStandingEvent[]);
          setStandingLoaded(true);
        });
    }
  }, [activeSection, standingLoaded, profile]);

  useEffect(() => {
    saveCallSettings(callSettings);
  }, [callSettings]);

  useEffect(() => {
    if (activeSection !== 'voice-video') return;
    let cancelled = false;
    const run = async () => {
      await refreshVoiceDeviceHealth();
    };
    void run();

    const onDeviceChange = () => {
      if (!cancelled) {
        void run();
      }
    };
    navigator.mediaDevices?.addEventListener?.('devicechange', onDeviceChange);

    return () => {
      cancelled = true;
      navigator.mediaDevices?.removeEventListener?.('devicechange', onDeviceChange);
    };
  }, [
    activeSection,
    callSettings.inputDeviceId,
    callSettings.outputDeviceId,
    callSettings.cameraDeviceId,
  ]);

  useEffect(() => {
    if (activeSection === 'voice-video') return undefined;
    stopMicrophoneTest();
    stopCameraPreview();
    return undefined;
  }, [activeSection]);

  useEffect(() => () => {
    stopMicrophoneTest();
    stopCameraPreview();
  }, []);

  useEffect(() => {
    if (activeSection !== 'whats-new') return;
    let cancelled = false;
    const fallback = buildFallbackReleaseLog(buildVersion, buildDate);
    const fallbackWithBadges = applyReleaseBadges(fallback, {
      currentBuildVersion: buildVersion,
      latestFeedVersion: buildVersion,
    });
    setReleaseLog(fallbackWithBadges);
    setLatestFeedVersion(buildVersion);

    (async () => {
      try {
        const feedBase = await resolveUpdateFeedBase(DEFAULT_UPDATE_FEED_URL);
        if (cancelled) return;
        setUpdateFeedUrlInput(feedBase);

        const [remoteLog, latestVersion] = await Promise.all([
          fetchReleaseNotesFromFeed(feedBase),
          fetchLatestReleaseVersion(feedBase),
        ]);
        if (cancelled) return;

        const deduped = dedupeAndSortReleaseLog(remoteLog);
        const merged = [...deduped];

        const latest = String(latestVersion || '').trim();
        if (latest && !merged.some((entry) => compareSemver(entry.version, latest) === 0)) {
          merged.unshift({
            version: latest,
            date: 'Latest release',
            badge: 'Release',
            improvements: ['Latest installer published to your configured update feed.'],
            bugFixes: [],
          });
        }

        const hasCurrentBuild = merged.some((entry) => compareSemver(entry.version, buildVersion) === 0);
        if (!hasCurrentBuild) {
          merged.unshift(fallback[0]);
        }

        const normalized = dedupeAndSortReleaseLog(merged);
        const resolvedLatestVersion = String(latest || normalized[0]?.version || buildVersion).trim();
        const finalLog = normalized.length > 0 ? normalized : fallback;
        setReleaseLog(applyReleaseBadges(finalLog, {
          currentBuildVersion: buildVersion,
          latestFeedVersion: resolvedLatestVersion,
        }));
        setLatestFeedVersion(resolvedLatestVersion);
      } catch {
        if (!cancelled) {
          setReleaseLog(fallbackWithBadges);
          setLatestFeedVersion(buildVersion);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeSection, buildDate, buildVersion]);

  useEffect(() => {
    if (activeSection !== 'membership') return;
    void refreshEntitlements();
    void refreshGrowthCapabilities();
    setBillingActionMessage('');
    setGrowthUnlockMessage('');
  }, [activeSection, refreshEntitlements, refreshGrowthCapabilities]);

  const rankInfo = profile ? getRankInfo(profile.xp || 0) : null;
  const growthTierLabel = String(growthCapabilities.trustTier || 'limited')
    .replace(/_/g, ' ')
    .toUpperCase();
  const growthCapabilitiesRows = [
    {
      key: 'can_create_server',
      label: 'Create Servers',
      enabled: growthCapabilities.canCreateServer,
      reason: getCapabilityLockReason('can_create_server', contract.unlock_source),
    },
    {
      key: 'can_start_high_volume_calls',
      label: 'Start High-volume Calls',
      enabled: growthCapabilities.canStartHighVolumeCalls,
      reason: getCapabilityLockReason('can_start_high_volume_calls', contract.unlock_source),
    },
    {
      key: 'can_use_marketplace',
      label: 'Use Marketplace',
      enabled: growthCapabilities.canUseMarketplace,
      reason: getCapabilityLockReason('can_use_marketplace', contract.unlock_source),
    },
  ];
  const updateAhead = compareSemver(latestFeedVersion, buildVersion) > 0;
  const updateStatusMessage = latestFeedVersion
    ? updateAhead
      ? `Update available: v${latestFeedVersion} (installed: v${buildVersion}).`
      : `You are on the latest build (v${buildVersion}).`
    : '';
  const activeUpdateLauncherFact = UPDATE_LAUNCHER_FACTS[updateLauncherFactIndex] || UPDATE_LAUNCHER_FACTS[0];
  const desktopUpdateBusy = downloadingUpdate
    || Boolean(desktopUpdateRuntimeState.checking)
    || Boolean(desktopUpdateRuntimeState.downloading)
    || Boolean(desktopUpdateRuntimeState.installing);
  const desktopUpdateReady = Boolean(desktopUpdateRuntimeState.ready);
  const desktopUpdateProgress = Math.max(0, Math.min(100, Math.round(Number(desktopUpdateRuntimeState.progress || 0))));
  const showInstallUpdateAction = desktopUpdateReady && Boolean(window.desktopBridge?.installDownloadedUpdate);

  async function handleSaveProfile() {
    if (!profile) return;
    setSaving(true);
    setError('');

    const normalizedUsername = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    const nextDisplayName = displayName.trim();
    const nextBio = bio.trim();

    if (normalizedUsername.length < 3) {
      setError('Username must be at least 3 characters and use only letters, numbers, and underscores.');
      setSaving(false);
      return;
    }

    if (!nextDisplayName) {
      setError('Display name is required.');
      setSaving(false);
      return;
    }

    const updates = {
      username: normalizedUsername,
      display_name: nextDisplayName,
      bio: nextBio,
    };

    const { error: err } = await updateProfile(updates as any);
    if (err) {
      const normalizedMessage = String(err.message || '').toLowerCase();
      if (normalizedMessage.includes('duplicate key') || normalizedMessage.includes('unique')) {
        setError('That username is already taken. Try a different one.');
      } else {
        setError(err.message);
      }
    } else {
      setUsername(normalizedUsername);
      setDisplayName(nextDisplayName);
      setBio(nextBio);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    }
    setSaving(false);
  }

  async function handleSaveStatus() {
    setSaving(true);
    setError('');
    const { error: err } = await updateProfile({
      status,
      custom_status: customStatus.trim().slice(0, 160),
      custom_status_emoji: customStatusEmoji.trim().slice(0, 16),
    } as any);
    if (err) setError(err.message);
    else { setSaved(true); setTimeout(() => setSaved(false), 3000); }
    setSaving(false);
  }

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !profile) return;

    const MAX_SIZE = 5 * 1024 * 1024;
    if (file.size > MAX_SIZE) { setError('Image must be under 5MB'); return; }

    setUploadingAvatar(true);
    setError('');

    const preview = URL.createObjectURL(file);
    setAvatarPreview(preview);

    const ext = file.name.split('.').pop();
    const path = `${profile.id}/avatar.${ext}`;

    const { error: uploadErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true });
    if (uploadErr) {
      setError('Failed to upload image: ' + uploadErr.message);
      setAvatarPreview(null);
      setUploadingAvatar(false);
      return;
    }

    const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path);
    const { error: updateErr } = await updateProfile({ avatar_url: publicUrl });
    if (updateErr) setError(updateErr.message);
    else { setSaved(true); setTimeout(() => setSaved(false), 3000); }

    setUploadingAvatar(false);
  }

  async function handleBannerUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !profile) return;

    const MAX_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      setError('Banner image must be under 10MB');
      return;
    }

    setUploadingBanner(true);
    setError('');

    const preview = URL.createObjectURL(file);
    setBannerPreview(preview);

    const ext = file.name.split('.').pop();
    const path = `${profile.id}/banner.${ext}`;

    const { error: uploadErr } = await supabase.storage.from('community-assets').upload(path, file, { upsert: true });
    if (uploadErr) {
      setError('Failed to upload banner: ' + uploadErr.message);
      setBannerPreview(null);
      setUploadingBanner(false);
      return;
    }

    const { data: { publicUrl } } = supabase.storage.from('community-assets').getPublicUrl(path);
    const { error: updateErr } = await updateProfile({ banner_url: publicUrl } as any);
    if (updateErr) {
      setError(updateErr.message);
    } else {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    }

    setUploadingBanner(false);
  }

  async function handleRemoveBanner() {
    setError('');
    const { error: updateErr } = await updateProfile({ banner_url: null } as any);
    if (updateErr) {
      setError(updateErr.message);
      return;
    }
    setBannerPreview(null);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  async function handlePasswordChange() {
    setPasswordError('');
    if (newPassword.length < 8) { setPasswordError('Password must be at least 8 characters'); return; }
    if (newPassword !== confirmPassword) { setPasswordError('Passwords do not match'); return; }

    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) { setPasswordError(error.message); return; }
    setPasswordSaved(true);
    setNewPassword('');
    setConfirmPassword('');
    setTimeout(() => setPasswordSaved(false), 3000);
  }

  async function handleSaveServerProfile() {
    if (!editingServerProfile || !profile) return;
    setSaving(true);
    const { error: err } = await supabase
      .from('server_profiles')
      .update({
        display_name: serverProfileForm.display_name || null,
        bio: serverProfileForm.bio,
        pronouns: serverProfileForm.pronouns,
      })
      .eq('id', editingServerProfile.id);
    if (!err) {
      setServerProfiles(prev => prev.map(sp =>
        sp.id === editingServerProfile.id
          ? { ...sp, ...serverProfileForm }
          : sp
      ));
      setEditingServerProfile(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    }
    setSaving(false);
  }

  function openUpdateLauncher(stage: UpdateLauncherStage, detail: string) {
    setUpdateLauncherStage(stage);
    setUpdateLauncherDetail(detail);
    setUpdateLauncherFactIndex(Math.floor(Math.random() * UPDATE_LAUNCHER_FACTS.length));
    setShowUpdateLauncher(true);
  }

  function applyDesktopUpdateRuntimeState(payload?: DesktopUpdateRuntimeState | null) {
    if (!payload?.ok) return;
    setDesktopUpdateRuntimeState({
      ok: true,
      portable: Boolean(payload.portable),
      ready: Boolean(payload.ready),
      checking: Boolean(payload.checking),
      downloading: Boolean(payload.downloading),
      progress: Number(payload.progress || 0),
      installing: Boolean(payload.installing),
      version: String(payload.version || ''),
      latestVersion: String(payload.latestVersion || ''),
      message: String(payload.message || ''),
    });
    if (!payload.installing) {
      setInstallingDownloadedUpdate(false);
    }
    const runtimeVersion = String(payload.latestVersion || payload.version || '').trim();
    const runtimeMessage = String(payload.message || '').trim();

    if (payload.installing) {
      const detail = runtimeMessage || (runtimeVersion
        ? `Applying NCore v${runtimeVersion} and restarting...`
        : 'Applying update and restarting NCore...');
      setUpdateDownloadMessage(detail);
      if (showUpdateLauncher || downloadingUpdate) {
        setUpdateLauncherStage('installing');
        setUpdateLauncherDetail(detail);
        setShowUpdateLauncher(true);
      }
      return;
    }

    if (payload.ready) {
      const detail = runtimeMessage || (runtimeVersion
        ? `NCore v${runtimeVersion} is downloaded and ready to install.`
        : 'Update downloaded and ready to install.');
      setUpdateDownloadMessage(detail);
      if (showUpdateLauncher || downloadingUpdate) {
        setUpdateLauncherStage('ready');
        setUpdateLauncherDetail(detail);
        setShowUpdateLauncher(true);
      }
      return;
    }

    if (payload.downloading) {
      const percent = Math.max(0, Math.min(100, Math.round(Number(payload.progress || 0))));
      const detail = runtimeMessage || (runtimeVersion
        ? `Downloading NCore v${runtimeVersion}${percent > 0 ? ` (${percent}%)` : ''}...`
        : `Downloading update${percent > 0 ? ` (${percent}%)` : ''}...`);
      setUpdateDownloadMessage(detail);
      if (showUpdateLauncher || downloadingUpdate) {
        setUpdateLauncherStage('downloading');
        setUpdateLauncherDetail(detail);
        setShowUpdateLauncher(true);
      }
      return;
    }

    if (payload.checking) {
      const detail = runtimeMessage || 'Checking for updates...';
      setUpdateDownloadMessage(detail);
      if (showUpdateLauncher || downloadingUpdate) {
        setUpdateLauncherStage('checking');
        setUpdateLauncherDetail(detail);
        setShowUpdateLauncher(true);
      }
      return;
    }

    if (runtimeMessage && (showUpdateLauncher || downloadingUpdate)) {
      const noUpdate = /latest build|already on the latest|no new updates/i.test(runtimeMessage);
      setUpdateDownloadMessage(runtimeMessage);
      setUpdateLauncherStage(noUpdate ? 'no-update' : 'error');
      setUpdateLauncherDetail(runtimeMessage);
      setShowUpdateLauncher(true);
    }
  }

  useEffect(() => {
    const desktopBridge = window.desktopBridge;
    if (!desktopBridge?.getUpdateRuntimeState) return;

    let mounted = true;
    const apply = (payload?: DesktopUpdateRuntimeState | null) => {
      if (!mounted) return;
      applyDesktopUpdateRuntimeState(payload);
    };

    const loadRuntimeState = async () => {
      try {
        const state = await desktopBridge.getUpdateRuntimeState();
        apply(state);
      } catch {
        // ignore updater runtime sync failures
      }
    };

    void loadRuntimeState();
    const unsubscribe = desktopBridge.onUpdateReady
      ? desktopBridge.onUpdateReady((payload) => apply(payload))
      : undefined;

    return () => {
      mounted = false;
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [downloadingUpdate, showUpdateLauncher]);

  async function handleDownloadLatestUpdate() {
    setUpdateDownloadMessage('');
    const desktopUpdater = window.desktopBridge?.downloadLatestUpdate;
    const feedBase = normalizeUpdateFeedBase(updateFeedUrlInput, DEFAULT_UPDATE_FEED_URL);
    const userAgent = String(typeof navigator !== 'undefined' ? navigator.userAgent : '').toLowerCase();
    const isMobileClient = /android|iphone|ipad|ipod|mobile/.test(userAgent);
    const isIOSClient = /iphone|ipad|ipod/.test(userAgent);

    setDownloadingUpdate(true);
    openUpdateLauncher('checking', 'Contacting the NCore update feed...');
    try {
      if (desktopUpdater) {
        const result = await desktopUpdater();
      if (!result.ok) {
        const message = result.message || 'Could not start update download.';
        setUpdateDownloadMessage(message);
        openUpdateLauncher('error', message);
      } else if (result.portable) {
        const message = result.message || 'Portable builds cannot self-update. Opening the latest installer instead.';
        setUpdateDownloadMessage(message);
        openUpdateLauncher('downloading', message);
      } else if (result.installing) {
        const message = result.message || 'Applying update and restarting NCore...';
        setUpdateDownloadMessage(message);
        openUpdateLauncher('installing', message);
      } else if (result.ready) {
        const message = result.message || (result.latestVersion
          ? `NCore v${result.latestVersion} is ready to install.`
          : 'Update downloaded and ready to install.');
        setUpdateDownloadMessage(message);
        openUpdateLauncher('ready', message);
      } else if (result.downloading) {
        const progress = Math.max(0, Math.min(100, Math.round(Number(result.progress || 0))));
        const message = result.message || (result.latestVersion
          ? `Downloading NCore v${result.latestVersion}${progress > 0 ? ` (${progress}%)` : ''}...`
          : `Downloading update${progress > 0 ? ` (${progress}%)` : ''}...`);
        setUpdateDownloadMessage(message);
        openUpdateLauncher('downloading', message);
      } else if (result.checking) {
        const message = result.message || 'Checking for updates...';
        setUpdateDownloadMessage(message);
        openUpdateLauncher('checking', message);
      } else if (result.noUpdate) {
        const message = result.message || 'No New Updates';
        setUpdateDownloadMessage(message);
        openUpdateLauncher('no-update', message);
      } else {
        const message = result.message || 'Update check started. NCore will download the latest release in the background if one is available.';
        setUpdateDownloadMessage(message);
        openUpdateLauncher('downloading', message);
      }
        return;
      }

      if (isMobileClient) {
        const mobileInstaller = await fetchLatestMobileInstaller(feedBase);
        if (mobileInstaller?.mode === 'apk' && mobileInstaller.url) {
          await openExternalUrl(mobileInstaller.url);
          const message = mobileInstaller.version
            ? `Opening Android installer v${mobileInstaller.version}...`
            : 'Opening latest Android installer...';
          setUpdateDownloadMessage(message);
          openUpdateLauncher('downloading', message);
          return;
        }

        if (isIOSClient) {
          const installResult = await promptPwaInstall();
          const message = installResult.message
            || 'On iPhone/iPad: open NCore in Safari, tap Share, then Add to Home Screen.';
          setUpdateDownloadMessage(message);
          openUpdateLauncher('no-update', message);
          return;
        }

        const message = mobileInstaller?.message
          || 'No Android installer is published yet. For now, install the web app via Add to Home Screen.';
        setUpdateDownloadMessage(message);
        openUpdateLauncher('no-update', message);
        return;
      }

      const installerPath = await fetchLatestInstallerAssetPath(feedBase);
      if (!installerPath) {
        const message = 'Could not resolve the latest installer from the update feed.';
        setUpdateDownloadMessage(message);
        openUpdateLauncher('error', message);
        return;
      }
      const installerUrl = resolveFeedAssetUrl(feedBase, installerPath);
      if (!installerUrl) {
        const message = 'Could not resolve installer URL.';
        setUpdateDownloadMessage(message);
        openUpdateLauncher('error', message);
        return;
      }
      await openExternalUrl(installerUrl);
      const message = 'Opening latest installer download...';
      setUpdateDownloadMessage(message);
      openUpdateLauncher('downloading', message);
    } catch (err: unknown) {
      const message = String((err as Error)?.message || err);
      setUpdateDownloadMessage(message);
      openUpdateLauncher('error', message);
    } finally {
      setDownloadingUpdate(false);
    }
  }

  async function handleInstallDownloadedUpdate() {
    const installDownloadedUpdate = window.desktopBridge?.installDownloadedUpdate;
    if (!installDownloadedUpdate || installingDownloadedUpdate || !desktopUpdateReady) return;

    setInstallingDownloadedUpdate(true);
    const detail = desktopUpdateRuntimeState.version
      ? `Applying NCore v${desktopUpdateRuntimeState.version} and restarting...`
      : 'Applying update and restarting NCore...';
    setUpdateDownloadMessage(detail);
    openUpdateLauncher('installing', detail);

    try {
      const result = await installDownloadedUpdate();
      if (!result.ok) {
        const message = result.message || 'Could not apply downloaded update.';
        setInstallingDownloadedUpdate(false);
        setUpdateDownloadMessage(message);
        openUpdateLauncher('error', message);
      }
    } catch (err: unknown) {
      const message = String((err as Error)?.message || err);
      setInstallingDownloadedUpdate(false);
      setUpdateDownloadMessage(message);
      openUpdateLauncher('error', message);
    }
  }

  async function handleSaveUpdateFeedUrl() {
    setUpdateDownloadMessage('');
    if (!window.desktopBridge?.setUpdateConfig) {
      setUpdateDownloadMessage('Update URL can only be saved from the desktop app.');
      return;
    }

    setSavingUpdateFeedUrl(true);
    try {
      const targetUrl = normalizeUpdateFeedBase(updateFeedUrlInput, DEFAULT_UPDATE_FEED_URL);
      const result = await window.desktopBridge.setUpdateConfig(targetUrl);
      if (!result.ok) {
        setUpdateDownloadMessage(result.message || 'Could not save update feed URL.');
      } else {
        setUpdateFeedUrlInput(targetUrl);
        setUpdateDownloadMessage('Update feed URL saved. You can now use Download Latest Update.');
        if (activeSection === 'whats-new') {
          const [remoteLog, latestVersion] = await Promise.all([
            fetchReleaseNotesFromFeed(targetUrl),
            fetchLatestReleaseVersion(targetUrl),
          ]);
          const merged = remoteLog
            .filter((entry, index, source) => source.findIndex((candidate) => compareSemver(candidate.version, entry.version) === 0) === index)
            .sort((a, b) => compareSemver(b.version, a.version));
          const latest = String(latestVersion || '').trim();
          if (latest && !merged.some((entry) => compareSemver(entry.version, latest) === 0)) {
            merged.unshift({
              version: latest,
              date: 'Latest release',
              badge: 'Release',
              improvements: ['Latest installer published to your configured update feed.'],
              bugFixes: [],
            });
          }
          if (merged.length > 0) {
            const fallback = buildFallbackReleaseLog(buildVersion, buildDate)[0];
            if (!merged.some((entry) => compareSemver(entry.version, buildVersion) === 0)) {
              merged.unshift(fallback);
            }
            setReleaseLog(merged);
          }
        }
      }
    } catch (err: unknown) {
      setUpdateDownloadMessage(String((err as Error)?.message || err));
    } finally {
      setSavingUpdateFeedUrl(false);
    }
  }

  function flashSavedNotice() {
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  async function resolveMediaPermissionState(name: 'microphone' | 'camera'): Promise<MediaPermissionState> {
    try {
      const permissions = (navigator as Navigator & {
        permissions?: {
          query: (descriptor: PermissionDescriptor) => Promise<PermissionStatus>;
        };
      }).permissions;
      if (!permissions?.query) return 'unsupported';
      const status = await permissions.query({ name } as PermissionDescriptor);
      if (status.state === 'granted' || status.state === 'prompt' || status.state === 'denied') {
        return status.state;
      }
      return 'unknown';
    } catch {
      return 'unknown';
    }
  }

  function resolveSelectedDeviceLabel(
    selectedId: string,
    devices: MediaDeviceOption[],
    fallbackLabel: string,
  ): string {
    if (!selectedId || selectedId === 'default') {
      return 'System Default';
    }
    const selected = devices.find((device) => device.deviceId === selectedId);
    return selected?.label || fallbackLabel;
  }

  function stopMicrophoneTest() {
    if (microphoneAnimationFrameRef.current != null) {
      window.cancelAnimationFrame(microphoneAnimationFrameRef.current);
      microphoneAnimationFrameRef.current = null;
    }
    if (microphoneAudioContextRef.current) {
      void microphoneAudioContextRef.current.close();
      microphoneAudioContextRef.current = null;
    }
    if (microphoneTestStreamRef.current) {
      microphoneTestStreamRef.current.getTracks().forEach((track) => track.stop());
      microphoneTestStreamRef.current = null;
    }
    setMicrophoneTesting(false);
    setMicrophoneLevel(0);
  }

  function stopCameraPreview() {
    if (cameraPreviewStreamRef.current) {
      cameraPreviewStreamRef.current.getTracks().forEach((track) => track.stop());
      cameraPreviewStreamRef.current = null;
    }
    if (cameraPreviewRef.current) {
      cameraPreviewRef.current.srcObject = null;
    }
    setCameraTesting(false);
  }

  async function refreshVoiceDeviceHealth() {
    setVoiceHealthChecking(true);
    try {
      const { audioInputs: nextAudioInputs, audioOutputs: nextAudioOutputs, videoInputs: nextVideoInputs } = await enumerateCallDevices();
      setAudioInputs(nextAudioInputs);
      setAudioOutputs(nextAudioOutputs);
      setVideoInputs(nextVideoInputs);

      const [microphonePermission, cameraPermission] = await Promise.all([
        resolveMediaPermissionState('microphone'),
        resolveMediaPermissionState('camera'),
      ]);

      const nextHealth: VoiceDeviceHealth = {
        microphonePermission,
        cameraPermission,
        hasMicrophoneDevice: nextAudioInputs.length > 0,
        hasSpeakerDevice: nextAudioOutputs.length > 0,
        hasCameraDevice: nextVideoInputs.length > 0,
        inputDeviceValid: callSettings.inputDeviceId === 'default'
          || nextAudioInputs.some((device) => device.deviceId === callSettings.inputDeviceId),
        outputDeviceValid: callSettings.outputDeviceId === 'default'
          || nextAudioOutputs.some((device) => device.deviceId === callSettings.outputDeviceId),
        cameraDeviceValid: callSettings.cameraDeviceId === 'default'
          || nextVideoInputs.some((device) => device.deviceId === callSettings.cameraDeviceId),
        selectedInputLabel: resolveSelectedDeviceLabel(callSettings.inputDeviceId, nextAudioInputs, 'Saved microphone (unavailable)'),
        selectedOutputLabel: resolveSelectedDeviceLabel(callSettings.outputDeviceId, nextAudioOutputs, 'Saved output (unavailable)'),
        selectedCameraLabel: resolveSelectedDeviceLabel(callSettings.cameraDeviceId, nextVideoInputs, 'Saved camera (unavailable)'),
        checkedAt: new Date().toISOString(),
      };

      const warnings: string[] = [];
      if (!nextHealth.inputDeviceValid) warnings.push('Selected microphone is unavailable.');
      if (!nextHealth.outputDeviceValid) warnings.push('Selected speaker output is unavailable.');
      if (!nextHealth.cameraDeviceValid) warnings.push('Selected camera is unavailable.');
      if (nextHealth.microphonePermission === 'denied') warnings.push('Microphone permission is denied.');
      if (nextHealth.cameraPermission === 'denied') warnings.push('Camera permission is denied.');

      setVoiceHealthMessage(
        warnings.length > 0
          ? warnings.join(' ')
          : 'Device health check passed. Selected devices are ready for calls.',
      );
      setVoiceDeviceHealth(nextHealth);
    } catch (err: unknown) {
      setVoiceHealthMessage(`Could not run device health check: ${String((err as Error)?.message || err)}`);
    } finally {
      setVoiceHealthChecking(false);
    }
  }

  async function handleRequestMediaPermissions() {
    setVoiceHealthMessage('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      stream.getTracks().forEach((track) => track.stop());
      setVoiceHealthMessage('Microphone and camera permissions were refreshed.');
      await refreshVoiceDeviceHealth();
    } catch (err: unknown) {
      setVoiceHealthMessage(`Permission request failed: ${String((err as Error)?.message || err)}`);
    }
  }

  async function handleTestMicrophone() {
    stopMicrophoneTest();
    setVoiceHealthMessage('');
    setMicrophoneTesting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: callSettings.inputDeviceId && callSettings.inputDeviceId !== 'default'
            ? { exact: callSettings.inputDeviceId }
            : undefined,
          echoCancellation: callSettings.echoCancellation,
          noiseSuppression: callSettings.noiseSuppression,
          autoGainControl: callSettings.automaticGainControl,
        },
        video: false,
      });
      microphoneTestStreamRef.current = stream;

      const context = new AudioContext();
      microphoneAudioContextRef.current = context;
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const startedAt = Date.now();

      const updateLevel = () => {
        analyser.getByteFrequencyData(dataArray);
        let total = 0;
        for (let i = 0; i < dataArray.length; i += 1) total += dataArray[i];
        const average = total / Math.max(1, dataArray.length);
        setMicrophoneLevel(Math.max(0, Math.min(100, Math.round((average / 255) * 100))));
        if (Date.now() - startedAt >= 6000) {
          stopMicrophoneTest();
          setVoiceHealthMessage('Microphone test complete.');
          return;
        }
        microphoneAnimationFrameRef.current = window.requestAnimationFrame(updateLevel);
      };

      microphoneAnimationFrameRef.current = window.requestAnimationFrame(updateLevel);
    } catch (err: unknown) {
      stopMicrophoneTest();
      setVoiceHealthMessage(`Microphone test failed: ${String((err as Error)?.message || err)}`);
    }
  }

  async function handleTestSpeaker() {
    setSpeakerTesting(true);
    setVoiceHealthMessage('');
    let context: AudioContext | null = null;
    let audioElement: HTMLAudioElement | null = null;
    try {
      context = new AudioContext();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = 880;
      gain.gain.value = 0.08;

      const outputDeviceId = String(callSettings.outputDeviceId || 'default');
      if (outputDeviceId !== 'default' && typeof Audio !== 'undefined') {
        const destination = context.createMediaStreamDestination();
        oscillator.connect(gain);
        gain.connect(destination);
        audioElement = new Audio();
        audioElement.srcObject = destination.stream;
        const setSinkId = (audioElement as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }).setSinkId;
        if (typeof setSinkId === 'function') {
          await setSinkId.call(audioElement, outputDeviceId);
        }
        await audioElement.play();
      } else {
        oscillator.connect(gain);
        gain.connect(context.destination);
      }

      oscillator.start();
      oscillator.stop(context.currentTime + 0.9);
      await new Promise((resolve) => setTimeout(resolve, 1100));
      setVoiceHealthMessage('Speaker test tone played successfully.');
    } catch (err: unknown) {
      setVoiceHealthMessage(`Speaker test failed: ${String((err as Error)?.message || err)}`);
    } finally {
      if (audioElement) {
        audioElement.pause();
        audioElement.srcObject = null;
      }
      if (context) {
        await context.close().catch(() => undefined);
      }
      setSpeakerTesting(false);
    }
  }

  async function handleToggleCameraPreview() {
    if (cameraTesting) {
      stopCameraPreview();
      setVoiceHealthMessage('Camera preview stopped.');
      return;
    }

    setVoiceHealthMessage('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          deviceId: callSettings.cameraDeviceId && callSettings.cameraDeviceId !== 'default'
            ? { exact: callSettings.cameraDeviceId }
            : undefined,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      cameraPreviewStreamRef.current = stream;
      if (cameraPreviewRef.current) {
        cameraPreviewRef.current.srcObject = stream;
        await cameraPreviewRef.current.play().catch(() => undefined);
      }
      setCameraTesting(true);
      setVoiceHealthMessage('Camera preview is active.');
    } catch (err: unknown) {
      stopCameraPreview();
      setVoiceHealthMessage(`Camera preview failed: ${String((err as Error)?.message || err)}`);
    }
  }

  function renderPermissionStateLabel(state: MediaPermissionState): string {
    if (state === 'granted') return 'Granted';
    if (state === 'denied') return 'Denied';
    if (state === 'prompt') return 'Prompt';
    if (state === 'unsupported') return 'Unsupported';
    return 'Unknown';
  }

  function renderPermissionStateClass(state: MediaPermissionState): string {
    if (state === 'granted') return 'border-green-500/30 bg-green-500/10 text-green-300';
    if (state === 'denied') return 'border-red-500/30 bg-red-500/10 text-red-300';
    if (state === 'prompt') return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
    return 'border-surface-700 bg-surface-900/60 text-surface-400';
  }

  async function handleApplyVoiceVideoSettings() {
    setError('');
    setApplyingVoiceSettings(true);
    try {
      saveCallSettings(callSettings);
      await applyDirectCallSettings(callSettings);
      await refreshVoiceDeviceHealth();
      flashSavedNotice();
    } catch (err: unknown) {
      setError(String((err as Error)?.message || err));
    } finally {
      setApplyingVoiceSettings(false);
    }
  }

  async function handleStartBoostCheckout() {
    setBillingActionMessage('');
    setCheckoutLoadingKey('boost');
    const sourceChannel = resolveGrowthSourceChannel();

    function handleSessionExpired(message?: string) {
      setBillingActionMessage(message || 'Session expired. Please sign out and sign in again, then retry checkout.');
    }

    const successUrl = resolveBillingReturnUrl('/app/settings');
    const cancelUrl = resolveBillingReturnUrl('/app/settings');
    const buildRequestBody = (accessToken: string) => ({
      mode: 'boost_subscription',
      successUrl,
      cancelUrl,
      sourceChannel,
      accessToken: String(accessToken || '').trim(),
    });

    const invokeCheckout = (body: Record<string, unknown>) => supabase.functions.invoke('billing-create-checkout-session', {
      body,
    });

    try {
      const authState = await ensureSessionPresent();
      if (!authState.ok || !authState.accessToken) {
        handleSessionExpired(authState.message);
        return;
      }

      let requestBody = buildRequestBody(authState.accessToken);
      let { data, error: invokeError } = await invokeCheckout(requestBody);
      if (invokeError) {
        const detail = await extractInvokeErrorMessage(invokeError, 'Could not start Boost checkout.');
        if (!isInvalidJwtMessage(detail)) {
          setBillingActionMessage(detail);
          return;
        }

        const refreshed = await tryRefreshSession();
        if (!refreshed.ok || !refreshed.accessToken) {
          handleSessionExpired('Session refresh failed. Please sign in again, then retry checkout.');
          return;
        }

        requestBody = buildRequestBody(refreshed.accessToken);
        const retry = await invokeCheckout(requestBody);
        if (retry.error) {
          const retryDetail = await extractInvokeErrorMessage(retry.error, 'Could not start Boost checkout.');
          if (isInvalidJwtMessage(retryDetail)) {
            setBillingActionMessage(`Checkout auth failed: ${retryDetail}`);
            return;
          }
          setBillingActionMessage(retryDetail);
          return;
        }
        data = retry.data;
      }

      const payload = data as { checkoutUrl?: string; error?: string; code?: string };
      if (payload?.error) {
        setBillingActionMessage(payload.error);
        return;
      }

      const checkoutUrl = String(payload?.checkoutUrl || '').trim();
      if (!checkoutUrl) {
        setBillingActionMessage('Stripe checkout URL was not returned by the backend.');
        return;
      }

      await openExternalUrl(checkoutUrl);
    } catch (err: unknown) {
      setBillingActionMessage(String((err as Error)?.message || err));
    } finally {
      setCheckoutLoadingKey(null);
    }
  }

  async function handleOpenBillingPortal() {
    setBillingActionMessage('');
    setCheckoutLoadingKey('portal');

    function handleSessionExpired(message?: string) {
      setBillingActionMessage(message || 'Session expired. Please sign out and sign in again, then retry billing portal.');
    }

    const buildRequestBody = (accessToken: string) => ({
      returnUrl: resolveBillingReturnUrl('/app/settings'),
      accessToken: String(accessToken || '').trim(),
    });

    const invokePortal = (body: Record<string, unknown>) => supabase.functions.invoke('billing-create-portal-session', {
      body,
    });

    try {
      const authState = await ensureSessionPresent();
      if (!authState.ok || !authState.accessToken) {
        handleSessionExpired(authState.message);
        return;
      }

      let requestBody = buildRequestBody(authState.accessToken);
      let { data, error: invokeError } = await invokePortal(requestBody);
      if (invokeError) {
        const detail = await extractInvokeErrorMessage(invokeError, 'Could not open billing portal.');
        if (!isInvalidJwtMessage(detail)) {
          setBillingActionMessage(detail);
          return;
        }

        const refreshed = await tryRefreshSession();
        if (!refreshed.ok || !refreshed.accessToken) {
          handleSessionExpired('Session refresh failed. Please sign in again, then retry billing portal.');
          return;
        }

        requestBody = buildRequestBody(refreshed.accessToken);
        const retry = await invokePortal(requestBody);
        if (retry.error) {
          const retryDetail = await extractInvokeErrorMessage(retry.error, 'Could not open billing portal.');
          if (isInvalidJwtMessage(retryDetail)) {
            setBillingActionMessage(`Billing portal auth failed: ${retryDetail}`);
            return;
          }
          setBillingActionMessage(retryDetail);
          return;
        }
        data = retry.data;
      }

      const payload = data as { portalUrl?: string; portal_url?: string; url?: string; checkoutUrl?: string; error?: string };
      if (payload?.error) {
        setBillingActionMessage(payload.error);
        return;
      }

      const portalUrl = String(payload?.portalUrl || payload?.portal_url || payload?.url || payload?.checkoutUrl || '').trim();
      if (!portalUrl) {
        setBillingActionMessage('Billing portal URL was not returned by the backend.');
        return;
      }

      await openExternalUrl(portalUrl);
    } catch (err: unknown) {
      setBillingActionMessage(String((err as Error)?.message || err));
    } finally {
      setCheckoutLoadingKey(null);
    }
  }

  async function handleRedeemInviteCode() {
    const code = String(inviteCodeInput || '').trim();
    if (!code) {
      setGrowthUnlockMessage('Enter an invite code first.');
      return;
    }

    setRedeemingInviteCode(true);
    setGrowthUnlockMessage('');
    try {
      const { data, error } = await (supabase as any).rpc('redeem_growth_invite_code', {
        p_code: code,
        p_source_channel: resolveGrowthSourceChannel(),
      });
      if (error) {
        setGrowthUnlockMessage(error.message || 'Invite code could not be redeemed.');
        return;
      }

      await (supabase as any).rpc('mark_growth_referral_activation', {
        p_event_name: 'invite_redeem',
      });
      setInviteCodeInput('');
      setGrowthUnlockMessage('Invite redeemed successfully. Capability contract updated.');
      await refreshGrowthCapabilities();
    } catch (err: unknown) {
      setGrowthUnlockMessage(String((err as Error)?.message || err));
    } finally {
      setRedeemingInviteCode(false);
    }
  }

  async function handleDiscordImportZip(file: File) {
    if (!profile) return;
    const filename = (file.name || '').toLowerCase();
    if (!filename.endsWith('.zip')) {
      setDiscordImportMessage('Please choose the Discord data export .zip file.');
      return;
    }

    setDiscordImportMessage('');
    setImportingDiscord(true);
    try {
      const zip = await JSZip.loadAsync(file);
      const imported: DiscordImportMessage[] = [];

      const entries = Object.values(zip.files);
      for (const entry of entries) {
        if (entry.dir) continue;
        if (imported.length >= MAX_DISCORD_IMPORT_MESSAGES) break;

        const source = entry.name.split('/').slice(-2).join('/').replace(/\.(json|csv)$/i, '') || entry.name;
        const lowerName = entry.name.toLowerCase();

        if (lowerName.endsWith('.json')) {
          const text = await entry.async('text');
          try {
            const parsed = JSON.parse(text);
            collectMessagesFromJson(parsed, source, imported, 0);
          } catch {
            // Skip malformed JSON files in the archive.
          }
          continue;
        }

        if (lowerName.endsWith('.csv') && (lowerName.includes('message') || lowerName.includes('dm'))) {
          const text = await entry.async('text');
          const csvMessages = collectMessagesFromCsv(text, source);
          for (const row of csvMessages) {
            imported.push(row);
            if (imported.length >= MAX_DISCORD_IMPORT_MESSAGES) break;
          }
        }
      }

      if (imported.length === 0) {
        setDiscordImportMessage('No messages were detected in that zip. Export Discord data with messages included.');
        return;
      }

      imported.sort((a, b) => {
        if (!a.timestamp && !b.timestamp) return 0;
        if (!a.timestamp) return 1;
        if (!b.timestamp) return -1;
        return a.timestamp.localeCompare(b.timestamp);
      });

      const { data: conversationRow, error: conversationError } = await supabase
        .from('direct_conversations')
        .insert({
          is_group: true,
          name: `Discord Import ${new Date().toLocaleDateString()}`,
          created_by: profile.id,
        } as any)
        .select('id')
        .single();
      if (conversationError || !conversationRow?.id) {
        setDiscordImportMessage(`Could not create import conversation: ${conversationError?.message || 'unknown error'}`);
        return;
      }

      const conversationKey = String(conversationRow.id);
      const { error: memberError } = await supabase.from('direct_conversation_members').insert({
        conversation_id: conversationKey,
        user_id: profile.id,
        role: 'owner',
        added_by: profile.id,
      } as any);
      if (memberError) {
        setDiscordImportMessage(`Could not initialize import members: ${memberError.message}`);
        return;
      }

      const preparedRows = imported.slice(0, MAX_DISCORD_IMPORT_MESSAGES).map((entry) => {
        const prefix = `[Discord Import ${entry.source}] ${entry.author}: `;
        const content = `${prefix}${entry.content}`.slice(0, 20000);
        return {
          conversation_id: conversationKey,
          author_id: profile.id,
          content,
          ...(entry.timestamp ? { created_at: entry.timestamp } : {}),
        };
      });

      for (let index = 0; index < preparedRows.length; index += 200) {
        const chunk = preparedRows.slice(index, index + 200);
        const { error: insertError } = await supabase.from('direct_messages').insert(chunk as any);
        if (insertError) {
          setDiscordImportMessage(`Import partially completed. Message insert failed: ${insertError.message}`);
          return;
        }
      }

      setDiscordImportMessage(`Imported ${preparedRows.length} messages into a new DM group.`);
      navigate(`/app/dm/${conversationKey}`);
    } catch (err: unknown) {
      setDiscordImportMessage(String((err as Error)?.message || err));
    } finally {
      setImportingDiscord(false);
    }
  }

  const currentAvatar = avatarPreview || profile?.avatar_url;
  const currentBanner = bannerPreview || profile?.banner_url;
  const progression = entitlements.progression;
  const nextRequiredLevel = progression.nextRequiredLevel;
  const nextRequiredEffectiveXp = progression.nextRequiredEffectiveXp;
  const xpToNextLevel = nextRequiredEffectiveXp == null
    ? 0
    : Math.max(nextRequiredEffectiveXp - progression.effectiveXp, 0);
  const canUpgradeToBoost = !entitlements.isBoost;
  if (!profile) return null;

  return (
    <AppShell showChannelSidebar={false} title="Settings">
      <div className="h-full flex overflow-hidden">
        {/* Sidebar */}
        {!isMobileSettings && (
          <div className="ncore-settings-desktop-nav w-60 bg-surface-900 border-r border-surface-800 flex-col py-4 overflow-y-auto no-scrollbar flex">
          {SECTION_GROUPS.map((group, gi) => (
            <div key={gi} className={gi > 0 ? 'mt-4 pt-4 border-t border-surface-800' : ''}>
              {group.label && (
                <div className="px-4 pb-1 text-xs font-bold text-surface-500 uppercase tracking-wider">{group.label}</div>
              )}
              {group.items.map(item => (
                <button
                  key={item.id}
                  onClick={() => activateSection(item.id)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                    activeSection === item.id
                      ? 'bg-surface-700/60 text-surface-100 font-medium'
                      : item.danger
                        ? 'text-red-400 hover:bg-red-500/10 hover:text-red-300'
                        : 'text-surface-400 hover:text-surface-200 hover:bg-surface-800'
                  }`}
                >
                  <item.icon size={16} />
                  {item.label}
                  {activeSection === item.id && <ChevronRight size={14} className="ml-auto text-nyptid-300" />}
                </button>
              ))}
            </div>
          ))}

          <div className="mt-4 pt-4 border-t border-surface-800 px-2 space-y-1">
            <button
              onClick={() => setShowLogoutModal(true)}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
            >
              <LogOut size={16} />
              Log Out
            </button>
          </div>

          <div className="px-4 pt-4 mt-auto">
            <div className="text-xs text-surface-600">NCore v{buildVersion}</div>
            <div className="text-xs text-surface-700 mt-0.5">by NYPTID Industries Advanced Technologies</div>
          </div>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden scrollbar-thin">
          <div className="w-full px-4 py-5 md:px-6 md:py-8 xl:px-10">
            {isMobileSettings && (
              <div className="ncore-settings-mobile-nav mb-5 space-y-3 rounded-xl border border-surface-700 bg-surface-900 p-3">
                <div>
                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-surface-500">Section</label>
                  <select
                    value={activeSection}
                    onChange={(event) => activateSection(event.target.value as SectionId)}
                    className="nyptid-input"
                  >
                    {SECTION_GROUPS.map((group) => (
                      <optgroup key={group.label || 'default'} label={group.label || 'General'}>
                        {group.items.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
                <div className="flex items-center justify-between gap-3 pt-1">
                  <div className="text-xs text-surface-600">
                    NCore v{buildVersion}
                  </div>
                  <button
                    onClick={() => setShowLogoutModal(true)}
                    className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/15 transition-colors"
                  >
                    Log Out
                  </button>
                </div>
              </div>
            )}
            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm mb-6">
                <AlertCircle size={16} />
                {error}
                <button onClick={() => setError('')} className="ml-auto"><X size={14} /></button>
              </div>
            )}
            {saved && (
              <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/20 rounded-lg text-green-400 text-sm mb-6">
                <CheckCircle size={16} />
                Changes saved successfully
              </div>
            )}

            {/* MY ACCOUNT */}
            {activeSection === 'my-account' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-bold text-surface-100 mb-1">My Account</h2>
                  <p className="text-surface-500 text-sm">Manage your NYPTID account credentials and identity</p>
                </div>

                <div className="nyptid-card overflow-hidden">
                  <div className="h-24 bg-gradient-to-r from-nyptid-900 via-nyptid-800/50 to-surface-800 relative" />
                  <div className="px-6 pb-6">
                    <div className="flex items-end gap-4 -mt-10 mb-6">
                      <div className="relative">
                        <Avatar
                          src={currentAvatar}
                          name={profile.display_name || profile.username}
                          size="xl"
                          status={profile.status}
                        />
                        <button
                          onClick={() => avatarInputRef.current?.click()}
                          className="absolute -bottom-1 -right-1 w-7 h-7 bg-nyptid-300 rounded-full flex items-center justify-center hover:bg-nyptid-200 transition-colors"
                        >
                          <Camera size={12} className="text-surface-950" />
                        </button>
                        <input
                          ref={avatarInputRef}
                          type="file"
                          accept="image/jpeg,image/png,image/gif,image/webp"
                          className="hidden"
                          onChange={handleAvatarUpload}
                        />
                      </div>
                      <div className="pb-2">
                        <div className="font-bold text-surface-100 text-lg">{profile.display_name}</div>
                        <div className="text-surface-400 text-sm">@{profile.username}</div>
                      </div>
                    </div>

                    <div className="space-y-0 divide-y divide-surface-700/50">
                      <div className="py-4">
                        <div className="text-xs font-bold text-surface-500 uppercase tracking-wider mb-3">Account Information</div>
                        {([
                          { label: 'USERNAME', value: `@${profile.username}`, icon: Hash, unverified: false },
                          { label: 'EMAIL ADDRESS', value: user?.email || 'Not set', icon: MessageSquare, unverified: false },
                          { label: 'PASSWORD', value: '••••••••••', icon: Key, unverified: false },
                        ] as { label: string; value: string; icon: React.ElementType; unverified?: boolean }[]).map(field => (
                          <div key={field.label} className="flex items-center justify-between py-3 px-4 rounded-lg hover:bg-surface-700/30 transition-colors group">
                            <div className="flex items-center gap-3">
                              <field.icon size={16} className="text-surface-500" />
                              <div>
                                <div className="text-xs font-bold text-surface-500 uppercase tracking-wider flex items-center gap-2">
                                  {field.label}
                                  {field.unverified && (
                                    <span className="text-yellow-500 normal-case font-normal">(unverified)</span>
                                  )}
                                </div>
                                <div className="text-sm text-surface-200 mt-0.5">{field.value}</div>
                              </div>
                            </div>
                            <button
                              onClick={() => activateSection(field.label === 'PASSWORD' ? 'security' : 'profile')}
                              className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 hover:bg-surface-600 rounded"
                            >
                              <RefreshCw size={14} className="text-surface-400" />
                            </button>
                          </div>
                        ))}
                      </div>

                      <div className="py-4">
                        <div className="text-xs font-bold text-surface-500 uppercase tracking-wider mb-3">Platform Status</div>
                        {rankInfo && (
                          <div className="px-4 py-3 bg-surface-800/50 rounded-lg">
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <Award size={16} className="text-nyptid-300" />
                                <span className="text-sm font-semibold text-surface-200">{rankInfo.rank}</span>
                              </div>
                              <span className="text-xs text-surface-500">{profile.xp || 0} XP</span>
                            </div>
                            <div className="h-1.5 bg-surface-700 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-gradient-to-r from-nyptid-500 to-nyptid-300 rounded-full transition-all"
                                style={{ width: `${rankInfo.progress}%` }}
                              />
                            </div>
                            <div className="text-xs text-surface-600 mt-1">{Math.round(rankInfo.progress)}% to {rankInfo.nextXp.toLocaleString()} XP</div>
                          </div>
                        )}
                        <div className="flex gap-2 mt-3 px-4 flex-wrap">
                          <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                            profile.platform_role === 'owner' ? 'bg-yellow-500/20 text-yellow-400' :
                            profile.platform_role === 'admin' ? 'bg-red-500/20 text-red-400' :
                            profile.platform_role === 'moderator' ? 'bg-blue-500/20 text-blue-400' :
                            'bg-surface-700 text-surface-400'
                          }`}>
                            {profile.platform_role?.toUpperCase()}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {uploadingAvatar && (
                  <div className="flex items-center gap-2 p-3 bg-nyptid-300/10 border border-nyptid-300/20 rounded-lg text-nyptid-300 text-sm">
                    <div className="w-4 h-4 border-2 border-nyptid-300 border-t-transparent rounded-full animate-spin" />
                    Uploading avatar...
                  </div>
                )}
              </div>
            )}

            {/* PROFILE */}
            {activeSection === 'profile' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-bold text-surface-100 mb-1">Profile</h2>
                  <p className="text-surface-500 text-sm">Customize how others see you across the platform</p>
                </div>

                <div className="nyptid-card p-6 space-y-5">
                  <div>
                    <div className="text-xs font-bold text-surface-500 uppercase tracking-wider mb-3">Profile Banner</div>
                    <div className="rounded-xl border border-surface-700 bg-surface-900 overflow-hidden h-28 relative">
                      {currentBanner ? (
                        <img src={currentBanner} alt="Profile banner" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-nyptid-900/60 via-surface-900 to-surface-800" />
                      )}
                      {uploadingBanner && (
                        <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                          <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        </div>
                      )}
                    </div>
                    <div className="mt-3 flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => bannerInputRef.current?.click()}
                        className="nyptid-btn-secondary text-sm flex items-center gap-2"
                        disabled={uploadingBanner}
                      >
                        <Upload size={14} />
                        {uploadingBanner ? 'Uploading...' : 'Upload Banner'}
                      </button>
                      {currentBanner && (
                        <button
                          onClick={() => void handleRemoveBanner()}
                          className="nyptid-btn-secondary text-xs"
                        >
                          Remove Banner
                        </button>
                      )}
                      {bannerPreview && bannerPreview !== profile.banner_url && (
                        <button
                          onClick={() => setBannerPreview(null)}
                          className="text-xs text-surface-500 hover:text-red-400 transition-colors flex items-center gap-1"
                        >
                          <X size={12} /> Remove preview
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-surface-600 mt-2">JPG, PNG, GIF, WEBP. Max 10MB.</p>
                    <input
                      ref={bannerInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/gif,image/webp"
                      className="hidden"
                      onChange={handleBannerUpload}
                    />
                  </div>

                  <div>
                    <div className="text-xs font-bold text-surface-500 uppercase tracking-wider mb-3">Profile Picture</div>
                    <div className="flex items-center gap-4">
                      <div className="relative">
                        <Avatar
                          src={currentAvatar}
                          name={profile.display_name || profile.username}
                          size="xl"
                        />
                        {uploadingAvatar && (
                          <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center">
                            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          </div>
                        )}
                      </div>
                      <div className="space-y-2">
                        <button
                          onClick={() => avatarInputRef.current?.click()}
                          className="nyptid-btn-secondary text-sm flex items-center gap-2"
                          disabled={uploadingAvatar}
                        >
                          <Upload size={14} />
                          {uploadingAvatar ? 'Uploading...' : 'Upload Image'}
                        </button>
                        {currentAvatar && currentAvatar !== profile.avatar_url && (
                          <button
                            onClick={() => setAvatarPreview(null)}
                            className="text-xs text-surface-500 hover:text-red-400 transition-colors flex items-center gap-1"
                          >
                            <X size={12} /> Remove preview
                          </button>
                        )}
                        <p className="text-xs text-surface-600">JPG, PNG, GIF, WEBP. Max 5MB.</p>
                      </div>
                      <input
                        ref={avatarInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/gif,image/webp"
                        className="hidden"
                        onChange={handleAvatarUpload}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-surface-500 uppercase tracking-wider mb-2">Display Name</label>
                    <input
                      type="text"
                      value={displayName}
                      onChange={e => setDisplayName(e.target.value)}
                      className="nyptid-input"
                      placeholder="Your display name"
                      maxLength={32}
                    />
                    <p className="text-xs text-surface-600 mt-1">This is how you appear to others. Max 32 characters.</p>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-surface-500 uppercase tracking-wider mb-2">Username</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-500">@</span>
                      <input
                        type="text"
                        value={username}
                        onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                        className="nyptid-input pl-7"
                        placeholder="your_username"
                        maxLength={32}
                      />
                    </div>
                    <p className="text-xs text-surface-600 mt-1">You can change this at any time. Use letters, numbers, and underscores.</p>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-surface-500 uppercase tracking-wider mb-2">About Me</label>
                    <textarea
                      value={bio}
                      onChange={e => setBio(e.target.value)}
                      className="nyptid-input resize-none"
                      placeholder="Tell others about yourself..."
                      rows={4}
                      maxLength={200}
                    />
                    <div className="flex items-center justify-between mt-1">
                      <p className="text-xs text-surface-600">Supports plain text. Shown on your profile page.</p>
                      <p className="text-xs text-surface-600">{bio.length}/200</p>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end">
                  <button onClick={handleSaveProfile} disabled={saving} className="nyptid-btn-primary px-8">
                    {saving ? 'Saving...' : <><Save size={16} /> Save Changes</>}
                  </button>
                </div>
              </div>
            )}

            {/* PRIVACY & STATUS */}
            {activeSection === 'privacy' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-bold text-surface-100 mb-1">Privacy & Status</h2>
                  <p className="text-surface-500 text-sm">Control your online presence and who can interact with you</p>
                </div>

                <div className="nyptid-card p-6">
                  <div className="text-xs font-bold text-surface-500 uppercase tracking-wider mb-4">Online Status</div>
                  <div className="space-y-1 mb-6">
                    {([
                      { value: 'online', label: 'Online', desc: 'You appear online to others', color: 'bg-green-500' },
                      { value: 'idle', label: 'Idle', desc: 'Appear as idle / away', color: 'bg-yellow-500' },
                      { value: 'dnd', label: 'Do Not Disturb', desc: 'Mute all notifications while online', color: 'bg-red-500' },
                      { value: 'invisible', label: 'Invisible', desc: 'Appear offline to everyone', color: 'bg-surface-500' },
                    ] as { value: UserStatus; label: string; desc: string; color: string }[]).map(s => (
                      <label key={s.value} className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${status === s.value ? 'bg-surface-700/60' : 'hover:bg-surface-700/30'}`}>
                        <input type="radio" name="status" value={s.value} checked={status === s.value} onChange={() => setStatus(s.value)} className="sr-only" />
                        <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${status === s.value ? 'border-nyptid-300' : 'border-surface-600'}`}>
                          {status === s.value && <div className="w-2 h-2 rounded-full bg-nyptid-300" />}
                        </div>
                        <div className={`w-3 h-3 rounded-full ${s.color}`} />
                        <div className="flex-1">
                          <div className="text-sm font-medium text-surface-200">{s.label}</div>
                          <div className="text-xs text-surface-500">{s.desc}</div>
                        </div>
                      </label>
                    ))}
                  </div>

                  <div className="border-t border-surface-700 pt-4 mb-4">
                    <div className="text-xs font-bold text-surface-500 uppercase tracking-wider mb-2">Custom Status</div>
                    <div className="grid sm:grid-cols-[96px_minmax(0,1fr)] gap-3">
                      <label className="text-xs text-surface-500 uppercase tracking-wide">
                        Emoji
                        <input
                          type="text"
                          value={customStatusEmoji}
                          onChange={(event) => setCustomStatusEmoji(event.target.value)}
                          className="nyptid-input mt-1 text-center"
                          placeholder="??"
                          maxLength={16}
                        />
                      </label>
                      <label className="text-xs text-surface-500 uppercase tracking-wide">
                        Status Message
                        <input
                          type="text"
                          value={customStatus}
                          onChange={(event) => setCustomStatus(event.target.value)}
                          className="nyptid-input mt-1"
                          placeholder="What are you up to?"
                          maxLength={160}
                        />
                      </label>
                    </div>
                    <div className="text-xs text-surface-600 mt-2">
                      Shows on your profile and friends view. {customStatus.length}/160
                    </div>
                  </div>

                  <div className="border-t border-surface-700 pt-4">
                    <div className="text-xs font-bold text-surface-500 uppercase tracking-wider mb-2">Privacy</div>
                    {Object.entries({
                      showOnlineStatus: { label: 'Show online status', desc: 'Let others see when you are online' },
                      allowDmsFromAll: { label: 'Allow DMs from everyone', desc: 'Allow anyone to message you directly' },
                      allowFriendRequests: { label: 'Allow friend requests', desc: 'Let other users send you friend requests' },
                      showCurrentActivity: { label: 'Show activity status', desc: 'Display what community you are active in' },
                      readReceipts: { label: 'Send read receipts', desc: 'Let others know when you have read their messages' },
                      typingIndicators: { label: 'Send typing indicators', desc: 'Show when you are typing in channels' },
                    }).map(([key, info]) => (
                      <SettingRow key={key} label={info.label} description={info.desc}>
                        <ToggleSwitch
                          checked={privacySettings[key as keyof typeof privacySettings]}
                          onChange={v => setPrivacySettings(p => ({ ...p, [key]: v }))}
                        />
                      </SettingRow>
                    ))}
                  </div>
                </div>

                <div className="flex justify-end">
                  <button onClick={handleSaveStatus} disabled={saving} className="nyptid-btn-primary px-8">
                    {saving ? 'Saving...' : <><Save size={16} /> Save Changes</>}
                  </button>
                </div>
              </div>
            )}

            {/* NOTIFICATIONS */}
            {activeSection === 'notifications' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-bold text-surface-100 mb-1">Notifications</h2>
                  <p className="text-surface-500 text-sm">Choose what you want to be notified about</p>
                </div>

                <div className="nyptid-card p-6">
                  <div className="text-xs font-bold text-surface-500 uppercase tracking-wider mb-2">Messages & Social</div>
                  {([
                    { key: 'directMessages', label: 'Direct Messages', desc: 'When someone sends you a DM' },
                    { key: 'mentions', label: 'Mentions', desc: 'When someone @mentions you in a channel' },
                    { key: 'friendRequests', label: 'Friend Requests', desc: 'When you receive a friend request' },
                    { key: 'readReceipts', label: 'Read Receipts', desc: 'When your messages are read' },
                  ] as { key: keyof typeof notifSettings; label: string; desc: string }[]).map(item => (
                    <SettingRow key={item.key} label={item.label} description={item.desc}>
                      <ToggleSwitch
                        checked={notifSettings[item.key]}
                        onChange={v => setNotifSettings(p => ({ ...p, [item.key]: v }))}
                      />
                    </SettingRow>
                  ))}
                </div>

                <div className="nyptid-card p-6">
                  <div className="text-xs font-bold text-surface-500 uppercase tracking-wider mb-2">Community & Learning</div>
                  {([
                    { key: 'communityAnnouncements', label: 'Community Announcements', desc: 'Announcements from your communities' },
                    { key: 'newLessons', label: 'New Lessons & Courses', desc: 'When new content is added to courses you follow' },
                    { key: 'achievements', label: 'Achievement Unlocked', desc: 'When you earn a new achievement badge' },
                  ] as { key: keyof typeof notifSettings; label: string; desc: string }[]).map(item => (
                    <SettingRow key={item.key} label={item.label} description={item.desc}>
                      <ToggleSwitch
                        checked={notifSettings[item.key]}
                        onChange={v => setNotifSettings(p => ({ ...p, [item.key]: v }))}
                      />
                    </SettingRow>
                  ))}
                </div>

                <div className="nyptid-card p-6">
                  <div className="text-xs font-bold text-surface-500 uppercase tracking-wider mb-2">Calls & System</div>
                  {([
                    { key: 'voiceCalls', label: 'Incoming Voice Calls', desc: 'When someone starts a voice call with you' },
                    { key: 'systemAlerts', label: 'System Alerts', desc: 'Important platform notifications and updates' },
                  ] as { key: keyof typeof notifSettings; label: string; desc: string }[]).map(item => (
                    <SettingRow key={item.key} label={item.label} description={item.desc}>
                      <ToggleSwitch
                        checked={notifSettings[item.key]}
                        onChange={v => setNotifSettings(p => ({ ...p, [item.key]: v }))}
                      />
                    </SettingRow>
                  ))}
                </div>
              </div>
            )}

            {/* VOICE & VIDEO */}
            {activeSection === 'voice-video' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-bold text-surface-100 mb-1">Voice & Video</h2>
                  <p className="text-surface-500 text-sm">Configure your audio and video settings for calls</p>
                </div>

                <div className="nyptid-card p-5 space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-bold text-surface-500 uppercase tracking-wider">Pre-call Device Health</div>
                      <div className="text-sm text-surface-300 mt-1">
                        Validate permissions, selected devices, and hardware readiness before joining a call.
                      </div>
                      <div className="text-[11px] text-surface-500 mt-1">
                        Last checked: {voiceDeviceHealth.checkedAt ? new Date(voiceDeviceHealth.checkedAt).toLocaleString() : 'Not yet checked'}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void refreshVoiceDeviceHealth()}
                        disabled={voiceHealthChecking}
                        className="nyptid-btn-secondary text-xs"
                      >
                        {voiceHealthChecking ? <RefreshCw size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                        {voiceHealthChecking ? 'Checking...' : 'Run Health Check'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleRequestMediaPermissions()}
                        className="nyptid-btn-ghost text-xs"
                      >
                        Request Permissions
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                    <div className={`rounded-lg border px-3 py-2 text-xs ${renderPermissionStateClass(voiceDeviceHealth.microphonePermission)}`}>
                      <div className="font-semibold">Microphone Permission</div>
                      <div className="mt-0.5">{renderPermissionStateLabel(voiceDeviceHealth.microphonePermission)}</div>
                    </div>
                    <div className={`rounded-lg border px-3 py-2 text-xs ${renderPermissionStateClass(voiceDeviceHealth.cameraPermission)}`}>
                      <div className="font-semibold">Camera Permission</div>
                      <div className="mt-0.5">{renderPermissionStateLabel(voiceDeviceHealth.cameraPermission)}</div>
                    </div>
                    <div className="rounded-lg border border-surface-700 bg-surface-900/70 px-3 py-2 text-xs text-surface-300">
                      <div className="font-semibold">Hardware Presence</div>
                      <div className="mt-0.5">
                        Mic: {voiceDeviceHealth.hasMicrophoneDevice ? 'Detected' : 'Missing'} ·
                        Speaker: {voiceDeviceHealth.hasSpeakerDevice ? 'Detected' : 'Missing'} ·
                        Camera: {voiceDeviceHealth.hasCameraDevice ? 'Detected' : 'Missing'}
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-2 md:grid-cols-3">
                    <div className={`rounded-lg border px-3 py-2 text-xs ${voiceDeviceHealth.inputDeviceValid ? 'border-green-500/30 bg-green-500/10 text-green-200' : 'border-red-500/30 bg-red-500/10 text-red-200'}`}>
                      <div className="font-semibold">Selected Microphone</div>
                      <div className="mt-0.5">{voiceDeviceHealth.selectedInputLabel}</div>
                    </div>
                    <div className={`rounded-lg border px-3 py-2 text-xs ${voiceDeviceHealth.outputDeviceValid ? 'border-green-500/30 bg-green-500/10 text-green-200' : 'border-red-500/30 bg-red-500/10 text-red-200'}`}>
                      <div className="font-semibold">Selected Speaker</div>
                      <div className="mt-0.5">{voiceDeviceHealth.selectedOutputLabel}</div>
                    </div>
                    <div className={`rounded-lg border px-3 py-2 text-xs ${voiceDeviceHealth.cameraDeviceValid ? 'border-green-500/30 bg-green-500/10 text-green-200' : 'border-red-500/30 bg-red-500/10 text-red-200'}`}>
                      <div className="font-semibold">Selected Camera</div>
                      <div className="mt-0.5">{voiceDeviceHealth.selectedCameraLabel}</div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void handleTestMicrophone()}
                      disabled={microphoneTesting}
                      className="nyptid-btn-secondary text-xs"
                    >
                      {microphoneTesting ? 'Testing Microphone...' : 'Test Microphone'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleTestSpeaker()}
                      disabled={speakerTesting}
                      className="nyptid-btn-secondary text-xs"
                    >
                      {speakerTesting ? 'Playing Tone...' : 'Test Speaker'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleToggleCameraPreview()}
                      className="nyptid-btn-secondary text-xs"
                    >
                      {cameraTesting ? 'Stop Camera Preview' : 'Start Camera Preview'}
                    </button>
                  </div>

                  <div className="grid gap-3 lg:grid-cols-2">
                    <div className="rounded-xl border border-surface-700 bg-surface-900/60 p-3">
                      <div className="text-xs font-semibold text-surface-300 mb-2">Microphone Activity</div>
                      <div className="h-2 w-full rounded-full bg-surface-800 overflow-hidden">
                        <div
                          className={`h-full transition-all ${microphoneTesting ? 'bg-green-400' : 'bg-surface-600'}`}
                          style={{ width: `${microphoneLevel}%` }}
                        />
                      </div>
                      <div className="text-[11px] text-surface-500 mt-2">
                        {microphoneTesting ? `Live input level: ${microphoneLevel}%` : 'Run microphone test to monitor live input level.'}
                      </div>
                    </div>
                    <div className="rounded-xl border border-surface-700 bg-black/30 p-3">
                      <div className="text-xs font-semibold text-surface-300 mb-2">Camera Preview</div>
                      <div className="aspect-video rounded-lg overflow-hidden border border-surface-700 bg-surface-950">
                        <video
                          ref={cameraPreviewRef}
                          className="h-full w-full object-cover"
                          autoPlay
                          muted
                          playsInline
                        />
                      </div>
                      <div className="text-[11px] text-surface-500 mt-2">
                        {cameraTesting ? 'Camera preview is active.' : 'Start camera preview to verify framing and permissions.'}
                      </div>
                    </div>
                  </div>

                  {voiceHealthMessage && (
                    <div className="rounded-lg border border-surface-700 bg-surface-900/70 px-3 py-2 text-xs text-surface-300">
                      {voiceHealthMessage}
                    </div>
                  )}
                </div>

                <div className="nyptid-card p-6">
                  <div className="text-xs font-bold text-surface-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                    <Mic size={14} />
                    Input Device
                  </div>
                  <div className="space-y-3 mb-4">
                    <div>
                      <label className="block text-sm text-surface-400 mb-1.5">Microphone</label>
                      <select
                        className="nyptid-input"
                        value={callSettings.inputDeviceId}
                        onChange={(e) => setCallSettings((prev) => ({ ...prev, inputDeviceId: e.target.value }))}
                      >
                        {audioInputs.map((d) => (
                          <option key={d.deviceId} value={d.deviceId}>
                            {d.label}
                          </option>
                        ))}
                        {!audioInputs.some((d) => d.deviceId === callSettings.inputDeviceId) && (
                          <option value={callSettings.inputDeviceId}>Saved device (unavailable)</option>
                        )}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm text-surface-400 mb-1.5">Input Volume</label>
                      <input
                        type="range"
                        min="0"
                        max="200"
                        value={callSettings.inputVolume}
                        onChange={(e) => setCallSettings((prev) => ({ ...prev, inputVolume: Number(e.target.value) }))}
                        className="w-full accent-nyptid-300"
                      />
                    </div>
                  </div>

                  <div className="text-xs font-bold text-surface-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                    <Volume2 size={14} />
                    Output Device
                  </div>
                  <div className="space-y-3 mb-4">
                    <div>
                      <label className="block text-sm text-surface-400 mb-1.5">Speaker / Headphones</label>
                      <select
                        className="nyptid-input"
                        value={callSettings.outputDeviceId}
                        onChange={(e) => setCallSettings((prev) => ({ ...prev, outputDeviceId: e.target.value }))}
                      >
                        {audioOutputs.map((d) => (
                          <option key={d.deviceId} value={d.deviceId}>
                            {d.label}
                          </option>
                        ))}
                        {!audioOutputs.some((d) => d.deviceId === callSettings.outputDeviceId) && (
                          <option value={callSettings.outputDeviceId}>Saved output (unavailable)</option>
                        )}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm text-surface-400 mb-1.5">Output Volume</label>
                      <input
                        type="range"
                        min="0"
                        max="200"
                        value={callSettings.outputVolume}
                        onChange={(e) => setCallSettings((prev) => ({ ...prev, outputVolume: Number(e.target.value) }))}
                        className="w-full accent-nyptid-300"
                      />
                    </div>
                  </div>

                  <div className="border-t border-surface-700 pt-4">
                    <div className="text-xs font-bold text-surface-500 uppercase tracking-wider mb-2">Voice Processing</div>
                    {([
                      { key: 'echoCancellation', label: 'Echo Cancellation', desc: 'Removes echo from your microphone input' },
                      { key: 'noiseSuppression', label: 'Noise Suppression', desc: 'Reduces background noise when speaking' },
                      { key: 'automaticGainControl', label: 'Automatic Gain Control', desc: 'Automatically adjusts microphone volume' },
                    ] as { key: 'echoCancellation' | 'noiseSuppression' | 'automaticGainControl'; label: string; desc: string }[]).map(item => (
                      <SettingRow key={item.key} label={item.label} description={item.desc}>
                        <ToggleSwitch
                          checked={callSettings[item.key]}
                          onChange={v => setCallSettings(p => ({ ...p, [item.key]: v }))}
                        />
                      </SettingRow>
                    ))}
                  </div>

                  <div className="border-t border-surface-700 pt-4 mt-4">
                    <div className="text-xs font-bold text-surface-500 uppercase tracking-wider mb-2 flex items-center gap-2">
                      <Video size={14} />
                      Camera
                    </div>
                    <div>
                      <label className="block text-sm text-surface-400 mb-1.5">Camera Device</label>
                      <select
                        className="nyptid-input"
                        value={callSettings.cameraDeviceId}
                        onChange={(e) => setCallSettings((prev) => ({ ...prev, cameraDeviceId: e.target.value }))}
                      >
                        {videoInputs.map((d) => (
                          <option key={d.deviceId} value={d.deviceId}>
                            {d.label}
                          </option>
                        ))}
                        {!videoInputs.some((d) => d.deviceId === callSettings.cameraDeviceId) && (
                          <option value={callSettings.cameraDeviceId}>Saved camera (unavailable)</option>
                        )}
                      </select>
                    </div>
                    <div className="mt-3">
                      <SettingRow label="HD Video Quality" description="Enable 720p or higher video in calls (uses more bandwidth)">
                        <ToggleSwitch
                          checked={callSettings.qualityHD}
                          onChange={v => setCallSettings(p => ({ ...p, qualityHD: v }))}
                        />
                      </SettingRow>
                      <SettingRow label="Hardware Acceleration" description="Use GPU to encode/decode video streams">
                        <ToggleSwitch
                          checked={callSettings.hardwareAcceleration}
                          onChange={v => setCallSettings(p => ({ ...p, hardwareAcceleration: v }))}
                        />
                      </SettingRow>
                    </div>
                  </div>

                  <div className="border-t border-surface-700 pt-4 mt-4 flex items-center justify-end">
                    <button
                      type="button"
                      onClick={() => void handleApplyVoiceVideoSettings()}
                      disabled={applyingVoiceSettings}
                      className="nyptid-btn-primary px-6"
                    >
                      {applyingVoiceSettings ? 'Applying...' : <><Save size={16} /> Save Voice & Video</>}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* APPEARANCE */}
            {activeSection === 'appearance' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-bold text-surface-100 mb-1">Appearance</h2>
                  <p className="text-surface-500 text-sm">Customize the look and feel of the app</p>
                </div>

                <div className="nyptid-card p-6">
                  <div className="text-xs font-bold text-surface-500 uppercase tracking-wider mb-4">Theme</div>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { id: 'dark', label: 'Dark', icon: Moon, preview: 'bg-surface-950' },
                      { id: 'darker', label: 'AMOLED', icon: Moon, preview: 'bg-black' },
                      { id: 'light', label: 'Light', icon: Sun, preview: 'bg-gray-100', disabled: true },
                    ].map(theme => (
                      <button key={theme.id} disabled={theme.disabled} className={`relative rounded-xl border p-3 text-center transition-all ${theme.id === 'dark' ? 'border-nyptid-300/50 bg-nyptid-300/5' : 'border-surface-700 hover:border-surface-600'} ${theme.disabled ? 'opacity-40 cursor-not-allowed' : ''}`}>
                        <div className={`h-12 rounded-lg ${theme.preview} mb-2 mx-auto`} />
                        <div className="text-xs font-medium text-surface-300">{theme.label}</div>
                        {theme.disabled && <div className="text-xs text-surface-600 mt-0.5">Soon</div>}
                        {theme.id === 'dark' && <div className="absolute top-1.5 right-1.5 w-3 h-3 bg-nyptid-300 rounded-full" />}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="nyptid-card p-6">
                  <div className="text-xs font-bold text-surface-500 uppercase tracking-wider mb-4">Chat Display</div>
                  <div>
                    <label className="block text-sm text-surface-400 mb-1.5">Message Font Size</label>
                    <div className="flex items-center gap-4">
                      <input type="range" min="12" max="18" defaultValue="14" className="flex-1 accent-nyptid-300" />
                      <span className="text-sm text-surface-300 w-8">14px</span>
                    </div>
                  </div>
                  <div className="mt-4">
                    <SettingRow label="Compact Message Mode" description="Show messages more densely with less spacing">
                      <ToggleSwitch checked={false} onChange={() => {}} />
                    </SettingRow>
                    <SettingRow label="Show Message Timestamps" description="Always show the time next to each message">
                      <ToggleSwitch checked={true} onChange={() => {}} />
                    </SettingRow>
                    <SettingRow label="Animate Emoji" description="Play animated emoji and stickers">
                      <ToggleSwitch checked={true} onChange={() => {}} />
                    </SettingRow>
                  </div>
                </div>
              </div>
            )}

            {/* ACCESSIBILITY */}
            {activeSection === 'accessibility' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-bold text-surface-100 mb-1">Accessibility</h2>
                  <p className="text-surface-500 text-sm">Make NYPTID work better for you</p>
                </div>

                <div className="nyptid-card p-6">
                  <div className="text-xs font-bold text-surface-500 uppercase tracking-wider mb-2">Motion & Animation</div>
                  <SettingRow label="Reduce Motion" description="Minimize animations and transitions throughout the app">
                    <ToggleSwitch checked={false} onChange={() => {}} />
                  </SettingRow>
                  <SettingRow label="Auto-play GIFs" description="Automatically animate GIF images in chat">
                    <ToggleSwitch checked={true} onChange={() => {}} />
                  </SettingRow>
                  <SettingRow label="Enable Saturation" description="Reduce color saturation for colorblind accessibility">
                    <ToggleSwitch checked={false} onChange={() => {}} />
                  </SettingRow>
                </div>

                <div className="nyptid-card p-6">
                  <div className="text-xs font-bold text-surface-500 uppercase tracking-wider mb-2">Text & Display</div>
                  <SettingRow label="Large Text Mode" description="Increase text size throughout the interface">
                    <ToggleSwitch checked={false} onChange={() => {}} />
                  </SettingRow>
                  <SettingRow label="High Contrast" description="Increase contrast for better readability">
                    <ToggleSwitch checked={false} onChange={() => {}} />
                  </SettingRow>
                </div>
              </div>
            )}

            {/* SECURITY */}
            {activeSection === 'security' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-bold text-surface-100 mb-1">Security</h2>
                  <p className="text-surface-500 text-sm">Manage your account security and authentication</p>
                </div>

                <div className="nyptid-card p-6">
                  <div className="flex items-start gap-3 mb-4">
                    <div className="w-10 h-10 rounded-xl bg-nyptid-300/10 border border-nyptid-300/20 flex items-center justify-center flex-shrink-0">
                      <Shield size={18} className="text-nyptid-200" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-surface-500 uppercase tracking-wider">NCore Shield</div>
                      <div className="text-sm text-surface-300 mt-1">
                        Outbound token leak checks, phishing link screening, executable attachment warnings, and login abuse throttling are active in this build.
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {shieldProtectionItems.map((item) => (
                      <div key={item.label} className="rounded-xl border border-surface-700 bg-surface-900/60 px-4 py-3">
                        <div className="text-sm font-semibold text-surface-100">{item.label}</div>
                        <div className="text-xs text-surface-500 mt-1 leading-relaxed">{item.description}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="nyptid-card p-6 space-y-4">
                  <div className="text-xs font-bold text-surface-500 uppercase tracking-wider">Change Password</div>

                  {passwordError && (
                    <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
                      <AlertCircle size={14} />
                      {passwordError}
                    </div>
                  )}
                  {passwordSaved && (
                    <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/20 rounded-lg text-green-400 text-sm">
                      <CheckCircle size={14} />
                      Password updated successfully
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-surface-300 mb-1.5">New Password</label>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      className="nyptid-input"
                      placeholder="Minimum 8 characters"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-surface-300 mb-1.5">Confirm New Password</label>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      className="nyptid-input"
                      placeholder="Re-enter new password"
                    />
                  </div>
                  <button onClick={handlePasswordChange} className="nyptid-btn-primary">
                    <Key size={16} />
                    Update Password
                  </button>
                </div>

                <div className="nyptid-card p-6">
                  <div className="text-xs font-bold text-surface-500 uppercase tracking-wider mb-3">Two-Factor Authentication</div>
                  <p className="text-sm text-surface-400 mb-4">Add an extra layer of security to your account with 2FA via TOTP authenticator app.</p>
                  <div className="p-3 bg-surface-800 rounded-lg border border-surface-700 flex items-center gap-3">
                    <Shield size={18} className="text-surface-500" />
                    <div className="flex-1">
                      <div className="text-sm text-surface-300">Authenticator App (TOTP)</div>
                      <div className="text-xs text-surface-500">Not configured</div>
                    </div>
                    <button className="nyptid-btn-secondary text-xs px-3 py-1.5">Set Up</button>
                  </div>
                </div>

                <div className="nyptid-card p-6">
                  <div className="text-xs font-bold text-surface-500 uppercase tracking-wider mb-3">Active Sessions</div>
                  <div className="space-y-2">
                    {[
                      { device: 'Chrome on Windows', location: 'Current Session', time: 'Active now', current: true },
                    ].map((session, i) => (
                      <div key={i} className="flex items-center gap-3 p-3 bg-surface-800 rounded-lg border border-surface-700">
                        <Monitor size={16} className="text-surface-400" />
                        <div className="flex-1">
                          <div className="text-sm text-surface-200">{session.device}</div>
                          <div className="text-xs text-surface-500">{session.time}</div>
                        </div>
                        {session.current ? (
                          <span className="text-xs text-green-400 font-medium">Current</span>
                        ) : (
                          <button className="text-xs text-red-400 hover:text-red-300">Revoke</button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="nyptid-card p-6 border-red-500/20">
                  <div className="text-xs font-bold text-red-500 uppercase tracking-wider mb-3">Danger Zone</div>
                  <p className="text-surface-400 text-sm mb-4">
                    Permanently delete your account and all associated data. This action cannot be undone.
                  </p>
                  <button onClick={() => setShowDeleteModal(true)} className="nyptid-btn-danger text-sm flex items-center gap-2">
                    <Trash2 size={14} />
                    Delete My Account
                  </button>
                </div>
              </div>
            )}

            {/* SERVER PROFILES */}
            {activeSection === 'server-profiles' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-bold text-surface-100 mb-1">Server Profiles</h2>
                  <p className="text-surface-500 text-sm">Customize how you appear in specific communities with unique display names, bios, and pronouns.</p>
                </div>

                <div className="nyptid-card p-5">
                  <div className="flex items-start gap-3 mb-2">
                    <Info size={16} className="text-nyptid-300 mt-0.5 flex-shrink-0" />
                    <p className="text-sm text-surface-400 leading-relaxed">
                      Server profiles let you present a different identity in each community — separate from your global profile.
                      They are created automatically when you set a server-specific name or bio in a community's member settings.
                    </p>
                  </div>
                </div>

                {!serverProfilesLoaded ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="w-8 h-8 border-2 border-nyptid-300 border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : serverProfiles.length === 0 ? (
                  <div className="text-center py-16 nyptid-card">
                    <Server size={48} className="text-surface-700 mx-auto mb-4" />
                    <p className="text-surface-400 font-medium">No server profiles yet</p>
                    <p className="text-surface-600 text-sm mt-1">Join communities and set custom profiles per server.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {serverProfiles.map(sp => (
                      <div key={sp.id} className="nyptid-card p-4 flex items-center gap-4">
                        <div className="w-10 h-10 rounded-xl bg-nyptid-900/50 flex items-center justify-center text-sm font-bold text-nyptid-300 flex-shrink-0">
                          {(sp.community as any)?.icon_url
                            ? <img src={(sp.community as any).icon_url} className="w-full h-full rounded-xl object-cover" alt="" />
                            : ((sp.community as any)?.name || 'S').slice(0, 2).toUpperCase()
                          }
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-surface-100 truncate">
                            {(sp.community as any)?.name || 'Unknown Server'}
                          </div>
                          <div className="text-xs text-surface-500 mt-0.5">
                            {sp.display_name ? `Display: ${sp.display_name}` : 'Using global name'}
                            {sp.pronouns ? ` · ${sp.pronouns}` : ''}
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            setEditingServerProfile(sp);
                            setServerProfileForm({
                              display_name: sp.display_name || '',
                              bio: sp.bio || '',
                              pronouns: sp.pronouns || '',
                            });
                          }}
                          className="nyptid-btn-ghost text-xs px-3 py-1.5 flex items-center gap-1.5"
                        >
                          <Edit2 size={13} />
                          Edit
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* STANDING */}
            {activeSection === 'standing' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-bold text-surface-100 mb-1">Account Standing</h2>
                  <p className="text-surface-500 text-sm">Review your account's compliance with NYPTID's Community Guidelines and Terms of Service.</p>
                </div>

                <div className={`rounded-xl border p-5 flex items-start gap-4 ${
                  standingEvents.filter(e => !e.resolved && (e.type === 'violation' || e.type === 'restriction')).length > 0
                    ? 'bg-red-500/10 border-red-500/30'
                    : standingEvents.filter(e => !e.resolved && e.type === 'warning').length > 0
                    ? 'bg-yellow-500/10 border-yellow-500/30'
                    : 'bg-green-500/10 border-green-500/30'
                }`}>
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    standingEvents.filter(e => !e.resolved && (e.type === 'violation' || e.type === 'restriction')).length > 0
                      ? 'bg-red-500/20'
                      : standingEvents.filter(e => !e.resolved && e.type === 'warning').length > 0
                      ? 'bg-yellow-500/20'
                      : 'bg-green-500/20'
                  }`}>
                    {standingEvents.filter(e => !e.resolved && (e.type === 'violation' || e.type === 'restriction')).length > 0 ? (
                      <AlertTriangle size={22} className="text-red-400" />
                    ) : standingEvents.filter(e => !e.resolved && e.type === 'warning').length > 0 ? (
                      <AlertTriangle size={22} className="text-yellow-400" />
                    ) : (
                      <CheckSquare size={22} className="text-green-400" />
                    )}
                  </div>
                  <div>
                    <div className={`font-bold text-lg ${
                      standingEvents.filter(e => !e.resolved && (e.type === 'violation' || e.type === 'restriction')).length > 0
                        ? 'text-red-300'
                        : standingEvents.filter(e => !e.resolved && e.type === 'warning').length > 0
                        ? 'text-yellow-300'
                        : 'text-green-300'
                    }`}>
                      {standingEvents.filter(e => !e.resolved && (e.type === 'violation' || e.type === 'restriction')).length > 0
                        ? 'Account Restricted'
                        : standingEvents.filter(e => !e.resolved && e.type === 'warning').length > 0
                        ? 'Warning on Record'
                        : 'Good Standing'}
                    </div>
                    <p className="text-sm text-surface-400 mt-0.5">
                      {standingEvents.filter(e => !e.resolved && (e.type === 'violation' || e.type === 'restriction')).length > 0
                        ? 'Your account has active violations. Review the details below and appeal if you believe this is an error.'
                        : standingEvents.filter(e => !e.resolved && e.type === 'warning').length > 0
                        ? 'You have an unresolved warning. Please review our Community Guidelines to avoid further action.'
                        : 'Your account is in good standing with NYPTID\'s Community Guidelines and Terms of Service.'}
                    </p>
                  </div>
                </div>

                <div className="nyptid-card p-5">
                  <div className="text-xs font-bold text-surface-500 uppercase tracking-wider mb-4">Community Standards</div>
                  <div className="space-y-3">
                    {[
                      { label: 'Community Guidelines', status: 'compliant', desc: 'Respect all community members and follow server rules.' },
                      { label: 'Terms of Service', status: 'compliant', desc: 'Account usage complies with NYPTID Terms of Service.' },
                      { label: 'Content Policy', status: 'compliant', desc: 'No policy violations detected on your shared content.' },
                      { label: 'Anti-Spam Policy', status: 'compliant', desc: 'No automated or spam behavior detected.' },
                    ].map(item => (
                      <div key={item.label} className="flex items-start gap-3 py-2 border-b border-surface-700/50 last:border-0">
                        <CheckCircle size={16} className="text-green-400 mt-0.5 flex-shrink-0" />
                        <div className="flex-1">
                          <div className="text-sm font-medium text-surface-200">{item.label}</div>
                          <div className="text-xs text-surface-500 mt-0.5">{item.desc}</div>
                        </div>
                        <span className="text-xs font-semibold text-green-400 px-2 py-0.5 bg-green-500/10 rounded-full">Compliant</span>
                      </div>
                    ))}
                  </div>
                </div>

                {standingLoaded && standingEvents.length > 0 && (
                  <div className="space-y-3">
                    <div className="text-xs font-bold text-surface-500 uppercase tracking-wider">Action History</div>
                    {standingEvents.map(event => (
                      <div key={event.id} className={`nyptid-card p-4 border ${
                        event.type === 'violation' || event.type === 'restriction' ? 'border-red-500/30' :
                        event.type === 'warning' ? 'border-yellow-500/30' :
                        event.type === 'appeal_approved' ? 'border-green-500/30' :
                        'border-surface-700'
                      }`}>
                        <div className="flex items-start gap-3">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                            event.type === 'violation' || event.type === 'restriction' ? 'bg-red-500/20' :
                            event.type === 'warning' ? 'bg-yellow-500/20' :
                            event.type === 'appeal_approved' ? 'bg-green-500/20' :
                            'bg-surface-700'
                          }`}>
                            {event.type === 'violation' || event.type === 'restriction' ? <AlertTriangle size={14} className="text-red-400" /> :
                             event.type === 'warning' ? <AlertTriangle size={14} className="text-yellow-400" /> :
                             event.type === 'appeal_approved' ? <CheckCircle size={14} className="text-green-400" /> :
                             <Info size={14} className="text-surface-400" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-semibold text-surface-100">{event.title}</span>
                              {event.resolved && <span className="text-xs text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full">Resolved</span>}
                            </div>
                            {event.description && <p className="text-xs text-surface-400 mt-1">{event.description}</p>}
                            <div className="text-xs text-surface-600 mt-1.5">
                              {new Date(event.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {standingLoaded && standingEvents.length === 0 && (
                  <div className="nyptid-card p-5 text-center text-surface-500 text-sm">
                    No action history. Keep it up!
                  </div>
                )}

                <div className="nyptid-card p-5">
                  <div className="text-xs font-bold text-surface-500 uppercase tracking-wider mb-3">Resources</div>
                  <div className="space-y-2">
                    {[
                      { id: 'guidelines' as StandingResourceId, label: 'Community Guidelines', desc: 'Read the full NYPTID Community Guidelines' },
                      { id: 'terms' as StandingResourceId, label: 'Terms of Service', desc: 'Review NYPTID Terms of Service' },
                      { id: 'appeal' as StandingResourceId, label: 'Appeal a Decision', desc: 'Dispute a moderation action on your account' },
                    ].map(r => (
                      <div key={r.label} className="flex items-center justify-between py-2 border-b border-surface-700/50 last:border-0">
                        <div>
                          <div className="text-sm text-surface-200">{r.label}</div>
                          <div className="text-xs text-surface-500">{r.desc}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setStandingResourceModal(r.id)}
                          className="text-xs text-nyptid-300 hover:text-nyptid-200 transition-colors font-medium"
                        >
                          View
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* CONNECTIONS */}
            {activeSection === 'connections' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-bold text-surface-100 mb-1">Connections</h2>
                  <p className="text-surface-500 text-sm">
                    OAuth and identity connections are intentionally deferred until the revenue and trust rails are fully in place.
                  </p>
                </div>

                <div className="rounded-[28px] border border-surface-700 bg-surface-900/80 p-6 shadow-[0_18px_50px_rgba(0,0,0,0.24)]">
                  <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                    <div className="max-w-2xl">
                      <div className="text-[11px] font-bold uppercase tracking-[0.28em] text-nyptid-200">Coming Soon</div>
                      <div className="mt-3 text-3xl font-black text-surface-100">Connections are staged, not live.</div>
                      <div className="mt-3 text-sm leading-6 text-surface-400">
                        Real account linking requires production-grade OAuth flows, token refresh, provider compliance, and moderation controls. The shell stays visible so the surface exists, but the actual provider connections are intentionally held until the monetization and trust systems are further along.
                      </div>
                    </div>
                    <div className="grid min-w-[18rem] gap-3 sm:grid-cols-2 lg:w-[22rem] lg:grid-cols-1">
                      <div className="rounded-2xl border border-surface-700 bg-surface-950/70 px-4 py-4">
                        <div className="text-[11px] uppercase tracking-[0.24em] text-surface-500">Status</div>
                        <div className="mt-2 text-lg font-bold text-surface-100">Deferred</div>
                        <div className="mt-1 text-xs text-surface-500">Hidden behind the next account-linking rollout.</div>
                      </div>
                      <div className="rounded-2xl border border-surface-700 bg-surface-950/70 px-4 py-4">
                        <div className="text-[11px] uppercase tracking-[0.24em] text-surface-500">Why</div>
                        <div className="mt-2 text-sm font-semibold text-surface-100">Reduce integration debt first</div>
                        <div className="mt-1 text-xs text-surface-500">Avoid half-built provider flows before revenue arrives.</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  {[
                    'Profile badges and rich identity cards',
                    'Verified gaming account ownership',
                    'Creator payment / storefront proof rails',
                  ].map((item) => (
                    <div key={item} className="rounded-2xl border border-dashed border-surface-700 bg-surface-950/65 px-4 py-5 text-sm text-surface-400">
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {rolledOutSection && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-bold text-surface-100 mb-1">{rolledOutSection.title}</h2>
                  <p className="text-surface-500 text-sm">{rolledOutSection.subtitle}</p>
                </div>

                {rolledOutSection.groups.map((group) => (
                  <div key={`${activeSection}-${group.title}`} className="nyptid-card p-5">
                    <div className="text-xs font-bold text-surface-500 uppercase tracking-wider mb-2">
                      {group.title}
                    </div>
                    {group.rows.map((row) => (
                      <SettingRow key={row.key} label={row.label} description={row.description}>
                        <ToggleSwitch
                          checked={Boolean(rolloutSettings[row.key])}
                          onChange={(value) => setRolloutToggle(row.key, value)}
                        />
                      </SettingRow>
                    ))}
                  </div>
                ))}

                {activeSection === 'registered-games' && (
                  <div className="nyptid-card p-5">
                    <div className="text-xs font-bold text-surface-500 uppercase tracking-wider mb-3">Detected Titles</div>
                    <div className="space-y-2">
                      {[
                        { title: 'NCore Desktop', exe: 'NCore.exe', source: 'Auto-detected' },
                        { title: 'FrameForge', exe: 'FrameForge.exe', source: 'Manual registration' },
                        { title: 'Steam Launcher', exe: 'steam.exe', source: 'Ignored (launcher process)' },
                      ].map((entry) => (
                        <div key={entry.exe} className="rounded-lg border border-surface-700 bg-surface-900/70 px-3 py-2">
                          <div className="text-sm text-surface-200 font-medium">{entry.title}</div>
                          <div className="text-xs text-surface-500">{entry.exe} - {entry.source}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {activeSection === 'nitro' && (
                  <div className="nyptid-card p-5">
                    <div className="text-xs font-bold text-surface-500 uppercase tracking-wider mb-3">Boost Subscription</div>
                    <div className="rounded-xl border border-surface-700 bg-surface-900/60 px-3 py-3 flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-surface-100">NCore Boost</div>
                        <div className="text-xs text-surface-500">$9.99/month - account-wide premium unlocks</div>
                      </div>
                      <span className={`px-2 py-1 rounded-full text-[11px] font-bold border ${entitlements.isBoost ? 'border-green-500/40 bg-green-500/10 text-green-300' : 'border-surface-600 bg-surface-700 text-surface-200'}`}>
                        {entitlements.isBoost ? 'ACTIVE' : 'NOT ACTIVE'}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      {entitlements.isBoost ? (
                        <button
                          type="button"
                          onClick={handleOpenBillingPortal}
                          disabled={checkoutLoadingKey !== null}
                          className="nyptid-btn-secondary text-sm"
                        >
                          {checkoutLoadingKey === 'portal' ? 'Opening portal...' : 'Manage Boost Subscription'}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={handleStartBoostCheckout}
                          disabled={checkoutLoadingKey !== null}
                          className="nyptid-btn-primary text-sm"
                        >
                          {checkoutLoadingKey === 'boost' ? 'Opening checkout...' : 'Subscribe to NCore Boost'}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {(activeSection === 'billing' || activeSection === 'subscriptions') && (
                  <div className="nyptid-card p-5">
                    <div className="text-xs font-bold text-surface-500 uppercase tracking-wider mb-3">Billing Portal</div>
                    <div className="text-sm text-surface-300">
                      Open Stripe billing portal to update payment methods, view invoices, and manage recurring plan state.
                    </div>
                    <button
                      type="button"
                      onClick={handleOpenBillingPortal}
                      disabled={checkoutLoadingKey !== null}
                      className="nyptid-btn-secondary text-sm mt-3"
                    >
                      {checkoutLoadingKey === 'portal' ? 'Opening portal...' : 'Open NCore Building Portal (Stripe)'}
                    </button>
                    {(billingActionMessage || checkoutLoadingKey === 'portal') && (
                      <div className="mt-2 text-xs text-surface-400">
                        {checkoutLoadingKey === 'portal' ? 'Requesting billing portal session...' : billingActionMessage}
                      </div>
                    )}
                  </div>
                )}

                {rolledOutSection.notes && rolledOutSection.notes.length > 0 && (
                  <div className="nyptid-card p-5">
                    <div className="text-xs font-bold text-surface-500 uppercase tracking-wider mb-3">Rollout Notes</div>
                    <ul className="space-y-2">
                      {rolledOutSection.notes.map((note) => (
                        <li key={note} className="text-sm text-surface-300 flex items-start gap-2">
                          <CheckCircle size={14} className="text-green-400 mt-0.5 flex-shrink-0" />
                          <span>{note}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {comingSoonSection && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-bold text-surface-100 mb-1">{comingSoonSection.title}</h2>
                  <p className="text-surface-500 text-sm">{comingSoonSection.subtitle}</p>
                </div>

                <div className="nyptid-card p-5">
                  <div className="text-xs font-bold text-surface-500 uppercase tracking-wider mb-3">
                    Planned Surface
                  </div>
                  <ul className="space-y-2">
                    {comingSoonSection.points.map((point) => (
                      <li key={point} className="flex items-start gap-2 text-sm text-surface-300">
                        <CheckCircle size={14} className="text-green-400 mt-0.5 flex-shrink-0" />
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="nyptid-card p-5">
                  <div className="text-xs font-bold text-surface-500 uppercase tracking-wider mb-3">
                    Rollout State
                  </div>
                  <div className="rounded-lg border border-surface-700 bg-surface-900/60 px-3 py-2 text-sm text-surface-300">
                    This section is scaffolded and available in navigation. Full controls will land in upcoming patches.
                  </div>
                </div>
              </div>
            )}

            {/* MEMBERSHIP */}
            {activeSection === 'membership' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-bold text-surface-100 mb-1">My Membership</h2>
                  <p className="text-surface-500 text-sm">Billing, plan limits, and unlock progression</p>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div className="nyptid-card p-5">
                    <div className="text-xs font-bold text-surface-500 uppercase tracking-wider mb-3">Plan Options</div>
                    <div className="space-y-3">
                      <div className={`rounded-xl border px-3 py-3 flex items-center justify-between gap-3 ${!entitlements.isBoost ? 'border-green-500/30 bg-green-500/10' : 'border-surface-700 bg-surface-800/50'}`}>
                        <div>
                          <div className="text-sm font-bold text-surface-100">Free</div>
                          <div className="text-xs text-surface-500">$0 forever</div>
                        </div>
                        <span className={`px-2 py-1 rounded-full text-[11px] font-bold border ${!entitlements.isBoost ? 'border-green-500/40 bg-green-500/15 text-green-300' : 'border-surface-600 bg-surface-700 text-surface-300'}`}>
                          {!entitlements.isBoost ? 'CURRENT' : 'AVAILABLE'}
                        </span>
                      </div>

                      <div className={`rounded-xl border px-3 py-3 flex items-center justify-between gap-3 ${entitlements.isBoost ? 'border-yellow-500/30 bg-yellow-500/10' : 'border-surface-700 bg-surface-800/50'}`}>
                        <div>
                          <div className="text-sm font-bold text-surface-100">NCore Boost</div>
                          <div className="text-xs text-surface-500">$9.99 / month</div>
                        </div>
                        {entitlements.isBoost ? (
                          <span className="px-2 py-1 rounded-full text-[11px] font-bold border border-yellow-500/40 bg-yellow-500/15 text-yellow-300">
                            CURRENT
                          </span>
                        ) : (
                          <span className="px-2 py-1 rounded-full text-[11px] font-bold border border-surface-600 bg-surface-700 text-surface-200">
                            UPGRADE
                          </span>
                        )}
                      </div>

                      <div className="pt-1">
                        <div className="text-[11px] font-bold text-surface-500 uppercase tracking-wider mb-2">
                          Other Side of NCore (Monthly)
                        </div>
                        <div className="space-y-2">
                          {[
                            { code: 'ncore_learn', name: 'NCore Learn', price: '$19.99 / month', desc: 'Learning-side monthly plan' },
                            { code: 'ncore_creator', name: 'NCore Creator', price: '$39.99 / month', desc: 'Creator-side monthly plan' },
                            { code: 'ncore_empire', name: 'NCore Empire', price: '$99.99 / month', desc: 'High-tier monthly plan' },
                          ].map((plan) => {
                            const isCurrent = entitlements.planCode === plan.code;
                            return (
                              <div
                                key={plan.code}
                                className={`rounded-lg border px-3 py-2.5 flex items-center justify-between gap-3 ${isCurrent ? 'border-nyptid-300/40 bg-nyptid-300/10' : 'border-surface-700 bg-surface-800/40'}`}
                              >
                                <div>
                                  <div className="text-sm font-semibold text-surface-100">{plan.name}</div>
                                  <div className="text-xs text-surface-500">{plan.price} · {plan.desc}</div>
                                </div>
                                <span className={`px-2 py-1 rounded-full text-[11px] font-bold border ${isCurrent ? 'border-nyptid-300/40 bg-nyptid-300/15 text-nyptid-200' : 'border-surface-600 bg-surface-700 text-surface-300'}`}>
                                  {isCurrent ? 'CURRENT' : 'COMING SOON'}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2 text-sm mt-4">
                      <div className="flex items-center justify-between">
                        <span className="text-surface-400">Message cap</span>
                        <span className="text-surface-100 font-semibold">{entitlements.messageLengthCap.toLocaleString()} chars</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-surface-400">Upload cap (per file)</span>
                        <span className="text-surface-100 font-semibold">{formatFileSize(entitlements.uploadBytesCap)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-surface-400">Max screen share</span>
                        <span className="text-surface-100 font-semibold uppercase">{entitlements.maxScreenShareQuality}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-surface-400">Status presets</span>
                        <span className="text-surface-100 font-semibold">{entitlements.statusPresetsEnabled ? 'Unlocked' : 'Locked'}</span>
                      </div>
                    </div>

                    <div className="mt-4 flex items-center gap-2">
                      {canUpgradeToBoost ? (
                        <button
                          type="button"
                          onClick={handleStartBoostCheckout}
                          disabled={checkoutLoadingKey !== null}
                          className="nyptid-btn-primary text-sm"
                        >
                          {checkoutLoadingKey === 'boost' ? 'Opening checkout...' : 'Subscribe to NCore Boost - $9.99/mo'}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={handleOpenBillingPortal}
                          disabled={checkoutLoadingKey !== null}
                          className="nyptid-btn-secondary text-sm"
                        >
                          {checkoutLoadingKey === 'portal' ? 'Opening portal...' : 'Manage subscription'}
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="nyptid-card p-5">
                    <div className="text-xs font-bold text-surface-500 uppercase tracking-wider mb-2">XP Unlock Track</div>
                    <div className="text-sm text-surface-300">
                      Current unlock level: <span className="font-bold text-surface-100">Lv {progression.level}</span>
                    </div>
                    <div className="text-xs text-surface-500 mt-1">
                      Effective XP: {progression.effectiveXp.toLocaleString()}
                      {entitlements.isBoost && ' (Boost progression uses 1.35x higher requirement)'}
                    </div>

                    <div className="mt-3 p-3 rounded-xl bg-surface-900/70 border border-surface-700/70">
                      {nextRequiredLevel == null ? (
                        <div className="text-sm text-green-400 font-semibold">All unlock tiers completed.</div>
                      ) : (
                        <>
                          <div className="text-sm text-surface-200">
                            Next unlock at <span className="font-bold">Lv {nextRequiredLevel}</span>
                          </div>
                          <div className="text-xs text-surface-500 mt-1">
                            {xpToNextLevel.toLocaleString()} effective XP remaining
                          </div>
                        </>
                      )}
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-lg border border-surface-700 p-2 text-surface-300">
                        <div className="font-semibold text-surface-200">Lv 5</div>
                        Status presets
                      </div>
                      <div className="rounded-lg border border-surface-700 p-2 text-surface-300">
                        <div className="font-semibold text-surface-200">Lv 10</div>
                        +10% message cap
                      </div>
                      <div className="rounded-lg border border-surface-700 p-2 text-surface-300">
                        <div className="font-semibold text-surface-200">Lv 20</div>
                        +10% upload cap
                      </div>
                      <div className="rounded-lg border border-surface-700 p-2 text-surface-300">
                        <div className="font-semibold text-surface-200">Lv 35</div>
                        1080p120 share unlock
                      </div>
                      <div className="rounded-lg border border-surface-700 p-2 text-surface-300">
                        <div className="font-semibold text-surface-200">Lv 50</div>
                        +5 group DM slots
                      </div>
                      <div className="rounded-lg border border-surface-700 p-2 text-surface-300">
                        <div className="font-semibold text-surface-200">Lv 70</div>
                        NCore Labs toggle
                      </div>
                    </div>
                  </div>
                </div>

                <div className="nyptid-card p-5 space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-bold text-surface-500 uppercase tracking-wider">Growth Access + Invite Unlock</div>
                      <div className="text-sm text-surface-300 mt-1">
                        Trust tier gates server creation, high-volume call starts, and marketplace actions.
                      </div>
                    </div>
                    <span className="px-2 py-1 rounded-full text-[11px] font-bold border border-nyptid-300/40 bg-nyptid-300/10 text-nyptid-200">
                      Tier: {growthCapabilitiesLoading ? 'Loading...' : growthTierLabel}
                    </span>
                  </div>

                  <div className="grid md:grid-cols-3 gap-2">
                    {growthCapabilitiesRows.map((row) => (
                      <div
                        key={row.key}
                        className={`rounded-lg border px-3 py-2 text-xs ${row.enabled ? 'border-green-500/30 bg-green-500/10 text-green-200' : 'border-red-500/30 bg-red-500/10 text-red-200'}`}
                      >
                        <div className="font-semibold">{row.label}</div>
                        <div className="mt-0.5">{row.enabled ? 'Unlocked' : 'Locked'}</div>
                        {!row.enabled && (
                          <div className="mt-1 text-[11px] opacity-90">{row.reason}</div>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="rounded-xl border border-surface-700 bg-surface-900/60 p-3">
                    <div className="text-xs font-semibold text-surface-200 mb-2">Redeem Trusted Invite Code</div>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        value={inviteCodeInput}
                        onChange={(e) => setInviteCodeInput(e.target.value)}
                        placeholder="Enter invite code"
                        className="nyptid-input flex-1 min-w-[220px]"
                        maxLength={64}
                      />
                      <button
                        type="button"
                        onClick={() => void handleRedeemInviteCode()}
                        disabled={redeemingInviteCode}
                        className="nyptid-btn-primary text-sm"
                      >
                        {redeemingInviteCode ? 'Redeeming...' : 'Redeem Code'}
                      </button>
                    </div>
                    <div className="text-[11px] text-surface-500 mt-2">
                      Unlock paths: trusted invite code, admin approval, or trust-tier promotion.
                    </div>
                    {growthUnlockMessage && (
                      <div className="mt-2 text-xs text-surface-300">{growthUnlockMessage}</div>
                    )}
                  </div>
                </div>

                {(billingActionMessage || entitlementsLoading) && (
                  <div className="text-xs text-surface-400">
                    {entitlementsLoading ? 'Refreshing entitlements...' : billingActionMessage}
                  </div>
                )}
              </div>
            )}

            {/* WHAT'S NEW */}
            {activeSection === 'whats-new' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-bold text-surface-100 mb-1">What's New</h2>
                  <p className="text-surface-500 text-sm">Latest updates and improvements to NCore</p>
                  <div className="mt-4 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={desktopUpdateReady ? handleInstallDownloadedUpdate : handleDownloadLatestUpdate}
                      disabled={desktopUpdateBusy || installingDownloadedUpdate}
                      className="nyptid-btn-primary text-sm"
                    >
                      {desktopUpdateBusy || installingDownloadedUpdate ? (
                        <RefreshCw size={14} className="animate-spin" />
                      ) : (
                        <Download size={14} />
                      )}
                      {installingDownloadedUpdate || desktopUpdateRuntimeState.installing
                        ? 'Applying update...'
                        : desktopUpdateReady
                          ? 'Restart to Update'
                          : desktopUpdateRuntimeState.downloading
                            ? `Downloading${desktopUpdateProgress > 0 ? ` ${desktopUpdateProgress}%` : '...'}`
                            : desktopUpdateRuntimeState.checking || downloadingUpdate
                              ? 'Checking latest...'
                              : 'Download Latest Update'}
                    </button>
                    <span className="text-xs text-surface-500">
                      Installed desktop builds self-update in place. Portable builds still fall back to the latest installer.
                    </span>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <input
                      type="url"
                      value={updateFeedUrlInput}
                      onChange={(e) => setUpdateFeedUrlInput(e.target.value)}
                      placeholder={DEFAULT_UPDATE_FEED_URL}
                      className="nyptid-input text-xs flex-1"
                    />
                    <button
                      type="button"
                      onClick={handleSaveUpdateFeedUrl}
                      disabled={savingUpdateFeedUrl}
                      className="nyptid-btn-secondary text-xs"
                    >
                      {savingUpdateFeedUrl ? 'Saving...' : 'Save URL'}
                    </button>
                  </div>
                  {updateStatusMessage && (
                    <div className={`mt-3 text-xs ${updateAhead ? 'text-amber-300' : 'text-green-300'}`}>
                      {updateStatusMessage}
                    </div>
                  )}
                  {updateDownloadMessage && (
                    <div className="mt-3 text-xs text-surface-400">{updateDownloadMessage}</div>
                  )}
                </div>

                <div className="space-y-4">
                  {releaseLog.map((release) => (
                    <div key={release.version} className="nyptid-card p-6">
                      <div className="flex items-center gap-3 mb-4">
                        <span className="text-lg font-black text-surface-100">v{release.version}</span>
                        <span className="px-2 py-0.5 bg-nyptid-300/10 border border-nyptid-300/20 rounded text-nyptid-300 text-xs font-bold">{release.badge}</span>
                        <span className="text-sm text-surface-500 ml-auto">{release.date}</span>
                      </div>

                      {release.improvements.length > 0 && (
                        <div className="mb-4">
                          <div className="text-[11px] font-bold text-surface-500 uppercase tracking-wider mb-2">
                            Improvements
                          </div>
                          <ul className="space-y-2">
                            {release.improvements.map((item) => (
                              <li key={`imp-${release.version}-${item}`} className="flex items-start gap-2 text-sm text-surface-300">
                                <Zap size={14} className="text-nyptid-300 mt-0.5 flex-shrink-0" />
                                {item}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      <div>
                        <div className="text-[11px] font-bold text-surface-500 uppercase tracking-wider mb-2">
                          Bug Fixes
                        </div>
                        {release.bugFixes.length > 0 ? (
                          <ul className="space-y-2">
                            {release.bugFixes.map((item) => (
                              <li key={`fix-${release.version}-${item}`} className="flex items-start gap-2 text-sm text-surface-300">
                                <CheckCircle size={14} className="text-green-400 mt-0.5 flex-shrink-0" />
                                {item}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <div className="text-xs text-surface-500">No specific bug-fix entries for this release.</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* DATA IMPORT */}
            {activeSection === 'data-import' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-bold text-surface-100 mb-1">Data Import</h2>
                  <p className="text-surface-500 text-sm">Import your Discord export zip into an NCore DM archive.</p>
                </div>

                <div className="nyptid-card p-5 space-y-4">
                  <div className="rounded-lg border border-surface-700 bg-surface-900 p-4">
                    <div className="text-sm font-semibold text-surface-200 mb-1">Discord Zip Import</div>
                    <p className="text-xs text-surface-500">
                      Supports Discord data export archives (`.zip`). Messages are imported into a new group DM owned by you.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => discordImportInputRef.current?.click()}
                      disabled={importingDiscord}
                      className="nyptid-btn-primary text-sm"
                    >
                      <Upload size={14} />
                      {importingDiscord ? 'Importing...' : 'Import Discord Zip'}
                    </button>
                    <input
                      ref={discordImportInputRef}
                      type="file"
                      accept=".zip,application/zip,application/x-zip-compressed"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) {
                          void handleDiscordImportZip(file);
                        }
                        event.currentTarget.value = '';
                      }}
                    />
                    <span className="text-xs text-surface-500">
                      Max {MAX_DISCORD_IMPORT_MESSAGES.toLocaleString()} imported messages per file.
                    </span>
                  </div>

                  {discordImportMessage && (
                    <div className="text-xs text-surface-300 bg-surface-900 border border-surface-700 rounded-lg px-3 py-2">
                      {discordImportMessage}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <Modal
        isOpen={standingResourceModal !== null}
        onClose={() => setStandingResourceModal(null)}
        title={standingResourceModal ? STANDING_RESOURCE_CONTENT[standingResourceModal].title : ''}
        size="lg"
      >
        {standingResourceModal && (
          <div className="space-y-4">
            <div className="rounded-xl border border-nyptid-300/25 bg-gradient-to-br from-nyptid-300/10 to-surface-900/40 p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-nyptid-200">NCore Standing Briefing</div>
              <div className="mt-1 text-sm text-surface-300">{STANDING_RESOURCE_CONTENT[standingResourceModal].subtitle}</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {STANDING_RESOURCE_CONTENT[standingResourceModal].highlights.map((point) => (
                  <span key={point} className="rounded-full border border-surface-600 bg-surface-900/60 px-2 py-0.5 text-[11px] text-surface-300">
                    {point}
                  </span>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              {STANDING_RESOURCE_CONTENT[standingResourceModal].body.map((paragraph) => (
                <div key={paragraph} className="rounded-lg border border-surface-700 bg-surface-900/60 px-3 py-2 text-sm text-surface-300 leading-relaxed">
                  {paragraph}
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setStandingResourceModal(null)} className="nyptid-btn-secondary text-sm px-3 py-2">
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  setStandingResourceModal(null);
                  if (activeSection !== 'standing') activateSection('standing');
                }}
                className="nyptid-btn-primary text-sm px-3 py-2"
              >
                {STANDING_RESOURCE_CONTENT[standingResourceModal].actionLabel}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={showUpdateLauncher}
        onClose={() => setShowUpdateLauncher(false)}
        title="NCore Update Launcher"
        size="sm"
      >
        <div className="space-y-4">
          <div className="relative overflow-hidden rounded-2xl border border-surface-700 bg-surface-900/90 p-4">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,180,71,0.18),transparent_55%)]" />
            <div className="relative flex items-center gap-4">
              <div className="relative flex h-14 w-14 items-center justify-center">
                <div className={`absolute inset-0 rounded-full ${
                  updateLauncherStage === 'error'
                    ? 'bg-red-500/15'
                    : updateLauncherStage === 'no-update'
                      ? 'bg-surface-700/70'
                      : 'bg-nyptid-300/15'
                }`} />
                <div className={`absolute inset-1 rounded-full border ${
                  updateLauncherStage === 'error'
                    ? 'border-red-500/30'
                    : updateLauncherStage === 'no-update'
                      ? 'border-surface-600'
                      : 'border-nyptid-300/30 animate-pulse'
                }`} />
                {updateLauncherStage === 'error' ? (
                  <AlertTriangle size={22} className="relative z-10 text-red-300" />
                ) : updateLauncherStage === 'no-update' ? (
                  <Info size={22} className="relative z-10 text-surface-200" />
                ) : updateLauncherStage === 'ready' ? (
                  <CheckCircle size={22} className="relative z-10 text-green-300" />
                ) : updateLauncherStage === 'downloading' ? (
                  <Download size={22} className="relative z-10 text-nyptid-200" />
                ) : (
                  <RefreshCw size={22} className="relative z-10 animate-spin text-nyptid-200" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold uppercase tracking-[0.24em] text-surface-500">
                  {updateLauncherStage === 'error'
                    ? 'Update Error'
                    : updateLauncherStage === 'no-update'
                      ? 'Feed Check Complete'
                      : updateLauncherStage === 'ready'
                        ? 'Update Ready'
                        : updateLauncherStage === 'installing'
                          ? 'Installing Update'
                          : updateLauncherStage === 'downloading'
                            ? 'Update In Progress'
                        : 'Checking Feed'}
                </div>
                <div className="mt-1 text-sm font-semibold text-surface-100">{updateLauncherDetail}</div>
              </div>
            </div>
          </div>

          {(desktopUpdateRuntimeState.downloading || desktopUpdateRuntimeState.installing || desktopUpdateRuntimeState.ready) && (
            <div className="rounded-2xl border border-surface-700 bg-surface-950/80 p-4">
              <div className="flex items-center justify-between gap-3 text-[11px] font-bold uppercase tracking-[0.24em] text-surface-500">
                <span>Updater Status</span>
                <span className="text-surface-300">
                  {desktopUpdateRuntimeState.ready
                    ? '100%'
                    : desktopUpdateProgress > 0
                      ? `${desktopUpdateProgress}%`
                      : desktopUpdateRuntimeState.installing
                        ? 'Applying'
                        : 'Preparing'}
                </span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-800">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    desktopUpdateRuntimeState.ready
                      ? 'bg-green-400'
                      : 'bg-gradient-to-r from-amber-300 via-nyptid-300 to-green-300'
                  }`}
                  style={{
                    width: `${desktopUpdateRuntimeState.ready
                      ? 100
                      : desktopUpdateRuntimeState.installing
                        ? 100
                        : Math.max(desktopUpdateProgress, desktopUpdateRuntimeState.downloading ? 8 : 4)}%`,
                  }}
                />
              </div>
              <div className="mt-2 text-xs text-surface-400">
                {desktopUpdateRuntimeState.ready
                  ? 'The release package is staged locally and ready to restart into the new build.'
                  : desktopUpdateRuntimeState.installing
                    ? 'NCore is applying the downloaded package and will relaunch automatically.'
                    : 'NCore is downloading the update in the background. You can leave this screen open or keep working.'}
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-surface-700 bg-surface-950/80 p-4">
            <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-surface-500">Operator Fact</div>
            <div className="mt-2 text-sm leading-relaxed text-surface-300">
              {activeUpdateLauncherFact}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-xl border border-surface-700 bg-surface-900/60 px-3 py-2 text-xs text-surface-400">
            <span>Installed build</span>
            <span className="font-semibold text-surface-200">v{buildVersion}</span>
          </div>

          <div className="flex justify-end gap-2">
            {showInstallUpdateAction && (
              <button
                type="button"
                onClick={handleInstallDownloadedUpdate}
                disabled={installingDownloadedUpdate || desktopUpdateRuntimeState.installing}
                className="nyptid-btn-primary text-sm px-3 py-2"
              >
                {installingDownloadedUpdate || desktopUpdateRuntimeState.installing ? 'Applying...' : 'Restart to Update'}
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowUpdateLauncher(false)}
              className="nyptid-btn-secondary text-sm px-3 py-2"
            >
              {updateLauncherStage === 'checking' || updateLauncherStage === 'downloading' ? 'Hide' : 'Close'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete Account Modal */}
      <Modal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        title="Delete Account"
        size="sm"
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
            <AlertCircle size={20} className="text-red-400 flex-shrink-0" />
            <p className="text-sm text-red-300">
              This will permanently delete your account and all your data. This cannot be undone.
            </p>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setShowDeleteModal(false)} className="nyptid-btn-secondary flex-1">Cancel</button>
            <button className="nyptid-btn-danger flex-1">Delete Account</button>
          </div>
        </div>
      </Modal>

      {/* Logout Modal */}
      <Modal
        isOpen={showLogoutModal}
        onClose={() => setShowLogoutModal(false)}
        title="Log Out"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-surface-400">Are you sure you want to log out of NYPTID?</p>
          <div className="flex gap-3">
            <button onClick={() => setShowLogoutModal(false)} className="nyptid-btn-secondary flex-1">Cancel</button>
            <button onClick={signOut} className="nyptid-btn-danger flex-1 flex items-center justify-center gap-2">
              <LogOut size={16} />
              Log Out
            </button>
          </div>
        </div>
      </Modal>

      {/* Edit Server Profile Modal */}
      <Modal
        isOpen={!!editingServerProfile}
        onClose={() => setEditingServerProfile(null)}
        title={`Edit Server Profile — ${(editingServerProfile?.community as any)?.name || 'Server'}`}
        size="md"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-surface-500 uppercase tracking-wider mb-2">Server Display Name</label>
            <input
              type="text"
              value={serverProfileForm.display_name}
              onChange={e => setServerProfileForm(p => ({ ...p, display_name: e.target.value }))}
              className="nyptid-input"
              placeholder="Leave blank to use your global name"
              maxLength={32}
            />
            <p className="text-xs text-surface-600 mt-1">Shown instead of your global display name in this server.</p>
          </div>
          <div>
            <label className="block text-xs font-bold text-surface-500 uppercase tracking-wider mb-2">Pronouns</label>
            <input
              type="text"
              value={serverProfileForm.pronouns}
              onChange={e => setServerProfileForm(p => ({ ...p, pronouns: e.target.value }))}
              className="nyptid-input"
              placeholder="e.g. he/him, she/her, they/them"
              maxLength={40}
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-surface-500 uppercase tracking-wider mb-2">Server Bio</label>
            <textarea
              value={serverProfileForm.bio}
              onChange={e => setServerProfileForm(p => ({ ...p, bio: e.target.value }))}
              className="nyptid-input resize-none"
              placeholder="Describe yourself for this server..."
              rows={3}
              maxLength={200}
            />
          </div>
          <div className="flex gap-3 pt-1">
            <button onClick={() => setEditingServerProfile(null)} className="nyptid-btn-secondary flex-1">Cancel</button>
            <button onClick={handleSaveServerProfile} disabled={saving} className="nyptid-btn-primary flex-1">
              <Save size={14} />
              {saving ? 'Saving...' : 'Save Profile'}
            </button>
          </div>
        </div>
      </Modal>
    </AppShell>
  );
}

