import { describe, expect, it } from 'vitest';
import { featuredPayment, nextAndLast, normalizeTicker, payoutCents, paymentsFor, payStatus, projectNext, summarize, yieldOnCost } from './fii';
import type { FiiDistribution, FiiPosition } from '@/lib/types';

const pos = (ticker: string, quantity: number): FiiPosition => ({ id: ticker, workspace_id: 'w', ticker, quantity, avg_price_cents: null, created_at: '' });
const dist = (code: string, payment_date: string, rate: number): FiiDistribution => ({ code, isin: `BR${code}CTF007`, kind: 'RENDIMENTO', record_date: null, payment_date, approved_on: null, rate, related_to: null });

describe('Renda FII', () => {
  it('normaliza códigos', () => {
    expect(normalizeTicker(' hglg ')).toBe('HGLG11');
    expect(normalizeTicker('mxrf11')).toBe('MXRF11');
    expect(normalizeTicker('PETR4')).toBeNull();
    expect(normalizeTicker('AB')).toBeNull();
  });

  it('calcula o valor a receber truncando centavos', () => {
    expect(payoutCents(24, 0.75)).toBe(1800); // HSML11 do exemplo: R$ 18,00
    expect(payoutCents(22, 0.91)).toBe(2002); // BRCO11: R$ 20,02
    expect(payoutCents(28, 0.41)).toBe(1148); // BRCR11: R$ 11,48
    expect(payoutCents(3, 0.333333)).toBe(99);
    expect(payoutCents(100, 0.1)).toBe(1000);
  });

  it('situação do pagamento', () => {
    expect(payStatus('2026-10-15', '2026-10-17').label).toBe('Recebido');
    expect(payStatus('2026-10-17', '2026-10-17').label).toBe('Hoje');
    expect(payStatus('2026-10-18', '2026-10-17').label).toBe('Amanhã');
    expect(payStatus('2026-10-19', '2026-10-17').label).toBe('Daqui a 2 dias');
  });

  it('destaca o próximo pagamento anunciado, senão o último', () => {
    const d = [dist('HSML', '2026-09-08', 0.75), dist('HSML', '2026-10-07', 0.75), dist('HSML', '2026-11-07', 0.8), dist('HSML', '2026-12-07', 0.8), dist('BRCO', '2026-10-15', 0.91)];
    const p = paymentsFor(pos('HSML11', 10), d);
    expect(p.map((x) => x.dist.payment_date)).toEqual(['2026-12-07', '2026-11-07', '2026-10-07', '2026-09-08']);
    expect(featuredPayment(p, '2026-10-17')?.dist.payment_date).toBe('2026-11-07');
    expect(featuredPayment(p, '2026-12-08')).toMatchObject({ projected: true, dist: { payment_date: '2027-01-07' } });
  });

  it('resume a receber, mês atual, 12 meses e média', () => {
    const d = [dist('HSML', '2026-08-07', 0.75), dist('HSML', '2026-09-08', 0.75), dist('HSML', '2026-10-07', 0.75), dist('HSML', '2026-11-07', 0.8), dist('HSML', '2025-01-07', 9)];
    const s = summarize(paymentsFor(pos('HSML11', 10), d), '2026-10-17');
    expect(s.upcoming_cents).toBe(800);
    expect(s.this_month_cents).toBe(750);
    expect(s.last12_cents).toBe(2250);
    expect(s.monthly_avg_cents).toBe(750);
    expect(s.months).toHaveLength(12);
    expect(s.months.at(-1)).toEqual({ month: '2026-10-01', cents: 750 });
  });

  it('rendimento sobre o preço médio', () => {
    expect(yieldOnCost(0.75, 7500)).toBeCloseTo(1);
    expect(yieldOnCost(0.75, null)).toBeNull();
  });
});

describe('previsão de rendimentos ainda não anunciados', () => {
  const xpml = ['2026-09-25', '2026-08-25', '2026-07-24', '2026-06-25', '2026-05-25', '2026-04-24', '2026-03-25'].map((d) => ({
    ...dist('XPML', d, 0.92),
    record_date: d === '2026-09-25' ? '2026-09-18' : null,
  }));

  it('XPML11: previsto para o dia 25 (fim de semana → dia útil anterior, como o fundo faz)', () => {
    const p = paymentsFor(pos('XPML11', 10), xpml);
    const next = projectNext(p, '2026-10-17');
    expect(next?.projected).toBe(true);
    expect(next?.dist.payment_date).toBe('2026-10-23'); // 25/10/2026 é domingo; o fundo antecipa
    expect(next?.amount_cents).toBe(920);
    expect(next?.dist.record_date).toBe('2026-10-16');
    expect(payStatus(next!.dist.payment_date, '2026-10-17', true).label).toBe('Previsto · daqui a 6 dias');
    // o destaque passa a ser a previsão, e o último recebido continua disponível
    const { next: n, last } = nextAndLast(p, '2026-10-17');
    expect(n?.projected).toBe(true);
    expect(last?.dist.payment_date).toBe('2026-09-25');
    expect(featuredPayment(p, '2026-10-17')?.projected).toBe(true);
  });

  it('sem previsão quando já há anúncio, histórico irregular ou o fundo parou de pagar', () => {
    const announced = [dist('XPML', '2026-10-23', 0.95), ...xpml];
    expect(projectNext(paymentsFor(pos('XPML11', 10), announced), '2026-10-17')).toBeUndefined();
    expect(projectNext(paymentsFor(pos('XPML11', 10), xpml.slice(0, 2)), '2026-10-17')).toBeUndefined();
    const irregular = [dist('ABCD', '2026-09-25', 1), dist('ABCD', '2026-06-25', 1), dist('ABCD', '2026-03-25', 1)];
    expect(projectNext(paymentsFor(pos('ABCD11', 10), irregular), '2026-10-17')).toBeUndefined();
    expect(projectNext(paymentsFor(pos('XPML11', 10), xpml), '2027-01-10')).toBeUndefined();
  });

  it('adia para o dia útil seguinte quando é o costume do fundo', () => {
    // dia habitual 15; em 15/08/2026 (sábado) pagou 17/08 (segunda)
    const d = ['2026-10-15', '2026-09-15', '2026-08-17', '2026-07-15'].map((x) => dist('BRCO', x, 0.91));
    const next = projectNext(paymentsFor(pos('BRCO11', 22), d), '2026-10-20');
    expect(next?.dist.payment_date).toBe('2026-11-16'); // 15/11/2026 é domingo → segunda
  });

  it('resumo soma as previsões à parte', () => {
    const p = paymentsFor(pos('XPML11', 10), xpml);
    const s = summarize(p, '2026-10-17', [projectNext(p, '2026-10-17')!]);
    expect(s.upcoming_cents).toBe(0);
    expect(s.projected_cents).toBe(920);
  });
});
