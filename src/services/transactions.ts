import { supabase } from '@/lib/supabase';
import type { PaymentMethod, Settlement, Transaction, TxKind, TxStatus } from '@/lib/types';
import { unwrap, unwrapList } from './base';

export const PAGE_SIZE = 40;

export interface TxFilters {
  from?: string;
  to?: string;
  kind?: TxKind | '';
  status?: TxStatus | 'open' | '';
  accountId?: string;
  cardId?: string;
  categoryIds?: string[];
  search?: string;
  /** IDs de categorias/contas cujos nomes casam com a busca (resolvidos no cliente) */
  searchCategoryIds?: string[];
  searchAccountIds?: string[];
  tag?: string;
  createdBy?: string;
}

function escapeLike(s: string) {
  return s.replace(/[%_\\,()]/g, (c) => `\\${c}`);
}

function applyFilters<Q>(query: Q, ws: string, f: TxFilters): Q {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = (query as any).eq('workspace_id', ws);
  if (f.from) q = q.gte('occurred_on', f.from);
  if (f.to) q = q.lte('occurred_on', f.to);
  if (f.kind) q = q.eq('kind', f.kind);
  if (f.status === 'open') q = q.in('status', ['planned', 'pending']);
  else if (f.status) q = q.eq('status', f.status);
  if (f.accountId) q = q.or(`account_id.eq.${f.accountId},destination_account_id.eq.${f.accountId}`);
  if (f.cardId) q = q.eq('card_id', f.cardId);
  if (f.categoryIds?.length) q = q.in('category_id', f.categoryIds);
  if (f.tag) q = q.contains('tags', [f.tag]);
  if (f.createdBy) q = q.eq('created_by', f.createdBy);
  if (f.search?.trim()) {
    const s = f.search.trim();
    const parts = [`description.ilike.%${escapeLike(s)}%`, `notes.ilike.%${escapeLike(s)}%`];
    const asMoney = /^\d+([.,]\d{1,2})?$/.test(s) ? Math.round(Number(s.replace(',', '.')) * 100) : null;
    if (asMoney) parts.push(`amount_cents.eq.${asMoney}`);
    const dateMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
    if (dateMatch) parts.push(`occurred_on.eq.${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`);
    if (f.searchCategoryIds?.length) parts.push(`category_id.in.(${f.searchCategoryIds.join(',')})`);
    if (f.searchAccountIds?.length) parts.push(`account_id.in.(${f.searchAccountIds.join(',')})`);
    q = q.or(parts.join(','));
  }
  return q as Q;
}

export async function listTransactions(ws: string, f: TxFilters, page: number): Promise<{ rows: Transaction[]; hasMore: boolean }> {
  const from = page * PAGE_SIZE;
  const q = applyFilters(supabase.from('transactions').select('*'), ws, f)
    .order('occurred_on', { ascending: false })
    .order('created_at', { ascending: false })
    .range(from, from + PAGE_SIZE);
  const rows = unwrapList<Transaction>(await q);
  return { rows: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE };
}

/** Todos os registros (paginado em lotes) — usado em exportações. */
export async function listAllTransactions(ws: string, f: TxFilters, max = 20000): Promise<Transaction[]> {
  const out: Transaction[] = [];
  const batch = 1000;
  for (let offset = 0; offset < max; offset += batch) {
    const rows = unwrapList<Transaction>(
      await applyFilters(supabase.from('transactions').select('*'), ws, f)
        .order('occurred_on', { ascending: true })
        .order('created_at', { ascending: true })
        .range(offset, offset + batch - 1),
    );
    out.push(...rows);
    if (rows.length < batch) break;
  }
  return out;
}

export async function getTransaction(id: string): Promise<Transaction> {
  return unwrap(await supabase.from('transactions').select('*').eq('id', id).single()) as Transaction;
}

export interface TxInput {
  kind: TxKind;
  status: TxStatus;
  description: string;
  amount_cents: number;
  occurred_on: string;
  due_on: string | null;
  category_id: string | null;
  account_id: string | null;
  destination_account_id: string | null;
  card_id: string | null;
  invoice_id?: string | null;
  payment_method: PaymentMethod | null;
  tags: string[];
  notes: string | null;
  attachment_path?: string | null;
}

/**
 * Criação idempotente: a mesma client_request_id nunca gera dois lançamentos,
 * mesmo com cliques repetidos, reenvio após timeout ou queda de conexão.
 */
export async function createTransaction(ws: string, input: TxInput, requestId: string): Promise<Transaction> {
  const res = await supabase
    .from('transactions')
    .insert({ ...input, workspace_id: ws, client_request_id: requestId })
    .select()
    .single();
  if (res.error?.code === '23505' && /client_request_id/.test(res.error.message + (res.error.details ?? ''))) {
    return unwrap(
      await supabase.from('transactions').select('*').eq('workspace_id', ws).eq('client_request_id', requestId).single(),
    ) as Transaction;
  }
  return unwrap(res) as Transaction;
}

export async function updateTransaction(id: string, patch: Partial<TxInput>): Promise<Transaction> {
  return unwrap(await supabase.from('transactions').update(patch).eq('id', id).select().single()) as Transaction;
}

export async function deleteTransaction(id: string) {
  const res = await supabase.from('transactions').delete().eq('id', id).select('id');
  const rows = unwrapList(res);
  if (rows.length === 0) throw Object.assign(new Error('Você não tem permissão para excluir este lançamento.'), { code: '42501' });
}

export async function createInstallments(
  ws: string,
  p: {
    description: string;
    total_cents: number;
    installments: number;
    purchase_date: string;
    card_id: string | null;
    account_id: string | null;
    category_id: string | null;
    tags: string[];
    notes: string | null;
    first_status: TxStatus;
  },
  requestId: string,
): Promise<string> {
  return unwrap(
    await supabase.rpc('create_installment_purchase', {
      p_workspace: ws,
      p_description: p.description,
      p_total_cents: p.total_cents,
      p_installments: p.installments,
      p_purchase_date: p.purchase_date,
      p_card_id: p.card_id,
      p_account_id: p.account_id,
      p_category_id: p.category_id,
      p_tags: p.tags,
      p_notes: p.notes,
      p_client_request_id: requestId,
      p_first_status: p.first_status,
    }),
  ) as string;
}

export async function deleteInstallmentGroup(groupId: string) {
  unwrap(await supabase.from('installment_groups').delete().eq('id', groupId));
}

export async function settleTransaction(
  id: string,
  p: { principal_cents: number; interest_cents: number; discount_cents: number; paid_on: string; notes?: string | null },
  requestId: string,
) {
  return unwrap(
    await supabase.rpc('settle_transaction', {
      p_transaction: id,
      p_principal_cents: p.principal_cents,
      p_interest_cents: p.interest_cents,
      p_discount_cents: p.discount_cents,
      p_paid_on: p.paid_on,
      p_notes: p.notes ?? null,
      p_client_request_id: requestId,
    }),
  );
}

export async function listSettlements(txId: string): Promise<Settlement[]> {
  return unwrapList(await supabase.from('tx_settlements').select('*').eq('transaction_id', txId).order('paid_on'));
}

export async function undoSettlement(id: string) {
  unwrap(await supabase.rpc('undo_settlement', { p_settlement: id }));
}

export interface AuditEntry {
  id: number;
  actor_id: string | null;
  action: string;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  created_at: string;
}

export async function listHistory(recordId: string): Promise<AuditEntry[]> {
  return unwrapList(
    await supabase.from('audit_log').select('id, actor_id, action, old_data, new_data, created_at').eq('record_id', recordId).order('created_at', { ascending: false }).limit(50),
  );
}

export async function listDueChanges(txId: string) {
  return unwrapList(await supabase.from('tx_due_changes').select('*').eq('transaction_id', txId).order('changed_at', { ascending: false }));
}

/** Contas a pagar/receber em aberto até uma data. */
export async function listOpenCommitments(ws: string, until: string): Promise<Transaction[]> {
  return unwrapList(
    await supabase
      .from('transactions')
      .select('*')
      .eq('workspace_id', ws)
      .in('kind', ['income', 'expense'])
      .in('status', ['planned', 'pending'])
      .not('account_id', 'is', null)
      .lte('due_on', until)
      .order('due_on')
      .limit(500),
  );
}

export async function listRecentlySettled(ws: string, since: string): Promise<Transaction[]> {
  return unwrapList(
    await supabase
      .from('transactions')
      .select('*')
      .eq('workspace_id', ws)
      .in('kind', ['income', 'expense'])
      .in('status', ['paid', 'received'])
      .not('due_on', 'is', null)
      .gte('updated_at', since)
      .order('updated_at', { ascending: false })
      .limit(100),
  );
}

export async function uploadReceipt(ws: string, txId: string, file: File): Promise<string> {
  const safe = file.name.normalize('NFD').replace(/[^\w.-]+/g, '_').slice(-80);
  const path = `${ws}/${txId}/${Date.now()}_${safe}`;
  const { error } = await supabase.storage.from('receipts').upload(path, file, { upsert: false, contentType: file.type });
  if (error) throw error;
  await updateTransaction(txId, { attachment_path: path });
  return path;
}

export async function receiptUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('receipts').createSignedUrl(path, 120);
  if (error) throw error;
  return data.signedUrl;
}

export async function removeReceipt(txId: string, path: string) {
  await supabase.storage.from('receipts').remove([path]);
  await updateTransaction(txId, { attachment_path: null });
}
