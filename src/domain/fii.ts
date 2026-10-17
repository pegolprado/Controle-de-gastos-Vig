/** Regras puras da Renda FII: valores a receber, situação do pagamento e resumos. */
import { addMonths, diffDays, startOfMonth, todayISO, type ISODate } from '@/lib/dates';
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

export type PayStatus = { tone: 'positive' | 'warning' | 'brand'; label: string; paid: boolean };

export function payStatus(paymentDate: ISODate, today: ISODate = todayISO()): PayStatus {
  const d = diffDays(paymentDate, today);
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
}

/** Pagamentos de cada posição (mais recentes primeiro). */
export function paymentsFor(position: FiiPosition, dists: FiiDistribution[]): FiiPayment[] {
  const code = baseCode(position.ticker);
  return dists
    .filter((d) => d.code === code)
    .sort((a, b) => b.payment_date.localeCompare(a.payment_date))
    .map((dist) => ({ ticker: position.ticker, quantity: position.quantity, dist, amount_cents: payoutCents(position.quantity, dist.rate) }));
}

/** O pagamento a destacar: o próximo anunciado ou, se não houver, o último recebido. */
export function featuredPayment(payments: FiiPayment[], today: ISODate = todayISO()): FiiPayment | undefined {
  const upcoming = payments.filter((p) => p.dist.payment_date >= today);
  return upcoming.length ? upcoming[upcoming.length - 1] : payments[0];
}

export interface FiiSummary {
  upcoming_cents: number;
  this_month_cents: number;
  last12_cents: number;
  monthly_avg_cents: number;
  upcoming: FiiPayment[];
  months: Array<{ month: ISODate; cents: number }>;
}

export function summarize(all: FiiPayment[], today: ISODate = todayISO()): FiiSummary {
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
    months,
  };
}

/** Rendimento mensal sobre o preço médio (%), quando informado. */
export function yieldOnCost(rate: number, avgPriceCents: number | null): number | null {
  if (!avgPriceCents) return null;
  return (Number(rate) * 100 * 100) / avgPriceCents;
}
