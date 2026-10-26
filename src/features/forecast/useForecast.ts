import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useWsId } from '@/app/WorkspaceProvider';
import { useAccounts, useBalances, useCards, wsKey } from '@/hooks/useFinance';
import { addDays, todayISO } from '@/lib/dates';
import { buildForecast, dailySpending, type Forecast } from '@/domain/forecast';
import { listInvoices } from '@/services/cards';
import { listRecurrences } from '@/services/planning';
import { listOpenCommitments, listPaidExpensesSince, listReceivedIncomesSince } from '@/services/transactions';

/** Previsão do saldo das contas que entram no total (as mesmas do Painel). */
export function useForecast(opts: { withDaily?: boolean } = {}): { data: Forecast | null; isLoading: boolean; error: unknown } {
  const ws = useWsId();
  const today = todayISO();
  const accounts = useAccounts();
  const cards = useCards();
  const balances = useBalances();
  const pending = useQuery({ queryKey: wsKey(ws, 'forecast-pending', today), queryFn: () => listOpenCommitments(ws, addDays(today, 62)) });
  const recurrences = useQuery({ queryKey: wsKey(ws, 'recurrences'), queryFn: () => listRecurrences(ws) });
  const invoices = useQuery({ queryKey: wsKey(ws, 'invoices', 'open'), queryFn: () => listInvoices(ws, { openOnly: true }) });
  const history = useQuery({ queryKey: wsKey(ws, 'forecast-history', today), queryFn: () => listPaidExpensesSince(ws, addDays(today, -60)) });
  const incomes = useQuery({ queryKey: wsKey(ws, 'forecast-incomes', today), queryFn: () => listReceivedIncomesSince(ws, addDays(today, -120)) });
  const withDaily = opts.withDaily ?? true;

  const queries = [accounts, cards, balances, pending, recurrences, invoices, history, incomes];
  const data = useMemo(() => {
    if (queries.some((q) => !q.data)) return null;
    const included = new Set((accounts.data ?? []).filter((a) => a.include_in_total && !a.archived).map((a) => a.id));
    const balance = (balances.data ?? []).filter((b) => included.has(b.account_id)).reduce((s, b) => s + Number(b.current_balance_cents), 0);
    // fatura paga por conta do total (ou sem conta padrão: entra também, alguém vai pagar)
    const cardIds = new Set((cards.data ?? []).filter((c) => !c.archived && (!c.default_payment_account_id || included.has(c.default_payment_account_id))).map((c) => c.id));
    return buildForecast({
      today,
      balance,
      pending: pending.data!,
      recurrences: recurrences.data!,
      invoices: invoices.data!,
      cardIds,
      accountIds: included,
      dailySpend: withDaily ? dailySpending(history.data!, today) : 0,
      incomeHistory: incomes.data!,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today, withDaily, ...queries.map((q) => q.data)]);
  return { data, isLoading: queries.some((q) => q.isLoading), error: queries.find((q) => q.error)?.error ?? null };
}
