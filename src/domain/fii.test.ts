import { describe, expect, it } from 'vitest';
import { breakdown, magicNumber, snowball, portfolioStats, featuredPayment, goalPlan, irReport, monthlyPerShare, normalizeStockTicker, qtyAt, stockIsinMatches, undatedFor, monthStatus, monthView, nextAndLast, normalizeTicker, payoutCents, paymentsFor, payStatus, projectNext, summarize, yieldOnCost } from './fii';
import type { FiiDistribution, FiiPosition, FiiTrade, StockDistribution } from '@/lib/types';

const pos = (ticker: string, quantity: number, asset_type: 'fii' | 'stock' = 'fii'): FiiPosition => ({ id: ticker, workspace_id: 'w', ticker, asset_type, quantity, avg_price_cents: null, created_at: '' });
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
    expect(payStatus('2026-10-17', '2026-10-17')).toMatchObject({ label: 'Recebido hoje', paid: true });
    expect(payStatus('2026-10-18', '2026-10-17').label).toBe('Amanhã');
    expect(payStatus('2026-10-19', '2026-10-17').label).toBe('Daqui a 2 dias');
  });

  it('destaca o próximo pagamento anunciado, senão o último', () => {
    const d = [dist('HSML', '2026-09-08', 0.75), dist('HSML', '2026-10-07', 0.75), dist('HSML', '2026-11-07', 0.8), dist('HSML', '2026-12-07', 0.8), dist('BRCO', '2026-10-15', 0.91)];
    const p = paymentsFor(pos('HSML11', 10), d);
    expect(p.map((x) => x.dist.payment_date)).toEqual(['2026-12-07', '2026-11-07', '2026-10-07', '2026-09-08']);
    // já pagou em 07/10 (mês vigente): fica Recebido, o de novembro conta a partir da virada
    expect(featuredPayment(p, '2026-10-17')?.dist.payment_date).toBe('2026-10-07');
    expect(featuredPayment(p, '2026-11-01')?.dist.payment_date).toBe('2026-11-07');
    expect(featuredPayment(p, '2026-12-08')?.dist.payment_date).toBe('2026-12-07');
    expect(featuredPayment(p, '2027-01-02')).toMatchObject({ projected: true, dist: { payment_date: '2027-01-07' } });
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

describe('visão do mês vigente', () => {
  const monthly = (code: string, day: string, rate: number, months = ['2026-07', '2026-08', '2026-09', '2026-10']) =>
    months.map((m) => dist(code, `${m}-${day}`, rate));

  it('já pago neste mês → Recebido (sem contar dias até o mês seguinte)', () => {
    // HGLG11 pagou 15/10; hoje 17/10
    const p = paymentsFor(pos('HGLG11', 1), monthly('HGLG', '15', 1.17));
    const v = monthView(p, '2026-10-17');
    expect(v.mode).toBe('received');
    expect(v.featured?.dist.payment_date).toBe('2026-10-15');
    expect(monthStatus(v.mode, v.featured, '2026-10-17')?.label).toBe('Recebido');
  });

  it('ainda vai cair neste mês → contagem de dias (anunciado ou previsto)', () => {
    const xpml = paymentsFor(pos('XPML11', 10), monthly('XPML', '25', 0.92, ['2026-07', '2026-08', '2026-09']));
    const v = monthView(xpml, '2026-10-17');
    expect(v.mode).toBe('upcoming');
    expect(v.featured?.projected).toBe(true);
    // sem histórico de fim de semana: 25/10 (domingo) → segunda 26/10
    expect(monthStatus(v.mode, v.featured, '2026-10-17')?.label).toBe('Previsto · daqui a 9 dias');
    const brco = paymentsFor(pos('BRCO11', 22), [...monthly('BRCO', '15', 0.91, ['2026-08', '2026-09']), dist('BRCO', '2026-10-19', 0.91)]);
    expect(monthStatus('upcoming', monthView(brco, '2026-10-17').featured, '2026-10-17')?.label).toBe('Daqui a 2 dias');
  });

  it('no dia do pagamento vira Recebido', () => {
    const p = paymentsFor(pos('BRCO11', 22), [dist('BRCO', '2026-09-15', 0.91), dist('BRCO', '2026-10-19', 0.91)]);
    const v = monthView(p, '2026-10-19');
    expect(v.mode).toBe('received');
    expect(monthStatus(v.mode, v.featured, '2026-10-19')?.label).toBe('Recebido hoje');
  });

  it('na virada do mês todos voltam a contar os dias', () => {
    const p = paymentsFor(pos('HGLG11', 1), monthly('HGLG', '15', 1.17));
    const v = monthView(p, '2026-11-01');
    expect(v.mode).toBe('upcoming');
    expect(v.featured?.dist.payment_date).toBe('2026-11-16'); // 15/11/2026 é domingo
    expect(monthStatus(v.mode, v.featured, '2026-11-01')?.label).toBe('Previsto · daqui a 15 dias');
  });

  it('anúncio para o mês seguinte sem pagamento neste mês → mostra só o mês', () => {
    const p = paymentsFor(pos('ABCD11', 5), [dist('ABCD', '2026-09-30', 1), dist('ABCD', '2026-11-03', 1)]);
    const v = monthView(p, '2026-10-17');
    expect(v.mode).toBe('next');
    expect(monthStatus(v.mode, v.featured, '2026-10-17')?.label).toBe('Em novembro');
  });
});

describe('compras com data, ações e JCP', () => {
  const trade = (trade_date: string | null, quantity: number): FiiTrade => ({ id: `${trade_date}${quantity}`, workspace_id: 'w', position_id: 'p', trade_date, quantity, price_cents: null, created_at: '' });
  const sd = (isin: string, kind: string, rate: number, payment_date: string | null, record_date: string): StockDistribution => ({ code: 'PETR', isin, kind, rate, payment_date, record_date, approved_on: null, related_to: null });

  it('quantidade com direito considera a data da compra', () => {
    const t = [trade(null, 10), trade('2026-10-10', 5), trade('2026-10-20', -3)];
    expect(qtyAt(t, '2026-09-30', 12)).toBe(10);
    expect(qtyAt(t, '2026-10-10', 12)).toBe(15); // comprou na data com: tem direito
    expect(qtyAt(t, '2026-10-31', 12)).toBe(12);
    expect(qtyAt([], '2026-01-01', 7)).toBe(7);
  });

  it('paga só pelas cotas que tinha na data com', () => {
    const d = [{ ...dist('XPML', '2026-09-25', 0.92), record_date: '2026-09-18' }, { ...dist('XPML', '2026-10-23', 0.92), record_date: '2026-10-16' }];
    const p = paymentsFor(pos('XPML11', 15), d, [trade('2026-08-01', 10), trade('2026-10-01', 5)]);
    expect(p.map((x) => [x.dist.payment_date, x.quantity, x.amount_cents])).toEqual([
      ['2026-10-23', 15, 1380],
      ['2026-09-25', 10, 920],
    ]);
    // comprou depois da data com: não recebe aquele
    expect(paymentsFor(pos('XPML11', 5), d, [trade('2026-10-20', 5)])).toEqual([]);
  });

  it('ações: classe pelo ISIN, JCP líquido e data a definir', () => {
    expect(normalizeStockTicker(' petr4 ')).toBe('PETR4');
    expect(normalizeStockTicker('HGLG11')).toBe('HGLG11'); // unit também termina em 11
    expect(normalizeStockTicker('PETR')).toBeNull();
    expect(stockIsinMatches('PETR4', 'BRPETRACNPR6')).toBe(true);
    expect(stockIsinMatches('PETR4', 'BRPETRACNOR9')).toBe(false);
    expect(stockIsinMatches('TAEE11', 'BRTAEECDAM10')).toBe(true);
    const d = [
      sd('BRPETRACNPR6', 'JRS CAP PROPRIO', 0.67407131, '2026-11-23', '2026-08-21'),
      sd('BRPETRACNOR9', 'DIVIDENDO', 9, '2026-11-23', '2026-08-21'),
      sd('BRPETRACNPR6', 'DIVIDENDO', 0.47156696, null, '2026-08-21'),
    ];
    const p = paymentsFor(pos('PETR4', 100, 'stock'), d);
    expect(p).toHaveLength(1);
    expect(p[0]!.amount_cents).toBe(5729); // 100 × 0,674 × 85%
    expect(undatedFor(pos('PETR4', 100, 'stock'), d)).toEqual([{ kind: 'DIVIDENDO', rate: 0.47156696, record_date: '2026-08-21', amount_cents: 4715 }]);
  });
});

describe('meta de renda passiva e IR', () => {
  it('renda por cota: FII usa o último; ação, a média de 12 meses', () => {
    const f = paymentsFor(pos('XPML11', 10), [dist('XPML', '2026-09-25', 0.92), dist('XPML', '2026-08-25', 0.9)]);
    expect(monthlyPerShare('fii', f, '2026-10-17')).toBe(0.92);
    const st = paymentsFor(pos('ITSA4', 100, 'stock'), [
      { code: 'ITSA', isin: 'BRITSAACNPR7', kind: 'DIVIDENDO', rate: 1.2, payment_date: '2026-05-01', record_date: null, approved_on: null, related_to: null },
      { code: 'ITSA', isin: 'BRITSAACNPR7', kind: 'DIVIDENDO', rate: 9, payment_date: '2024-01-01', record_date: null, approved_on: null, related_to: null },
    ]);
    expect(monthlyPerShare('stock', st, '2026-10-17')).toBeCloseTo(0.1);
  });

  it('plano da meta: quanto falta e quantas cotas de cada ativo', () => {
    const g = goalPlan(100000, [
      { ticker: 'XPML11', quantity: 10, perShare: 0.92, price: 104.5 },
      { ticker: 'MXRF11', quantity: 100, perShare: 0.1, price: 9.5 },
    ]);
    expect(g.current_cents).toBe(1920);
    expect(g.missing_cents).toBe(98080);
    expect(g.rows[0]).toMatchObject({ ticker: 'MXRF11', sharesNeeded: 9808 }); // rende mais por real (1,05% a.m.)
    expect(g.rows[1]).toMatchObject({ ticker: 'XPML11', sharesNeeded: 1067, cost_cents: 11150150 });
  });

  it('relatório de IR por grupo, só o que foi pago no ano', () => {
    const xp = paymentsFor(pos('XPML11', 10), [dist('XPML', '2025-12-26', 0.9), dist('XPML', '2026-01-26', 0.9), dist('XPML', '2027-01-25', 1)]);
    const petr = paymentsFor(pos('PETR4', 100, 'stock'), [
      { code: 'PETR', isin: 'BRPETRACNPR6', kind: 'JRS CAP PROPRIO', rate: 1, payment_date: '2026-03-01', record_date: null, approved_on: null, related_to: null },
      { code: 'PETR', isin: 'BRPETRACNPR6', kind: 'DIVIDENDO', rate: 0.5, payment_date: '2026-03-01', record_date: null, approved_on: null, related_to: null },
    ]);
    const r = irReport(2026, [
      { ticker: 'XPML11', name: 'FII XP MALLS', assetType: 'fii', payments: xp },
      { ticker: 'PETR4', name: 'PETROBRAS', assetType: 'stock', payments: petr },
    ], '2026-12-31');
    expect(r.map((x) => [x.group, x.ticker, x.total_cents])).toEqual([
      ['fii', 'XPML11', 900],
      ['dividendos', 'PETR4', 5000],
      ['jcp', 'PETR4', 8500],
    ]);
  });
});

describe('composição da carteira', () => {
  const h = (ticker: string, type: 'fii' | 'stock', quantity: number, price: number | null, avg: number | null, perShare = 0) => ({ ticker, type, quantity, price, avgPriceCents: avg, perShare });
  const carteira = [
    h('MXRF11', 'fii', 26, 9.46, 950, 0.1),
    h('GRND3', 'stock', 20, 5.56, 520, 0.02),
    h('KLBN3', 'stock', 20, 3.57, 360, 0.01),
    h('TRIS3', 'stock', 5, 8.16, 800),
  ];

  it('patrimônio, investido, variação, DY e yield on cost', () => {
    const s = portfolioStats(carteira);
    expect(s.value_cents).toBe(24596 + 11120 + 7140 + 4080);
    expect(s.invested_cents).toBe(24700 + 10400 + 7200 + 4000);
    expect(s.units).toBe(71);
    expect(s.monthly_income_cents).toBe(260 + 40 + 20);
    expect(s.gain_pct).toBeCloseTo((46936 / 46300 - 1) * 100);
    expect(s.dy_pct).toBeCloseTo((320 / 46936) * 100);
    expect(s.yoc_pct).toBeCloseTo((320 / 46300) * 100);
  });

  it('fatias por ativo, tipo, classe e renda; cor fixa por ativo', () => {
    const a = breakdown(carteira, 'ativos');
    expect(a.map((x) => x.key)).toEqual(['MXRF11', 'GRND3', 'KLBN3', 'TRIS3']); // maior primeiro
    expect(a.find((x) => x.key === 'GRND3')!.slot).toBe(1); // ordem alfabética define a cor
    expect(a.find((x) => x.key === 'TRIS3')!.slot).toBe(4);
    expect(a.reduce((s, x) => s + x.pct, 0)).toBeCloseTo(100);
    expect(breakdown(carteira, 'tipos').map((x) => [x.label, x.slot])).toEqual([['Fundos imobiliários', 1], ['Ações', 2]]);
    expect(breakdown(carteira, 'classe').map((x) => x.label)).toEqual(['FII', 'Ação ON']);
    const r = breakdown(carteira, 'renda');
    expect(r.map((x) => x.key)).toEqual(['MXRF11', 'GRND3', 'KLBN3']); // TRIS3 não rende: fora
  });

  it('mais de 8 ativos: os menores viram "Outros"', () => {
    const many = Array.from({ length: 10 }, (_, i) => h(`AAA${i}11`, 'fii', 1, 10 + i, null));
    const s = breakdown(many, 'ativos');
    expect(s).toHaveLength(8);
    expect(s.at(-1)).toMatchObject({ key: 'outros', slot: 0 });
  });
});

describe('número mágico e bola de neve', () => {
  it('número mágico: renda de um mês compra mais uma cota', () => {
    expect(magicNumber(100, 0.8)).toBe(125);
    expect(magicNumber(100.5, 1)).toBe(101);
    expect(magicNumber(null, 1)).toBeNull();
    expect(magicNumber(100, 0)).toBeNull();
  });

  it('bola de neve reinveste a renda e soma os aportes', () => {
    // R$ 10.000 rendendo 1% ao mês, sem aporte: 12 meses → 10.000 × 1,01^12
    const r = snowball({ value_cents: 1_000_000, income_cents: 10_000, contribution_cents: 0, milestones: [12] });
    expect(r.points[0]!.value_cents).toBeCloseTo(1_126_825, -2);
    expect(r.points[0]!.contributed_cents).toBe(1_000_000);
    const a = snowball({ value_cents: 1_000_000, income_cents: 10_000, contribution_cents: 50_000, goal_cents: 20_000, milestones: [12] });
    expect(a.points[0]!.contributed_cents).toBe(1_600_000);
    expect(a.goal_month).toBeGreaterThan(12);
    expect(a.goal_month).toBeLessThan(60);
    expect(snowball({ value_cents: 0, income_cents: 0, contribution_cents: 0, goal_cents: 1 }).goal_month).toBeNull();
  });
});
