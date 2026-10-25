import { useMemo } from 'react';
import { ArrowRight, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge, Progress } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { Money } from '@/components/ui/Money';
import { cn } from '@/lib/cn';
import { capitalize, formatDate, monthLabel } from '@/lib/dates';
import { formatPercent } from '@/lib/money';
import { kindLabel, magicNumber, payStatus, portfolioStats, type FiiPayment, type Holding } from '@/domain/fii';
import { fmtRate, unitLabel } from './shared';

export type StatKind = 'receber' | 'recebido' | '12m' | 'carteira';

interface Props {
  kind: StatKind;
  onClose: () => void;
  /** troca a aba da página (Agenda, Meta…) e fecha o detalhe */
  onGo: (tab: 'agenda' | 'meta' | 'ir') => void;
  today: string;
  names: Map<string, string | null>;
  thisMonth: FiiPayment[];
  received: FiiPayment[];
  last12: FiiPayment[];
  months: Array<{ month: string; cents: number }>;
  holdings: Holding[];
}

const TITLE: Record<StatKind, string> = {
  receber: 'A receber este mês',
  recebido: 'Recebido este mês',
  '12m': 'Últimos 12 meses',
  carteira: 'Valor da carteira',
};

/** Detalhe de cada quadro do resumo da Renda: de onde vem o número. */
export function StatDetails(props: Props) {
  const { kind, onClose, onGo } = props;
  const footer =
    kind === 'receber' ? (
      <Button className="w-full" icon={<ArrowRight className="size-4" />} onClick={() => onGo('agenda')}>Ver a agenda completa</Button>
    ) : kind === '12m' ? (
      <Button className="w-full" icon={<ArrowRight className="size-4" />} onClick={() => onGo('ir')}>Ver o informe para o IR</Button>
    ) : kind === 'carteira' ? (
      <Button className="w-full" icon={<ArrowRight className="size-4" />} onClick={() => onGo('meta')}>Simular a bola de neve</Button>
    ) : undefined;
  return (
    <Modal open onClose={onClose} title={TITLE[kind]} size="lg" footer={footer}>
      {kind === 'receber' && <PaymentList items={props.thisMonth} today={props.today} names={props.names} empty="Nada mais a cair este mês." upcoming />}
      {kind === 'recebido' && <PaymentList items={props.received} today={props.today} names={props.names} empty="Nenhum provento caiu este mês ainda." />}
      {kind === '12m' && <Last12 months={props.months} payments={props.last12} />}
      {kind === 'carteira' && <Portfolio holdings={props.holdings} names={props.names} />}
    </Modal>
  );
}

function PaymentList({ items, today, names, empty, upcoming }: { items: FiiPayment[]; today: string; names: Map<string, string | null>; empty: string; upcoming?: boolean }) {
  const sorted = [...items].sort((a, b) => (upcoming ? 1 : -1) * a.dist.payment_date.localeCompare(b.dist.payment_date));
  const total = items.reduce((s, p) => s + p.amount_cents, 0);
  if (!items.length) return <p className="py-6 text-center text-[14px] text-muted">{empty}</p>;
  return (
    <>
      <p className="text-[13px] text-muted">
        Total <Money cents={total} className="font-num font-semibold text-fg" /> em {items.length} {items.length === 1 ? 'pagamento' : 'pagamentos'}
      </p>
      <ul className="mt-2 divide-y divide-line" aria-label="Pagamentos">
        {sorted.map((p) => {
          const st = payStatus(p.dist.payment_date, today, p.projected);
          return (
            <li key={`${p.ticker}${p.dist.payment_date}${p.dist.kind}`} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {p.ticker}
                  {names.get(p.ticker) && <span className="ml-1.5 text-[12px] font-normal text-subtle">{names.get(p.ticker)}</span>}
                </p>
                <p className="text-[13px] text-subtle">
                  {p.projected ? 'Previsto' : kindLabel(p.dist.kind)} · {formatDate(p.dist.payment_date)} · {fmtRate(Number(p.dist.rate))} × {p.quantity}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <Money cents={p.amount_cents} className={cn('font-num font-semibold', st.paid ? 'text-positive' : p.projected ? 'text-info' : 'text-warning')} />
                {upcoming && <Badge tone={st.tone}>{capitalize(st.label.replace('Previsto · ', ''))}</Badge>}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function Last12({ months, payments }: { months: Array<{ month: string; cents: number }>; payments: FiiPayment[] }) {
  const max = Math.max(...months.map((m) => m.cents), 1);
  const best = months.reduce((b, m) => (m.cents > b.cents ? m : b), months[0]!);
  const byAsset = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of payments) m.set(p.ticker, (m.get(p.ticker) ?? 0) + p.amount_cents);
    const total = [...m.values()].reduce((s, v) => s + v, 0);
    return [...m.entries()].map(([ticker, cents]) => ({ ticker, cents, pct: total ? (cents / total) * 100 : 0 })).sort((a, b) => b.cents - a.cents);
  }, [payments]);
  return (
    <>
      {best.cents > 0 && (
        <p className="text-[13px] text-muted">
          Melhor mês: <strong className="text-fg">{capitalize(monthLabel(best.month))}</strong> com <Money cents={best.cents} className="font-semibold text-positive" />
        </p>
      )}
      <h3 className="mt-4 text-[12px] font-semibold uppercase tracking-wide text-subtle">Mês a mês</h3>
      <ul className="mt-2 flex flex-col gap-1.5" aria-label="Proventos por mês">
        {[...months].reverse().map((m) => (
          <li key={m.month} className="grid grid-cols-[72px_1fr_96px] items-center gap-2 text-[13px]">
            <span className="text-muted">{capitalize(monthLabel(m.month, { short: true }))}</span>
            <span className="h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
              <span className="block h-full rounded-full bg-brand/70" style={{ width: `${(m.cents / max) * 100}%` }} />
            </span>
            <Money cents={m.cents} className={cn('font-num text-right', m.cents ? 'font-medium' : 'text-subtle')} />
          </li>
        ))}
      </ul>
      {byAsset.length > 0 && (
        <>
          <h3 className="mt-5 text-[12px] font-semibold uppercase tracking-wide text-subtle">Quem mais pagou</h3>
          <ul className="mt-2 divide-y divide-line" aria-label="Proventos por ativo">
            {byAsset.map((a) => (
              <li key={a.ticker} className="flex items-center justify-between gap-3 py-2 text-[14px]">
                <span className="font-semibold">{a.ticker}</span>
                <span className="text-[13px] text-muted">{formatPercent(a.pct, 1)}</span>
                <Money cents={a.cents} className="font-num w-28 text-right font-medium" />
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function Portfolio({ holdings, names }: { holdings: Holding[]; names: Map<string, string | null> }) {
  const stats = portfolioStats(holdings);
  const rows = holdings
    .filter((h) => h.quantity > 0)
    .map((h) => {
      const value = h.price !== null ? Math.round(h.price * h.quantity * 100) : null;
      const gain = h.price !== null && h.avgPriceCents ? ((h.price * 100) / h.avgPriceCents - 1) * 100 : null;
      return { h, value, gain, magic: magicNumber(h.price, h.perShare), income: Math.round(h.quantity * h.perShare * 100) };
    })
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  return (
    <>
      <dl className="grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-3">
        <div><dt className="text-subtle">Patrimônio</dt><dd className="font-num text-[15px] font-semibold"><Money cents={stats.value_cents} /></dd></div>
        <div><dt className="text-subtle">Investido</dt><dd className="font-num text-[15px] font-semibold">{stats.invested_cents ? <Money cents={stats.invested_cents} /> : '—'}</dd></div>
        <div><dt className="text-subtle">Renda / mês</dt><dd className="font-num text-[15px] font-semibold text-positive"><Money cents={stats.monthly_income_cents} /></dd></div>
      </dl>
      <ul className="mt-4 divide-y divide-line" aria-label="Ativos da carteira">
        {rows.map(({ h, value, gain, magic, income }) => (
          <li key={h.ticker} className="py-3">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {h.ticker}
                  {names.get(h.ticker) && <span className="ml-1.5 text-[12px] font-normal text-subtle">{names.get(h.ticker)}</span>}
                </p>
                <p className="text-[13px] text-subtle">
                  {h.quantity.toLocaleString('pt-BR')} {unitLabel(h.type, h.quantity)}
                  {h.price !== null && ` × ${fmtRate(h.price)}`}
                  {h.avgPriceCents ? ` · médio ${fmtRate(h.avgPriceCents / 100)}` : ''}
                </p>
              </div>
              <div className="text-right">
                {value !== null ? <Money cents={value} className="font-num font-semibold" /> : <span className="text-[13px] text-subtle">sem cotação</span>}
                <p className="text-[12px]">
                  {gain !== null && <span className={cn('font-semibold', gain >= 0 ? 'text-positive' : 'text-negative')}>{gain >= 0 ? '+' : '−'}{formatPercent(Math.abs(gain), 1)}</span>}
                  {stats.value_cents > 0 && value !== null && <span className="text-subtle"> · {formatPercent((value / stats.value_cents) * 100, 1)}</span>}
                </p>
              </div>
            </div>
            {income > 0 && (
              <p className="mt-1 text-[13px] text-muted">
                Rende <Money cents={income} className="font-medium text-positive" />/mês
              </p>
            )}
            {magic !== null && <MagicBar magic={magic} quantity={h.quantity} type={h.type} />}
          </li>
        ))}
      </ul>
      <p className="mt-3 flex items-start gap-1.5 text-[12px] text-subtle">
        <Sparkles className="mt-0.5 size-3.5 shrink-0 text-brand" aria-hidden />
        Número mágico: a partir dessa quantidade, a renda de um mês compra mais uma cota ou ação sozinha, e a carteira passa a crescer por conta própria.
      </p>
    </>
  );
}

export function MagicBar({ magic, quantity, type }: { magic: number; quantity: number; type: Holding['type'] }) {
  const done = quantity >= magic;
  return (
    <div className="mt-2">
      <p className="flex items-center justify-between gap-2 text-[12px]">
        <span className="font-semibold text-brand">Número mágico: {magic.toLocaleString('pt-BR')} {unitLabel(type, magic)}</span>
        <span className={done ? 'font-semibold text-positive' : 'text-subtle'}>
          {done ? 'atingido ✓' : `faltam ${(magic - quantity).toLocaleString('pt-BR')}`}
        </span>
      </p>
      <Progress value={Math.min(100, (quantity / magic) * 100)} tone="positive" className="mt-1 h-1.5" label={`Número mágico de ${magic}`} />
    </div>
  );
}
