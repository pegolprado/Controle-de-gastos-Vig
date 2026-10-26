import { describe, expect, it } from 'vitest';
import { healthScore } from './health';

describe('saúde financeira', () => {
  it('tudo em ordem dá nota alta', () => {
    const r = healthScore({ surplus: 200_000, income: 800_000, expense: 600_000, overdue: 0, forecastNegative: false, reserveSaved: 3_600_000, balance: 100_000 });
    expect(r.score).toBe(100);
    expect(r.label).toBe('Ótima');
    expect(r.parts.every((p) => p.tip === null)).toBe(true);
  });
  it('aponta o que melhorar', () => {
    const r = healthScore({ surplus: -50_000, income: 500_000, expense: 550_000, overdue: 2, forecastNegative: true, reserveSaved: null, balance: 30_000 });
    expect(r.score).toBe(11); // 0 + 6 + 5 + 0 de 100
    expect(r.label).toBe('Cuidado');
    expect(r.parts.filter((p) => p.tip).map((p) => p.key)).toEqual(['savings', 'bills', 'forecast', 'reserve']);
  });
  it('sem histórico: não inventa nota', () => {
    expect(healthScore({ surplus: null, income: null, expense: null, overdue: 0, forecastNegative: null, reserveSaved: null, balance: 0 }).score).toBeNull();
  });
});
