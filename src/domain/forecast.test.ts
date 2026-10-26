import { describe, expect, it } from 'vitest';
import { buildForecast, canSpend, dailySpending, pendingOccurrences } from './forecast';
import type { InvoiceSummary, Recurrence, Transaction } from '@/lib/types';

const T = '2026-10-25';
const tx = (p: Partial<Transaction>): Transaction => ({
  id: Math.random().toString(), workspace_id: 'w', kind: 'expense', status: 'pending', description: 'x', amount_cents: 1000, paid_cents: 0,
  occurred_on: T, due_on: T, category_id: null, account_id: 'a', destination_account_id: null, card_id: null, invoice_id: null, payment_method: null,
  tags: [], notes: null, attachment_path: null, installment_group_id: null, installment_number: null, installments_total: null, recurrence_id: null,
  recurrence_date: null, ...p,
} as Transaction);
const rec = (p: Partial<Recurrence>): Recurrence => ({
  id: 'r', workspace_id: 'w', kind: 'income', description: 'Salário', amount_cents: 500_000, category_id: null, account_id: 'a', card_id: null, payment_method: null,
  tags: [], notes: null, frequency: 'monthly', interval_count: 1, start_date: '2026-01-05', end_date: null, occurrences_generated: 10, status: 'active', ...p,
});

describe('previsão de saldo', () => {
  it('ocorrências ainda não geradas', () => {
    // geradas: jan..out (10); próximas: 05/11, 05/12
    expect(pendingOccurrences(rec({}), T, '2026-12-31')).toEqual(['2026-11-05', '2026-12-05']);
  });

  it('aplica contas, salário, fatura e gasto diário; acha o ponto mais baixo', () => {
    const inv: InvoiceSummary = { id: 'i', workspace_id: 'w', card_id: 'c', reference_month: '2026-10-01', closing_date: '2026-10-28', due_date: '2026-11-03', total_cents: 80_000, items: 3, paid_cents: 0, remaining_cents: 80_000, status: 'open' };
    const f = buildForecast({
      today: T,
      balance: 100_000,
      pending: [tx({ description: 'Aluguel', amount_cents: 150_000, due_on: '2026-10-30' }), tx({ description: 'Luz atrasada', amount_cents: 10_000, due_on: '2026-10-20' })],
      recurrences: [rec({})],
      invoices: [inv],
      dailySpend: 1_000,
    });
    expect(f.payday).toMatchObject({ date: '2026-11-05', cents: 500_000 });
    expect(f.events.find((e) => e.description === 'Luz atrasada')).toMatchObject({ date: T, overdue: true });
    // hoje: 100.000 - 10.000 (atrasada) = 90.000
    expect(f.days[0]!.balance).toBe(90_000);
    // 30/10: 90.000 - 5×1.000 - 150.000 = -65.000 → negativo
    expect(f.days.find((d) => d.date === '2026-10-30')!.balance).toBe(-65_000);
    expect(f.negativeDays[0]).toBe('2026-10-30');
    // ponto mais baixo: 04/11, antes do salário (fatura em 03/11)
    expect(f.low.date).toBe('2026-11-04');
    expect(f.low.balance).toBe(90_000 - 10 * 1_000 - 150_000 - 80_000);
    expect(canSpend(f, 30_000).ok).toBe(false);
  });

  it('posso gastar: folga até o salário', () => {
    const f = buildForecast({ today: T, balance: 200_000, pending: [tx({ amount_cents: 50_000, due_on: '2026-10-28' })], recurrences: [rec({})], invoices: [] });
    const r = canSpend(f, 30_000);
    expect(r.safe).toBe(150_000);
    expect(r.ok).toBe(true);
    expect(canSpend(f, 160_000).ok).toBe(false);
  });

  it('gasto do dia a dia ignora contas, cartão e recorrências', () => {
    const h = [
      tx({ status: 'paid', due_on: null, amount_cents: 6_000, occurred_on: '2026-10-10' }),
      tx({ status: 'paid', due_on: '2026-10-05', amount_cents: 90_000, occurred_on: '2026-10-05' }),
      tx({ status: 'paid', due_on: null, card_id: 'c', account_id: null, amount_cents: 50_000 }),
      tx({ status: 'paid', due_on: null, recurrence_id: 'r', amount_cents: 50_000 }),
    ];
    expect(dailySpending(h, T, 60)).toBe(100);
  });
});

describe('salário e gasto do dia a dia', () => {
  it('provento pequeno não vira "salário"', () => {
    const f = buildForecast({ today: T, balance: 29_174, pending: [tx({ kind: 'income', description: 'JCP PETR4', amount_cents: 114, due_on: '2026-11-23' })], recurrences: [], invoices: [] });
    expect(f.payday).toBeNull();
    expect(f.days.at(-1)!.date).toBe('2026-11-24'); // 30 dias
  });

  it('estima o salário que cai todo mês sem estar cadastrado', () => {
    const income = (d: string) => ({ description: 'Salário Empresa X', amount_cents: 450_000, occurred_on: d, kind: 'income' as const, status: 'received' as const, recurrence_id: null, account_id: 'a' });
    const f = buildForecast({ today: T, balance: 29_174, pending: [], recurrences: [], invoices: [], incomeHistory: [income('2026-08-05'), income('2026-09-05'), income('2026-10-05')] });
    expect(f.payday).toMatchObject({ date: '2026-11-05', cents: 450_000, estimated: true });
    expect(f.events.find((e) => e.source === 'estimated')).toBeTruthy();
    // já cadastrado como pendente: não duplica
    const g = buildForecast({ today: T, balance: 0, pending: [tx({ kind: 'income', description: 'Salário Empresa X', amount_cents: 450_000, due_on: '2026-11-06' })], recurrences: [], invoices: [], incomeHistory: [income('2026-09-05'), income('2026-10-05')] });
    expect(g.events.filter((e) => e.cents > 0)).toHaveLength(1);
  });

  it('dia a dia ignora contas fixas lançadas à mão e compras grandes', () => {
    const paid = (description: string, amount_cents: number, occurred_on: string) => tx({ status: 'paid', due_on: null, description, amount_cents, occurred_on });
    const h = [
      paid('Aluguel', 150_000, '2026-08-10'), paid('Aluguel', 150_000, '2026-09-10'), paid('Aluguel', 150_000, '2026-10-10'),
      paid('Celular novo', 300_000, '2026-10-01'),
      paid('Padaria', 3_000, '2026-10-20'), paid('Padaria', 3_000, '2026-10-21'),
    ];
    expect(dailySpending(h, T, 60)).toBe(100);
  });
});
