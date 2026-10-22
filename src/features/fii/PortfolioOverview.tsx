import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Info, PieChart } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Money } from '@/components/ui/Money';
import { Segmented } from '@/components/ui/Segmented';
import { cn } from '@/lib/cn';
import { formatPercent } from '@/lib/money';
import { breakdown, portfolioStats, type BreakdownBy, type Holding, type Slice } from '@/domain/fii';

const HIDE_KEY = 'fmv.renda.chart.hidden';
const color = (slot: number) => (slot ? `var(--viz-${slot})` : 'var(--viz-other)');

const TABS: Array<{ value: BreakdownBy; label: string }> = [
  { value: 'ativos', label: 'Ativos' },
  { value: 'tipos', label: 'Tipos' },
  { value: 'classe', label: 'Classe' },
  { value: 'renda', label: 'Renda' },
];

/** Resumo da carteira: patrimônio, rentabilidade e composição em gráfico de rosca interativo. */
export function PortfolioOverview({ holdings, names }: { holdings: Holding[]; names: Map<string, string | null> }) {
  const [by, setBy] = useState<BreakdownBy>('ativos');
  const [active, setActive] = useState<string | null>(null);
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(HIDE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const stats = useMemo(() => portfolioStats(holdings), [holdings]);
  const slices = useMemo(() => breakdown(holdings, by), [holdings, by]);
  const total = slices.reduce((s, x) => s + x.cents, 0);
  const current = slices.find((s) => s.key === active) ?? null;
  const hasStocks = holdings.some((h) => h.type === 'stock');
  const hasFii = holdings.some((h) => h.type === 'fii');

  const toggleHidden = () => {
    const next = !hidden;
    setHidden(next);
    try {
      localStorage.setItem(HIDE_KEY, next ? '1' : '0');
    } catch {
      /* ignore */
    }
  };

  if (!holdings.length) return null;
  const top = slices[0];
  const insight =
    !top || top.key === 'outros'
      ? null
      : by === 'ativos' && top.pct >= 35 && slices.length > 1
        ? { warn: true, text: `${top.label} concentra ${formatPercent(top.pct)} da carteira. Diversificar reduz o risco de depender de um só ativo.` }
        : by === 'renda' && top.pct >= 50 && slices.length > 1
          ? { warn: true, text: `${top.label} gera ${formatPercent(top.pct)} da sua renda mensal.` }
          : by === 'tipos'
            ? { warn: false, text: slices.map((s) => `${formatPercent(s.pct)} em ${s.label.toLowerCase()}`).join(' e ') + '.' }
            : null;

  return (
    <Card className="mt-4 overflow-hidden" role="region" aria-label="Minha carteira">
      <div className="flex items-start gap-4 p-5">
        <span className="hidden size-12 shrink-0 place-items-center rounded-2xl bg-brand/12 text-brand sm:grid">
          <PieChart className="size-6" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-muted">Patrimônio atual</p>
          <div className="flex flex-wrap items-center gap-2">
            <Money cents={stats.value_cents} className="font-num text-3xl font-bold tracking-tight" />
            {stats.gain_pct !== null && (
              <span
                className={cn(
                  'inline-flex items-center gap-0.5 rounded-lg px-2 py-0.5 text-[13px] font-semibold',
                  stats.gain_pct >= 0 ? 'bg-positive/12 text-positive' : 'bg-negative/12 text-negative',
                )}
                title="Variação da cotação atual sobre o preço médio"
              >
                {stats.gain_pct >= 0 ? <ArrowUpRight className="size-3.5" aria-hidden /> : <ArrowDownRight className="size-3.5" aria-hidden />}
                {formatPercent(Math.abs(stats.gain_pct), 1)}
              </span>
            )}
          </div>
        </div>
        <button type="button" onClick={toggleHidden} className="shrink-0 text-[13px] font-semibold text-brand hover:underline">
          {hidden ? 'Mostrar gráfico' : 'Ocultar gráfico'}
        </button>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line px-5 py-4 sm:grid-cols-3">
        <Stat label="Total investido" value={stats.invested_cents ? <Money cents={stats.invested_cents} /> : '—'} hint={stats.invested_cents ? undefined : 'informe o preço pago nas compras'} />
        <Stat label={hasStocks && hasFii ? 'Cotas e ações' : hasStocks ? 'Ações' : 'Cotas'} value={stats.units.toLocaleString('pt-BR')} />
        <Stat label="Renda mensal estimada" value={<Money cents={stats.monthly_income_cents} />} tone="positive" />
        <Stat label="DY mensal" value={stats.dy_pct !== null ? formatPercent(stats.dy_pct, 2) : '—'} tone="positive" hint="renda do mês ÷ patrimônio" />
        <Stat label="Yield on cost" value={stats.yoc_pct !== null ? formatPercent(stats.yoc_pct, 2) : '—'} tone="positive" hint="renda do mês ÷ valor investido" />
        <Stat label="Ativos" value={String(holdings.filter((h) => h.quantity > 0).length)} />
      </dl>

      {!hidden && (
        <div className="border-t border-line p-5">
          <Segmented size="sm" label="Composição por" value={by} onChange={(v) => { setBy(v); setActive(null); }} options={TABS} />
          {slices.length === 0 ? (
            <p className="mt-6 text-center text-[14px] text-muted">
              {by === 'renda' ? 'Ainda sem proventos para estimar a renda.' : 'Sem cotações para montar o gráfico ainda.'}
            </p>
          ) : (
            <div className="mt-5 grid items-center gap-6 md:grid-cols-[260px_1fr]">
              <Donut slices={slices} active={active} onActive={setActive} total={total} by={by} current={current} />
              <ul className="flex flex-col gap-1" aria-label="Composição">
                {slices.map((s) => (
                  <li key={s.key}>
                    <button
                      type="button"
                      onClick={() => setActive(active === s.key ? null : s.key)}
                      onMouseEnter={() => setActive(s.key)}
                      onMouseLeave={() => setActive(null)}
                      aria-pressed={active === s.key}
                      className={cn('w-full rounded-xl px-2.5 py-2 text-left transition', active === s.key ? 'bg-surface-2' : 'hover:bg-surface-2/60', active && active !== s.key && 'opacity-60')}
                    >
                      <span className="flex items-center gap-2.5">
                        <span className="size-2.5 shrink-0 rounded-full" style={{ background: color(s.slot) }} aria-hidden />
                        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">
                          {s.label}
                          {(by === 'ativos' || by === 'renda') && names.get(s.key) && <span className="ml-1.5 text-[12px] font-normal text-subtle">{names.get(s.key)}</span>}
                        </span>
                        <span className="text-[13px] font-semibold text-muted">{formatPercent(s.pct, 1)}</span>
                        <Money cents={s.cents} className="font-num w-24 text-right text-[13px] text-muted" />
                      </span>
                      <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                        <span className="block h-full rounded-full" style={{ width: `${Math.max(2, s.pct)}%`, background: color(s.slot) }} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {insight && (
            <p className={cn('mt-4 flex items-start gap-2 rounded-xl px-3 py-2.5 text-[13px]', insight.warn ? 'bg-warning/10 text-fg' : 'bg-surface-2 text-muted')}>
              {insight.warn ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-label="Atenção" /> : <Info className="mt-0.5 size-4 shrink-0 text-subtle" aria-hidden />}
              <span>{insight.text}</span>
            </p>
          )}
          {by === 'renda' && <p className="mt-2 text-[12px] text-subtle">Renda mensal estimada: FII pelo último rendimento; ações pela média dos últimos 12 meses (JCP líquido).</p>}
        </div>
      )}
    </Card>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: string; tone?: 'positive' }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-subtle">{label}</dt>
      <dd className={cn('font-num mt-0.5 text-[17px] font-semibold', tone === 'positive' && 'text-positive')}>{value}</dd>
      {hint && <dd className="text-[11px] text-subtle">{hint}</dd>}
    </div>
  );
}

const R = 100;
const r = 64;
const point = (radius: number, angle: number) => `${(radius * Math.cos(angle)).toFixed(3)} ${(radius * Math.sin(angle)).toFixed(3)}`;

function arc(a0: number, a1: number, outer: number) {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${point(outer, a0)} A ${outer} ${outer} 0 ${large} 1 ${point(outer, a1)} L ${point(r, a1)} A ${r} ${r} 0 ${large} 0 ${point(r, a0)} Z`;
}

function Donut({
  slices,
  active,
  onActive,
  total,
  by,
  current,
}: {
  slices: Slice[];
  active: string | null;
  onActive: (k: string | null) => void;
  total: number;
  by: BreakdownBy;
  current: Slice | null;
}) {
  let angle = -Math.PI / 2;
  const segments = slices.map((s) => {
    const sweep = (s.cents / total) * Math.PI * 2;
    const seg = { s, a0: angle, a1: angle + sweep };
    angle += sweep;
    return seg;
  });
  const summary = slices.map((s) => `${s.label} ${formatPercent(s.pct, 1)}`).join(', ');

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[260px]">
      <svg viewBox="-110 -110 220 220" className="size-full overflow-visible" role="img" aria-label={`Composição da carteira: ${summary}`}>
        {segments.length === 1 ? (
          <circle r={(R + r) / 2} fill="none" stroke={color(segments[0]!.s.slot)} strokeWidth={R - r} />
        ) : (
          segments.map(({ s, a0, a1 }) => {
            const on = active === s.key;
            return (
              <path
                key={s.key}
                d={arc(a0, a1, on ? R + 6 : R)}
                fill={color(s.slot)}
                stroke="var(--surface)"
                strokeWidth={2}
                strokeLinejoin="round"
                opacity={active && !on ? 0.45 : 1}
                className="cursor-pointer transition-[opacity] duration-200"
                onMouseEnter={() => onActive(s.key)}
                onMouseLeave={() => onActive(null)}
                onClick={() => onActive(on ? null : s.key)}
              >
                <title>{`${s.label}: ${formatPercent(s.pct, 1)}`}</title>
              </path>
            );
          })
        )}
      </svg>
      <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
        <div className="max-w-[120px]">
          <p className="truncate text-[12px] font-semibold text-muted">{current ? current.label : by === 'renda' ? 'Renda / mês' : 'Total'}</p>
          <Money cents={current ? current.cents : total} className={cn('font-num block font-bold', (current ? current.cents : total) >= 100_000_000 ? 'text-base' : 'text-xl')} />
          {current && <p className="text-[12px] font-semibold text-subtle">{formatPercent(current.pct, 1)}</p>}
        </div>
      </div>
    </div>
  );
}
