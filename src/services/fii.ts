import { supabase } from '@/lib/supabase';
import type { FiiDistribution, FiiFund, FiiPosition } from '@/lib/types';
import { addDays, todayISO } from '@/lib/dates';
import { unwrap, unwrapList } from './base';

export type FiiSyncResult = 'ok' | 'cached' | 'not_found' | 'unavailable';

export async function listFiiPositions(ws: string): Promise<FiiPosition[]> {
  return unwrapList(await supabase.from('fii_positions').select('*').eq('workspace_id', ws).order('ticker')) as FiiPosition[];
}

export async function saveFiiPosition(ws: string, p: { id?: string; ticker: string; quantity: number; avg_price_cents: number | null }) {
  if (p.id) {
    return unwrap(await supabase.from('fii_positions').update({ quantity: p.quantity, avg_price_cents: p.avg_price_cents }).eq('id', p.id).select().single()) as FiiPosition;
  }
  return unwrap(await supabase.from('fii_positions').insert({ workspace_id: ws, ticker: p.ticker, quantity: p.quantity, avg_price_cents: p.avg_price_cents }).select().single()) as FiiPosition;
}

export async function deleteFiiPosition(id: string) {
  unwrapList(await supabase.from('fii_positions').delete().eq('id', id).select('id'));
}

/** Pede ao servidor para atualizar os proventos do fundo na B3 (com cache de 6 h). */
export async function syncFii(ticker: string, force = false): Promise<FiiSyncResult> {
  return unwrap(await supabase.rpc('fii_sync', { p_ticker: ticker, p_force: force })) as FiiSyncResult;
}

/** Proventos dos últimos ~13 meses e futuros, mais o cadastro dos fundos. */
export async function listFiiMarket(codes: string[]): Promise<{ funds: FiiFund[]; dists: FiiDistribution[] }> {
  if (!codes.length) return { funds: [], dists: [] };
  const [funds, dists] = await Promise.all([
    supabase.from('fii_funds').select('*').in('code', codes),
    supabase.from('fii_distributions').select('*').in('code', codes).gte('payment_date', addDays(todayISO(), -400)).order('payment_date', { ascending: false }).limit(5000),
  ]);
  return { funds: unwrapList(funds) as FiiFund[], dists: (unwrapList(dists) as FiiDistribution[]).map((d) => ({ ...d, rate: Number(d.rate) })) };
}
