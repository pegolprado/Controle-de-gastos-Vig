/** Regras puras da Renda FII: valores a receber, situação do pagamento e resumos. */
import { addDays, addMonths, diffDays, makeDate, parseISO, startOfMonth, todayISO, type ISODate } from '@/lib/dates';
import type { FiiDistribution, FiiPosition } from '@/lib/types';

/** "hglg" / "HGLG11 " → "HGLG11"; null se não parecer um código de FII. */
export function normalizeTicker(input: string): string | null {
  const t = input.trim().toUpperCase().replace(/\s+/g, '');
  if (/^[A-Z][A-Z0-9]{3}$/.test(t)) return `${t}11`;
  return /^[A-Z][A-Z0-9]{3}1[1-5]$/.test(t) ? t : null;
}

export const baseCode = (ticker: string) => ticker.slice(0, 4);

/** Valor recebido: cotas × valor por cota, truncado nos centavos (como a B3 credita). */
export function payoutCents(quantity: number, rate: number): number {
  return Math.floor(Math.round(quantity * Number(rate) * 1e6) / 1e4);
}

export type PayStatus = { tone: 'positive' | 'warning' | 'brand' | 'info'; label: string; paid: boolean };

export function payStatus(paymentDate: ISODate, today: ISODate = todayISO(), projected = false): PayStatus {
  const d = diffDays(paymentDate, today);
  if (projected) {
    if (d < 0) return { tone: 'info', label: 'Previsto · aguardando anúncio', paid: false };
    if (d === 0) return { tone: 'info', label: 'Previsto · hoje', paid: false };
    if (d === 1) return { tone: 'info', label: 'Previsto · amanhã', paid: false };
    return { tone: 'info', label: `Previsto · daqui a ${d} dias`, paid: false };
  }
  if (d < 0) return { tone: 'positive', label: 'Recebido', paid: true };
  if (d === 0) return { tone: 'brand', label: 'Hoje', paid: false };
  if (d === 1) return { tone: 'warning', label: 'Amanhã', paid: false };
  return { tone: 'warning', label: `Daqui a ${d} dias`, paid: false };
}

export interface FiiPayment {
  ticker: string;
  quantity: number;
  dist: FiiDistribution;
  amount_cents: number;
  /** estimativa pelo histórico: o fundo ainda não anunciou na B3 */
  projected?: boolean;
}

/** Pagamentos de cada posição (mais recentes primeiro). */
export function paymentsFor(position: FiiPosition, dists: FiiDistribution[]): FiiPayment[] {
  const code = baseCode(position.ticker);
  return dists
    .filter((d) => d.code === code)
    .sort((a, b) => b.payment_date.localeCompare(a.payment_date))
    .map((dist) => ({ ticker: position.ticker, quantity: position.quantity, dist, amount_cents: payoutCents(position.quantity, dist.rate) }));
}

const weekday = (iso: ISODate) => {
  const { y, m, d } = parseISO(iso);
  return new Date(y, m - 1, d).getDay();
};

/** Fim de semana → dia útil anterior ou seguinte, conforme o costume do fundo. */
function toBusinessDay(iso: ISODate, backwards: boolean): ISODate {
  const wd = weekday(iso);
  if (wd === 6) return addDays(iso, backwards ? -1 : 2);
  if (wd === 0) return addDays(iso, backwards ? -2 : 1);
  return iso;
}

/**
 * Próximo rendimento previsto pelo histórico, quando o fundo ainda não anunciou:
 * exige pagamentos mensais regulares (3 últimos com intervalo de 20 a 40 dias).
 * Data: o dia do mês em que o fundo costuma pagar; valor: o último por cota.
 */
export function projectNext(payments: FiiPayment[], today: ISODate = todayISO()): FiiPayment | undefined {
  const income = payments.filter((p) => p.dist.kind === 'RENDIMENTO');
  if (income.length < 3 || income[0]!.dist.payment_date >= today) return undefined;
  const recent = income.slice(0, 3);
  for (let i = 0; i < recent.length - 1; i++) {
    const gap = diffDays(recent[i]!.dist.payment_date, recent[i + 1]!.dist.payment_date);
    if (gap < 20 || gap > 40) return undefined;
  }
  const last = recent[0]!;
  // fundo que parou de pagar: sem previsão
  if (diffDays(today, last.dist.payment_date) > 65) return undefined;
  const days = recent.map((p) => parseISO(p.dist.payment_date).d).sort((a, b) => a - b);
  const typicalDay = days[1]!; // mediana
  // quando o dia habitual cai no fim de semana, o fundo antecipa ou adia? (pelo histórico)
  let before = 0;
  let after = 0;
  for (const p of income.slice(0, 12)) {
    const { y, m, d } = parseISO(p.dist.payment_date);
    if (d === typicalDay) continue;
    const usual = makeDate(y, m, typicalDay);
    if (weekday(usual) !== 0 && weekday(usual) !== 6) continue;
    if (d < typicalDay) before++;
    else after++;
  }
  const { y, m } = parseISO(last.dist.payment_date);
  let date = toBusinessDay(makeDate(y, m + 1, typicalDay), before > after);
  // um mês inteiro sem anúncio: projeta o mês seguinte
  if (diffDays(today, date) > 20) {
    const p = parseISO(date);
    date = toBusinessDay(makeDate(p.y, p.m + 1, typicalDay), before > after);
  }
  const recordGap = last.dist.record_date ? diffDays(last.dist.payment_date, last.dist.record_date) : null;
  return {
    ...last,
    projected: true,
    dist: { ...last.dist, payment_date: date, record_date: recordGap !== null ? toBusinessDay(addDays(date, -recordGap), true) : null, approved_on: null, related_to: null },
  };
}

/** Próximo pagamento (anunciado ou previsto) e o último recebido de uma posição. */
export function nextAndLast(payments: FiiPayment[], today: ISODate = todayISO()): { next?: FiiPayment; last?: FiiPayment } {
  const upcoming = payments.filter((p) => p.dist.payment_date >= today);
  const last = payments.find((p) => p.dist.payment_date < today);
  return { next: upcoming.length ? upcoming[upcoming.length - 1] : projectNext(payments, today), last };
}

/** O pagamento a destacar: o próximo (anunciado ou previsto) ou, se não houver, o último recebido. */
export function featuredPayment(payments: FiiPayment[], today: ISODate = todayISO()): FiiPayment | undefined {
  const { next, last } = nextAndLast(payments, today);
  return next ?? last;
}

export interface FiiSummary {
  upcoming_cents: number;
  this_month_cents: number;
  last12_cents: number;
  monthly_avg_cents: number;
  upcoming: FiiPayment[];
  /** previsões dos fundos que ainda não anunciaram */
  projected: FiiPayment[];
  projected_cents: number;
  months: Array<{ month: ISODate; cents: number }>;
}

export function summarize(all: FiiPayment[], today: ISODate = todayISO(), projected: FiiPayment[] = []): FiiSummary {
  const monthStart = startOfMonth(today);
  const from12 = addMonths(monthStart, -11);
  const upcoming = all.filter((p) => p.dist.payment_date >= today).sort((a, b) => a.dist.payment_date.localeCompare(b.dist.payment_date));
  const months = Array.from({ length: 12 }, (_, i) => ({ month: addMonths(from12, i), cents: 0 }));
  let last12 = 0;
  let thisMonth = 0;
  for (const p of all) {
    const d = p.dist.payment_date;
    if (d < from12 || d > today) continue;
    last12 += p.amount_cents;
    if (d >= monthStart) thisMonth += p.amount_cents;
    const m = months.find((x) => x.month === startOfMonth(d));
    if (m) m.cents += p.amount_cents;
  }
  const paidMonths = months.filter((m) => m.cents > 0).length;
  return {
    upcoming_cents: upcoming.reduce((s, p) => s + p.amount_cents, 0),
    this_month_cents: thisMonth,
    last12_cents: last12,
    monthly_avg_cents: paidMonths ? Math.round(last12 / paidMonths) : 0,
    upcoming,
    projected: [...projected].sort((a, b) => a.dist.payment_date.localeCompare(b.dist.payment_date)),
    projected_cents: projected.reduce((s, p) => s + p.amount_cents, 0),
    months,
  };
}

/** Rendimento mensal sobre o preço médio (%), quando informado. */
export function yieldOnCost(rate: number, avgPriceCents: number | null): number | null {
  if (!avgPriceCents) return null;
  return (Number(rate) * 100 * 100) / avgPriceCents;
}
