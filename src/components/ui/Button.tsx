import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
type Size = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  block?: boolean;
}

const variants: Record<Variant, string> = {
  primary:
    'bg-brand text-[color:var(--brand-fg)] font-semibold shadow-[0_1px_0_rgba(255,255,255,0.25)_inset,0_8px_20px_-10px_var(--brand)] hover:brightness-110 active:brightness-95',
  secondary: 'bg-surface-2 text-fg border border-line hover:border-line-strong hover:bg-elevated',
  ghost: 'text-muted hover:text-fg hover:bg-surface-2',
  danger: 'bg-negative/12 text-negative border border-negative/25 hover:bg-negative/18',
  subtle: 'bg-brand/12 text-brand hover:bg-brand/18',
};

const sizes: Record<Size, string> = {
  sm: 'h-9 px-3 text-sm gap-1.5 rounded-lg',
  md: 'h-11 px-4 text-[15px] gap-2 rounded-xl',
  lg: 'h-13 px-6 text-base gap-2 rounded-xl',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, block, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex select-none items-center justify-center whitespace-nowrap font-medium transition-[background,filter,border,color,transform] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50',
        variants[variant],
        sizes[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string; size?: 'sm' | 'md' }>(
  function IconButton({ label, className, children, size = 'md', type = 'button', ...rest }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        aria-label={label}
        title={label}
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-xl text-muted transition hover:bg-surface-2 hover:text-fg active:scale-95 disabled:opacity-40',
          size === 'md' ? 'size-10' : 'size-8',
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    );
  },
);
