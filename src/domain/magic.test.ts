import { describe, expect, it } from 'vitest';
import { magicNumberFor, simulateMagic } from './magic';

describe('número mágico', () => {
  it('fórmula dos prints: 2 × 8,94 ÷ 0,10 = 178,8 → 179 cotas = R$ 1.600,26', () => {
    expect(magicNumberFor(894, 10, 2)).toBe(179);
    expect(magicNumberFor(889, 10, 2)).toBe(178);
    expect(magicNumberFor(894, 0, 2)).toBe(0);
    const r = simulateMagic({ price: 894, dividend: 10, perMonth: 2, inflation: 6, goal: 50_000 });
    expect(r.initial).toBe(160_026);
  });

  it('mês a mês igual à planilha: rendimento, compra, sobra e patrimônio', () => {
    const r = simulateMagic({ price: 894, dividend: 10, perMonth: 2, inflation: 6, goal: 50_000 });
    expect(r.rows).toHaveLength(360);
    expect(r.rows[0]).toMatchObject({ month: 1, shares: 179, income: 1790, bought: 2, leftover: 2, equity: 160_026 });
    // linhas do print
    expect(r.rows[114]).toMatchObject({ month: 115, shares: 635, income: 6350, bought: 7, leftover: 198, equity: 567_690 });
    expect(r.rows[117]).toMatchObject({ month: 118, shares: 656, bought: 8, leftover: 0, record: true });
    expect(r.rows[127]).toMatchObject({ month: 128, shares: 733, bought: 9, leftover: 48, record: true });
    // R$ 500 de hoje não chega em 30 anos com 6% de inflação (o print mostra R$ 168,63)
    expect(r.goalMonth).toBeNull();
    expect(r.last!.realIncome).toBeGreaterThan(16_000);
    expect(r.last!.realIncome).toBeLessThan(17_500);
  });

  it('aporte mensal acelera e a meta é atingida', () => {
    const r = simulateMagic({ price: 894, dividend: 10, perMonth: 2, inflation: 4, goal: 50_000, contribution: 50_000 });
    expect(r.goalMonth).not.toBeNull();
    expect(r.rows.find((x) => x.goal)!.month).toBe(r.goalMonth);
    expect(r.invested).toBe(160_026 + 360 * 50_000);
  });
});
