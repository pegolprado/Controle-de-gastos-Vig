import { describe, expect, it } from 'vitest';
import { capacity, emergencyTarget, planGoal } from './goals';
import type { MonthlyRow } from '@/lib/types';

const row = (month: string, income: number, expense: number): MonthlyRow => ({ month, income_cents: income, expense_cents: expense, income_realized_cents: income, expense_realized_cents: expense, fixed_expense_cents: 0, variable_expense_cents: expense });
const T = '2026-10-25';

describe('metas inteligentes', () => {
  it('sobra média dos últimos 3 meses completos', () => {
    const c = capacity([row('2026-06-01', 1, 1), row('2026-07-01', 500_000, 400_000), row('2026-08-01', 500_000, 380_000), row('2026-09-01', 520_000, 420_000), row('2026-10-01', 900_000, 0)], T);
    expect(c).toEqual({ months: 3, income: 506_667, expense: 400_000, surplus: 106_667 });
    expect(emergencyTarget(c)).toBe(2_400_000);
    expect(capacity([], T).months).toBe(0);
  });

  it('com prazo: quanto por mês e se cabe', () => {
    // faltam 12.000 em ~12 meses → 1.000/mês
    expect(planGoal({ target: 1_500_000, saved: 300_000, deadline: '2027-10-25' }, T, 300_000)).toMatchObject({ status: 'ok', monthly: 100_000, monthsLeft: 12 });
    expect(planGoal({ target: 1_500_000, saved: 300_000, deadline: '2027-10-25' }, T, 150_000).status).toBe('tight');
    const over = planGoal({ target: 1_500_000, saved: 0, deadline: '2026-12-25' }, T, 100_000);
    expect(over.status).toBe('over');
    expect(over.eta).toBe('2029-04-25'); // 15.000 ÷ (50% de 1.000) = 30 meses
  });

  it('sem prazo: sugere 30% da sobra e prevê a data', () => {
    const p = planGoal({ target: 600_000, saved: 0, deadline: null }, T, 200_000);
    expect(p).toMatchObject({ status: 'open', monthly: 60_000, monthsLeft: 10, eta: '2027-08-25' });
    expect(planGoal({ target: 1, saved: 1, deadline: null }, T, 0).status).toBe('done');
  });
});
