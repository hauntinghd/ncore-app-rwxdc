interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeClasses = {
  sm: 'w-4 h-4 border-2',
  md: 'w-6 h-6 border-2',
  lg: 'w-10 h-10 border-3',
};

export function Spinner({ size = 'md', className = '' }: SpinnerProps) {
  return (
    <div
      className={`${sizeClasses[size]} rounded-full border-surface-600 border-t-nyptid-300 animate-spin ${className}`}
    />
  );
}

export function LoadingScreen() {
  return (
    <div className="fixed inset-0 bg-surface-950 flex flex-col items-center justify-center gap-4">
      <div className="text-2xl font-black text-gradient tracking-widest">NCORE</div>
      <Spinner size="lg" />
    </div>
  );
}
