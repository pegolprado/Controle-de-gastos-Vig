import { addDays, diffDays, type ISODate } from '@/lib/dates';
import { descriptionKey } from '@/lib/statement';
import type { Transaction } from '@/lib/types';

/**
 * Detector de desperdícios: encontra padrões que passam despercebidos no extrato
 * e estima quanto daria para economizar. Sem julgamento: são oportunidades.
 */
export type WasteKind = 'subscription' | 'increase' | 'repeat' | 'fee' | 'duplicate';

export interface WasteItem {
  id: string;
  kind: WasteKind;
  title: string;
  detail: string;
  /** economia possível por mês (estimativa conservadora) */
  monthly_saving: number;
  /** lançamentos que deram origem (para conferir) */
  examples: Array<Pick<Transaction, 'id' | 'description' | 'amount_cents' | 'occurred_on'>>;
}

export interface Subscription {
  key: string;
  name: string;
  monthly: number;
  last: ISODate;
  count: number;
  /** ainda cobrando (última cobrança há menos de ~40 dias) */
  active: boolean;
}

const brl = (c: number) => `R$ ${(c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
};

const FEE = /\b(tarifa|anuidade|iof|juros|multa|encargo|encargos|mora|cesta de servicos|pacote de servicos|taxa de manutencao|saque|rotativo|cheque especial)\b/;
const SUBSCRIPTION_HINT = /\b(netflix|spotify|disney|prime|amazon prime|hbo|max|globoplay|youtube|deezer|paramount|apple|icloud|google one|google storage|chatgpt|openai|microsoft|office|adobe|dropbox|canva|academia|smart ?fit|gympass|wellhub|assinatura|mensalidade|clube|plano|crunchyroll|star\+|telecine|premiere|tinder|duolingo|kindle|audible|ifood clube|uber one|meli\+|nubank ultravioleta)\b/;
const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

type Tx = Pick<Transaction, 'id' | 'description' | 'amount_cents' | 'occurred_on' | 'kind' | 'status' | 'recurrence_id' | 'installment_group_id'>;

function groupBy(txs: Tx[]) {
  const map = new Map<string, Tx[]>();
  for (const t of txs) {
    const k = descriptionKey(t.description);
    if (k.length < 3) continue;
    map.set(k, [...(map.get(k) ?? []), t]);
  }
  for (const list of map.values()) list.sort((a, b) => a.occurred_on.localeCompare(b.occurred_on));
  return map;
}

/** Cobranças que se repetem todo mês com valor parecido (assinaturas e contas fixas). */
export function findSubscriptions(txs: Tx[], today: ISODate): Subscription[] {
  const out: Subscription[] = [];
  for (const [key, list] of groupBy(txs.filter((t) => t.kind === 'expense' && t.status !== 'cancelled' && !t.installment_group_id))) {
    // uma cobrança por mês
    const byMonth = new Map<string, Tx>();
    for (const t of list) byMonth.set(t.occurred_on.slice(0, 7), t);
    const monthly = [...byMonth.values()];
    if (monthly.length < 3) continue;
    const gaps = monthly.slice(1).map((t, i) => diffDays(t.occurred_on, monthly[i]!.occurred_on));
    const regular = gaps.filter((g) => g >= 25 && g <= 36).length >= Math.max(2, gaps.length * 0.7);
    const amounts = monthly.map((t) => t.amount_cents);
    const med = median(amounts);
    const stable = amounts.filter((a) => Math.abs(a - med) <= med * 0.25).length >= amounts.length * 0.7;
    if (!regular || !stable) continue;
    const last = monthly[monthly.length - 1]!;
    out.push({ key, name: last.description, monthly: last.amount_cents, last: last.occurred_on, count: monthly.length, active: diffDays(today, last.occurred_on) <= 40 });
  }
  return out.sort((a, b) => b.monthly - a.monthly);
}

export function detectWaste(txs: Tx[], today: ISODate): { items: WasteItem[]; subscriptions: Subscription[]; monthly_saving: number } {
  const expenses = txs.filter((t) => t.kind === 'expense' && t.status !== 'cancelled');
  const items: WasteItem[] = [];
  const subs = findSubscriptions(expenses, today);
  const groups = groupBy(expenses);
  const ex = (list: Tx[]) => list.slice(-4).reverse().map(({ id, description, amount_cents, occurred_on }) => ({ id, description, amount_cents, occurred_on }));

  // 1) assinaturas: o que parece serviço por assinatura e ainda cobra
  const services = subs.filter((s) => s.active && SUBSCRIPTION_HINT.test(strip(s.name)));
  if (services.length) {
    const total = services.reduce((s, x) => s + x.monthly, 0);
    const cheapest = Math.min(...services.map((s) => s.monthly));
    items.push({
      id: 'subscriptions',
      kind: 'subscription',
      title: `${services.length} ${services.length === 1 ? 'assinatura ativa' : 'assinaturas ativas'}: ${brl(total)}/mês`,
      detail: `São ${brl(total * 12)} por ano. Vale conferir se usa todas: cancelar a que menos usa${services.length > 1 ? ` (a mais barata custa ${brl(cheapest)})` : ''} já ajuda. Revezar streamings (um por mês) também funciona.`,
      monthly_saving: services.length > 1 ? cheapest : 0,
      examples: services.map((s) => ({ id: s.key, description: s.name, amount_cents: s.monthly, occurred_on: s.last })),
    });
  }

  // 2) contas que subiram: última cobrança recorrente ≥ 10% acima da média das anteriores
  for (const s of subs.filter((x) => x.active)) {
    const list = groups.get(s.key)!;
    const prev = list.slice(-4, -1).map((t) => t.amount_cents);
    if (prev.length < 2) continue;
    const avg = Math.round(prev.reduce((a, b) => a + b, 0) / prev.length);
    const last = list[list.length - 1]!.amount_cents;
    if (last >= avg * 1.1 && last - avg >= 500) {
      const pct = Math.round(((last - avg) / avg) * 100);
      items.push({
        id: `increase-${s.key}`,
        kind: 'increase',
        title: `${s.name} subiu ${pct}%`,
        detail: `Era ${brl(avg)} em média e veio ${brl(last)}. Vale confirmar se foi reajuste, consumo maior ou cobrança indevida — e negociar ou trocar de plano.`,
        monthly_saving: last - avg,
        examples: ex(list),
      });
    }
  }

  // 3) compras repetitivas: muitas compras no mesmo lugar nos últimos 30 dias
  const from30 = addDays(today, -30);
  const subKeys = new Set(subs.map((s) => s.key));
  for (const [key, list] of groups) {
    if (subKeys.has(key)) continue;
    const recent = list.filter((t) => t.occurred_on > from30 && t.occurred_on <= today && !t.recurrence_id);
    const total = recent.reduce((s, t) => s + t.amount_cents, 0);
    if (recent.length >= 5 && total >= 10_000) {
      items.push({
        id: `repeat-${key}`,
        kind: 'repeat',
        title: `${recent.length} compras em ${recent[recent.length - 1]!.description} em 30 dias`,
        detail: `Somaram ${brl(total)} (média de ${brl(Math.round(total / recent.length))} cada). Pequenas compras frequentes pesam: reduzir pela metade economiza cerca de ${brl(Math.round(total / 2))} por mês.`,
        monthly_saving: Math.round(total / 2),
        examples: ex(recent),
      });
    }
  }

  // 4) tarifas, juros e encargos nos últimos 90 dias
  const from90 = addDays(today, -90);
  const fees = expenses.filter((t) => t.occurred_on > from90 && t.occurred_on <= today && FEE.test(strip(t.description)));
  if (fees.length) {
    const total = fees.reduce((s, t) => s + t.amount_cents, 0);
    items.push({
      id: 'fees',
      kind: 'fee',
      title: `${brl(total)} em tarifas, juros e encargos em 90 dias`,
      detail: `Isso dá cerca de ${brl(Math.round((total / 3) * 12))} por ano. Peça isenção de anuidade, troque para uma conta sem tarifa e evite rotativo e cheque especial.`,
      monthly_saving: Math.round(total / 3),
      examples: ex(fees),
    });
  }

  // 5) possível cobrança duplicada: mesma descrição e valor em até 2 dias
  for (const [, list] of groups) {
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1]!;
      const b = list[i]!;
      if (a.amount_cents === b.amount_cents && a.amount_cents >= 1_000 && diffDays(b.occurred_on, a.occurred_on) <= 2 && b.occurred_on > from90 && !a.installment_group_id) {
        items.push({
          id: `dup-${a.id}-${b.id}`,
          kind: 'duplicate',
          title: `Cobrança repetida? ${b.description}`,
          detail: `Dois lançamentos de ${brl(b.amount_cents)} em ${diffDays(b.occurred_on, a.occurred_on) === 0 ? 'um mesmo dia' : 'dias seguidos'}. Se foi cobrado duas vezes, peça o estorno.`,
          monthly_saving: 0,
          examples: ex([a, b]),
        });
        break;
      }
    }
  }

  const order: Record<WasteKind, number> = { duplicate: 0, increase: 1, fee: 2, repeat: 3, subscription: 4 };
  items.sort((a, b) => order[a.kind] - order[b.kind] || b.monthly_saving - a.monthly_saving);
  return { items, subscriptions: subs, monthly_saving: items.reduce((s, i) => s + i.monthly_saving, 0) };
}
