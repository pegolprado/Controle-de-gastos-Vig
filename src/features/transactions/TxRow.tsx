import { ArrowLeftRight, CreditCard, Layers, Paperclip, Repeat } from 'lucide-react';
import { useLookups } from '@/hooks/useFinance';
import { CategoryIcon } from '@/components/ui/CategoryIcon';
import { Badge } from '@/components/ui/Card';
import { Money } from '@/components/ui/Money';
import { TX_STATUS_LABEL } from '@/domain/labels';
import { formatDate, relativeDay, todayISO } from '@/lib/dates';
import { cn } from '@/lib/cn';
import type { Transaction } from '@/lib/types';

export function txSignedAmount(tx: Transaction, accountId?: string): number {
  if (tx.kind === 'income') return tx.amount_cents;
  if (tx.kind === 'transfer') {
    if (accountId) return tx.destination_account_id === accountId ? tx.amount_cents : -tx.amount_cents;
    return 0;
  }
  return -tx.amount_cents;
}

export function TxRow({ tx, onOpen, accountId, showDate = true }: { tx: Transaction; onOpen: (tx: Transaction) => void; accountId?: string; showDate?: boolean }) {
  const { accountMap, categoryMap, cardMap, topCategory } = useLookups();
  const cat = tx.category_id ? categoryMap.get(tx.category_id) : undefined;
  const top = topCategory(tx.category_id);
  const isTransfer = tx.kind === 'transfer' || tx.kind === 'card_payment';
  const where =
    tx.kind === 'transfer'
      ? `${accountMap.get(tx.account_id ?? '')?.name ?? '?'} → ${accountMap.get(tx.destination_account_id ?? '')?.name ?? '?'}`
      : tx.card_id
        ? cardMap.get(tx.card_id)?.name
        : accountMap.get(tx.account_id ?? '')?.name;
  const signed = txSignedAmount(tx, accountId);
  const open = tx.status === 'pending' || tx.status === 'planned';
  const overdue = open && tx.due_on && tx.due_on < todayISO();
  const cancelled = tx.status === 'cancelled';

  return (
    <button
      type="button"
      onClick={() => onOpen(tx)}
      className={cn('flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition hover:bg-surface-2/70', cancelled && 'opacity-50')}
    >
      {isTransfer ? (
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-info/10 text-info ring-1 ring-info/20" aria-hidden>
          {tx.kind === 'card_payment' ? <CreditCard className="size-4" /> : <ArrowLeftRight className="size-4" />}
        </span>
      ) : (
        <CategoryIcon icon={top?.icon ?? 'circle-dashed'} color={top?.color ?? '#64748b'} />
      )}
      <span className="min-w-0 flex-1">
        <span className={cn('flex items-center gap-1.5 truncate text-[15px] font-medium', cancelled && 'line-through')}>
          <span className="truncate">{tx.description}</span>
          {tx.recurrence_id && <Repeat className="size-3.5 shrink-0 text-subtle" aria-label="Recorrente" />}
          {tx.installment_group_id && <Layers className="size-3.5 shrink-0 text-subtle" aria-label="Parcelado" />}
          {tx.attachment_path && <Paperclip className="size-3.5 shrink-0 text-subtle" aria-label="Com comprovante" />}
        </span>
        <span className="flex items-center gap-1.5 truncate text-[13px] text-subtle">
          {showDate && <span>{formatDate(tx.occurred_on)}</span>}
          {showDate && (cat || where) && <span aria-hidden>·</span>}
          <span className="truncate">{[cat?.name, where].filter(Boolean).join(' · ')}</span>
        </span>
      </span>
      <span className="flex flex-col items-end gap-1">
        <Money cents={signed} tone={tx.kind === 'income' ? 'income' : tx.kind === 'expense' ? 'neutral' : 'muted'} signed={tx.kind === 'income'} className="text-[15px] font-semibold" />
        {open && (
          <Badge tone={overdue ? 'negative' : 'warning'}>
            {overdue ? 'Atrasado' : tx.due_on ? `Vence ${relativeDay(tx.due_on)}` : TX_STATUS_LABEL[tx.status]}
          </Badge>
        )}
        {cancelled && <Badge>Cancelado</Badge>}
      </span>
    </button>
  );
}

/** Agrupa por data com cabeçalho e total do dia. */
export function groupByDate(rows: Transaction[]) {
  const groups: Array<{ date: string; rows: Transaction[] }> = [];
  for (const r of rows) {
    const last = groups[groups.length - 1];
    if (last && last.date === r.occurred_on) last.rows.push(r);
    else groups.push({ date: r.occurred_on, rows: [r] });
  }
  return groups;
}
