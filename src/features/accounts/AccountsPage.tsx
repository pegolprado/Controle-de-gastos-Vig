import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Archive, ArchiveRestore, Landmark, Pencil, Plus, Trash2 } from 'lucide-react';
import { useWorkspace, useWsId } from '@/app/WorkspaceProvider';
import { useAccounts, useBalances } from '@/hooks/useFinance';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge, Card, EmptyState, ErrorState, Skeleton } from '@/components/ui/Card';
import { Money } from '@/components/ui/Money';
import { useConfirm } from '@/components/ui/Confirm';
import { ACCOUNT_TYPE_LABEL } from '@/domain/labels';
import { errorMessage } from '@/lib/errors';
import { invalidateFinance } from '@/lib/queryClient';
import type { Account } from '@/lib/types';
import { deleteAccount, updateAccount } from '@/services/accounts';
import { AccountForm } from './AccountForm';

export default function AccountsPage() {
  const ws = useWsId();
  const { canEdit } = useWorkspace();
  const accounts = useAccounts();
  const balances = useBalances();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Account | null | 'new'>(null);
  const [showArchived, setShowArchived] = useState(false);
  const bal = (id: string) => balances.data?.find((b) => b.account_id === id);

  const archive = useMutation({
    mutationFn: (a: Account) => updateAccount(a.id, { archived: !a.archived }),
    onSuccess: () => void invalidateFinance(ws),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (a: Account) => deleteAccount(a.id),
    onSuccess: () => { toast.success('Conta excluída.'); void invalidateFinance(ws); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const list = (accounts.data ?? []).filter((a) => showArchived || !a.archived);
  const totals = (accounts.data ?? []).filter((a) => a.include_in_total && !a.archived).reduce(
    (acc, a) => {
      const b = bal(a.id);
      return { current: acc.current + (b?.current_balance_cents ?? 0), projected: acc.projected + (b?.projected_balance_cents ?? 0) };
    },
    { current: 0, projected: 0 },
  );

  return (
    <>
      <PageHeader
        title="Contas"
        subtitle="Saldos calculados a partir dos lançamentos confirmados."
        actions={canEdit && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>Nova conta</Button>}
      />
      <div className="mb-5 grid grid-cols-2 gap-3 sm:max-w-xl">
        <Card className="p-4">
          <p className="text-[13px] font-semibold text-muted">Saldo atual</p>
          <Money cents={totals.current} tone={totals.current < 0 ? 'expense' : 'neutral'} className="font-num text-2xl font-semibold" />
          <p className="text-[12px] text-subtle">Somente o que já foi pago/recebido</p>
        </Card>
        <Card className="p-4">
          <p className="text-[13px] font-semibold text-muted">Saldo previsto</p>
          <Money cents={totals.projected} tone={totals.projected < 0 ? 'expense' : 'neutral'} className="font-num text-2xl font-semibold" />
          <p className="text-[12px] text-subtle">Inclui compromissos pendentes</p>
        </Card>
      </div>

      {accounts.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-36" />)}</div>
      ) : accounts.error ? (
        <ErrorState error={accounts.error} onRetry={() => void accounts.refetch()} />
      ) : list.length === 0 ? (
        <Card><EmptyState icon={<Landmark className="size-6" />} title="Nenhuma conta" description="Cadastre contas correntes, poupança, carteira ou investimentos." action={canEdit && <Button variant="primary" onClick={() => setEditing('new')}>Cadastrar conta</Button>} /></Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((a) => {
            const b = bal(a.id);
            return (
              <Card key={a.id} className="group relative overflow-hidden p-5">
                <span className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: a.color }} aria-hidden />
                <div className="flex items-start justify-between gap-2">
                  <Link to={`/contas/${a.id}`} className="min-w-0">
                    <p className="truncate font-semibold hover:underline">{a.name}</p>
                    <p className="text-[13px] text-subtle">{ACCOUNT_TYPE_LABEL[a.type]}{a.institution ? ` · ${a.institution}` : ''}</p>
                  </Link>
                  <div className="flex gap-1">
                    {a.archived && <Badge>Arquivada</Badge>}
                    {!a.include_in_total && <Badge tone="info">Fora do total</Badge>}
                  </div>
                </div>
                <Link to={`/contas/${a.id}`} className="mt-4 block">
                  <Money cents={b?.current_balance_cents ?? a.initial_balance_cents} tone={(b?.current_balance_cents ?? 0) < 0 ? 'expense' : 'neutral'} className="font-num text-2xl font-semibold" />
                  {b && (b.pending_in_cents > 0 || b.pending_out_cents > 0) && (
                    <p className="mt-1 text-[13px] text-subtle">
                      Previsto <Money cents={b.projected_balance_cents} className="font-semibold text-muted" />
                    </p>
                  )}
                </Link>
                {canEdit && (
                  <div className="mt-3 flex justify-end gap-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
                    <IconButton size="sm" label="Editar" onClick={() => setEditing(a)}><Pencil className="size-4" /></IconButton>
                    <IconButton size="sm" label={a.archived ? 'Desarquivar' : 'Arquivar'} onClick={() => archive.mutate(a)}>{a.archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}</IconButton>
                    <IconButton
                      size="sm"
                      label="Excluir"
                      onClick={async () => {
                        if (await confirm({ title: `Excluir “${a.name}”?`, description: 'Só é possível excluir contas sem movimentações. Para manter o histórico, prefira arquivar.', confirmLabel: 'Excluir conta' })) remove.mutate(a);
                      }}
                    >
                      <Trash2 className="size-4" />
                    </IconButton>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
      {(accounts.data ?? []).some((a) => a.archived) && (
        <button type="button" className="mt-4 text-sm font-semibold text-muted hover:text-fg" onClick={() => setShowArchived((v) => !v)}>
          {showArchived ? 'Ocultar arquivadas' : 'Mostrar arquivadas'}
        </button>
      )}
      {editing && <AccountForm account={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}
