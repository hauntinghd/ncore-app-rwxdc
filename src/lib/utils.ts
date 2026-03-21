import type { PlatformRole, UserStatus, CommunityRole } from './types';

export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatMessageTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

  if (isToday) return `Today at ${timeStr}`;
  if (isYesterday) return `Yesterday at ${timeStr}`;
  return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} at ${timeStr}`;
}

export function formatShortTime(dateString: string): string {
  return new Date(dateString).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map(word => word[0])
    .join('')
    .toUpperCase();
}

export function getRankInfo(xp: number): { rank: string; color: string; nextXp: number; progress: number } {
  const ranks = [
    { name: 'Newcomer', minXp: 0, maxXp: 100, color: 'text-surface-400' },
    { name: 'Apprentice', minXp: 100, maxXp: 500, color: 'text-green-400' },
    { name: 'Contributor', minXp: 500, maxXp: 1500, color: 'text-blue-400' },
    { name: 'Expert', minXp: 1500, maxXp: 5000, color: 'text-nyptid-300' },
    { name: 'Master', minXp: 5000, maxXp: 15000, color: 'text-yellow-400' },
    { name: 'Elite', minXp: 15000, maxXp: 50000, color: 'text-orange-400' },
    { name: 'Legend', minXp: 50000, maxXp: Infinity, color: 'text-red-400' },
  ];

  const currentRank = ranks.findLast(r => xp >= r.minXp) || ranks[0];
  const progress = currentRank.maxXp === Infinity
    ? 100
    : Math.min(((xp - currentRank.minXp) / (currentRank.maxXp - currentRank.minXp)) * 100, 100);

  return {
    rank: currentRank.name,
    color: currentRank.color,
    nextXp: currentRank.maxXp === Infinity ? currentRank.minXp : currentRank.maxXp,
    progress,
  };
}

export function getRankBadgeClasses(rank: string): string {
  const classes: Record<string, string> = {
    'Newcomer': 'bg-surface-700 text-surface-300',
    'Apprentice': 'bg-green-900/50 text-green-400 border border-green-500/30',
    'Contributor': 'bg-blue-900/50 text-blue-400 border border-blue-500/30',
    'Expert': 'bg-nyptid-900/50 text-nyptid-300 border border-nyptid-300/30',
    'Master': 'bg-yellow-900/50 text-yellow-400 border border-yellow-500/30',
    'Elite': 'bg-orange-900/50 text-orange-400 border border-orange-500/30',
    'Legend': 'bg-red-900/50 text-red-400 border border-red-500/30',
  };
  return classes[rank] || classes['Newcomer'];
}

export function getPlatformRoleBadge(role: PlatformRole): { label: string; classes: string } | null {
  if (role === 'owner') return { label: 'OWNER', classes: 'bg-nyptid-300/20 text-nyptid-300 border border-nyptid-300/40' };
  if (role === 'admin') return { label: 'ADMIN', classes: 'bg-red-500/20 text-red-400 border border-red-500/30' };
  if (role === 'moderator') return { label: 'MOD', classes: 'bg-green-500/20 text-green-400 border border-green-500/30' };
  return null;
}

export function getCommunityRoleBadge(role: CommunityRole): { label: string; classes: string } | null {
  if (role === 'owner') return { label: 'OWNER', classes: 'bg-yellow-500/20 text-yellow-400' };
  if (role === 'admin') return { label: 'ADMIN', classes: 'bg-red-500/20 text-red-400' };
  if (role === 'moderator') return { label: 'MOD', classes: 'bg-green-500/20 text-green-400' };
  return null;
}

export function getStatusColor(status: UserStatus): string {
  const colors: Record<UserStatus, string> = {
    online: 'bg-green-500',
    idle: 'bg-yellow-500',
    dnd: 'bg-red-500',
    invisible: 'bg-surface-500',
    offline: 'bg-surface-500',
  };
  return colors[status];
}

export function getStatusLabel(status: UserStatus): string {
  const labels: Record<UserStatus, string> = {
    online: 'Online',
    idle: 'Idle',
    dnd: 'Do Not Disturb',
    invisible: 'Invisible',
    offline: 'Offline',
  };
  return labels[status];
}

export function clsx(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ');
}

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

export const COMMUNITY_CATEGORIES = [
  'General', 'Technology', 'Business', 'Health & Fitness', 'Creative Arts',
  'Education', 'Gaming', 'Music', 'Sports', 'Science', 'Finance',
  'Language Learning', 'Personal Development', 'Food & Cooking', 'Travel',
];

export const EMOJI_LIST = ['👍', '❤️', '😂', '😮', '😢', '😡', '🔥', '🎉', '✅', '⭐', '💯', '🚀'];
