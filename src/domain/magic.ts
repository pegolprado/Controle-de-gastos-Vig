/**
 * Simulador do Número Mágico: quantas cotas são precisas para que o próprio provento compre
 * `perMonth` cotas novas todo mês, e a bola de neve de reinvestir tudo por N meses.
 * Valores em centavos; preço e provento constantes (sem valorização), inflação só para
 * mostrar quanto a renda vale em reais de hoje.
 */
export interface MagicInput {
  /** preço da cota, em centavos (pode ter frações de centavo) */
  price: number;
  /** provento mensal por cota, em centavos (pode ter frações de centavo) */
  dividend: number;
  perMonth: number;
  /** inflação anual em % (ex.: 6) */
  inflation: number;
  /** meta de renda mensal em R$ de hoje, em centavos (0 = sem meta) */
  goal: number;
  /** aporte extra todo mês, em centavos */
  contribution?: number;
  months?: number;
  /** cotas iniciais (padrão: o número mágico) */
  startShares?: number;
}

export interface MagicRow {
  month: number;
  year: number;
  shares: number;
  income: number;
  bought: number;
  leftover: number;
  equity: number;
  /** renda e patrimônio em reais de hoje */
  realIncome: number;
  realEquity: number;
  record: boolean;
  goal: boolean;
}

export interface MagicResult {
  magic: number;
  initial: number;
  rows: MagicRow[];
  /** primeiro mês em que a renda (em R$ de hoje) bate a meta */
  goalMonth: number | null;
  last: MagicRow | null;
  invested: number;
}

export function magicNumberFor(price: number, dividend: number, perMonth: number): number {
  if (!(price > 0) || !(dividend > 0) || !(perMonth > 0)) return 0;
  // arredonda para cima, com tolerância para erros de ponto flutuante (2 × 8,94 ÷ 0,10)
  return Math.ceil((perMonth * price) / dividend - 1e-9);
}

export function simulateMagic(i: MagicInput): MagicResult {
  const months = Math.min(600, Math.max(1, Math.round(i.months ?? 360)));
  const magic = magicNumberFor(i.price, i.dividend, i.perMonth);
  if (!magic) return { magic: 0, initial: 0, rows: [], goalMonth: null, last: null, invested: 0 };
  let shares = Math.max(0, Math.round(i.startShares ?? magic));
  const initial = Math.round(shares * i.price);
  const contribution = Math.max(0, Math.round(i.contribution ?? 0));
  const monthlyInflation = Math.pow(1 + Math.max(-50, i.inflation) / 100, 1 / 12);
  let leftover = 0;
  let best = 0;
  let goalMonth: number | null = null;
  let invested = initial;
  const rows: MagicRow[] = [];
  for (let m = 1; m <= months; m++) {
    const income = Math.round(shares * i.dividend);
    const cash = income + leftover + contribution;
    const bought = Math.floor(cash / i.price + 1e-9);
    leftover = Math.max(0, Math.round(cash - bought * i.price));
    invested += contribution;
    const deflator = Math.pow(monthlyInflation, m);
    const realIncome = Math.round(income / deflator);
    const record = bought > best && m > 1;
    if (bought > best) best = bought;
    const reached = i.goal > 0 && goalMonth === null && realIncome >= i.goal;
    if (reached) goalMonth = m;
    rows.push({
      month: m,
      year: Math.ceil(m / 12),
      shares,
      income,
      bought,
      leftover,
      equity: Math.round(shares * i.price),
      realIncome,
      realEquity: Math.round((shares * i.price) / deflator),
      record,
      goal: reached,
    });
    shares += bought;
  }
  return { magic, initial, rows, goalMonth, last: rows[rows.length - 1] ?? null, invested };
}
