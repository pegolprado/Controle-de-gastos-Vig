import { supabase } from '@/lib/supabase';
import type { CardLimit, CreditCard, InvoiceSummary, Transaction } from '@/lib/types';
import { unwrap, unwrapList } from './base';

export async function listCards(ws: string): Promise<CreditCard[]> {
  return unwrapList(await supabase.from('credit_cards').select('*').eq('workspace_id', ws).order('archived').order('name'));
}

export async function listCardLimits(ws: string): Promise<CardLimit[]> {
  return unwrapList(await supabase.from('card_limits').select('*').eq('workspace_id', ws));
}

export async function listInvoices(ws: string, opts: { cardId?: string; from?: string; to?: string; openOnly?: boolean } = {}): Promise<InvoiceSummary[]> {
  let q = supabase.from('card_invoice_summary').select('*').eq('workspace_id', ws);
  if (opts.cardId) q = q.eq('card_id', opts.cardId);
  if (opts.from) q = q.gte('reference_month', opts.from);
  if (opts.to) q = q.lte('reference_month', opts.to);
  if (opts.openOnly) q = q.neq('status', 'paid');
  return unwrapList(await q.order('reference_month', { ascending: true }));
}

export async function listInvoiceItems(invoiceId: string): Promise<Transaction[]> {
  return unwrapList(
    await supabase.from('transactions').select('*').eq('invoice_id', invoiceId).order('occurred_on', { ascending: false }).order('created_at', { ascending: false }),
  );
}

export interface CardInput {
  name: string;
  brand: string | null;
  last_digits: string | null;
  limit_cents: number;
  closing_day: number;
  due_day: number;
  color: string;
  default_payment_account_id: string | null;
}

export async function createCard(ws: string, input: CardInput) {
  return unwrap(await supabase.from('credit_cards').insert({ ...input, workspace_id: ws }).select().single());
}

export async function updateCard(id: string, patch: Partial<CardInput> & { archived?: boolean }) {
  return unwrap(await supabase.from('credit_cards').update(patch).eq('id', id).select().single());
}

export async function deleteCard(id: string) {
  unwrap(await supabase.from('credit_cards').delete().eq('id', id));
}
