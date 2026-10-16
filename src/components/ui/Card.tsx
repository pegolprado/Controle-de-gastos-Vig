import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Card({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rounded-[var(--radius-card)] border border-line bg-surface shadow-card', className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action, className }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-start justify-between gap-3 px-5 pt-5', className)}>
      <div className="min-w-0">
        <h2 className="truncate text-[15px] font-semibold tracking-tight">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[13px] text-subtle">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Badge({ tone = 'neutral', children, className }: { tone?: 'neutral' | 'positive' | 'negative' | 'warning' | 'info' | 'brand'; children: ReactNode; className?: string }) {
  const tones = {
    neutral: 'bg-surface-2 text-muted border-line',
    positive: 'bg-positive/10 text-positive border-positive/20',
    negative: 'bg-negative/10 text-negative border-negative/20',
    warning: 'bg-warning/10 text-warning border-warning/25',
    info: 'bg-info/10 text-info border-info/20',
    brand: 'bg-brand/10 text-brand border-brand/20',
  };
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[12px] font-semibold', tones[tone], className)}>
      {children}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-lg bg-surface-2', className)} aria-hidden />;
}

export function Progress({ value, tone = 'brand', className, label }: { value: number; tone?: 'brand' | 'positive' | 'negative' | 'warning'; className?: string; label?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  const colors = { brand: 'bg-brand', positive: 'bg-positive', negative: 'bg-negative', warning: 'bg-warning' };
  return (
    <div
      className={cn('h-2 w-full overflow-hidden rounded-full bg-surface-2', className)}
      role="progressbar"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div className={cn('h-full rounded-full transition-[width] duration-700 ease-out', colors[tone])} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function EmptyState({ icon, title, description, action, className }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-10 text-center', className)}>
      {icon && <div className="mb-4 grid size-14 place-items-center rounded-2xl border border-line bg-surface-2 text-brand">{icon}</div>}
      <h3 className="text-base font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = (error as { message?: string })?.message ?? 'Não foi possível carregar.';
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-xl border border-negative/25 bg-negative/5 px-4 py-6 text-center text-sm">
      <p className="text-negative">{navigator.onLine ? msg : 'Sem conexão. Os dados serão carregados quando a internet voltar.'}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="font-semibold text-fg underline underline-offset-4">
          Tentar novamente
        </button>
      )}
    </div>
  );
}
