import { supabase } from '@/lib/supabase';
import type { Account, AccountBalance, AccountType } from '@/lib/types';
import { unwrap, unwrapList } from './base';

export async function listAccounts(ws: string): Promise<Account[]> {
  return unwrapList(await supabase.from('accounts').select('*').eq('workspace_id', ws).order('archived').order('sort_order').order('name'));
}

export async function listBalances(ws: string): Promise<AccountBalance[]> {
  return unwrapList(await supabase.from('account_balances').select('*').eq('workspace_id', ws));
}

export interface AccountInput {
  name: string;
  type: AccountType;
  institution?: string | null;
  initial_balance_cents: number;
  color: string;
  include_in_total: boolean;
}

export async function createAccount(ws: string, input: AccountInput) {
  return unwrap(await supabase.from('accounts').insert({ ...input, workspace_id: ws }).select().single());
}

export async function updateAccount(id: string, patch: Partial<AccountInput> & { archived?: boolean }) {
  return unwrap(await supabase.from('accounts').update(patch).eq('id', id).select().single());
}

export async function deleteAccount(id: string) {
  unwrap(await supabase.from('accounts').delete().eq('id', id));
}
