import { describe, expect, it } from 'vitest';
import { detectWaste, findSubscriptions } from './waste';

const T = '2026-10-25';
let n = 0;
const tx = (description: string, amount_cents: number, occurred_on: string) => ({ id: `t${n++}`, description, amount_cents, occurred_on, kind: 'expense' as const, status: 'paid' as const, recurrence_id: null, installment_group_id: null });
const monthly = (description: string, amounts: number[], day = '10') => amounts.map((a, i) => tx(description, a, `2026-${String(5 + i).padStart(2, '0')}-${day}`));

describe('detector de desperdícios', () => {
  it('acha assinaturas mensais com valor estável', () => {
    const txs = [...monthly('Netflix.com', [5590, 5590, 5590, 5590, 5590, 5590]), ...monthly('Mercado', [30000, 12000, 50000]), tx('Netflix.com', 5590, '2026-10-26')];
    const subs = findSubscriptions(txs, T);
    expect(subs.map((s) => s.name)).toEqual(['Netflix.com']);
    expect(subs[0]).toMatchObject({ monthly: 5590, active: true });
  });

  it('assinaturas, conta que subiu, tarifas, compras repetitivas e duplicadas', () => {
    const txs = [
      ...monthly('Netflix', [5590, 5590, 5590, 5590, 5590, 5590], '05'),
      ...monthly('Spotify', [2190, 2190, 2190, 2190, 2190, 2190], '07'),
      ...monthly('Conta de luz Enel', [18000, 17500, 18200, 17800, 18100, 22500], '15'),
      tx('Tarifa pacote de serviços', 4500, '2026-09-30'),
      tx('Anuidade cartão', 3900, '2026-10-02'),
      ...[1, 4, 8, 12, 15, 20].map((d) => tx('iFood', 4500, `2026-10-${String(d).padStart(2, '0')}`)),
      tx('Posto Shell', 20000, '2026-10-21'),
      tx('Posto Shell', 20000, '2026-10-21'),
    ];
    const r = detectWaste(txs, T);
    const kinds = r.items.map((i) => i.kind);
    expect(kinds).toEqual(['duplicate', 'increase', 'fee', 'repeat', 'subscription']);
    expect(r.items.find((i) => i.kind === 'subscription')!.title).toBe('2 assinaturas ativas: R$ 77,80/mês');
    expect(r.items.find((i) => i.kind === 'increase')!.title).toMatch(/Conta de luz Enel subiu 2\d%/);
    expect(r.items.find((i) => i.kind === 'repeat')!.monthly_saving).toBe(13500);
    expect(r.items.find((i) => i.kind === 'fee')!.monthly_saving).toBe(2800);
    expect(r.monthly_saving).toBe(2190 + (22500 - 18033) + 2800 + 13500);
  });

  it('sem padrões: nada a apontar', () => {
    expect(detectWaste([tx('Mercado', 30000, '2026-10-01')], T)).toMatchObject({ items: [], monthly_saving: 0 });
  });
});
