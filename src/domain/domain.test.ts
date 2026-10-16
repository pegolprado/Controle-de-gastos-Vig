import { describe, expect, it } from 'vitest';
import { cardCycle } from './invoice';
import { describeRecurrence, nextOccurrences, recurrenceDate } from './recurrence';
import { budgetUsage, projectMonthEnd } from './budget';
import { buildInsights } from './insights';
import { can } from './labels';
import type { CategoryTotal, MonthlyRow } from '@/lib/types';

describe('cardCycle (espelho do servidor)', () => {
  it('antes do fechamento: fatura do mês', () => {
    expect(cardCycle(5, 12, '2026-03-04')).toEqual({ referenceMonth: '2026-03-01', closingDate: '2026-03-05', dueDate: '2026-03-12' });
  });
  it('no dia do fechamento: próxima fatura', () => {
    expect(cardCycle(5, 12, '2026-03-05').referenceMonth).toBe('2026-04-01');
  });
  it('vencimento no mês seguinte ao fechamento', () => {
    expect(cardCycle(25, 5, '2026-01-20')).toEqual({ referenceMonth: '2026-02-01', closingDate: '2026-01-25', dueDate: '2026-02-05' });
  });
  it('dia 31 em fevereiro e virada de ano', () => {
    expect(cardCycle(31, 10, '2026-02-10').closingDate).toBe('2026-02-28');
    expect(cardCycle(31, 10, '2026-12-31').referenceMonth).toBe('2027-02-01');
  });
});

describe('recorrências', () => {
  it('não deriva a partir do dia 31', () => {
    expect(recurrenceDate('2026-01-31', 'monthly', 1, 1)).toBe('2026-02-28');
    expect(recurrenceDate('2026-01-31', 'monthly', 1, 2)).toBe('2026-03-31');
  });
  it('anual em ano bissexto e quinzenal', () => {
    expect(recurrenceDate('2024-02-29', 'yearly', 1, 1)).toBe('2025-02-28');
    expect(recurrenceDate('2026-01-01', 'weekly', 2, 3)).toBe('2026-02-12');
  });
  it('lista próximas respeitando término', () => {
    expect(nextOccurrences('2026-01-10', 'monthly', 1, 0, 5, '2026-03-10')).toEqual(['2026-01-10', '2026-02-10', '2026-03-10']);
  });
  it('descreve', () => {
    expect(describeRecurrence('monthly', 1)).toBe('Todo mês');
    expect(describeRecurrence('weekly', 2)).toBe('A cada 2 semanas');
  });
});

describe('orçamento', () => {
  it('classifica níveis de alerta', () => {
    expect(budgetUsage(4000, 10000).level).toBe('ok');
    expect(budgetUsage(5000, 10000).level).toBe('attention');
    expect(budgetUsage(7600, 10000).level).toBe('warning');
    expect(budgetUsage(9000, 10000).level).toBe('critical');
    expect(budgetUsage(10001, 10000).level).toBe('over');
    expect(budgetUsage(12000, 10000).remaining).toBe(-2000);
  });
  it('projeção só com dados suficientes', () => {
    expect(projectMonthEnd(10000, 3, 30)).toBeNull();
    expect(projectMonthEnd(10000, 10, 30)).toBe(30000);
  });
});

describe('insights explicáveis', () => {
  const cat = (id: string, name: string, total: number): CategoryTotal => ({ category_id: id, name, color: '#000', icon: 'tag', total_cents: total, items: 1 });
  const month = (income: number, expense: number, fixed = 0): MonthlyRow => ({
    month: '2026-01-01', income_cents: income, expense_cents: expense, income_realized_cents: income,
    expense_realized_cents: expense, fixed_expense_cents: fixed, variable_expense_cents: expense - fixed,
  });
  it('sem dados → nenhum insight', () => {
    expect(buildInsights([], [], [])).toEqual([]);
  });
  it('detecta aumento de 12% em transporte com números reais', () => {
    const out = buildInsights([cat('t', 'Transporte', 56000)], [cat('t', 'Transporte', 50000)], []);
    expect(out[0].title).toBe('Seus gastos com transporte aumentaram 12%');
    expect(out[0].detail).toContain('R$ 560,00');
    expect(out[0].tone).toBe('negative');
  });
  it('ignora variações pequenas ou de valores irrelevantes', () => {
    expect(buildInsights([cat('t', 'Transporte', 51000)], [cat('t', 'Transporte', 50000)], [])).toEqual([]);
    expect(buildInsights([cat('t', 'Café', 2000)], [cat('t', 'Café', 1000)], []).filter((i) => i.id.startsWith('cat'))).toEqual([]);
  });
  it('sequência de meses positivos', () => {
    const out = buildInsights([], [], [month(500000, 300000), month(500000, 400000), month(500000, 450000)]);
    expect(out.some((i) => i.id === 'streak-positive')).toBe(true);
  });
});

describe('permissões no cliente (espelho da RLS)', () => {
  it('hierarquia de papéis', () => {
    expect(can('viewer', 'read')).toBe(true);
    expect(can('viewer', 'contribute')).toBe(false);
    expect(can('contributor', 'contribute')).toBe(true);
    expect(can('contributor', 'edit')).toBe(false);
    expect(can('editor', 'edit')).toBe(true);
    expect(can('admin', 'admin')).toBe(true);
    expect(can('admin', 'own')).toBe(false);
    expect(can(undefined, 'read')).toBe(false);
  });
});
