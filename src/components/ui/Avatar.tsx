import { useEffect, useState } from 'react';
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
  const [imageFailed, setImageFailed] = useState(false);
  const hue = Array.from(name || 'NCore').reduce((value, char) => ((value * 31) + char.charCodeAt(0)) % 360, 29);

  useEffect(() => {
    setImageFailed(false);
  }, [src]);

  return (
    <div className={`relative flex-shrink-0 ${className}`}>
      <div
        className={`${sizeClasses[size]} rounded-full overflow-hidden flex items-center justify-center font-semibold text-white shadow-inner`}
        style={{ background: `radial-gradient(circle at 28% 22%, hsla(${hue}, 90%, 78%, .88), transparent 32%), linear-gradient(145deg, hsl(${hue}, 58%, 43%), hsl(${(hue + 52) % 360}, 66%, 19%))` }}
      >
        {src && !imageFailed ? (
          <img src={src} alt="" className="w-full h-full object-cover" onError={() => setImageFailed(true)} />
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
