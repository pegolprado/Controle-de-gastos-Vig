import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ArrowLeft, Pencil } from 'lucide-react';
import { useWorkspace, useWsId } from '@/app/WorkspaceProvider';
import { useLookups, wsKey } from '@/hooks/useFinance';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState, Skeleton } from '@/components/ui/Card';
import { Money } from '@/components/ui/Money';
import { ACCOUNT_TYPE_LABEL } from '@/domain/labels';
import { formatDate } from '@/lib/dates';
import type { Transaction } from '@/lib/types';
import { listTransactions } from '@/services/transactions';
import { TxRow, groupByDate } from '@/features/transactions/TxRow';
import { TransactionDetail } from '@/features/transactions/TransactionDetail';
import { AccountForm } from './AccountForm';

export default function AccountDetailPage() {
  const { id = '' } = useParams();
  const ws = useWsId();
  const { canEdit } = useWorkspace();
  const { accountMap, balanceMap, loading } = useLookups();
  const account = accountMap.get(id);
  const bal = balanceMap.get(id);
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [editing, setEditing] = useState(false);
  const q = useInfiniteQuery({
    queryKey: wsKey(ws, 'transactions', { accountId: id }),
    queryFn: ({ pageParam }) => listTransactions(ws, { accountId: id }, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, all) => (last.hasMore ? all.length : undefined),
  });
  const rows = useMemo(() => q.data?.pages.flatMap((p) => p.rows) ?? [], [q.data]);
  if (loading) return <Skeleton className="h-64" />;
  if (!account) return <EmptyState title="Conta não encontrada" action={<Link to="/contas" className="font-semibold text-brand">Voltar</Link>} />;

  return (
    <>
      <Link to="/contas" className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-fg"><ArrowLeft className="size-4" /> Contas</Link>
      <PageHeader
        title={account.name}
        subtitle={`${ACCOUNT_TYPE_LABEL[account.type]}${account.institution ? ` · ${account.institution}` : ''}`}
        actions={canEdit && <Button icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>Editar</Button>}
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ['Saldo atual', bal?.current_balance_cents ?? account.initial_balance_cents],
          ['Saldo previsto', bal?.projected_balance_cents ?? account.initial_balance_cents],
          ['A receber', bal?.pending_in_cents ?? 0],
          ['A pagar', -(bal?.pending_out_cents ?? 0)],
        ].map(([label, v]) => (
          <Card key={label as string} className="p-4">
            <p className="text-[13px] font-semibold text-muted">{label}</p>
            <Money cents={v as number} tone={(v as number) < 0 ? 'expense' : 'neutral'} className="font-num text-xl font-semibold" />
          </Card>
        ))}
      </div>
      <p className="mb-2 px-1 text-[13px] text-subtle">Saldo inicial de <Money cents={account.initial_balance_cents} /> · desde {formatDate(account.created_at.slice(0, 10))}</p>
      <Card className="p-2 sm:p-3">
        {q.isLoading ? <Skeleton className="h-40" /> : rows.length === 0 ? <EmptyState title="Sem movimentações" description="Os lançamentos desta conta aparecerão aqui." /> : (
          <>
            {groupByDate(rows).map((g) => (
              <section key={g.date}>
                <h2 className="px-2 pb-1 pt-3 text-[12px] font-semibold uppercase tracking-wider text-subtle">{formatDate(g.date)}</h2>
                {g.rows.map((t) => <TxRow key={t.id} tx={t} onOpen={setSelected} accountId={id} showDate={false} />)}
              </section>
            ))}
            {q.hasNextPage && <div className="p-3 text-center"><Button size="sm" loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>Carregar mais</Button></div>}
          </>
        )}
      </Card>
      {selected && <TransactionDetail tx={selected} onClose={() => setSelected(null)} />}
      {editing && <AccountForm account={account} onClose={() => setEditing(false)} />}
    </>
  );
}
