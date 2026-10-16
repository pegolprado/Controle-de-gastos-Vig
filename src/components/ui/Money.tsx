import { formatBRL } from '@/lib/money';
import { cn } from '@/lib/cn';

interface MoneyProps {
  cents: number;
  tone?: 'auto' | 'income' | 'expense' | 'neutral' | 'muted';
  signed?: boolean;
  className?: string;
}

/** Valor monetário com cor semântica; respeita o modo "ocultar valores". */
export function Money({ cents, tone = 'neutral', signed, className }: MoneyProps) {
  const t = tone === 'auto' ? (cents > 0 ? 'income' : cents < 0 ? 'expense' : 'neutral') : tone;
  return (
    <span
      className={cn(
        'money tabular whitespace-nowrap',
        t === 'income' && 'text-positive',
        t === 'expense' && 'text-negative',
        t === 'muted' && 'text-muted',
        className,
      )}
    >
      {formatBRL(cents, { signed })}
    </span>
  );
}
