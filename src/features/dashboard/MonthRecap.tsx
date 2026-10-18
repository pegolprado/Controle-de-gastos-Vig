import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarCheck, X } from 'lucide-react';
import { useWsId } from '@/app/WorkspaceProvider';
import { wsKey } from '@/hooks/useFinance';
import { IconButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { CategoryIcon } from '@/components/ui/CategoryIcon';
import { Money } from '@/components/ui/Money';
import { addMonths, capitalize, endOfMonth, monthLabel, startOfMonth, todayISO } from '@/lib/dates';
import { formatPercent, percentChange } from '@/lib/money';
import { reportCategories, reportMonthly } from '@/services/reports';

const RECAP_DAYS = 7;
const storageKey = (ws: string, month: string) => `fmv.recap.${ws}.${month}`;

/** Resumo do mês que acabou: aparece nos primeiros dias do mês seguinte (pode ser dispensado). */
export function MonthRecap({ today = todayISO() }: { today?: string }) {
  const ws = useWsId();
  const month = addMonths(startOfMonth(today), -1);
  const before = addMonths(month, -1);
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(storageKey(ws, month)) === '1';
    } catch {
      return false;
    }
  });
  const show = Number(today.slice(8, 10)) <= RECAP_DAYS && !hidden;
  const series = useQuery({ queryKey: wsKey(ws, 'recap', month), queryFn: () => reportMonthly(ws, before, month), enabled: show });
  const cats = useQuery({ queryKey: wsKey(ws, 'recap-cats', month), queryFn: () => reportCategories(ws, month, endOfMonth(month), 'expense'), enabled: show });
  if (!show || !series.data || !cats.data) return null;

  const cur = series.data.find((r) => r.month === month);
  const prev = series.data.find((r) => r.month === before);
  if (!cur || (cur.income_cents === 0 && cur.expense_cents === 0)) return null;
  const result = cur.income_cents - cur.expense_cents;
  const change = prev ? percentChange(cur.expense_cents, prev.expense_cents) : null;
  const top = cats.data.slice(0, 3);
  const name = monthLabel(month, { year: false });

  const dismiss = () => {
    try {
      localStorage.setItem(storageKey(ws, month), '1');
    } catch {
      /* ignore */
    }
    setHidden(true);
  };

  return (
    <Card className="relative overflow-hidden p-5" role="region" aria-label={`Resumo de ${name}`}>
      <div className="absolute right-2 top-2">
        <IconButton size="sm" label="Fechar resumo" onClick={dismiss}>
          <X className="size-4" />
        </IconButton>
      </div>
      <div className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-brand">
        <CalendarCheck className="size-4" aria-hidden /> Resumo de {name}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3">
        <div>
          <p className="text-[12px] text-subtle">Entrou</p>
          <Money cents={cur.income_cents} tone="income" className="font-num text-lg font-semibold" />
        </div>
        <div>
          <p className="text-[12px] text-subtle">Saiu</p>
          <Money cents={cur.expense_cents} tone="expense" className="font-num text-lg font-semibold" />
        </div>
        <div>
          <p className="text-[12px] text-subtle">{result >= 0 ? 'Sobrou' : 'Faltou'}</p>
          <Money cents={Math.abs(result)} tone={result >= 0 ? 'income' : 'expense'} className="font-num text-lg font-semibold" />
        </div>
      </div>
      {change !== null && prev && prev.expense_cents > 0 && (
        <p className="mt-3 text-[14px] text-muted">
          Você gastou{' '}
          <strong className={change > 0 ? 'text-negative' : 'text-positive'}>
            {formatPercent(Math.abs(change))} {change > 0 ? 'a mais' : 'a menos'}
          </strong>{' '}
          que em {monthLabel(before, { year: false })} (<Money cents={prev.expense_cents} />).
        </p>
      )}
      {top.length > 0 && (
        <>
          <p className="mt-4 text-[13px] font-semibold text-muted">Onde mais gastou</p>
          <ul className="mt-2 flex flex-col gap-2">
            {top.map((c) => (
              <li key={c.category_id ?? 'none'} className="flex items-center gap-3">
                <CategoryIcon icon={c.icon} color={c.color} size="sm" />
                <span className="min-w-0 flex-1 truncate text-[14px]">{capitalize(c.name)}</span>
                <span className="text-[12px] text-subtle">{cur.expense_cents ? formatPercent((c.total_cents / cur.expense_cents) * 100) : ''}</span>
                <Money cents={c.total_cents} className="font-num text-[14px] font-semibold" />
              </li>
            ))}
          </ul>
        </>
      )}
      <Link to="/relatorios" className="mt-4 inline-block text-[13px] font-semibold text-brand">Ver relatório completo →</Link>
    </Card>
  );
}
