import { diffDays, type ISODate } from '@/lib/dates';
import { magicNumber, type Holding } from './fii';

/**
 * Plano de investimento: divisão-alvo da carteira entre quatro classes, quanto aportar em cada
 * uma para chegar perto da meta e sinais de oportunidade nos ativos que a pessoa já tem.
 * Tudo calculado com dados públicos da B3 e regras simples e explicáveis — não é recomendação.
 */
export type PlanClass = 'rf' | 'acoes' | 'exterior' | 'fii';

export const PLAN_CLASSES: Array<{ key: PlanClass; label: string; hint: string }> = [
  { key: 'rf', label: 'Renda fixa', hint: 'Tesouro, CDB, LCI/LCA: segurança e liquidez' },
  { key: 'acoes', label: 'Ações do Brasil', hint: 'Empresas que pagam dividendos' },
  { key: 'exterior', label: 'Exterior', hint: 'ETFs e BDRs: proteção contra o real' },
  { key: 'fii', label: 'Imóveis (FII)', hint: 'Renda mensal isenta de IR' },
];

export const PRESETS: Array<{ name: string; targets: Record<PlanClass, number>; text: string }> = [
  { name: 'Equilibrado', targets: { rf: 25, acoes: 25, exterior: 25, fii: 25 }, text: '25% em cada classe' },
  { name: 'Renda mensal', targets: { rf: 25, acoes: 20, exterior: 10, fii: 45 }, text: 'Mais FII para mais rendimento todo mês' },
  { name: 'Conservador', targets: { rf: 50, acoes: 15, exterior: 10, fii: 25 }, text: 'Metade em renda fixa' },
];

export interface PlanSettings {
  targets: Record<PlanClass, number>;
  /** valores que ficam fora do app (renda fixa, exterior), em centavos */
  manual: Partial<Record<'rf' | 'exterior', number>>;
}

export const DEFAULT_PLAN: PlanSettings = { targets: PRESETS[0]!.targets, manual: {} };

export function readPlan(raw: unknown): PlanSettings {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Partial<PlanSettings>;
  const t = p.targets ?? DEFAULT_PLAN.targets;
  const targets = { rf: Number(t.rf) || 0, acoes: Number(t.acoes) || 0, exterior: Number(t.exterior) || 0, fii: Number(t.fii) || 0 };
  const sum = targets.rf + targets.acoes + targets.exterior + targets.fii;
  return { targets: sum === 100 ? targets : DEFAULT_PLAN.targets, manual: { rf: Number(p.manual?.rf) || 0, exterior: Number(p.manual?.exterior) || 0 } };
}

const holdingValue = (h: Holding) => Math.round(h.quantity * (h.price ?? (h.avgPriceCents ?? 0) / 100) * 100);

export interface ClassRow {
  key: PlanClass;
  label: string;
  cents: number;
  pct: number;
  target: number;
  /** quanto falta (positivo) ou sobra (negativo) para a meta, em centavos */
  gap: number;
}

export function allocation(holdings: Holding[], plan: PlanSettings): { rows: ClassRow[]; total: number } {
  const value: Record<PlanClass, number> = {
    rf: plan.manual.rf ?? 0,
    exterior: plan.manual.exterior ?? 0,
    fii: holdings.filter((h) => h.type === 'fii').reduce((s, h) => s + holdingValue(h), 0),
    acoes: holdings.filter((h) => h.type === 'stock').reduce((s, h) => s + holdingValue(h), 0),
  };
  const total = Object.values(value).reduce((s, v) => s + v, 0);
  const rows = PLAN_CLASSES.map((c) => ({
    key: c.key,
    label: c.label,
    cents: value[c.key],
    pct: total ? (value[c.key] / total) * 100 : 0,
    target: plan.targets[c.key],
    gap: Math.round((plan.targets[c.key] / 100) * total - value[c.key]),
  }));
  return { rows, total };
}

/** Divide o aporte entre as classes que estão abaixo da meta (proporcional ao que falta). */
export function splitContribution(rows: ClassRow[], total: number, contribution: number): Record<PlanClass, number> {
  const after = total + contribution;
  const need = rows.map((r) => ({ key: r.key, need: Math.max(0, (r.target / 100) * after - r.cents) }));
  const sum = need.reduce((s, n) => s + n.need, 0);
  const out = { rf: 0, acoes: 0, exterior: 0, fii: 0 } as Record<PlanClass, number>;
  if (contribution <= 0) return out;
  if (sum <= 0) {
    for (const r of rows) out[r.key] = Math.round((r.target / 100) * contribution);
    return out;
  }
  for (const n of need) out[n.key] = Math.round((n.need / sum) * contribution);
  return out;
}

export interface NextRecord {
  record_date: ISODate;
  payment_date: ISODate | null;
  rate: number;
}

export type SignalKind = 'datacom' | 'below_pm' | 'yield' | 'magic' | 'concentration';

export interface Signal {
  ticker: string;
  kind: SignalKind;
  title: string;
  detail: string;
}

const brl = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pctTxt = (v: number, d = 1) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: d })}%`;

/** Sinais de oportunidade e de cuidado nos ativos da carteira. */
export function signals(holdings: Holding[], next: Map<string, NextRecord>, today: ISODate): Signal[] {
  const out: Signal[] = [];
  const total = holdings.reduce((s, h) => s + holdingValue(h), 0);
  const priced = holdings.filter((h) => h.quantity > 0 && h.price && h.perShare > 0);
  const avgYield = priced.length ? priced.reduce((s, h) => s + h.perShare / h.price!, 0) / priced.length : 0;

  for (const h of holdings.filter((x) => x.quantity > 0)) {
    const n = next.get(h.ticker);
    if (n && n.record_date >= today && diffDays(n.record_date, today) <= 5) {
      const days = diffDays(n.record_date, today);
      out.push({
        ticker: h.ticker,
        kind: 'datacom',
        title: days === 0 ? `Hoje é a data com de ${h.ticker}` : `Data com de ${h.ticker} em ${days} ${days === 1 ? 'dia' : 'dias'}`,
        detail: `Quem tiver a cota no fim do dia ${n.record_date.slice(8, 10)}/${n.record_date.slice(5, 7)} recebe ${brl(n.rate)} por cota${n.payment_date ? ` em ${n.payment_date.slice(8, 10)}/${n.payment_date.slice(5, 7)}` : ''}.`,
      });
    }
    if (h.price && h.avgPriceCents && h.price * 100 <= h.avgPriceCents * 0.95) {
      const off = (1 - (h.price * 100) / h.avgPriceCents) * 100;
      out.push({
        ticker: h.ticker,
        kind: 'below_pm',
        title: `${h.ticker} está ${pctTxt(off, 0)} abaixo do seu preço médio`,
        detail: `Cotação ${brl(h.price)} contra ${brl(h.avgPriceCents / 100)} que você pagou em média. Comprar agora baixa o seu preço médio.`,
      });
    }
    if (h.price && h.perShare > 0 && avgYield > 0 && h.perShare / h.price >= avgYield * 1.15 && priced.length > 1) {
      out.push({
        ticker: h.ticker,
        kind: 'yield',
        title: `${h.ticker} rende ${pctTxt((h.perShare / h.price) * 100, 2)} ao mês pela cotação de hoje`,
        detail: `Acima da média da sua carteira (${pctTxt(avgYield * 100, 2)}). Cada R$ 1.000 aqui rendem cerca de ${brl((1000 * h.perShare) / h.price)} por mês.`,
      });
    }
    const magic = magicNumber(h.price, h.perShare);
    if (magic && h.quantity < magic && h.quantity / magic >= 0.7) {
      out.push({
        ticker: h.ticker,
        kind: 'magic',
        title: `Faltam ${magic - h.quantity} cotas para o número mágico de ${h.ticker}`,
        detail: `Com ${magic} cotas, a renda de um mês compra mais uma sozinha (custa cerca de ${brl((magic - h.quantity) * h.price!)}).`,
      });
    }
    const share = total ? holdingValue(h) / total : 0;
    if (share >= 0.35 && holdings.length > 1) {
      out.push({
        ticker: h.ticker,
        kind: 'concentration',
        title: `${h.ticker} é ${pctTxt(share * 100, 0)} da carteira`,
        detail: 'Para manter a carteira segura, prefira aportar nos outros ativos até equilibrar.',
      });
    }
  }
  const order: Record<SignalKind, number> = { datacom: 0, below_pm: 1, yield: 2, magic: 3, concentration: 4 };
  return out.sort((a, b) => order[a.kind] - order[b.kind]);
}

export interface Buy {
  ticker: string;
  quantity: number;
  cents: number;
  why: string;
}

/**
 * Onde colocar o valor de uma classe (FII ou ações) entre os ativos que a pessoa já tem:
 * prioriza rendimento sobre a cotação, preço abaixo do médio e data com próxima, e evita
 * aumentar o que já está concentrado.
 */
export function pickBuys(holdings: Holding[], type: 'fii' | 'stock', budget: number, sig: Signal[]): Buy[] {
  const total = holdings.reduce((s, h) => s + holdingValue(h), 0);
  const kinds = (t: string) => new Set(sig.filter((s) => s.ticker === t).map((s) => s.kind));
  const ranked = holdings
    .filter((h) => h.type === type && h.price && h.price > 0)
    .map((h) => {
      const k = kinds(h.ticker);
      const yieldPct = h.perShare > 0 ? (h.perShare / h.price!) * 100 : 0;
      const share = total ? holdingValue(h) / total : 0;
      const score = yieldPct + (k.has('below_pm') ? 0.3 : 0) + (k.has('datacom') ? 0.2 : 0) + (k.has('magic') ? 0.15 : 0) - (share >= 0.35 ? 1 : 0);
      const why = k.has('below_pm') ? 'abaixo do seu preço médio' : k.has('datacom') ? 'data com chegando' : k.has('magic') ? 'perto do número mágico' : yieldPct ? `rende ${pctTxt(yieldPct, 2)} ao mês` : 'equilibra a carteira';
      return { h, score, why };
    })
    .sort((a, b) => b.score - a.score);
  const out: Buy[] = [];
  let left = budget;
  // até dois ativos: o melhor leva a maior parte, o segundo o que sobrar
  for (const [i, r] of ranked.slice(0, 2).entries()) {
    const price = Math.round(r.h.price! * 100);
    const part = i === 0 && ranked.length > 1 ? Math.round(left * 0.6) : left;
    const qty = Math.floor(part / price);
    if (qty <= 0) continue;
    out.push({ ticker: r.h.ticker, quantity: qty, cents: qty * price, why: r.why });
    left -= qty * price;
  }
  // sobrou dinheiro para mais uma cota do primeiro?
  if (out[0] && ranked[0] && left >= Math.round(ranked[0].h.price! * 100)) {
    const price = Math.round(ranked[0].h.price! * 100);
    const extra = Math.floor(left / price);
    out[0] = { ...out[0], quantity: out[0].quantity + extra, cents: out[0].cents + extra * price };
  }
  return out;
}
