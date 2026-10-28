import { describe, expect, it } from 'vitest';
import { allocation, pickBuys, readPlan, signals, splitContribution } from './plan';
import type { Holding } from './fii';

const T = '2026-10-28';
const h = (ticker: string, type: 'fii' | 'stock', quantity: number, price: number, perShare: number, avg: number | null = null): Holding => ({ ticker, type, quantity, price, perShare, avgPriceCents: avg });
const carteira = [
  h('XPML11', 'fii', 50, 100, 0.92, 11_000), // 5.000; abaixo do PM; rende 0,92%
  h('HGLG11', 'fii', 20, 160, 1.1), // 3.200; 0,69%
  h('PETR4', 'stock', 100, 30, 0.2), // 3.000
];

describe('plano de investimento', () => {
  it('lê o plano e corrige metas que não somam 100%', () => {
    expect(readPlan({ targets: { rf: 50, acoes: 50, exterior: 10, fii: 0 } }).targets).toEqual({ rf: 25, acoes: 25, exterior: 25, fii: 25 });
    expect(readPlan(null).manual).toEqual({ rf: 0, exterior: 0 });
  });

  it('divisão atual × meta e onde colocar o aporte', () => {
    const plan = readPlan({ targets: { rf: 25, acoes: 25, exterior: 25, fii: 25 }, manual: { rf: 4_000_00, exterior: 0 } });
    const { rows, total } = allocation(carteira, plan);
    expect(total).toBe(1_520_000);
    expect(rows.find((r) => r.key === 'fii')!.pct).toBeCloseTo(53.9, 1);
    const split = splitContribution(rows, total, 100_000);
    // exterior está zerado: leva o aporte inteiro (é o que mais falta)
    expect(split.exterior).toBeGreaterThan(split.acoes);
    expect(split.fii).toBe(0);
    expect(Object.values(split).reduce((s, v) => s + v, 0)).toBeCloseTo(100_000, -1);
  });

  it('sinais: data com, abaixo do preço médio, rendimento e concentração', () => {
    const next = new Map([['XPML11', { record_date: '2026-10-30', payment_date: '2026-11-14', rate: 0.92 }]]);
    const s = signals(carteira, next, T);
    expect(s.map((x) => `${x.kind}:${x.ticker}`)).toEqual(['datacom:XPML11', 'below_pm:XPML11', 'yield:XPML11', 'concentration:XPML11']);
    expect(s[0]!.title).toBe('Data com de XPML11 em 2 dias');
  });

  it('escolhe o que comprar com o valor da classe', () => {
    const s = signals(carteira, new Map(), T);
    const buys = pickBuys(carteira, 'fii', 50_000, s);
    expect(buys[0]!.ticker).toBe('HGLG11'); // XPML11 já é 1/3 da carteira (concentrado)
    expect(buys.reduce((a, b) => a + b.cents, 0)).toBeLessThanOrEqual(50_000);
  });
});
