import { getInitials, getStatusColor } from '../../lib/utils';
import type { UserStatus } from '../../lib/types';

interface AvatarProps {
  src?: string | null;
  name: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  status?: UserStatus;
  className?: string;
}

const sizeClasses = {
  xs: 'w-6 h-6 text-xs',
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-12 h-12 text-base',
  xl: 'w-16 h-16 text-xl',
};

const statusSizeClasses = {
  xs: 'w-2 h-2 border',
  sm: 'w-2.5 h-2.5 border',
  md: 'w-3 h-3 border-2',
  lg: 'w-3.5 h-3.5 border-2',
  xl: 'w-4 h-4 border-2',
};

export function Avatar({ src, name, size = 'md', status, className = '' }: AvatarProps) {
  const initials = getInitials(name);

  return (
    <div className={`relative flex-shrink-0 ${className}`}>
      <div className={`${sizeClasses[size]} rounded-full overflow-hidden flex items-center justify-center bg-gradient-to-br from-nyptid-700 to-nyptid-900 font-semibold text-nyptid-200`}>
        {src ? (
          <img src={src} alt={name} className="w-full h-full object-cover" />
        ) : (
          <span>{initials}</span>
        )}
      </div>
      {status && status !== 'invisible' && (
        <div className={`${statusSizeClasses[size]} ${getStatusColor(status)} rounded-full border-surface-800 absolute bottom-0 right-0`} />
      )}
    </div>
  );
}
