import { addMonths, startOfMonth, type ISODate } from '@/lib/dates';
import type { MonthlyRow } from '@/lib/types';

/** Tipo da meta (guardado na coluna icon da meta, sem mudar o banco). */
export type GoalType = 'emergency' | 'car' | 'home' | 'travel' | 'debt' | 'purchase' | 'target';

export const GOAL_TYPES: Array<{ type: GoalType; label: string; name: string; hint: string }> = [
  { type: 'emergency', label: 'Reserva de emergência', name: 'Reserva de emergência', hint: 'O ideal é ter de 3 a 6 meses dos seus gastos guardados, num lugar fácil de sacar.' },
  { type: 'car', label: 'Carro', name: 'Carro novo', hint: 'Junte ao menos a entrada (20% a 30%) para pagar menos juros no financiamento.' },
  { type: 'home', label: 'Imóvel', name: 'Entrada do imóvel', hint: 'Bancos costumam financiar até 80%: a meta é a entrada (20%) mais uns 5% de ITBI e cartório.' },
  { type: 'travel', label: 'Viagem', name: 'Viagem', hint: 'Some passagem, hospedagem, passeios e uma folga de 10% para imprevistos.' },
  { type: 'debt', label: 'Quitar dívida', name: 'Quitar dívida', hint: 'Pague primeiro a dívida de juros mais altos (cartão e cheque especial). Quitar à vista costuma dar desconto.' },
  { type: 'purchase', label: 'Compra', name: 'Compra planejada', hint: 'Comprar à vista com o dinheiro guardado dá poder de negociar desconto.' },
];

export const isGoalType = (s: string): s is GoalType => ['emergency', 'car', 'home', 'travel', 'debt', 'purchase', 'target'].includes(s);

export interface Capacity {
  /** meses considerados (completos, com movimento) */
  months: number;
  income: number;
  expense: number;
  /** sobra média por mês (receitas − despesas) */
  surplus: number;
}

/** Quanto sobra por mês, pela média dos últimos meses completos (até 3) com movimento. */
export function capacity(rows: MonthlyRow[], today: ISODate): Capacity {
  const current = startOfMonth(today);
  const done = rows.filter((r) => r.month < current && (r.income_cents > 0 || r.expense_cents > 0)).sort((a, b) => b.month.localeCompare(a.month)).slice(0, 3);
  if (!done.length) return { months: 0, income: 0, expense: 0, surplus: 0 };
  const income = Math.round(done.reduce((s, r) => s + r.income_cents, 0) / done.length);
  const expense = Math.round(done.reduce((s, r) => s + r.expense_cents, 0) / done.length);
  return { months: done.length, income, expense, surplus: income - expense };
}

/** Reserva de emergência sugerida: 6 meses de gastos (arredondado para cima em R$ 100). */
export const emergencyTarget = (cap: Capacity) => (cap.expense > 0 ? Math.ceil((cap.expense * 6) / 10_000) * 10_000 : 0);

export type PlanStatus = 'done' | 'ok' | 'tight' | 'over' | 'late' | 'open';

export interface GoalPlan {
  status: PlanStatus;
  left: number;
  /** quanto guardar por mês (com prazo) ou sugestão (sem prazo) */
  monthly: number;
  monthsLeft: number | null;
  /** parte da sobra mensal que a meta pede (0–1+) */
  share: number | null;
  /** prazo realista quando o pedido não cabe, ou previsão de chegada sem prazo */
  eta: ISODate | null;
}

const roundUp = (cents: number, step = 1_000) => Math.ceil(cents / step) * step;

/** Meses de calendário até o prazo (25/10 → 25/12 = 2; um dia a mais conta como mais um mês). */
export function monthsUntil(deadline: ISODate, today: ISODate) {
  const [y1, m1, d1] = today.split('-').map(Number) as [number, number, number];
  const [y2, m2, d2] = deadline.split('-').map(Number) as [number, number, number];
  return Math.max(1, (y2 - y1) * 12 + (m2 - m1) + (d2 > d1 ? 1 : 0));
}

/**
 * Plano de uma meta. `available` = sobra mensal ainda livre para esta meta
 * (a sobra menos o que as outras metas já pedem).
 */
export function planGoal(g: { target: number; saved: number; deadline: ISODate | null }, today: ISODate, available: number): GoalPlan {
  const left = Math.max(0, g.target - g.saved);
  if (left === 0) return { status: 'done', left, monthly: 0, monthsLeft: 0, share: null, eta: null };
  if (g.deadline) {
    if (g.deadline < today) return { status: 'late', left, monthly: left, monthsLeft: 0, share: null, eta: available > 0 ? addMonths(today, Math.ceil(left / (available * 0.5 || 1))) : null };
    const monthsLeft = monthsUntil(g.deadline, today);
    const monthly = roundUp(left / monthsLeft, 100);
    const share = available > 0 ? monthly / available : null;
    const status: PlanStatus = share === null || share > 1 ? 'over' : share > 0.5 ? 'tight' : 'ok';
    const realistic = status === 'over' && available > 0 ? addMonths(today, Math.ceil(left / (available * 0.5))) : null;
    return { status, left, monthly, monthsLeft, share, eta: realistic };
  }
  // sem prazo: sugere guardar 30% da sobra livre
  if (available <= 0) return { status: 'open', left, monthly: 0, monthsLeft: null, share: null, eta: null };
  const monthly = Math.max(1_000, roundUp(available * 0.3));
  const months = Math.ceil(left / monthly);
  return { status: 'open', left, monthly, monthsLeft: months, share: monthly / available, eta: addMonths(today, months) };
}
