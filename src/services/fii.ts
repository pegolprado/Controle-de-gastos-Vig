import { supabase } from '@/lib/supabase';
import type { AssetQuote, AssetType, FiiDistribution, FiiFund, FiiPosition, FiiTrade, RendaSettings, StockCompany, StockDistribution } from '@/lib/types';
import { addDays, todayISO } from '@/lib/dates';
import { unwrap, unwrapList } from './base';

export type FiiSyncResult = 'ok' | 'cached' | 'not_found' | 'unavailable';

export async function listFiiPositions(ws: string): Promise<FiiPosition[]> {
  return unwrapList(await supabase.from('fii_positions').select('*').eq('workspace_id', ws).order('ticker')) as FiiPosition[];
}

export async function listFiiTrades(ws: string): Promise<FiiTrade[]> {
  return unwrapList(
    await supabase.from('fii_trades').select('*').eq('workspace_id', ws).order('trade_date', { ascending: true, nullsFirst: true }),
  ) as FiiTrade[];
}

/** Novo ativo na carteira com a primeira operação (data null = "já tinha antes"). */
export async function createPosition(
  ws: string,
  p: { ticker: string; asset_type: AssetType; quantity: number; trade_date: string | null; price_cents: number | null },
) {
  const pos = unwrap(
    await supabase.from('fii_positions').insert({ workspace_id: ws, ticker: p.ticker, asset_type: p.asset_type, quantity: 0 }).select().single(),
  ) as FiiPosition;
  try {
    await addTrade(ws, pos.id, { trade_date: p.trade_date, quantity: p.quantity, price_cents: p.price_cents });
  } catch (e) {
    await supabase.from('fii_positions').delete().eq('id', pos.id);
    throw e;
  }
  return pos;
}

export async function addTrade(ws: string, positionId: string, t: { trade_date: string | null; quantity: number; price_cents: number | null }) {
  return unwrap(
    await supabase.from('fii_trades').insert({ workspace_id: ws, position_id: positionId, ...t }).select().single(),
  ) as FiiTrade;
}

export async function deleteTrade(id: string) {
  unwrapList(await supabase.from('fii_trades').delete().eq('id', id).select('id'));
}

export async function deleteFiiPosition(id: string) {
  unwrapList(await supabase.from('fii_positions').delete().eq('id', id).select('id'));
}

/** Pede ao servidor para atualizar proventos (cache 6 h) e cotação (cache 20 min) na B3. */
export async function syncAsset(ticker: string, type: AssetType, force = false): Promise<FiiSyncResult> {
  return unwrap(await supabase.rpc('asset_sync', { p_ticker: ticker, p_type: type, p_force: force })) as FiiSyncResult;
}

export interface RendaMarket {
  funds: FiiFund[];
  companies: StockCompany[];
  dists: Array<FiiDistribution | StockDistribution>;
  quotes: AssetQuote[];
}

/** Proventos dos últimos ~13 meses e futuros, cadastro dos ativos e cotações. */
export async function listRendaMarket(positions: Array<Pick<FiiPosition, 'ticker' | 'asset_type'>>): Promise<RendaMarket> {
  const fiiCodes = [...new Set(positions.filter((p) => p.asset_type !== 'stock').map((p) => p.ticker.slice(0, 4)))];
  const stockCodes = [...new Set(positions.filter((p) => p.asset_type === 'stock').map((p) => p.ticker.slice(0, 4)))];
  const tickers = positions.map((p) => p.ticker);
  const since = addDays(todayISO(), -400);
  const none = Promise.resolve({ data: [], error: null });
  const [funds, fd, companies, sd, quotes] = await Promise.all([
    fiiCodes.length ? supabase.from('fii_funds').select('*').in('code', fiiCodes) : none,
    fiiCodes.length ? supabase.from('fii_distributions').select('*').in('code', fiiCodes).gte('payment_date', since).limit(5000) : none,
    stockCodes.length ? supabase.from('stock_companies').select('*').in('code', stockCodes) : none,
    stockCodes.length
      ? supabase.from('stock_distributions').select('code, isin, kind, record_date, payment_date, approved_on, rate, related_to').in('code', stockCodes).or(`payment_date.gte.${since},payment_date.is.null`).limit(5000)
      : none,
    tickers.length ? supabase.from('asset_quotes').select('*').in('ticker', tickers) : none,
  ]);
  const num = <T extends { rate: number }>(rows: T[]) => rows.map((d) => ({ ...d, rate: Number(d.rate) }));
  return {
    funds: unwrapList(funds) as FiiFund[],
    companies: unwrapList(companies) as StockCompany[],
    dists: [...num(unwrapList(fd) as FiiDistribution[]), ...num(unwrapList(sd) as StockDistribution[])],
    quotes: (unwrapList(quotes) as AssetQuote[]).map((q) => ({ ...q, price: Number(q.price), change_pct: q.change_pct === null ? null : Number(q.change_pct) })),
  };
}

export async function getRendaSettings(ws: string): Promise<RendaSettings | null> {
  const rows = unwrapList(await supabase.from('renda_settings').select('*').eq('workspace_id', ws).limit(1)) as RendaSettings[];
  return rows[0] ?? null;
}

export async function saveRendaSettings(ws: string, patch: Partial<Omit<RendaSettings, 'workspace_id'>>) {
  return unwrap(
    await supabase.from('renda_settings').upsert({ workspace_id: ws, ...patch }, { onConflict: 'workspace_id' }).select().single(),
  ) as RendaSettings;
}

/** Lança os proventos anunciados e marca como recebidos os que já caíram (se o piloto estiver ligado). */
export async function runAutopilot(ws: string): Promise<number> {
  return unwrap(await supabase.rpc('renda_autopilot', { p_workspace: ws })) as number;
}
