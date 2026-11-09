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

describe('ponto de partida', () => {
  it('começa com as cotas que a pessoa já tem', () => {
    const r = simulateMagic({ price: 885, dividend: 9.5, perMonth: 2, inflation: 6, goal: 50_000, startShares: 313 });
    expect(r.magic).toBe(187); // 2 × 8,85 ÷ 0,095 = 186,3 → 187
    expect(r.initial).toBe(277_005);
    expect(r.rows[0]).toMatchObject({ shares: 313, income: 2974, bought: 3 });
  });
  it('sem cotas, só o aporte compra', () => {
    const r = simulateMagic({ price: 1000, dividend: 10, perMonth: 1, inflation: 0, goal: 0, startShares: 0, contribution: 5000 });
    expect(r.rows[0]).toMatchObject({ shares: 0, income: 0, bought: 5 });
    expect(r.rows[1]!.shares).toBe(5);
  });
});
