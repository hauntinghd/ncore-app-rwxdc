import { useEffect, useState } from 'react';

export function CommunityAvatar({ iconUrl, name, className = '' }: { iconUrl?: string | null; name: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const initials = String(name || 'NC').slice(0, 2).toUpperCase();
  const hue = Array.from(name || 'NCore').reduce((value, char) => ((value * 29) + char.charCodeAt(0)) % 360, 27);

  useEffect(() => setFailed(false), [iconUrl]);

  return (
    <div className={`relative flex h-full w-full items-center justify-center overflow-hidden ${className}`} style={{ background: `linear-gradient(145deg, hsl(${hue}, 66%, 42%), hsl(${(hue + 48) % 360}, 62%, 18%))` }}>
      <span className="select-none text-[0.42em] font-black tracking-tight text-white/95">{initials}</span>
      {iconUrl && !failed && <img src={iconUrl} alt="" className="absolute inset-0 h-full w-full object-cover" onError={() => setFailed(true)} />}
    </div>
  );
}
