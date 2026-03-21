import { ReactNode, useEffect, useRef, useState } from 'react';

interface DropdownItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
  divider?: boolean;
}

interface DropdownProps {
  trigger: ReactNode;
  items: DropdownItem[];
  align?: 'left' | 'right';
  className?: string;
}

export function Dropdown({ trigger, items, align = 'left', className = '' }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <div onClick={() => setOpen(v => !v)}>{trigger}</div>
      {open && (
        <div className={`absolute z-50 mt-1 w-52 bg-surface-800 border border-surface-600 rounded-xl shadow-2xl overflow-hidden animate-slide-up ${align === 'right' ? 'right-0' : 'left-0'}`}>
          {items.map((item, i) => (
            <div key={i}>
              {item.divider && i > 0 && <div className="nyptid-separator mx-1 my-1" />}
              <button
                onClick={() => { item.onClick(); setOpen(false); }}
                className={`w-full flex items-center gap-3 px-3 py-2 text-sm transition-colors ${
                  item.danger
                    ? 'text-red-400 hover:bg-red-500/10'
                    : 'text-surface-200 hover:bg-surface-700'
                }`}
              >
                {item.icon && <span className="opacity-70">{item.icon}</span>}
                {item.label}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
