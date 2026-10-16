import { cn } from '@/lib/cn';

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = 'md',
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string; tone?: 'income' | 'expense' }>;
  className?: string;
  size?: 'sm' | 'md';
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('flex gap-1 rounded-xl border border-line bg-surface-2/70 p-1', className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'flex-1 whitespace-nowrap rounded-lg font-semibold transition',
              size === 'md' ? 'h-9 px-3 text-sm' : 'h-7 px-2.5 text-[13px]',
              active ? 'bg-surface text-fg shadow-card' : 'text-subtle hover:text-fg',
              active && o.tone === 'income' && 'text-positive',
              active && o.tone === 'expense' && 'text-negative',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
