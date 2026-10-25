import { descriptionKey } from '@/lib/statement';
import type { Account, Category, CreditCard, TxKind } from '@/lib/types';
import { CATEGORY_PARENT, type QuickEntry } from '@/domain/quickEntry';

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export type CategoryHint = { description: string; category_id: string | null; kind: TxKind };

/** Categoria aprendida com lançamentos anteriores de mesma descrição. */
export function historyCategory(description: string, kind: TxKind, categories: Category[], hints: CategoryHint[] | undefined): string {
  const typed = descriptionKey(description);
  if (typed.length < 3 || !hints) return '';
  const valid = (id: string | null) => !!id && categories.some((c) => c.id === id && c.kind === kind && !c.archived);
  const same = hints.filter((h) => h.kind === kind && valid(h.category_id));
  const exact = same.find((h) => descriptionKey(h.description) === typed);
  const partial = typed.length >= 4 ? same.find((h) => { const k = descriptionKey(h.description); return k.startsWith(typed) || (k.length >= 4 && typed.startsWith(k)); }) : undefined;
  return (exact ?? partial)?.category_id ?? '';
}

/** Categoria de um lançamento rápido: histórico primeiro, depois palavras-chave (subcategoria ou a principal). */
export function quickCategory(q: QuickEntry, categories: Category[], hints: CategoryHint[] | undefined): string {
  const fromHistory = historyCategory(q.description, q.kind, categories, hints);
  if (fromHistory) return fromHistory;
  const named = (name: string | undefined) => (name ? categories.find((c) => c.kind === q.kind && !c.archived && norm(c.name) === norm(name))?.id ?? '' : '');
  return q.categoryName ? named(q.categoryName) || named(CATEGORY_PARENT[q.categoryName]) : '';
}

/** De onde sai o dinheiro: cartão (citado, "no crédito" ou parcelado) ou conta (citada ou a principal). */
export function quickSource(q: QuickEntry, accounts: Account[], cards: CreditCard[]) {
  const activeAccounts = accounts.filter((a) => !a.archived);
  const activeCards = cards.filter((c) => !c.archived);
  const card = q.sourceName ? activeCards.find((c) => norm(c.name) === norm(q.sourceName!)) : undefined;
  const account = q.sourceName ? activeAccounts.find((a) => norm(a.name) === norm(q.sourceName!)) : undefined;
  const useCard = q.kind === 'expense' && activeCards.length > 0 && (Boolean(card) || q.credit || q.installments > 1);
  return {
    useCard,
    card: card ?? (useCard ? activeCards[0] : undefined),
    account: account ?? activeAccounts[0],
  };
}
