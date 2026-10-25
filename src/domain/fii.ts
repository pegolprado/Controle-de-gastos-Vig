/** Regras puras da Renda (FII e ações): valores a receber, situação do pagamento, metas e IR. */
import { addDays, addMonths, diffDays, makeDate, monthLabel, parseISO, startOfMonth, todayISO, type ISODate } from '@/lib/dates';
import type { AssetType, FiiDistribution, FiiPosition, FiiTrade, StockDistribution } from '@/lib/types';

/** "hglg" / "HGLG11 " → "HGLG11"; null se não parecer um código de FII. */
export function normalizeTicker(input: string): string | null {
  const t = input.trim().toUpperCase().replace(/\s+/g, '');
  if (/^[A-Z][A-Z0-9]{3}$/.test(t)) return `${t}11`;
  return /^[A-Z][A-Z0-9]{3}1[1-5]$/.test(t) ? t : null;
}

/** "petr4" → "PETR4"; aceita ON (3), PN (4), PNA/PNB… (5–8) e units (11). */
export function normalizeStockTicker(input: string): string | null {
  const t = input.trim().toUpperCase().replace(/\s+/g, '');
  return /^[A-Z][A-Z0-9]{3}([3-8]|11)$/.test(t) ? t : null;
}

export const baseCode = (ticker: string) => ticker.slice(0, 4);

/** Juros sobre capital próprio: 15% de IR retido na fonte. */
export const isJcp = (kind: string) => kind.startsWith('JRS');

/** Valor recebido: cotas × valor por cota (JCP líquido), truncado nos centavos (como a B3 credita). */
export function payoutCents(quantity: number, rate: number, kind = ''): number {
  return Math.floor(Math.round(quantity * Number(rate) * (isJcp(kind) ? 0.85 : 1) * 1e6) / 1e4);
}

/** Mesmo critério do banco (stock_isin_matches): classe da ação pelo ISIN. */
export function stockIsinMatches(ticker: string, isin: string): boolean {
  const suffix = ticker.slice(4);
  const cls: Record<string, string> = { '3': 'ACNOR', '4': 'ACNPR', '5': 'ACNPA', '6': 'ACNPB', '7': 'ACNPC', '8': 'ACNPD', '11': 'CDAM' };
  const want = cls[suffix];
  return !!want && isin.slice(6, 6 + want.length) === want;
}

/** Cotas com direito ao provento: operações até a data com (sem operações, vale a quantidade atual). */
export function qtyAt(trades: FiiTrade[], date: string | null, current: number): number {
  if (!trades.length) return current;
  return trades.filter((t) => !t.trade_date || !date || t.trade_date <= date).reduce((s, t) => s + t.quantity, 0);
}

export type PayStatus = { tone: 'positive' | 'warning' | 'brand' | 'info' | 'neutral'; label: string; paid: boolean };

export function payStatus(paymentDate: ISODate, today: ISODate = todayISO(), projected = false): PayStatus {
  const d = diffDays(paymentDate, today);
  if (projected) {
    if (d < 0) return { tone: 'info', label: 'Previsto · aguardando anúncio', paid: false };
    if (d === 0) return { tone: 'info', label: 'Previsto · hoje', paid: false };
    if (d === 1) return { tone: 'info', label: 'Previsto · amanhã', paid: false };
    return { tone: 'info', label: `Previsto · daqui a ${d} dias`, paid: false };
  }
  // no dia do pagamento o valor já cai na conta da corretora
  if (d < 0) return { tone: 'positive', label: 'Recebido', paid: true };
  if (d === 0) return { tone: 'positive', label: 'Recebido hoje', paid: true };
  if (d === 1) return { tone: 'warning', label: 'Amanhã', paid: false };
  return { tone: 'warning', label: `Daqui a ${d} dias`, paid: false };
}

export interface FiiPayment {
  ticker: string;
  quantity: number;
  dist: FiiDistribution;
  amount_cents: number;
  /** estimativa pelo histórico: o fundo ainda não anunciou na B3 */
  projected?: boolean;
  /** quantidade atual (a previsão usa as cotas de hoje) */
  current?: number;
  asset_type?: AssetType;
}

/** Proventos do ativo (FII: as cotas; ação: a classe certa — PN, ON ou unit). */
function distsOf(position: Pick<FiiPosition, 'ticker' | 'asset_type'>, dists: Array<FiiDistribution | StockDistribution>) {
  const code = baseCode(position.ticker);
  return dists.filter((d) => d.code === code && (position.asset_type !== 'stock' || stockIsinMatches(position.ticker, d.isin)));
}

/** Pagamentos de cada posição (mais recentes primeiro), com as cotas que tinham direito na data com. */
export function paymentsFor(
  position: Pick<FiiPosition, 'ticker' | 'quantity'> & { asset_type?: AssetType },
  dists: Array<FiiDistribution | StockDistribution>,
  trades: FiiTrade[] = [],
): FiiPayment[] {
  const pos = { ticker: position.ticker, asset_type: position.asset_type ?? 'fii' };
  return distsOf(pos, dists)
    .filter((d): d is FiiDistribution => !!d.payment_date)
    .sort((a, b) => b.payment_date.localeCompare(a.payment_date))
    .map((dist) => {
      const quantity = qtyAt(trades, dist.record_date ?? dist.payment_date, position.quantity);
      return { ticker: position.ticker, quantity, dist, amount_cents: payoutCents(quantity, dist.rate, dist.kind), current: position.quantity, asset_type: pos.asset_type };
    })
    .filter((p) => p.quantity > 0);
}

/** Proventos já aprovados com data de pagamento "a definir" (comum em JCP de ações). */
export function undatedFor(
  position: Pick<FiiPosition, 'ticker' | 'quantity'> & { asset_type?: AssetType },
  dists: Array<FiiDistribution | StockDistribution>,
  trades: FiiTrade[] = [],
): Array<{ kind: string; rate: number; record_date: string | null; amount_cents: number }> {
  return distsOf({ ticker: position.ticker, asset_type: position.asset_type ?? 'fii' }, dists)
    .filter((d) => !d.payment_date)
    .map((d) => {
      const q = qtyAt(trades, d.record_date, position.quantity);
      return { kind: d.kind, rate: Number(d.rate), record_date: d.record_date, amount_cents: payoutCents(q, d.rate, d.kind) };
    })
    .filter((d) => d.amount_cents > 0);
}

const weekday = (iso: ISODate) => {
  const { y, m, d } = parseISO(iso);
  return new Date(y, m - 1, d).getDay();
};

/** Fim de semana → dia útil anterior ou seguinte, conforme o costume do fundo. */
function toBusinessDay(iso: ISODate, backwards: boolean): ISODate {
  const wd = weekday(iso);
  if (wd === 6) return addDays(iso, backwards ? -1 : 2);
  if (wd === 0) return addDays(iso, backwards ? -2 : 1);
  return iso;
}

/**
 * Próximo rendimento previsto pelo histórico, quando o fundo ainda não anunciou:
 * exige pagamentos mensais regulares (3 últimos com intervalo de 20 a 40 dias).
 * Data: o dia do mês em que o fundo costuma pagar; valor: o último por cota.
 */
export function projectNext(payments: FiiPayment[], today: ISODate = todayISO()): FiiPayment | undefined {
  const income = payments.filter((p) => p.dist.kind === 'RENDIMENTO');
  if (income.length < 3 || income[0]!.dist.payment_date > today) return undefined;
  const recent = income.slice(0, 3);
  for (let i = 0; i < recent.length - 1; i++) {
    const gap = diffDays(recent[i]!.dist.payment_date, recent[i + 1]!.dist.payment_date);
    if (gap < 20 || gap > 40) return undefined;
  }
  const last = recent[0]!;
  // fundo que parou de pagar: sem previsão
  if (diffDays(today, last.dist.payment_date) > 65) return undefined;
  const days = recent.map((p) => parseISO(p.dist.payment_date).d).sort((a, b) => a - b);
  const typicalDay = days[1]!; // mediana
  // quando o dia habitual cai no fim de semana, o fundo antecipa ou adia? (pelo histórico)
  let before = 0;
  let after = 0;
  for (const p of income.slice(0, 12)) {
    const { y, m, d } = parseISO(p.dist.payment_date);
    if (d === typicalDay) continue;
    const usual = makeDate(y, m, typicalDay);
    if (weekday(usual) !== 0 && weekday(usual) !== 6) continue;
    if (d < typicalDay) before++;
    else after++;
  }
  const { y, m } = parseISO(last.dist.payment_date);
  let date = toBusinessDay(makeDate(y, m + 1, typicalDay), before > after);
  // um mês inteiro sem anúncio: projeta o mês seguinte
  if (diffDays(today, date) > 20) {
    const p = parseISO(date);
    date = toBusinessDay(makeDate(p.y, p.m + 1, typicalDay), before > after);
  }
  const recordGap = last.dist.record_date ? diffDays(last.dist.payment_date, last.dist.record_date) : null;
  const qty = last.current ?? last.quantity;
  return {
    ...last,
    quantity: qty,
    amount_cents: payoutCents(qty, last.dist.rate, last.dist.kind),
    projected: true,
    dist: { ...last.dist, payment_date: date, record_date: recordGap !== null ? toBusinessDay(addDays(date, -recordGap), true) : null, approved_on: null, related_to: null },
  };
}

/** Próximo pagamento (anunciado ou previsto) e o último recebido de uma posição. */
export function nextAndLast(payments: FiiPayment[], today: ISODate = todayISO()): { next?: FiiPayment; last?: FiiPayment } {
  const upcoming = payments.filter((p) => p.dist.payment_date > today);
  const last = payments.find((p) => p.dist.payment_date <= today);
  return { next: upcoming.length ? upcoming[upcoming.length - 1] : projectNext(payments, today), last };
}

export type MonthMode = 'upcoming' | 'received' | 'next' | 'none';

/**
 * Visão do mês vigente para um fundo:
 * - 'upcoming': ainda vai cair neste mês (anunciado ou previsto) → contagem de dias;
 * - 'received': já caiu neste mês → "Recebido";
 * - 'next': nada neste mês; o próximo é no mês seguinte (a contagem começa na virada);
 * - 'none': sem anúncio nem previsão.
 */
export function monthView(payments: FiiPayment[], today: ISODate = todayISO()): { mode: MonthMode; featured?: FiiPayment; last?: FiiPayment } {
  const monthStart = startOfMonth(today);
  const nextMonth = addMonths(monthStart, 1);
  const { next, last } = nextAndLast(payments, today);
  const paidThisMonth = last && last.dist.payment_date >= monthStart ? last : undefined;
  if (next && next.dist.payment_date < nextMonth && !(next.projected && paidThisMonth)) return { mode: 'upcoming', featured: next, last };
  if (paidThisMonth) return { mode: 'received', featured: paidThisMonth, last };
  if (next) return { mode: 'next', featured: next, last };
  return { mode: 'none', featured: last, last };
}

/** Selo do cartão: contagem só no mês vigente; pagamento do mês seguinte mostra só o mês. */
export function monthStatus(mode: MonthMode, featured: FiiPayment | undefined, today: ISODate = todayISO()): PayStatus | null {
  if (!featured) return null;
  if (mode === 'next') return { tone: 'neutral', label: `Em ${monthLabel(featured.dist.payment_date, { year: false })}`, paid: false };
  if (mode === 'none') return { tone: 'neutral', label: 'Sem anúncio', paid: true };
  return payStatus(featured.dist.payment_date, today, featured.projected);
}

/** O pagamento a destacar no cartão (ver monthView). */
export function featuredPayment(payments: FiiPayment[], today: ISODate = todayISO()): FiiPayment | undefined {
  return monthView(payments, today).featured;
}

export interface FiiSummary {
  upcoming_cents: number;
  this_month_cents: number;
  last12_cents: number;
  monthly_avg_cents: number;
  upcoming: FiiPayment[];
  /** previsões dos fundos que ainda não anunciaram */
  projected: FiiPayment[];
  projected_cents: number;
  months: Array<{ month: ISODate; cents: number }>;
}

export function summarize(all: FiiPayment[], today: ISODate = todayISO(), projected: FiiPayment[] = []): FiiSummary {
  const monthStart = startOfMonth(today);
  const from12 = addMonths(monthStart, -11);
  const upcoming = all.filter((p) => p.dist.payment_date > today).sort((a, b) => a.dist.payment_date.localeCompare(b.dist.payment_date));
  const months = Array.from({ length: 12 }, (_, i) => ({ month: addMonths(from12, i), cents: 0 }));
  let last12 = 0;
  let thisMonth = 0;
  for (const p of all) {
    const d = p.dist.payment_date;
    if (d < from12 || d > today) continue;
    last12 += p.amount_cents;
    if (d >= monthStart) thisMonth += p.amount_cents;
    const m = months.find((x) => x.month === startOfMonth(d));
    if (m) m.cents += p.amount_cents;
  }
  const paidMonths = months.filter((m) => m.cents > 0).length;
  return {
    upcoming_cents: upcoming.reduce((s, p) => s + p.amount_cents, 0),
    this_month_cents: thisMonth,
    last12_cents: last12,
    monthly_avg_cents: paidMonths ? Math.round(last12 / paidMonths) : 0,
    upcoming,
    projected: [...projected].sort((a, b) => a.dist.payment_date.localeCompare(b.dist.payment_date)),
    projected_cents: projected.reduce((s, p) => s + p.amount_cents, 0),
    months,
  };
}

/** Rendimento mensal sobre o preço médio (%), quando informado. */
export function yieldOnCost(rate: number, avgPriceCents: number | null): number | null {
  if (!avgPriceCents) return null;
  return (Number(rate) * 100 * 100) / avgPriceCents;
}

// ---------------------------------------------------------------- meta de renda passiva

/** Renda mensal estimada por cota (líquida): FII = último rendimento; ação = média dos últimos 12 meses. */
export function monthlyPerShare(assetType: AssetType, payments: FiiPayment[], today: ISODate = todayISO()): number {
  const net = (p: FiiPayment) => Number(p.dist.rate) * (isJcp(p.dist.kind) ? 0.85 : 1);
  if (assetType === 'fii') {
    const last = payments.find((p) => p.dist.kind === 'RENDIMENTO' && p.dist.payment_date <= addDays(today, 45));
    return last ? net(last) : 0;
  }
  const from = addDays(today, -365);
  return payments.filter((p) => p.dist.payment_date > from && p.dist.payment_date <= today).reduce((s, p) => s + net(p), 0) / 12;
}

export interface GoalRow {
  ticker: string;
  perShare: number;
  price: number | null;
  /** rendimento mensal sobre o preço atual (%) */
  yieldPct: number | null;
  sharesNeeded: number;
  cost_cents: number | null;
}

export function goalPlan(
  goalCents: number,
  items: Array<{ ticker: string; quantity: number; perShare: number; price: number | null }>,
): { current_cents: number; missing_cents: number; pct: number; rows: GoalRow[] } {
  const current = Math.round(items.reduce((s, i) => s + i.quantity * i.perShare * 100, 0));
  const missing = Math.max(0, goalCents - current);
  const rows = items
    .filter((i) => i.perShare > 0)
    .map((i) => {
      const sharesNeeded = Math.ceil(missing / (i.perShare * 100));
      return {
        ticker: i.ticker,
        perShare: i.perShare,
        price: i.price,
        yieldPct: i.price ? (i.perShare / i.price) * 100 : null,
        sharesNeeded,
        cost_cents: i.price ? Math.round(sharesNeeded * i.price * 100) : null,
      };
    })
    .sort((a, b) => (b.yieldPct ?? -1) - (a.yieldPct ?? -1));
  return { current_cents: current, missing_cents: missing, pct: goalCents ? Math.min(100, (current / goalCents) * 100) : 0, rows };
}

// ---------------------------------------------------------------- imposto de renda

export type IrGroup = 'fii' | 'dividendos' | 'jcp';

export const IR_GROUP_LABEL: Record<IrGroup, { title: string; where: string }> = {
  fii: { title: 'Rendimentos de FII', where: 'Rendimentos isentos e não tributáveis → Outros (informe o CNPJ do fundo)' },
  dividendos: { title: 'Dividendos de ações', where: 'Rendimentos isentos e não tributáveis → Lucros e dividendos recebidos' },
  jcp: { title: 'Juros sobre capital próprio (líquido)', where: 'Rendimentos sujeitos à tributação exclusiva → Juros sobre capital próprio' },
};

export function irReport(
  year: number,
  items: Array<{ ticker: string; name: string | null; assetType: AssetType; payments: FiiPayment[] }>,
  today: ISODate = todayISO(),
): Array<{ group: IrGroup; ticker: string; name: string | null; total_cents: number; count: number }> {
  const from = `${year}-01-01`;
  const to = `${year}-12-31` < today ? `${year}-12-31` : today;
  const out = new Map<string, { group: IrGroup; ticker: string; name: string | null; total_cents: number; count: number }>();
  for (const it of items) {
    for (const p of it.payments) {
      if (p.projected || p.dist.payment_date < from || p.dist.payment_date > to) continue;
      const group: IrGroup = it.assetType === 'fii' ? 'fii' : isJcp(p.dist.kind) ? 'jcp' : 'dividendos';
      const key = `${group}|${it.ticker}`;
      const cur = out.get(key) ?? { group, ticker: it.ticker, name: it.name, total_cents: 0, count: 0 };
      cur.total_cents += p.amount_cents;
      cur.count++;
      out.set(key, cur);
    }
  }
  const order: IrGroup[] = ['fii', 'dividendos', 'jcp'];
  return [...out.values()].sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || a.ticker.localeCompare(b.ticker));
}

/** "JRS CAP PROPRIO" → "JCP"; "RENDIMENTO" → "Rendimento"… */
export function kindLabel(kind: string): string {
  if (isJcp(kind)) return 'JCP';
  const k = kind.toLowerCase();
  if (k.startsWith('amortiza')) return 'Amortização';
  return k.charAt(0).toUpperCase() + k.slice(1);
}

/** Descrição do lançamento (igual à do piloto automático no banco). */
export function incomeDescription(p: Pick<FiiPayment, 'ticker' | 'asset_type' | 'dist'>): string {
  if (isJcp(p.dist.kind)) return `JCP ${p.ticker}`;
  return `${p.asset_type === 'stock' ? 'Dividendo' : 'Rendimento'} ${p.ticker}`;
}

// ---------------------------------------------------------------- composição da carteira

export interface Holding {
  ticker: string;
  type: AssetType;
  quantity: number;
  /** cotação atual (R$) */
  price: number | null;
  avgPriceCents: number | null;
  /** renda mensal estimada por cota/ação (R$, líquida) */
  perShare: number;
}

export interface PortfolioStats {
  value_cents: number;
  invested_cents: number;
  /** variação sobre o investido (só ativos com preço médio e cotação) */
  gain_pct: number | null;
  units: number;
  monthly_income_cents: number;
  /** renda mensal ÷ patrimônio atual */
  dy_pct: number | null;
  /** renda mensal ÷ valor investido */
  yoc_pct: number | null;
}

const holdingValue = (h: Holding) => Math.round(h.quantity * (h.price ?? (h.avgPriceCents ?? 0) / 100) * 100);
const holdingIncome = (h: Holding) => Math.round(h.quantity * h.perShare * 100);

export function portfolioStats(holdings: Holding[]): PortfolioStats {
  const value = holdings.reduce((s, h) => s + holdingValue(h), 0);
  const withCost = holdings.filter((h) => h.avgPriceCents && h.quantity > 0);
  const invested = withCost.reduce((s, h) => s + h.quantity * (h.avgPriceCents ?? 0), 0);
  const priced = withCost.filter((h) => h.price !== null);
  const pricedInvested = priced.reduce((s, h) => s + h.quantity * (h.avgPriceCents ?? 0), 0);
  const pricedValue = priced.reduce((s, h) => s + holdingValue(h), 0);
  const income = holdings.reduce((s, h) => s + holdingIncome(h), 0);
  const incomeWithCost = withCost.reduce((s, h) => s + holdingIncome(h), 0);
  return {
    value_cents: value,
    invested_cents: invested,
    gain_pct: pricedInvested ? (pricedValue / pricedInvested - 1) * 100 : null,
    units: holdings.reduce((s, h) => s + h.quantity, 0),
    monthly_income_cents: income,
    dy_pct: value ? (income / value) * 100 : null,
    yoc_pct: invested ? (incomeWithCost / invested) * 100 : null,
  };
}

export type BreakdownBy = 'ativos' | 'tipos' | 'classe' | 'renda';

export interface Slice {
  key: string;
  label: string;
  cents: number;
  pct: number;
  /** posição fixa na paleta categórica (1–8); 0 = "Outros" (neutro) */
  slot: number;
}

const MAX_SLICES = 8;

/** Classe pelo final do código: FII, ação ON (3), PN (4–8) ou unit (11). */
export function assetClass(h: Pick<Holding, 'ticker' | 'type'>): string {
  if (h.type === 'fii') return 'FII';
  const s = h.ticker.slice(4);
  return s === '3' ? 'Ação ON' : s === '11' ? 'Unit' : 'Ação PN';
}

/**
 * Fatias do gráfico. A cor segue a entidade (ordem alfabética fixa dos ativos),
 * nunca o tamanho; com mais de 8 ativos, os menores viram "Outros".
 */
export function breakdown(holdings: Holding[], by: BreakdownBy): Slice[] {
  const groups = new Map<string, number>();
  const add = (k: string, v: number) => groups.set(k, (groups.get(k) ?? 0) + v);
  for (const h of holdings) {
    if (by === 'ativos') add(h.ticker, holdingValue(h));
    else if (by === 'renda') add(h.ticker, holdingIncome(h));
    else if (by === 'tipos') add(h.type === 'fii' ? 'Fundos imobiliários' : 'Ações', holdingValue(h));
    else add(assetClass(h), holdingValue(h));
  }
  const fixedOrder =
    by === 'tipos' ? ['Fundos imobiliários', 'Ações'] : by === 'classe' ? ['FII', 'Ação PN', 'Ação ON', 'Unit'] : [...new Set(holdings.map((h) => h.ticker))].sort();
  const total = [...groups.values()].reduce((s, v) => s + v, 0);
  let rows = [...groups.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  let other = 0;
  if (rows.length > MAX_SLICES) {
    other = rows.slice(MAX_SLICES - 1).reduce((s, [, v]) => s + v, 0);
    rows = rows.slice(0, MAX_SLICES - 1);
  }
  // cor por entidade: posição na ordem fixa entre as que aparecem
  const shown = fixedOrder.filter((k) => rows.some(([r]) => r === k));
  const slices: Slice[] = rows.map(([key, cents]) => ({
    key,
    label: key,
    cents,
    pct: total ? (cents / total) * 100 : 0,
    slot: shown.indexOf(key) + 1,
  }));
  if (other > 0) slices.push({ key: 'outros', label: 'Outros', cents: other, pct: (other / total) * 100, slot: 0 });
  return slices;
}

// ---------------------------------------------------------------- número mágico e bola de neve

/**
 * Número mágico: quantas cotas/ações fazem a renda de um mês comprar mais uma sozinha.
 * Null quando falta cotação ou o ativo não tem renda estimada.
 */
export function magicNumber(price: number | null, perShare: number): number | null {
  if (!price || perShare <= 0) return null;
  return Math.ceil(price / perShare);
}

export interface SnowballPoint {
  month: number;
  value_cents: number;
  income_cents: number;
  /** quanto saiu do bolso até aqui (patrimônio inicial + aportes) */
  contributed_cents: number;
}

/**
 * Efeito bola de neve: reinveste toda a renda e aporta todo mês, mantendo o rendimento
 * mensal de hoje (sem contar valorização das cotas nem inflação).
 * Devolve um ponto por marco pedido e o mês em que a renda bate a meta (se bater em até 50 anos).
 */
export function snowball(opts: {
  value_cents: number;
  income_cents: number;
  contribution_cents: number;
  goal_cents?: number;
  milestones?: number[];
}): { points: SnowballPoint[]; goal_month: number | null } {
  const { value_cents, income_cents, contribution_cents, goal_cents = 0 } = opts;
  const milestones = opts.milestones ?? [12, 60, 120, 240];
  const rate = value_cents > 0 ? income_cents / value_cents : 0;
  const last = Math.max(...milestones, goal_cents ? 600 : 0);
  let value = value_cents;
  let income = income_cents;
  let contributed = value_cents;
  let goal: number | null = goal_cents && income >= goal_cents ? 0 : null;
  const points: SnowballPoint[] = [];
  for (let m = 1; m <= last; m++) {
    value += income + contribution_cents;
    contributed += contribution_cents;
    income = Math.round(value * rate);
    if (goal === null && goal_cents && income >= goal_cents) goal = m;
    if (milestones.includes(m)) points.push({ month: m, value_cents: Math.round(value), income_cents: income, contributed_cents: contributed });
    if (m >= Math.max(...milestones) && (goal !== null || !goal_cents)) break;
  }
  return { points, goal_month: goal };
}
