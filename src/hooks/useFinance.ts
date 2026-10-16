import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useWsId } from '@/app/WorkspaceProvider';
import { listAccounts, listBalances } from '@/services/accounts';
import { listCategories } from '@/services/categories';
import { listCardLimits, listCards, listInvoices } from '@/services/cards';
import type { Account, AccountBalance, Category, CreditCard } from '@/lib/types';

export const wsKey = (ws: string, ...parts: unknown[]) => ['ws', ws, ...parts] as const;

export function useAccounts() {
  const ws = useWsId();
  return useQuery({ queryKey: wsKey(ws, 'accounts'), queryFn: () => listAccounts(ws), enabled: Boolean(ws), staleTime: 60_000 });
}

export function useBalances() {
  const ws = useWsId();
  return useQuery({ queryKey: wsKey(ws, 'balances'), queryFn: () => listBalances(ws), enabled: Boolean(ws) });
}

export function useCategories() {
  const ws = useWsId();
  return useQuery({ queryKey: wsKey(ws, 'categories'), queryFn: () => listCategories(ws), enabled: Boolean(ws), staleTime: 5 * 60_000 });
}

export function useCards() {
  const ws = useWsId();
  return useQuery({ queryKey: wsKey(ws, 'cards'), queryFn: () => listCards(ws), enabled: Boolean(ws), staleTime: 60_000 });
}

export function useCardLimits() {
  const ws = useWsId();
  return useQuery({ queryKey: wsKey(ws, 'card-limits'), queryFn: () => listCardLimits(ws), enabled: Boolean(ws) });
}

export function useOpenInvoices() {
  const ws = useWsId();
  return useQuery({ queryKey: wsKey(ws, 'invoices', 'open'), queryFn: () => listInvoices(ws, { openOnly: true }), enabled: Boolean(ws) });
}

/** Mapas de consulta rápida por id (evita buscas lineares em listas). */
export function useLookups() {
  const accounts = useAccounts();
  const categories = useCategories();
  const cards = useCards();
  const balances = useBalances();
  return useMemo(() => {
    const accountMap = new Map<string, Account>((accounts.data ?? []).map((a) => [a.id, a]));
    const categoryMap = new Map<string, Category>((categories.data ?? []).map((c) => [c.id, c]));
    const cardMap = new Map<string, CreditCard>((cards.data ?? []).map((c) => [c.id, c]));
    const balanceMap = new Map<string, AccountBalance>((balances.data ?? []).map((b) => [b.account_id, b]));
    const topCategory = (id: string | null | undefined) => {
      if (!id) return undefined;
      const c = categoryMap.get(id);
      return c?.parent_id ? categoryMap.get(c.parent_id) : c;
    };
    return {
      accounts: accounts.data ?? [],
      categories: categories.data ?? [],
      cards: cards.data ?? [],
      accountMap,
      categoryMap,
      cardMap,
      balanceMap,
      topCategory,
      loading: accounts.isLoading || categories.isLoading || cards.isLoading,
    };
  }, [accounts.data, categories.data, cards.data, balances.data, accounts.isLoading, categories.isLoading, cards.isLoading]);
}
