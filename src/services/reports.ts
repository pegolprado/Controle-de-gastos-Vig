import { supabase } from '@/lib/supabase';
import type { CategoryTotal, MonthlyRow, Transaction } from '@/lib/types';
import { unwrapList } from './base';

export interface ReportFilters {
  accountId?: string | null;
  cardId?: string | null;
  categoryId?: string | null;
  userId?: string | null;
}

export async function reportMonthly(ws: string, from: string, to: string, f: ReportFilters = {}): Promise<MonthlyRow[]> {
  const rows = unwrapList<MonthlyRow>(
    await supabase.rpc('report_monthly', {
      p_workspace: ws, p_from: from, p_to: to,
      p_account: f.accountId ?? null, p_card: f.cardId ?? null, p_category: f.categoryId ?? null, p_user: f.userId ?? null,
    }),
  );
  return rows.map((r) => ({
    ...r,
    income_cents: Number(r.income_cents), expense_cents: Number(r.expense_cents),
    income_realized_cents: Number(r.income_realized_cents), expense_realized_cents: Number(r.expense_realized_cents),
    fixed_expense_cents: Number(r.fixed_expense_cents), variable_expense_cents: Number(r.variable_expense_cents),
  }));
}

export async function reportCategories(ws: string, from: string, to: string, kind: 'income' | 'expense' = 'expense', f: ReportFilters = {}): Promise<CategoryTotal[]> {
  const rows = unwrapList<CategoryTotal>(
    await supabase.rpc('report_categories', {
      p_workspace: ws, p_from: from, p_to: to, p_kind: kind,
      p_account: f.accountId ?? null, p_card: f.cardId ?? null, p_user: f.userId ?? null,
    }),
  );
  return rows.map((r) => ({ ...r, total_cents: Number(r.total_cents), items: Number(r.items) }));
}

export async function topExpenses(ws: string, from: string, to: string, f: ReportFilters = {}, limit = 10): Promise<Transaction[]> {
  let q = supabase
    .from('transactions')
    .select('*')
    .eq('workspace_id', ws)
    .eq('kind', 'expense')
    .neq('status', 'cancelled')
    .gte('occurred_on', from)
    .lte('occurred_on', to);
  if (f.accountId) q = q.eq('account_id', f.accountId);
  if (f.cardId) q = q.eq('card_id', f.cardId);
  if (f.userId) q = q.eq('created_by', f.userId);
  return unwrapList(await q.order('amount_cents', { ascending: false }).limit(limit));
}

export async function upcomingCommitments(ws: string, from: string, to: string) {
  return unwrapList<Transaction>(
    await supabase
      .from('transactions')
      .select('*')
      .eq('workspace_id', ws)
      .in('status', ['planned', 'pending'])
      .gte('due_on', from)
      .lte('due_on', to)
      .order('due_on')
      .limit(500),
  );
}
