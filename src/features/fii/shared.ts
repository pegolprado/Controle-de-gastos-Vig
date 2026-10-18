import { useEffect, useState } from 'react';
import { todayISO } from '@/lib/dates';
import { stableUUID } from '@/lib/id';
import type { AssetType } from '@/lib/types';
import type { FiiPayment } from '@/domain/fii';

export const fmtRate = (rate: number) => `R$ ${rate.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;

export const unitLabel = (type: AssetType | undefined, n: number) =>
  type === 'stock' ? (n === 1 ? 'ação' : 'ações') : n === 1 ? 'cota' : 'cotas';

/**
 * Chave de idempotência do lançamento de um provento. A mesma fórmula é usada pelo
 * piloto automático no banco (public.stable_uuid): lançar à mão e no automático não duplica.
 */
export const launchId = (ws: string, p: FiiPayment) =>
  stableUUID(`finance-mv-fii|${ws}|${p.ticker}|${p.dist.isin}|${p.dist.kind}|${p.dist.payment_date}`);

/** Data de hoje que se atualiza sozinha na virada do dia (app aberto ou voltando do segundo plano). */
export function useToday() {
  const [today, setToday] = useState(todayISO);
  useEffect(() => {
    const check = () => setToday((t) => (t === todayISO() ? t : todayISO()));
    const id = window.setInterval(check, 60_000);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);
  return today;
}
