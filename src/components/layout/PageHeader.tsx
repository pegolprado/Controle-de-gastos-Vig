import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addMonths, capitalize, monthLabel, startOfMonth, todayISO } from '@/lib/dates';
import type { ReactNode } from 'react';

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="mb-1 text-[12px] font-semibold uppercase tracking-[0.14em] text-subtle">{eyebrow}</p>}
        <h1 className="font-display text-[26px] font-semibold leading-tight tracking-tight sm:text-[30px]">{title}</h1>
        {subtitle && <p className="mt-1 text-[15px] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function MonthPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const current = startOfMonth(todayISO());
  return (
    <div className="flex h-10 items-center rounded-xl border border-line bg-surface" role="group" aria-label="Mês de referência">
      <button type="button" aria-label="Mês anterior" onClick={() => onChange(addMonths(value, -1))} className="grid h-full w-9 place-items-center rounded-l-xl text-muted hover:bg-surface-2 hover:text-fg">
        <ChevronLeft className="size-4" aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => onChange(current)}
        title="Voltar para o mês atual"
        className="min-w-36 px-1 text-center text-sm font-semibold"
        aria-live="polite"
      >
        {capitalize(monthLabel(value))}
      </button>
      <button type="button" aria-label="Próximo mês" onClick={() => onChange(addMonths(value, 1))} className="grid h-full w-9 place-items-center rounded-r-xl text-muted hover:bg-surface-2 hover:text-fg">
        <ChevronRight className="size-4" aria-hidden />
      </button>
    </div>
  );
}
