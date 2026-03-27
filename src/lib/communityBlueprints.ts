import type { ChannelType } from './types';

export type CommunityTemplateId =
  | 'standard'
  | 'gaming'
  | 'friends'
  | 'study_group'
  | 'school_club'
  | 'creator'
  | 'animehub';

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
  icon: string;
  createModeLabel: string;
  templatePitch: string;
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

const COMMON_ROLE_LABELS = {
  owner: 'Owner',
  admin: 'Admin',
  moderator: 'Moderator',
  member: 'Member',
};

export const COMMUNITY_BLUEPRINTS: Record<CommunityTemplateId, CommunityBlueprint> = {
  standard: {
    id: 'standard',
    label: 'Create My Own',
    icon: '🛠️',
    createModeLabel: 'Blank server',
    templatePitch: 'Start with a clean shell and shape every category, role, and channel yourself.',
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
    roleLabels: COMMON_ROLE_LABELS,
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
  gaming: {
    id: 'gaming',
    label: 'Gaming',
    icon: '🎮',
    createModeLabel: 'Gaming server',
    templatePitch: 'Queue friends fast with LFG, clips, and voice hangouts already scaffolded.',
    recommendedName: 'NCore Gaming',
    recommendedCategory: 'Gaming',
    recommendedDescription: 'Squads, clips, ranked grind, and community nights in one place.',
    serverTagline: 'Your squad hub, match room, and LFG board.',
    welcomeMessage: 'Welcome in. Pick a role, jump into LFG, and queue up.',
    rulesMarkdown: '- Respect teammates\n- Keep comms clear\n- Use spoiler / leak channels properly',
    onboardingSteps: ['Read #rules', 'Introduce yourself in #lobby', 'Pick your game roles', 'Join voice'],
    accentColor: '#7c9cff',
    gradientStart: '#0b1225',
    gradientEnd: '#1c2342',
    roleLabels: {
      ...COMMON_ROLE_LABELS,
      server_booster: 'Booster',
    },
    categories: [
      {
        name: 'WELCOME',
        channels: [
          { name: 'rules', channel_type: 'text' },
          { name: 'announcements', channel_type: 'announcement' },
        ],
      },
      {
        name: 'COMMUNITY',
        channels: [
          { name: 'lobby', channel_type: 'text' },
          { name: 'clips', channel_type: 'text' },
          { name: 'looking-for-group', channel_type: 'text' },
        ],
      },
      {
        name: 'VOICE',
        channels: [
          { name: 'Squad Alpha', channel_type: 'voice' },
          { name: 'Squad Bravo', channel_type: 'voice' },
          { name: 'Strategy Room', channel_type: 'voice' },
        ],
      },
    ],
  },
  friends: {
    id: 'friends',
    label: 'Friends',
    icon: '💖',
    createModeLabel: 'Friends server',
    templatePitch: 'A lighter layout for private circles, movie nights, and everyday chat.',
    recommendedName: 'Friend Group',
    recommendedCategory: 'General',
    recommendedDescription: 'Private friend space for daily chat, games, memes, and hangouts.',
    serverTagline: 'Private circle. Fast chat. Zero clutter.',
    welcomeMessage: 'You made it in. Drop into chat and make the place yours.',
    rulesMarkdown: '- Keep it friendly\n- Respect privacy\n- No spam',
    onboardingSteps: ['Pick your nickname', 'Say hi', 'Start a voice room'],
    accentColor: '#ff74b5',
    gradientStart: '#230b1d',
    gradientEnd: '#38152f',
    roleLabels: COMMON_ROLE_LABELS,
    categories: [
      {
        name: 'HOME',
        channels: [
          { name: 'general', channel_type: 'text' },
          { name: 'media', channel_type: 'text' },
          { name: 'memes', channel_type: 'text' },
          { name: 'hangout', channel_type: 'voice' },
        ],
      },
    ],
  },
  study_group: {
    id: 'study_group',
    label: 'Study Group',
    icon: '📚',
    createModeLabel: 'Study group',
    templatePitch: 'Structured for sessions, resources, accountability, and focused voice rooms.',
    recommendedName: 'Study Group',
    recommendedCategory: 'Education',
    recommendedDescription: 'Focused study sessions, accountability, and resource sharing.',
    serverTagline: 'Study together. Track goals. Keep momentum.',
    welcomeMessage: 'Welcome. Start in resources, then join the study room.',
    rulesMarkdown: '- Stay constructive\n- Keep resource channels clean\n- Respect study sessions',
    onboardingSteps: ['Read #how-to-use', 'Set your goals', 'Join a focus room'],
    accentColor: '#6de1b8',
    gradientStart: '#071b17',
    gradientEnd: '#163128',
    roleLabels: COMMON_ROLE_LABELS,
    categories: [
      {
        name: 'START',
        channels: [
          { name: 'how-to-use', channel_type: 'text' },
          { name: 'resources', channel_type: 'text' },
        ],
      },
      {
        name: 'SESSIONS',
        channels: [
          { name: 'accountability', channel_type: 'text' },
          { name: 'study-room-1', channel_type: 'voice' },
          { name: 'study-room-2', channel_type: 'voice' },
        ],
      },
    ],
  },
  school_club: {
    id: 'school_club',
    label: 'School Club',
    icon: '🏫',
    createModeLabel: 'School club',
    templatePitch: 'Announcements, committees, event planning, and club leadership channels out of the box.',
    recommendedName: 'School Club',
    recommendedCategory: 'Education',
    recommendedDescription: 'Run club meetings, announcements, and events from one community hub.',
    serverTagline: 'Organize members, meetings, and announcements.',
    welcomeMessage: 'Welcome to the club server. Check announcements and meeting channels first.',
    rulesMarkdown: '- Keep posts club-related\n- Respect officers and members\n- Use event threads cleanly',
    onboardingSteps: ['Read announcements', 'Check meeting notes', 'Join committee channels'],
    accentColor: '#ffd36d',
    gradientStart: '#211606',
    gradientEnd: '#3d2608',
    roleLabels: {
      owner: 'President',
      admin: 'Officer',
      moderator: 'Coordinator',
      member: 'Member',
    },
    categories: [
      {
        name: 'CLUB INFO',
        channels: [
          { name: 'announcements', channel_type: 'announcement' },
          { name: 'calendar', channel_type: 'text' },
          { name: 'meeting-notes', channel_type: 'text' },
        ],
      },
      {
        name: 'COMMITTEES',
        channels: [
          { name: 'operations', channel_type: 'text' },
          { name: 'outreach', channel_type: 'text' },
          { name: 'club-room', channel_type: 'voice' },
        ],
      },
    ],
  },
  creator: {
    id: 'creator',
    label: 'Creator',
    icon: '🎥',
    createModeLabel: 'Creator hub',
    templatePitch: 'Designed for audience updates, submissions, supporters, and content feedback loops.',
    recommendedName: 'Creator Hub',
    recommendedCategory: 'Creative Arts',
    recommendedDescription: 'Updates, supporter perks, content drops, and community discussion for your audience.',
    serverTagline: 'Audience hub for drops, support, and feedback.',
    welcomeMessage: 'Welcome to the hub. Check announcements and supporter perks first.',
    rulesMarkdown: '- Keep feedback constructive\n- Respect creator and mods\n- Stay on-topic in content channels',
    onboardingSteps: ['Read announcements', 'Introduce yourself', 'Pick your interest roles'],
    accentColor: '#9b86ff',
    gradientStart: '#120a22',
    gradientEnd: '#251244',
    roleLabels: {
      owner: 'Creator',
      admin: 'Management',
      moderator: 'Moderator',
      member: 'Supporter',
    },
    categories: [
      {
        name: 'BROADCAST',
        channels: [
          { name: 'announcements', channel_type: 'announcement' },
          { name: 'behind-the-scenes', channel_type: 'text' },
        ],
      },
      {
        name: 'COMMUNITY',
        channels: [
          { name: 'general', channel_type: 'text' },
          { name: 'feedback', channel_type: 'text' },
          { name: 'creator-stage', channel_type: 'voice' },
        ],
      },
    ],
  },
  animehub: {
    id: 'animehub',
    label: 'AnimeHub Preset',
    icon: '🌸',
    createModeLabel: 'AnimeHub preset',
    templatePitch: 'Full anime community scaffold with announcement lanes, media lanes, and voice rooms.',
    recommendedName: 'AnimeHub',
    recommendedCategory: 'Creative Arts',
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

export const COMMUNITY_BLUEPRINT_OPTIONS = Object.values(COMMUNITY_BLUEPRINTS);

function normalizeKey(value: string): string {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function normalizeCommunityTemplateId(value: string): CommunityTemplateId {
  switch (String(value || '').trim().toLowerCase()) {
    case 'gaming':
      return 'gaming';
    case 'friends':
      return 'friends';
    case 'studygroup':
    case 'study_group':
    case 'study-group':
      return 'study_group';
    case 'schoolclub':
    case 'school_club':
    case 'school-club':
      return 'school_club';
    case 'creator':
      return 'creator';
    case 'animehub':
      return 'animehub';
    default:
      return 'standard';
  }
}

export function detectCommunityTemplate(name?: string | null, slug?: string | null): CommunityTemplateId {
  const joined = normalizeKey(`${String(name || '')} ${String(slug || '')}`);
  if (joined.includes('animehub')) return 'animehub';
  if (joined.includes('gaming')) return 'gaming';
  if (joined.includes('study')) return 'study_group';
  if (joined.includes('schoolclub')) return 'school_club';
  if (joined.includes('creator')) return 'creator';
  if (joined.includes('friend')) return 'friends';
  return 'standard';
}

export function getCommunityBlueprint(templateId: CommunityTemplateId): CommunityBlueprint {
  return COMMUNITY_BLUEPRINTS[templateId] || COMMUNITY_BLUEPRINTS.standard;
}
