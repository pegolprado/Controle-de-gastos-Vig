import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, HeartPulse } from 'lucide-react';
import { useWsId } from '@/app/WorkspaceProvider';
import { useBalances, useAccounts, wsKey } from '@/hooks/useFinance';
import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/cn';
import { healthScore } from '@/domain/health';
import { useCapacity } from '@/features/goals/useCapacity';
import { useForecast } from '@/features/forecast/useForecast';
import { listGoals } from '@/services/planning';

const TONE = { Ótima: 'text-positive', Boa: 'text-positive', Atenção: 'text-warning', Cuidado: 'text-negative', 'Poucos dados': 'text-subtle' } as const;
const RING = { Ótima: 'var(--positive)', Boa: 'var(--positive)', Atenção: 'var(--warning)', Cuidado: 'var(--negative)', 'Poucos dados': 'var(--border-strong)' } as const;

/** Nota de saúde financeira (0–100) com o que fazer para melhorar. */
export function HealthCard() {
  const ws = useWsId();
  const cap = useCapacity();
  const { data: f } = useForecast();
  const goals = useQuery({ queryKey: wsKey(ws, 'goals'), queryFn: () => listGoals(ws) });
  const accounts = useAccounts();
  const balances = useBalances();

  const result = useMemo(() => {
    if (!cap || !f || !goals.data || !accounts.data || !balances.data) return null;
    const included = new Set(accounts.data.filter((a) => a.include_in_total && !a.archived).map((a) => a.id));
    const balance = balances.data.filter((b) => included.has(b.account_id)).reduce((s, b) => s + Number(b.current_balance_cents), 0);
    const reserve = goals.data.filter((g) => g.icon === 'emergency' && !g.archived);
    return healthScore({
      surplus: cap.months ? cap.surplus : null,
      income: cap.months ? cap.income : null,
      expense: cap.months ? cap.expense : null,
      overdue: f.events.filter((e) => e.overdue).length,
      forecastNegative: f.days.length ? f.negativeDays.length > 0 : null,
      reserveSaved: reserve.length ? reserve.reduce((s, g) => s + Number(g.saved_cents), 0) : null,
      balance,
    });
  }, [cap, f, goals.data, accounts.data, balances.data]);

  if (!result) return null;
  const { score, label, parts } = result;
  const tips = parts.filter((p) => p.tip).sort((a, b) => b.max - b.points - (a.max - a.points)).slice(0, 2);
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <Card className="p-4 sm:p-5" role="region" aria-label="Saúde financeira">
      <div className="flex items-center gap-4">
        <div className="relative size-[68px] shrink-0">
          <svg viewBox="0 0 64 64" className="size-full -rotate-90" aria-hidden>
            <circle cx="32" cy="32" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="7" />
            <circle cx="32" cy="32" r={r} fill="none" stroke={RING[label as keyof typeof RING]} strokeWidth="7" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - (score ?? 0) / 100)} className="transition-[stroke-dashoffset] duration-700" />
          </svg>
          <span className="font-num absolute inset-0 grid place-items-center text-lg font-bold">{score ?? '—'}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold text-muted"><HeartPulse className="size-4" aria-hidden /> Saúde financeira</p>
          <p className={cn('font-display text-xl font-semibold', TONE[label as keyof typeof TONE])}>{label}</p>
          <p className="text-[12px] text-subtle">{score === null ? 'Lance receitas e despesas por um mês para ver sua nota.' : 'Nota de 0 a 100 pelas suas contas'}</p>
        </div>
      </div>
      <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5" aria-label="Partes da nota">
        {parts.map((p) => (
          <li key={p.key} className="min-w-0" title={p.detail}>
            <p className="flex justify-between gap-2 text-[12px]"><span className="truncate text-muted">{p.label}</span><span className="font-num font-semibold">{p.points}/{p.max}</span></p>
            <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
              <span className={cn('block h-full rounded-full', p.points / p.max >= 0.75 ? 'bg-positive' : p.points / p.max >= 0.4 ? 'bg-warning' : 'bg-negative')} style={{ width: `${Math.max(4, (p.points / p.max) * 100)}%` }} />
            </span>
          </li>
        ))}
      </ul>
      {tips.length > 0 && (
        <ul className="mt-3 divide-y divide-line border-t border-line" aria-label="Como melhorar">
          {tips.map((t) => (
            <li key={t.key}>
              <Link to={t.to} className="group flex items-center justify-between gap-2 py-2.5 text-[13px] font-medium hover:text-brand">
                {t.tip}
                <ChevronRight className="size-4 shrink-0 text-subtle transition group-hover:translate-x-0.5" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
