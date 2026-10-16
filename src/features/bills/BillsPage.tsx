import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarCheck, CalendarClock, Check, Plus } from 'lucide-react';
import { useWorkspace, useWsId } from '@/app/WorkspaceProvider';
import { useLookups, useOpenInvoices, wsKey } from '@/hooks/useFinance';
import { useQuickAdd } from '@/features/transactions/QuickAdd';
import { TransactionDetail } from '@/features/transactions/TransactionDetail';
import { SettleDialog } from '@/features/transactions/SettleDialog';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState, ErrorState, Skeleton } from '@/components/ui/Card';
import { Money } from '@/components/ui/Money';
import { addDays, formatDate, relativeDay, todayISO } from '@/lib/dates';
import { invalidateFinance } from '@/lib/queryClient';
import { cn } from '@/lib/cn';
import type { Transaction } from '@/lib/types';
import { listOpenCommitments, listRecentlySettled } from '@/services/transactions';

type Tab = 'overdue' | 'today' | 'week' | 'month' | 'income' | 'paid';

export default function BillsPage() {
  const ws = useWsId();
  const { canContribute } = useWorkspace();
  const { accountMap, cardMap } = useLookups();
  const quickAdd = useQuickAdd();
  const today = todayISO();
  const [tab, setTab] = useState<Tab>('overdue');
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [settling, setSettling] = useState<Transaction | null>(null);

  const open = useQuery({ queryKey: wsKey(ws, 'commitments', today), queryFn: () => listOpenCommitments(ws, addDays(today, 30)) });
  const paid = useQuery({ queryKey: wsKey(ws, 'commitments-paid'), queryFn: () => listRecentlySettled(ws, addDays(today, -30) + 'T00:00:00Z'), enabled: tab === 'paid' });
  const invoices = useOpenInvoices();

  const buckets = useMemo(() => {
    const rows = open.data ?? [];
    const exp = rows.filter((t) => t.kind === 'expense');
    return {
      overdue: rows.filter((t) => t.due_on! < today),
      today: exp.filter((t) => t.due_on === today),
      week: exp.filter((t) => t.due_on! > today && t.due_on! <= addDays(today, 7)),
      month: exp.filter((t) => t.due_on! > addDays(today, 7) && t.due_on! <= addDays(today, 30)),
      income: rows.filter((t) => t.kind === 'income' && t.due_on! >= today),
    };
  }, [open.data, today]);

  // faturas fechadas também são compromissos
  const invoiceRows = (invoices.data ?? []).filter((i) => i.remaining_cents > 0 && i.status !== 'open');
  const overdueInvoices = invoiceRows.filter((i) => i.status === 'overdue');
  const remaining = (t: Transaction) => t.amount_cents - t.settled_principal_cents;
  const sum = (l: Transaction[]) => l.reduce((a, t) => a + remaining(t), 0);
  const lateTotal = sum(buckets.overdue.filter((t) => t.kind === 'expense')) + overdueInvoices.reduce((a, i) => a + i.remaining_cents, 0);

  const tabs: Array<{ id: Tab; label: string; count: number; total?: number }> = [
    { id: 'overdue', label: 'Vencidas', count: buckets.overdue.length + overdueInvoices.length, total: lateTotal },
    { id: 'today', label: 'Hoje', count: buckets.today.length, total: sum(buckets.today) },
    { id: 'week', label: '7 dias', count: buckets.week.length, total: sum(buckets.week) },
    { id: 'month', label: '30 dias', count: buckets.month.length, total: sum(buckets.month) },
    { id: 'income', label: 'A receber', count: buckets.income.length, total: sum(buckets.income) },
    { id: 'paid', label: 'Pagas', count: paid.data?.length ?? 0 },
  ];
  const current: Transaction[] = tab === 'paid' ? paid.data ?? [] : buckets[tab];

  return (
    <>
      <PageHeader
        title="Compromissos"
        subtitle="Contas a pagar e a receber. Nada é marcado como pago sem sua confirmação."
        actions={canContribute && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => quickAdd({ kind: 'expense' })}>Nova conta a pagar</Button>}
      />

      {lateTotal > 0 && (
        <div role="alert" className="mb-4 flex items-center gap-3 rounded-2xl border border-negative/25 bg-negative/8 px-4 py-3 text-sm">
          <AlertTriangle className="size-5 shrink-0 text-negative" aria-hidden />
          <span>Você tem <Money cents={lateTotal} className="font-semibold text-negative" /> em atraso.</span>
        </div>
      )}

      <div className="scrollbar-none -mx-1 mb-4 flex gap-2 overflow-x-auto px-1" role="tablist" aria-label="Períodos">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn('shrink-0 rounded-xl border px-3.5 py-2 text-left transition', tab === t.id ? 'border-brand/50 bg-brand/8' : 'border-line bg-surface hover:border-line-strong')}
          >
            <span className="flex items-center gap-1.5 text-sm font-semibold">
              {t.label}
              {t.count > 0 && <span className={cn('rounded-full px-1.5 text-[11px]', t.id === 'overdue' ? 'bg-negative/15 text-negative' : 'bg-surface-2 text-muted')}>{t.count}</span>}
            </span>
            {t.total !== undefined && <Money cents={t.total} className="text-[12px] text-subtle" />}
          </button>
        ))}
      </div>

      <Card className="p-2 sm:p-3">
        {open.isLoading ? <Skeleton className="m-2 h-40" /> : open.error ? <ErrorState error={open.error} onRetry={() => void open.refetch()} /> : (
          <>
            {tab === 'overdue' && overdueInvoices.map((i) => (
              <div key={i.id} className="flex items-center gap-3 rounded-xl px-2 py-2.5">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-negative/12 text-[11px] font-bold text-negative">{i.due_date.slice(8)}/{i.due_date.slice(5, 7)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">Fatura {cardMap.get(i.card_id)?.name}</span>
                  <span className="block text-[13px] text-negative">Vencida {relativeDay(i.due_date)}</span>
                </span>
                <Money cents={i.remaining_cents} className="font-semibold" />
                {canContribute && <Button size="sm" variant="subtle" onClick={() => quickAdd({ kind: 'card_payment', preset: { cardId: i.card_id, invoiceId: i.id, amount: i.remaining_cents } })}>Pagar</Button>}
              </div>
            ))}
            {current.length === 0 && !(tab === 'overdue' && overdueInvoices.length) ? (
              <EmptyState
                icon={tab === 'overdue' ? <CalendarCheck className="size-6" /> : <CalendarClock className="size-6" />}
                title={tab === 'overdue' ? 'Nada em atraso' : tab === 'paid' ? 'Nenhum pagamento recente' : 'Nenhum compromisso neste período'}
                description={tab === 'overdue' ? 'Parabéns, tudo em dia.' : 'Lançamentos pendentes com vencimento aparecem aqui.'}
              />
            ) : (
              current.map((t) => {
                const late = t.due_on! < today && tab !== 'paid';
                return (
                  <div key={t.id} className="flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-surface-2/60">
                    <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => setSelected(t)}>
                      <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl text-[11px] font-bold', tab === 'paid' ? 'bg-positive/12 text-positive' : late ? 'bg-negative/12 text-negative' : t.kind === 'income' ? 'bg-positive/12 text-positive' : 'bg-warning/12 text-warning')}>
                        {t.due_on!.slice(8)}/{t.due_on!.slice(5, 7)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{t.description}</span>
                        <span className={cn('block text-[13px]', late ? 'text-negative' : 'text-subtle')}>
                          {tab === 'paid' ? `Vencimento ${formatDate(t.due_on)}` : late ? `Venceu ${relativeDay(t.due_on!)}` : `Vence ${relativeDay(t.due_on!)}`} · {accountMap.get(t.account_id ?? '')?.name}
                          {t.settled_principal_cents > 0 && tab !== 'paid' && ' · pago parcialmente'}
                        </span>
                      </span>
                      <Money cents={tab === 'paid' ? t.paid_cents : remaining(t)} tone={t.kind === 'income' ? 'income' : 'neutral'} className="font-semibold" />
                    </button>
                    {canContribute && tab !== 'paid' && (
                      <Button size="sm" variant="subtle" icon={<Check className="size-4" />} onClick={() => setSettling(t)}>
                        {t.kind === 'income' ? 'Receber' : 'Pagar'}
                      </Button>
                    )}
                  </div>
                );
              })
            )}
          </>
        )}
      </Card>
      {tab !== 'overdue' && tab !== 'paid' && invoiceRows.filter((i) => i.status !== 'overdue').length > 0 && (
        <p className="mt-3 px-1 text-[13px] text-subtle">Faturas de cartão fechadas aguardando pagamento aparecem em Cartões.</p>
      )}
      {selected && <TransactionDetail tx={selected} onClose={() => setSelected(null)} />}
      {settling && <SettleDialog tx={settling} onClose={() => setSettling(null)} onDone={() => void invalidateFinance(ws)} />}
    </>
  );
}
