import { supabase } from '@/lib/supabase';
import type { BudgetProgress, Goal, PaymentMethod, Recurrence, RecurrenceFreq, RecurrenceStatus } from '@/lib/types';
import { unwrap, unwrapList } from './base';

// ---------------------------------------------------------------- recorrências
export async function listRecurrences(ws: string): Promise<Recurrence[]> {
  return unwrapList(await supabase.from('recurrences').select('*').eq('workspace_id', ws).order('status').order('description'));
}

export interface RecurrenceInput {
  kind: 'income' | 'expense';
  description: string;
  amount_cents: number;
  category_id: string | null;
  account_id: string | null;
  card_id: string | null;
  payment_method: PaymentMethod | null;
  frequency: RecurrenceFreq;
  interval_count: number;
  start_date: string;
  end_date: string | null;
  notes: string | null;
}

/** Idempotente: reenvio com a mesma requestId devolve a recorrência já criada. */
export async function createRecurrence(ws: string, input: RecurrenceInput, requestId?: string): Promise<Recurrence> {
  const res = await supabase.from('recurrences').insert({ ...input, workspace_id: ws, client_request_id: requestId ?? null }).select().single();
  let rec: Recurrence;
  if (res.error?.code === '23505' && requestId) {
    rec = unwrap(await supabase.from('recurrences').select('*').eq('workspace_id', ws).eq('client_request_id', requestId).single()) as Recurrence;
  } else {
    rec = unwrap(res) as Recurrence;
  }
  await generateRecurrences(ws);
  return rec;
}

/** Marca uma ocorrência gerada como liquidada (ex.: a primeira, já paga no cadastro). */
export async function settleOccurrence(recurrenceId: string, date: string, status: 'paid' | 'received') {
  unwrap(await supabase.from('transactions').update({ status }).eq('recurrence_id', recurrenceId).eq('recurrence_date', date));
}

export async function updateRecurrence(id: string, changes: Partial<RecurrenceInput>, applyFrom: string | null) {
  return unwrap(await supabase.rpc('update_recurrence', { p_recurrence: id, p_changes: changes, p_apply_from: applyFrom }));
}

export async function setRecurrenceStatus(id: string, status: RecurrenceStatus, removeFuture = false) {
  unwrap(await supabase.rpc('set_recurrence_status', { p_recurrence: id, p_status: status, p_remove_future: removeFuture }));
}

export async function deleteRecurrence(id: string) {
  unwrap(await supabase.from('recurrences').delete().eq('id', id));
}

/** Idempotente: pode ser chamado a cada abertura do app sem duplicar nada. */
export async function generateRecurrences(ws: string): Promise<number> {
  return (unwrap(await supabase.rpc('generate_recurrences', { p_workspace: ws })) as number) ?? 0;
}

// ---------------------------------------------------------------- orçamentos
export async function budgetProgress(ws: string, month: string): Promise<BudgetProgress[]> {
  return unwrapList(await supabase.rpc('budget_progress', { p_workspace: ws, p_month: month }));
}

export async function upsertBudget(ws: string, p: { category_id: string; month: string; limit_cents: number; alert_thresholds: number[] }) {
  return unwrap(
    await supabase.from('budgets').upsert({ ...p, workspace_id: ws }, { onConflict: 'workspace_id,category_id,month' }).select().single(),
  );
}

export async function deleteBudget(id: string) {
  unwrap(await supabase.from('budgets').delete().eq('id', id));
}

export async function copyBudgets(ws: string, from: string, to: string): Promise<number> {
  return unwrap(await supabase.rpc('copy_budgets', { p_workspace: ws, p_from: from, p_to: to })) as number;
}

// ---------------------------------------------------------------- metas
export async function listGoals(ws: string): Promise<Goal[]> {
  return unwrapList(await supabase.from('goal_progress').select('*').eq('workspace_id', ws).order('archived').order('created_at'));
}

export async function createGoal(ws: string, p: { name: string; target_cents: number; deadline: string | null; color: string; icon?: string }) {
  return unwrap(await supabase.from('goals').insert({ ...p, workspace_id: ws }).select().single());
}

export async function updateGoal(id: string, p: Partial<{ name: string; target_cents: number; deadline: string | null; color: string; icon: string; archived: boolean }>) {
  return unwrap(await supabase.from('goals').update(p).eq('id', id).select().single());
}

export async function deleteGoal(id: string) {
  unwrap(await supabase.from('goals').delete().eq('id', id));
}

export async function addContribution(ws: string, goalId: string, amount_cents: number, contributed_on: string, requestId: string) {
  const res = await supabase
    .from('goal_contributions')
    .insert({ workspace_id: ws, goal_id: goalId, amount_cents, contributed_on, client_request_id: requestId });
  if (res.error && res.error.code !== '23505') throw res.error;
}

export async function listContributions(goalId: string) {
  return unwrapList(await supabase.from('goal_contributions').select('*').eq('goal_id', goalId).order('contributed_on', { ascending: false }).limit(50));
}
