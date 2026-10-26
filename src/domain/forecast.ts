import { addDays, addMonths, diffDays, type ISODate } from '@/lib/dates';
import { descriptionKey } from '@/lib/statement';
import type { InvoiceSummary, Recurrence, Transaction } from '@/lib/types';
import { recurrenceDate } from './recurrence';
import { findSubscriptions } from './waste';

/**
 * Previsão do saldo: parte do saldo de hoje e aplica, dia a dia, o que já se sabe que vai
 * entrar e sair (contas pendentes, recorrências, faturas) e uma estimativa do gasto do dia a dia.
 */
export interface ForecastEvent {
  date: ISODate;
  description: string;
  /** positivo = entra; negativo = sai */
  cents: number;
  /** estimated = entrada que se repete todo mês no histórico, mas não está cadastrada */
  source: 'pending' | 'recurrence' | 'invoice' | 'income' | 'estimated';
  overdue?: boolean;
}

export interface ForecastDay {
  date: ISODate;
  balance: number;
  events: ForecastEvent[];
  /** gasto do dia a dia estimado aplicado neste dia */
  daily: number;
}

export interface Forecast {
  days: ForecastDay[];
  events: ForecastEvent[];
  start: number;
  end: number;
  low: { date: ISODate; balance: number };
  negativeDays: ISODate[];
  payday: { date: ISODate; description: string; cents: number; estimated?: boolean } | null;
  dailySpend: number;
}

/** Ocorrências ainda não geradas de uma recorrência, entre (exclusivo) `after` e `until`. */
export function pendingOccurrences(r: Pick<Recurrence, 'start_date' | 'frequency' | 'interval_count' | 'occurrences_generated' | 'end_date'>, after: ISODate, until: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let i = r.occurrences_generated; i < r.occurrences_generated + 400; i++) {
    const d = recurrenceDate(r.start_date, r.frequency, r.interval_count, i);
    if (d > until || (r.end_date && d > r.end_date)) break;
    if (d > after) out.push(d);
  }
  return out;
}

/** Compras acima disso são pontuais (não entram no "dia a dia"). */
export const BIG_ONE_OFF = 100_000;

/**
 * Gasto do dia a dia: despesas avulsas pagas pela conta nos últimos `days` dias ÷ dias.
 * Fica de fora o que já entra na previsão por outro caminho (contas com vencimento, recorrências,
 * cartão, parcelas), o que se repete todo mês (contas fixas lançadas à mão) e compras grandes pontuais.
 */
export function dailySpending(history: Transaction[], today: ISODate, days = 60): number {
  const from = addDays(today, -days);
  const fixed = new Set(findSubscriptions(history, today).map((s) => s.key));
  const total = history
    .filter(
      (t) =>
        t.kind === 'expense' && t.account_id && !t.card_id && !t.recurrence_id && !t.installment_group_id && t.status === 'paid' && !t.due_on &&
        t.occurred_on > from && t.occurred_on <= today && t.amount_cents <= BIG_ONE_OFF && !fixed.has(descriptionKey(t.description)),
    )
    .reduce((s, t) => s + t.amount_cents, 0);
  return Math.round(total / days);
}

/**
 * Entradas que caem todo mês no histórico (salário, aluguel recebido…) mas não estão cadastradas
 * como recorrência nem como receita pendente: projeta a próxima pelo mesmo dia do mês.
 */
export function estimatedIncomes(
  history: Array<Pick<Transaction, 'description' | 'amount_cents' | 'occurred_on' | 'kind' | 'status' | 'recurrence_id' | 'account_id'>>,
  today: ISODate,
  until: ISODate,
  known: ForecastEvent[],
): ForecastEvent[] {
  const incomes = history.filter((t) => t.kind === 'income' && t.status === 'received' && !t.recurrence_id);
  const groups = new Map<string, typeof incomes>();
  for (const t of incomes) {
    const k = descriptionKey(t.description);
    if (k.length < 3) continue;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  const out: ForecastEvent[] = [];
  for (const [key, list] of groups) {
    const byMonth = new Map<string, (typeof list)[number]>();
    for (const t of [...list].sort((a, b) => a.occurred_on.localeCompare(b.occurred_on))) byMonth.set(t.occurred_on.slice(0, 7), t);
    const monthly = [...byMonth.values()];
    if (monthly.length < 2) continue;
    const gaps = monthly.slice(1).map((t, i) => diffDays(t.occurred_on, monthly[i]!.occurred_on));
    if (!gaps.every((g) => g >= 20 && g <= 40)) continue;
    const last = monthly[monthly.length - 1]!;
    if (diffDays(today, last.occurred_on) > 45) continue; // parou de cair
    let next = addMonths(last.occurred_on, 1);
    while (next <= today) next = addMonths(next, 1);
    for (; next <= until; next = addMonths(next, 1)) {
      const covered = known.some((e) => e.cents > 0 && descriptionKey(e.description) === key && Math.abs(diffDays(e.date, next)) <= 10);
      if (!covered) out.push({ date: next, description: last.description, cents: last.amount_cents, source: 'estimated' });
    }
  }
  return out;
}

/** Entrada mínima para ser tratada como "salário" (fim do período da previsão). */
export const PAYDAY_MIN = 30_000;

export function buildForecast(opts: {
  today: ISODate;
  balance: number;
  pending: Transaction[];
  recurrences: Recurrence[];
  invoices: InvoiceSummary[];
  /** cartões cuja fatura é paga por uma conta incluída no saldo */
  cardIds?: Set<string>;
  accountIds?: Set<string>;
  dailySpend?: number;
  /** entradas recebidas nos últimos meses (para estimar salário não cadastrado) */
  incomeHistory?: Parameters<typeof estimatedIncomes>[0];
  /** até quando (padrão: próximo salário + 3 dias, no mínimo 30 dias) */
  until?: ISODate;
}): Forecast {
  const { today, balance, dailySpend = 0 } = opts;
  const inAccounts = (id: string | null) => !!id && (!opts.accountIds || opts.accountIds.has(id));
  const far = addDays(today, 62);
  const events: ForecastEvent[] = [];

  for (const t of opts.pending) {
    if (!inAccounts(t.account_id) || (t.kind !== 'income' && t.kind !== 'expense')) continue;
    const left = t.amount_cents - (t.paid_cents ?? 0);
    if (left <= 0) continue;
    const due = t.due_on ?? t.occurred_on;
    events.push({ date: due < today ? today : due, description: t.description, cents: t.kind === 'income' ? left : -left, source: t.kind === 'income' ? 'income' : 'pending', overdue: due < today });
  }
  for (const r of opts.recurrences) {
    if (r.status !== 'active' || !inAccounts(r.account_id) || r.card_id) continue;
    for (const d of pendingOccurrences(r, addDays(today, -1), far)) {
      events.push({ date: d, description: r.description, cents: r.kind === 'income' ? r.amount_cents : -r.amount_cents, source: r.kind === 'income' ? 'income' : 'recurrence' });
    }
  }
  for (const inv of opts.invoices) {
    if (inv.remaining_cents <= 0 || inv.status === 'paid' || (opts.cardIds && !opts.cardIds.has(inv.card_id))) continue;
    events.push({ date: inv.due_date < today ? today : inv.due_date, description: 'Fatura do cartão', cents: -inv.remaining_cents, source: 'invoice', overdue: inv.due_date < today });
  }
  if (opts.incomeHistory) events.push(...estimatedIncomes(opts.incomeHistory.filter((t) => inAccounts(t.account_id)), today, far, events));
  events.sort((a, b) => a.date.localeCompare(b.date) || a.cents - b.cents);

  // próximo salário: a primeira entrada relevante (≥ R$ 300 e perto da maior) nos próximos 45 dias.
  // Proventos de R$ 1 ou um Pix pequeno não são "o salário".
  const incomes = events.filter((e) => e.cents >= PAYDAY_MIN && e.date > today && e.date <= addDays(today, 45));
  const biggest = incomes.reduce<ForecastEvent | null>((b, e) => (!b || e.cents > b.cents ? e : b), null);
  const payday = biggest ? incomes.find((e) => e.cents >= biggest.cents * 0.6) ?? biggest : null;
  const until = opts.until ?? (payday ? (addDays(payday.date, 3) > addDays(today, 30) ? addDays(payday.date, 3) : addDays(today, 30)) : addDays(today, 30));

  const days: ForecastDay[] = [];
  let running = balance;
  let low = { date: today, balance };
  const negativeDays: ISODate[] = [];
  for (let d = today; d <= until; d = addDays(d, 1)) {
    const todays = events.filter((e) => e.date === d);
    const daily = d === today ? 0 : dailySpend;
    running += todays.reduce((s, e) => s + e.cents, 0) - daily;
    days.push({ date: d, balance: running, events: todays, daily });
    if (running < low.balance) low = { date: d, balance: running };
    if (running < 0) negativeDays.push(d);
  }
  return {
    days,
    events: events.filter((e) => e.date <= until),
    start: balance,
    end: running,
    low,
    negativeDays,
    payday: payday ? { date: payday.date, description: payday.description, cents: payday.cents, estimated: payday.source === 'estimated' } : null,
    dailySpend,
  };
}

/**
 * "Posso gastar R$ X hoje?": aplica o gasto hoje e olha o ponto mais baixo até o próximo
 * salário (ou o fim da previsão). Folga = quanto ainda sobra nesse ponto mais baixo.
 */
export function canSpend(f: Forecast, amount: number, cushion = 0): { ok: boolean; tight: boolean; safe: number; lowAfter: number; lowDate: ISODate; until: ISODate } {
  const until = f.payday?.date ?? f.days[f.days.length - 1]?.date ?? '';
  const window = f.days.filter((d) => !until || d.date < until || d.date === f.days[0]!.date);
  const lowDay = window.reduce((m, d) => (d.balance < m.balance ? d : m), window[0] ?? { date: '', balance: f.start });
  const safe = Math.max(0, lowDay.balance - cushion);
  const lowAfter = lowDay.balance - amount;
  return { ok: lowAfter >= cushion, tight: lowAfter >= cushion && lowAfter < cushion + Math.max(10_000, f.dailySpend * 3), safe, lowAfter, lowDate: lowDay.date, until };
}

