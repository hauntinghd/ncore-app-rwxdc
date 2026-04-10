export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type PlatformRole = 'owner' | 'admin' | 'moderator' | 'user';
export type UserStatus = 'online' | 'idle' | 'dnd' | 'invisible' | 'offline';
export type CommunityRole = 'owner' | 'admin' | 'moderator' | 'member';
export type ChannelType = 'text' | 'voice' | 'announcement' | 'forum' | 'stage';
export type ContentType = 'video' | 'text' | 'quiz';
export type Visibility = 'public' | 'private';
export type ScreenShareQualityCap = '720p30' | '1080p120' | '4k60';

export interface Profile {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  banner_url: string | null;
  bio: string;
  custom_status?: string | null;
  custom_status_emoji?: string | null;
  platform_role: PlatformRole;
  rank: string;
  xp: number;
  status: UserStatus;
  last_seen: string;
  is_banned: boolean;
  created_at: string;
  updated_at: string;
}

export interface BillingSubscription {
  id: string;
  user_id: string;
  plan_code: string;
  status: string;
  current_period_end: string | null;
  stripe_subscription_id: string;
  created_at: string;
  updated_at: string;
}

export interface StoreProduct {
  sku: string;
  name: string;
  description: string;
  kind: string;
  price_cents: number;
  currency: string;
  active: boolean;
  grant_key: string;
  grant_payload: Json;
  created_at: string;
  updated_at: string;
}

export interface UserPurchase {
  id: string;
  user_id: string;
  sku: string;
  stripe_payment_intent_id: string | null;
  stripe_checkout_session_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface MarketplaceSellerProfile {
  user_id: string;
  primary_niche: string;
  bio: string;
  clearance_level: 'none' | 'level_i' | 'level_ii' | 'level_iii' | string;
  clearance_status: 'pending' | 'approved' | 'rejected' | 'suspended' | string;
  verified_earnings_cents: number;
  proof_url: string | null;
  stripe_account_id: string | null;
  quickdraw_enabled: boolean;
  can_publish_games: boolean;
  created_at: string;
  updated_at: string;
}

export interface MarketplaceServiceCategory {
  id: string;
  slug: string;
  name: string;
  description: string;
  listing_fee_min_cents: number;
  listing_fee_max_cents: number;
  min_verified_earnings_cents: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface MarketplaceServiceListing {
  id: string;
  seller_id: string;
  category_id: string;
  title: string;
  description: string;
  portfolio_url: string | null;
  base_price_cents: number;
  delivery_days: number;
  listing_fee_cents: number;
  listing_fee_paid: boolean;
  status: 'draft' | 'pending_fee' | 'pending_review' | 'approved' | 'paused' | 'rejected' | string;
  review_note?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  rejection_reason?: string | null;
  created_at: string;
  updated_at: string;
  category?: MarketplaceServiceCategory | null;
  seller_profile?: Pick<Profile, 'id' | 'username' | 'display_name' | 'avatar_url'> | null;
}

export interface MarketplaceServiceOrder {
  id: string;
  listing_id: string;
  buyer_id: string;
  seller_id: string;
  amount_cents: number;
  platform_fee_bps: number;
  status: 'pending_payment' | 'funded' | 'in_progress' | 'delivered' | 'released' | 'disputed' | 'refunded' | 'cancelled' | string;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  escrow_release_due_at: string | null;
  seller_delivered_at?: string | null;
  buyer_confirmed_at?: string | null;
  disputed_at?: string | null;
  released_at: string | null;
  created_at: string;
  updated_at: string;
  listing?: MarketplaceServiceListing | null;
  buyer_profile?: Pick<Profile, 'id' | 'username' | 'display_name' | 'avatar_url'> | null;
  seller_profile?: Pick<Profile, 'id' | 'username' | 'display_name' | 'avatar_url'> | null;
}

export interface MarketplaceGameListing {
  id: string;
  seller_id: string;
  title: string;
  slug: string;
  description: string;
  cover_url: string | null;
  installer_url: string | null;
  price_cents: number;
  listing_fee_cents: number;
  listing_fee_paid: boolean;
  platform_fee_bps: number;
  provenance_type: 'self_developed' | 'steam_authorized' | string;
  provenance_proof_url: string | null;
  status: 'draft' | 'pending_fee' | 'pending_review' | 'approved' | 'paused' | 'rejected' | string;
  review_note?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  rejection_reason?: string | null;
  security_status?: 'pending' | 'passed' | 'failed' | 'needs_changes' | string;
  security_notes?: string | null;
  created_at: string;
  updated_at: string;
  seller_profile?: Pick<Profile, 'id' | 'username' | 'display_name' | 'avatar_url'> | null;
}

export interface MarketplaceGameOrder {
  id: string;
  game_listing_id: string;
  buyer_id: string;
  seller_id: string;
  amount_cents: number;
  platform_fee_bps: number;
  status: 'pending_payment' | 'paid' | 'fulfilled' | 'refunded' | 'cancelled' | string;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  download_token: string | null;
  download_expires_at: string | null;
  created_at: string;
  updated_at: string;
  game?: MarketplaceGameListing | null;
  buyer_profile?: Pick<Profile, 'id' | 'username' | 'display_name' | 'avatar_url'> | null;
  seller_profile?: Pick<Profile, 'id' | 'username' | 'display_name' | 'avatar_url'> | null;
}

export interface MarketplaceServiceDispute {
  id: string;
  order_id: string;
  opened_by: string;
  reason: string;
  evidence_url: string | null;
  status: 'open' | 'resolved' | 'rejected' | 'refunded' | string;
  resolution: string | null;
  admin_note: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  order?: MarketplaceServiceOrder | null;
}

export interface NcoreWalletAccount {
  user_id: string;
  pending_balance_cents: number;
  available_balance_cents: number;
  created_at: string;
  updated_at: string;
}

export interface XpUnlockTier {
  tier: number;
  required_level: number;
  unlock_key: string;
  unlock_payload: Json;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProgressionSummary {
  rawXp: number;
  effectiveXp: number;
  level: number;
  isBoost: boolean;
  nextRequiredLevel: number | null;
  nextRequiredEffectiveXp: number | null;
  unlockedTiers: number[];
}

export interface UserEntitlements {
  planCode: 'free' | 'boost_monthly' | string;
  isBoost: boolean;
  messageLengthCap: number;
  uploadBytesCap: number;
  maxScreenShareQuality: ScreenShareQualityCap;
  statusPresetsEnabled: boolean;
  groupDmMemberBonus: number;
  ncoreLabsEnabled: boolean;
  ownedSkus: string[];
  progression: ProgressionSummary;
  purchaseEntitlements?: Record<string, Json>;
}

export type GrowthTrustTier = 'limited' | 'member' | 'trusted' | 'operator' | string;

export interface UserGrowthCapabilityRow {
  user_id: string;
  trust_tier: GrowthTrustTier;
  can_create_server: boolean;
  can_start_high_volume_calls: boolean;
  can_use_marketplace: boolean;
  unlock_source: string;
  created_at: string;
  updated_at: string;
}

export interface GrowthCapabilityContract {
  trust_tier: GrowthTrustTier;
  capabilities: {
    can_create_server: boolean;
    can_start_high_volume_calls: boolean;
    can_use_marketplace: boolean;
  };
  unlock_source: string;
  updated_at?: string | null;
}

export interface GrowthInviteCode {
  id: string;
  inviter_user_id: string;
  code: string;
  source_channel: string;
  grant_trust_tier: GrowthTrustTier;
  grant_can_create_server: boolean;
  grant_can_start_high_volume_calls: boolean;
  grant_can_use_marketplace: boolean;
  max_uses: number;
  use_count: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface GrowthReferral {
  id: string;
  code_id: string;
  inviter_user_id: string;
  invitee_user_id: string;
  source_channel: string;
  activation_criteria: Json;
  activated_at: string | null;
  activation_event: string | null;
  reward_eligible: boolean;
  reward_granted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface GrowthEventRow {
  id: string;
  user_id: string | null;
  event_name: string;
  event_version: number;
  event_source: string;
  source_channel: string;
  session_id: string | null;
  payload: Json;
  created_at: string;
}

export interface AccountSecurityRiskSignal {
  id: string;
  user_id: string;
  source_kind: 'channel_message' | 'direct_message' | 'growth_event' | 'admin_manual' | string;
  source_ref: string;
  signal_key: string;
  risk_score: number;
  risk_level: 'low' | 'medium' | 'high' | 'critical' | string;
  excerpt: string | null;
  metadata: Json;
  created_at: string;
}

export interface AccountSecurityRiskCase {
  user_id: string;
  risk_level: 'none' | 'low' | 'medium' | 'high' | 'critical' | string;
  risk_score: number;
  containment_state: 'none' | 'observe' | 'limited_mode' | 'quarantined' | string;
  auto_contained: boolean;
  review_status: 'pending_review' | 'reviewed' | 'dismissed' | string;
  previous_growth_contract: Json | null;
  signal_summary: Json;
  risk_factors: Json;
  last_event_name: string | null;
  last_event_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface OperatorDailyMetric {
  metric_date: string;
  source_channel: string;
  checkout_started_count: number;
  checkout_paid_count: number;
  checkout_failed_count: number;
  boost_mrr_cents: number;
  marketplace_gmv_cents: number;
  marketplace_fee_cents: number;
  call_attempts_count: number;
  call_connected_count: number;
  call_drop_count: number;
  updated_at: string;
}

export interface OperatorRevenue30d {
  source_channel: string;
  checkout_started_count: number;
  checkout_paid_count: number;
  checkout_failed_count: number;
  boost_mrr_cents: number;
  marketplace_gmv_cents: number;
  marketplace_fee_cents: number;
  call_attempts_count: number;
  call_connected_count: number;
  call_drop_count: number;
  last_updated_at: string;
}

export interface Community {
  id: string;
  name: string;
  slug: string;
  description: string;
  icon_url: string | null;
  banner_url: string | null;
  category: string;
  visibility: Visibility;
  owner_id: string;
  member_count: number;
  is_featured: boolean;
  created_at: string;
  updated_at: string;
  owner?: Profile;
  is_member?: boolean;
  member_role?: CommunityRole;
}

export interface CommunityMember {
  id: string;
  community_id: string;
  user_id: string;
  role: CommunityRole;
  joined_at: string;
  profile?: Profile;
}

export interface CommunityInvite {
  id: string;
  community_id: string;
  code: string;
  created_by: string | null;
  max_uses: number | null;
  use_count: number;
  expires_at: string | null;
  revoked: boolean;
  created_at: string;
  updated_at: string;
}

export interface CommunityServerCustomization {
  id: string;
  community_id: string;
  accent_color: string;
  gradient_start: string;
  gradient_end: string;
  server_tagline: string;
  welcome_message: string;
  rules_markdown: string;
  onboarding_steps: string[];
  default_slowmode_seconds: number;
  max_upload_mb: number;
  verification_level: 'none' | 'low' | 'medium' | 'high' | 'very_high';
  custom_role_labels: Json;
  custom_theme_css: string;
  enable_animated_background: boolean;
  invite_only: boolean;
  created_at: string;
  updated_at: string;
}

export interface Course {
  id: string;
  community_id: string;
  title: string;
  description: string;
  thumbnail_url: string | null;
  order_index: number;
  is_published: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  lessons?: Lesson[];
  progress?: number;
}

export interface Lesson {
  id: string;
  course_id: string;
  title: string;
  content_type: ContentType;
  content_url: string | null;
  content_text: string | null;
  order_index: number;
  duration_minutes: number;
  is_published: boolean;
  created_at: string;
  completed?: boolean;
}

export interface LessonProgress {
  id: string;
  user_id: string;
  lesson_id: string;
  completed: boolean;
  completed_at: string | null;
}

export interface Server {
  id: string;
  community_id: string;
  name: string;
  icon_url: string | null;
  owner_id: string | null;
  created_at: string;
  categories?: ChannelCategory[];
}

export interface ChannelCategory {
  id: string;
  server_id: string;
  name: string;
  order_index: number;
  channels?: Channel[];
}

export interface Channel {
  id: string;
  server_id: string;
  category_id: string | null;
  name: string;
  channel_type: ChannelType;
  description: string;
  order_index: number;
  is_private: boolean;
  created_at: string;
  voice_participants?: VoiceSession[];
}

export interface Message {
  id: string;
  channel_id: string;
  author_id: string | null;
  content: string;
  is_edited: boolean;
  is_pinned: boolean;
  parent_message_id: string | null;
  created_at: string;
  updated_at: string;
  author?: Profile;
  reactions?: MessageReaction[];
  attachments?: MessageAttachment[];
  reply_count?: number;
}

export interface MessageReaction {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
  user?: Profile;
}

export interface MessageAttachment {
  id: string;
  message_id: string;
  file_url: string;
  file_name: string;
  file_type: string;
  file_size: number;
}

export interface DirectConversation {
  id: string;
  is_group: boolean;
  name: string | null;
  icon_url: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  members?: DirectConversationMember[];
  last_message?: DirectMessage;
  unread_count?: number;
}

export interface DirectConversationMember {
  id: string;
  conversation_id: string;
  user_id: string;
  last_read_at: string;
  role: 'owner' | 'admin' | 'member';
  added_by: string | null;
  profile?: Profile;
}

export interface DirectMessage {
  id: string;
  conversation_id: string;
  author_id: string | null;
  content: string;
  is_edited: boolean;
  created_at: string;
  updated_at: string;
  author?: Profile;
  attachments?: DirectMessageAttachment[];
}

export interface DirectMessageAttachment {
  id: string;
  direct_message_id: string;
  file_url: string;
  file_name: string;
  file_type: string;
  file_size: number;
  created_at: string;
}

export interface VoiceSession {
  id: string;
  channel_id: string;
  user_id: string;
  is_muted: boolean;
  is_deafened: boolean;
  is_camera_on: boolean;
  is_screen_sharing: boolean;
  joined_at: string;
  profile?: Profile;
}

export interface Notification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  data: Json;
  is_read: boolean;
  created_at: string;
}

export interface UserRelationship {
  id: string;
  user_id: string;
  target_user_id: string;
  relationship: 'friend' | 'ignored' | 'blocked' | 'friend_pending_outgoing' | 'friend_pending_incoming';
  created_at: string;
  updated_at: string;
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  xp_reward: number;
  criteria_type: string;
  criteria_value: number;
  created_at: string;
}

export interface UserAchievement {
  id: string;
  user_id: string;
  achievement_id: string;
  earned_at: string;
  achievement?: Achievement;
}

export interface PlatformBan {
  id: string;
  user_id: string;
  banned_by: string | null;
  reason: string;
  expires_at: string | null;
  is_permanent: boolean;
  created_at: string;
  user?: Profile;
  banner?: Profile;
}

export interface ServerProfile {
  id: string;
  user_id: string;
  community_id: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string;
  pronouns: string;
  banner_url: string | null;
  created_at: string;
  updated_at: string;
  community?: Community;
}

export type StandingEventType = 'warning' | 'violation' | 'appeal_approved' | 'note' | 'restriction';

export interface AccountStandingEvent {
  id: string;
  user_id: string;
  type: StandingEventType;
  title: string;
  description: string;
  issued_by: string | null;
  resolved: boolean;
  created_at: string;
  issuer?: Profile;
}

export type Database = {
  public: {
    Tables: {
      profiles: { Row: Profile; Insert: Omit<Profile, 'created_at' | 'updated_at'>; Update: Partial<Profile> };
      user_growth_capabilities: { Row: UserGrowthCapabilityRow; Insert: Omit<UserGrowthCapabilityRow, 'created_at' | 'updated_at'>; Update: Partial<UserGrowthCapabilityRow> };
      growth_invite_codes: { Row: GrowthInviteCode; Insert: Omit<GrowthInviteCode, 'id' | 'created_at' | 'updated_at' | 'use_count'>; Update: Partial<GrowthInviteCode> };
      growth_referrals: { Row: GrowthReferral; Insert: Omit<GrowthReferral, 'id' | 'created_at' | 'updated_at'>; Update: Partial<GrowthReferral> };
      growth_events: { Row: GrowthEventRow; Insert: Omit<GrowthEventRow, 'id' | 'created_at'>; Update: Partial<GrowthEventRow> };
      account_security_risk_signals: { Row: AccountSecurityRiskSignal; Insert: Omit<AccountSecurityRiskSignal, 'id'>; Update: Partial<AccountSecurityRiskSignal> };
      account_security_risk_cases: { Row: AccountSecurityRiskCase; Insert: Omit<AccountSecurityRiskCase, 'created_at' | 'updated_at'>; Update: Partial<AccountSecurityRiskCase> };
      operator_daily_metrics: { Row: OperatorDailyMetric; Insert: Omit<OperatorDailyMetric, 'updated_at'>; Update: Partial<OperatorDailyMetric> };
      billing_subscriptions: { Row: BillingSubscription; Insert: Omit<BillingSubscription, 'id' | 'created_at' | 'updated_at'>; Update: Partial<BillingSubscription> };
      store_products: { Row: StoreProduct; Insert: Omit<StoreProduct, 'created_at' | 'updated_at'>; Update: Partial<StoreProduct> };
      user_purchases: { Row: UserPurchase; Insert: Omit<UserPurchase, 'id' | 'created_at' | 'updated_at'>; Update: Partial<UserPurchase> };
      xp_unlock_tiers: { Row: XpUnlockTier; Insert: Omit<XpUnlockTier, 'created_at' | 'updated_at'>; Update: Partial<XpUnlockTier> };
      communities: { Row: Community; Insert: Omit<Community, 'id' | 'created_at' | 'updated_at' | 'member_count'>; Update: Partial<Community> };
      community_members: { Row: CommunityMember; Insert: Omit<CommunityMember, 'id' | 'joined_at'>; Update: Partial<CommunityMember> };
      community_invites: { Row: CommunityInvite; Insert: Omit<CommunityInvite, 'id' | 'created_at' | 'updated_at' | 'use_count'>; Update: Partial<CommunityInvite> };
      community_server_customizations: { Row: CommunityServerCustomization; Insert: Omit<CommunityServerCustomization, 'id' | 'created_at' | 'updated_at'>; Update: Partial<CommunityServerCustomization> };
      courses: { Row: Course; Insert: Omit<Course, 'id' | 'created_at' | 'updated_at'>; Update: Partial<Course> };
      lessons: { Row: Lesson; Insert: Omit<Lesson, 'id' | 'created_at'>; Update: Partial<Lesson> };
      lesson_progress: { Row: LessonProgress; Insert: Omit<LessonProgress, 'id'>; Update: Partial<LessonProgress> };
      servers: { Row: Server; Insert: Omit<Server, 'id' | 'created_at'>; Update: Partial<Server> };
      channel_categories: { Row: ChannelCategory; Insert: Omit<ChannelCategory, 'id'>; Update: Partial<ChannelCategory> };
      channels: { Row: Channel; Insert: Omit<Channel, 'id' | 'created_at'>; Update: Partial<Channel> };
      messages: { Row: Message; Insert: Omit<Message, 'id' | 'created_at' | 'updated_at'>; Update: Partial<Message> };
      message_reactions: { Row: MessageReaction; Insert: Omit<MessageReaction, 'id' | 'created_at'>; Update: Partial<MessageReaction> };
      message_attachments: { Row: MessageAttachment; Insert: Omit<MessageAttachment, 'id' | 'created_at'>; Update: Partial<MessageAttachment> };
      direct_conversations: { Row: DirectConversation; Insert: Omit<DirectConversation, 'id' | 'created_at'>; Update: Partial<DirectConversation> };
      direct_conversation_members: { Row: DirectConversationMember; Insert: Omit<DirectConversationMember, 'id'>; Update: Partial<DirectConversationMember> };
      direct_messages: { Row: DirectMessage; Insert: Omit<DirectMessage, 'id' | 'created_at' | 'updated_at'>; Update: Partial<DirectMessage> };
      direct_message_attachments: { Row: DirectMessageAttachment; Insert: Omit<DirectMessageAttachment, 'id' | 'created_at'>; Update: Partial<DirectMessageAttachment> };
      voice_sessions: { Row: VoiceSession; Insert: Omit<VoiceSession, 'id' | 'joined_at'>; Update: Partial<VoiceSession> };
      notifications: { Row: Notification; Insert: Omit<Notification, 'id' | 'created_at'>; Update: Partial<Notification> };
      user_relationships: { Row: UserRelationship; Insert: Omit<UserRelationship, 'id' | 'created_at' | 'updated_at'>; Update: Partial<UserRelationship> };
      achievements: { Row: Achievement; Insert: Omit<Achievement, 'id' | 'created_at'>; Update: Partial<Achievement> };
      user_achievements: { Row: UserAchievement; Insert: Omit<UserAchievement, 'id' | 'earned_at'>; Update: Partial<UserAchievement> };
      platform_bans: { Row: PlatformBan; Insert: Omit<PlatformBan, 'id' | 'created_at'>; Update: Partial<PlatformBan> };
    };
  };
};
