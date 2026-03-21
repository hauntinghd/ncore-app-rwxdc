import type { ChannelType } from './types';

export type CommunityTemplateId = 'standard' | 'animehub';
type SupportedChannelType = Extract<ChannelType, 'text' | 'voice' | 'announcement'>;

export interface BlueprintChannel {
  name: string;
  channel_type: SupportedChannelType;
}

export interface BlueprintCategory {
  name: string;
  channels: BlueprintChannel[];
}

export interface CommunityBlueprint {
  id: CommunityTemplateId;
  label: string;
  recommendedName: string;
  recommendedCategory: string;
  recommendedDescription: string;
  serverTagline: string;
  welcomeMessage: string;
  rulesMarkdown: string;
  onboardingSteps: string[];
  accentColor: string;
  gradientStart: string;
  gradientEnd: string;
  roleLabels: Record<string, string>;
  categories: BlueprintCategory[];
}

export const COMMUNITY_BLUEPRINTS: Record<CommunityTemplateId, CommunityBlueprint> = {
  standard: {
    id: 'standard',
    label: 'Standard Server',
    recommendedName: '',
    recommendedCategory: 'General',
    recommendedDescription: '',
    serverTagline: 'Build your server your way.',
    welcomeMessage: 'Welcome to the server.',
    rulesMarkdown: '- Be respectful\n- Keep conversations on-topic\n- Follow moderator guidance',
    onboardingSteps: ['Read the rules', 'Introduce yourself', 'Pick your roles'],
    accentColor: '#00c8ff',
    gradientStart: '#0b1220',
    gradientEnd: '#192338',
    roleLabels: {
      owner: 'Owner',
      admin: 'Admin',
      moderator: 'Moderator',
      member: 'Member',
    },
    categories: [
      {
        name: 'GENERAL',
        channels: [
          { name: 'general', channel_type: 'text' },
          { name: 'announcements', channel_type: 'announcement' },
          { name: 'General Voice', channel_type: 'voice' },
        ],
      },
    ],
  },
  animehub: {
    id: 'animehub',
    label: 'AnimeHub Preset',
    recommendedName: 'AnimeHub',
    recommendedCategory: 'Anime',
    recommendedDescription: 'A full anime community server for discussion, events, media sharing, and live voice hangouts.',
    serverTagline: 'Your anime home base on NCore.',
    welcomeMessage: 'Welcome to AnimeHub. Pick your roles, read the guide, and jump into chat.',
    rulesMarkdown: [
      '1. Keep spoilers inside #spoilers with warning tags.',
      '2. Respect all members and mods.',
      '3. Use #cmds for bot commands.',
      '4. Keep media channels on-topic.',
      '5. Follow moderator and owner instructions.',
    ].join('\n'),
    onboardingSteps: ['Read #server-guide', 'Review #channels-and-roles', 'Pick your anime roles', 'Say hi in #ani-chat'],
    accentColor: '#f3bb52',
    gradientStart: '#12060a',
    gradientEnd: '#2b140f',
    roleLabels: {
      owner: 'Owner',
      admin: 'Mod',
      moderator: 'Mod',
      member: 'Member',
      server_booster: 'Server Booster',
    },
    categories: [
      {
        name: 'START HERE',
        channels: [
          { name: 'server-guide', channel_type: 'text' },
          { name: 'channels-and-roles', channel_type: 'text' },
        ],
      },
      {
        name: 'INFO',
        channels: [
          { name: 'status', channel_type: 'text' },
          { name: 'faqs', channel_type: 'text' },
          { name: 'ani-news', channel_type: 'announcement' },
          { name: 'ani-release', channel_type: 'announcement' },
        ],
      },
      {
        name: 'SERVER',
        channels: [
          { name: 'info', channel_type: 'text' },
          { name: 'announcement', channel_type: 'announcement' },
        ],
      },
      {
        name: 'EVENT',
        channels: [
          { name: 'events', channel_type: 'text' },
          { name: 'giveaways', channel_type: 'text' },
        ],
      },
      {
        name: 'COMMUNITY',
        channels: [
          { name: 'roles', channel_type: 'text' },
          { name: 'boosts', channel_type: 'text' },
          { name: 'levels', channel_type: 'text' },
        ],
      },
      {
        name: 'SITE HELP',
        channels: [
          { name: 'support-guide', channel_type: 'announcement' },
          { name: 'ask-help', channel_type: 'text' },
          { name: 'ban-appeals', channel_type: 'announcement' },
        ],
      },
      {
        name: 'CHAT',
        channels: [
          { name: 'gen', channel_type: 'text' },
          { name: 'cmds', channel_type: 'text' },
        ],
      },
      {
        name: 'ANIME',
        channels: [
          { name: 'ani-chat', channel_type: 'text' },
          { name: 'spoilers', channel_type: 'text' },
        ],
      },
      {
        name: 'MEDIA',
        channels: [
          { name: 'gallery', channel_type: 'text' },
          { name: 'art', channel_type: 'text' },
          { name: 'memes-new', channel_type: 'text' },
          { name: 'wallpaper', channel_type: 'text' },
          { name: 'photography', channel_type: 'text' },
        ],
      },
      {
        name: 'FUN',
        channels: [
          { name: 'bots', channel_type: 'text' },
          { name: 'count', channel_type: 'text' },
          { name: 'mudae', channel_type: 'text' },
          { name: 'owo', channel_type: 'text' },
        ],
      },
      {
        name: 'VOICE',
        channels: [
          { name: 'gen', channel_type: 'voice' },
          { name: 'hangout', channel_type: 'voice' },
          { name: 'party', channel_type: 'voice' },
          { name: 'aux', channel_type: 'voice' },
          { name: 'controls', channel_type: 'voice' },
          { name: 'Join to create', channel_type: 'voice' },
        ],
      },
      {
        name: '.GG/HIANIME',
        channels: [
          { name: 'welcome', channel_type: 'text' },
          { name: 'servers', channel_type: 'text' },
        ],
      },
    ],
  },
};

function normalizeKey(value: string): string {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function detectCommunityTemplate(name?: string | null, slug?: string | null): CommunityTemplateId {
  const joined = `${String(name || '')} ${String(slug || '')}`.toLowerCase();
  if (normalizeKey(joined).includes('animehub')) {
    return 'animehub';
  }
  return 'standard';
}

export function getCommunityBlueprint(templateId: CommunityTemplateId): CommunityBlueprint {
  return COMMUNITY_BLUEPRINTS[templateId] || COMMUNITY_BLUEPRINTS.standard;
}
