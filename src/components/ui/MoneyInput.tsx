import { forwardRef, type KeyboardEvent } from 'react';
import { centsFromDigits, formatCentsInput } from '@/lib/money';
import { cn } from '@/lib/cn';
import { controlClass } from './Field';

interface MoneyInputProps {
  value: number;
  onChange: (cents: number) => void;
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  hero?: boolean;
  tone?: 'income' | 'expense' | 'neutral';
  autoFocus?: boolean;
  disabled?: boolean;
  allowNegative?: boolean;
  name?: string;
}

/** Campo monetário estilo caixa eletrônico: digitar 1234 → R$ 12,34. */
export const MoneyInput = forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput(
  { value, onChange, hero, tone = 'neutral', allowNegative, ...rest },
  ref,
) {
  const negative = value < 0;
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (allowNegative && (e.key === '-' || e.key === '−')) {
      e.preventDefault();
      onChange(-value);
    }
  };
  return (
    <div className={cn('relative', hero && 'text-center')}>
      <span
        className={cn(
          'pointer-events-none absolute top-1/2 -translate-y-1/2 font-semibold text-subtle',
          hero ? 'left-4 text-xl' : 'left-3.5 text-[15px]',
        )}
        aria-hidden
      >
        {negative ? '−R$' : 'R$'}
      </span>
      <input
        ref={ref}
        inputMode="numeric"
        autoComplete="off"
        value={formatCentsInput(Math.abs(value))}
        onKeyDown={onKeyDown}
        onChange={(e) => {
          const cents = centsFromDigits(e.target.value);
          onChange(negative ? -cents : cents);
        }}
        onFocus={(e) => {
          const el = e.currentTarget;
          requestAnimationFrame(() => el.setSelectionRange(el.value.length, el.value.length));
        }}
        className={cn(
          controlClass,
          'tabular font-num',
          hero ? 'h-20 pl-14 pr-4 text-center text-4xl font-semibold' : 'h-11 pl-11 text-right',
          tone === 'income' && 'text-positive',
          tone === 'expense' && 'text-negative',
        )}
        {...rest}
      />
    </div>
  );
});
