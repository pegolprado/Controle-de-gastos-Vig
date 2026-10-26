import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useWsId } from '@/app/WorkspaceProvider';
import { wsKey } from '@/hooks/useFinance';
import { addMonths, startOfMonth, todayISO } from '@/lib/dates';
import { capacity } from '@/domain/goals';
import { reportMonthly } from '@/services/reports';

/** Sobra mensal média (receitas − despesas dos últimos meses completos). */
export function useCapacity() {
  const ws = useWsId();
  const today = todayISO();
  const q = useQuery({
    queryKey: wsKey(ws, 'report-monthly', 'goals', startOfMonth(today)),
    queryFn: () => reportMonthly(ws, addMonths(startOfMonth(today), -6), startOfMonth(today)),
    staleTime: 10 * 60_000,
  });
  return useMemo(() => (q.data ? capacity(q.data, today) : null), [q.data, today]);
}
