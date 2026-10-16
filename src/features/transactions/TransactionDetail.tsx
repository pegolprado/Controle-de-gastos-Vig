import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Ban, Copy, Download, History, Paperclip, Pencil, RotateCcw, Trash2, Wallet } from 'lucide-react';
import { useBrand } from '@/app/BrandProvider';
import { useWorkspace, useWsId } from '@/app/WorkspaceProvider';
import { useLookups, wsKey } from '@/hooks/useFinance';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Card';
import { Money } from '@/components/ui/Money';
import { useConfirm } from '@/components/ui/Confirm';
import { PAYMENT_METHOD_LABEL, TX_KIND_LABEL, TX_STATUS_LABEL } from '@/domain/labels';
import { formatDate, formatDateTime } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import { invalidateFinance } from '@/lib/queryClient';
import type { Transaction } from '@/lib/types';
import {
  deleteInstallmentGroup, deleteTransaction, listDueChanges, listHistory, listSettlements, receiptUrl, removeReceipt,
  undoSettlement, updateTransaction, uploadReceipt,
} from '@/services/transactions';
import { useQuickAdd } from './QuickAdd';
import { SettleDialog } from './SettleDialog';

const FIELD_LABELS: Record<string, string> = {
  amount_cents: 'Valor', description: 'Descrição', occurred_on: 'Data', due_on: 'Vencimento', status: 'Situação',
  category_id: 'Categoria', account_id: 'Conta', card_id: 'Cartão', notes: 'Observações', tags: 'Tags', paid_cents: 'Valor pago',
  destination_account_id: 'Destino', payment_method: 'Forma de pagamento', attachment_path: 'Comprovante',
};

export function TransactionDetail({ tx, onClose }: { tx: Transaction; onClose: () => void }) {
  const ws = useWsId();
  const brand = useBrand();
  const { canEdit, canContribute, ctx } = useWorkspace();
  const { accountMap, categoryMap, cardMap } = useLookups();
  const confirm = useConfirm();
  const quickAdd = useQuickAdd();
  const [settleOpen, setSettleOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const mine = tx.created_by === ctx?.profile?.id;
  const canModify = canEdit || (canContribute && mine);

  const settlements = useQuery({ queryKey: wsKey(ws, 'settlements', tx.id), queryFn: () => listSettlements(tx.id), enabled: tx.kind === 'income' || tx.kind === 'expense' });
  const history = useQuery({ queryKey: wsKey(ws, 'history', tx.id), queryFn: () => listHistory(tx.id), enabled: showHistory && canEdit });
  const dueChanges = useQuery({ queryKey: wsKey(ws, 'due-changes', tx.id), queryFn: () => listDueChanges(tx.id), enabled: Boolean(tx.due_on) });

  const after = () => {
    void invalidateFinance(ws);
    onClose();
  };
  const del = useMutation({ mutationFn: () => deleteTransaction(tx.id), onSuccess: () => { toast.success('Lançamento excluído.'); after(); }, onError: (e) => toast.error(errorMessage(e)) });
  const delGroup = useMutation({ mutationFn: () => deleteInstallmentGroup(tx.installment_group_id!), onSuccess: () => { toast.success('Parcelamento excluído.'); after(); }, onError: (e) => toast.error(errorMessage(e)) });
  const setStatus = useMutation({
    mutationFn: (status: Transaction['status']) => updateTransaction(tx.id, { status }),
    onSuccess: () => { toast.success('Situação atualizada.'); after(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const undo = useMutation({ mutationFn: undoSettlement, onSuccess: () => { toast.success('Pagamento desfeito.'); after(); }, onError: (e) => toast.error(errorMessage(e)) });
  const upload = useMutation({ mutationFn: (f: File) => uploadReceipt(ws, tx.id, f), onSuccess: () => { toast.success('Comprovante anexado.'); after(); }, onError: (e) => toast.error(errorMessage(e)) });
  const removeFile = useMutation({ mutationFn: () => removeReceipt(tx.id, tx.attachment_path!), onSuccess: () => { toast.success('Comprovante removido.'); after(); }, onError: (e) => toast.error(errorMessage(e)) });

  const open = tx.status === 'pending' || tx.status === 'planned';
  const settleable = (tx.kind === 'income' || tx.kind === 'expense') && tx.account_id && open;
  const remaining = tx.amount_cents - tx.settled_principal_cents;
  const where = tx.card_id ? `Cartão ${cardMap.get(tx.card_id)?.name ?? ''}` : accountMap.get(tx.account_id ?? '')?.name;
  const category = tx.category_id ? categoryMap.get(tx.category_id) : null;
  const parent = category?.parent_id ? categoryMap.get(category.parent_id) : null;

  async function onDelete() {
    if (tx.installment_group_id) {
      const ok = await confirm({
        title: 'Excluir parcelamento inteiro?',
        description: `Esta é a parcela ${tx.installment_number}/${tx.installments_total}. Excluir remove todas as parcelas desta compra. Para remover só uma, use "Cancelar".`,
        confirmLabel: 'Excluir todas as parcelas',
      });
      if (ok) delGroup.mutate();
      return;
    }
    const ok = await confirm({
      title: 'Excluir lançamento?',
      description: (
        <>
          “{tx.description}” de <Money cents={tx.amount_cents} className="font-semibold text-fg" /> será removido permanentemente. A exclusão fica registrada no histórico do espaço.
        </>
      ),
      confirmLabel: 'Excluir',
    });
    if (ok) del.mutate();
  }

  const rows: Array<[string, React.ReactNode]> = [
    ['Tipo', TX_KIND_LABEL[tx.kind]],
    ['Data', formatDate(tx.occurred_on)],
    ...(tx.due_on ? ([['Vencimento', formatDate(tx.due_on)]] as Array<[string, React.ReactNode]>) : []),
    ...(tx.kind === 'transfer'
      ? ([['Origem → destino', `${accountMap.get(tx.account_id ?? '')?.name} → ${accountMap.get(tx.destination_account_id ?? '')?.name}`]] as Array<[string, React.ReactNode]>)
      : ([[tx.kind === 'income' ? 'Recebido em' : 'Pago com', where ?? '—']] as Array<[string, React.ReactNode]>)),
    ...(category ? ([['Categoria', parent ? `${parent.name} › ${category.name}` : category.name]] as Array<[string, React.ReactNode]>) : []),
    ...(tx.payment_method ? ([['Forma', PAYMENT_METHOD_LABEL[tx.payment_method]]] as Array<[string, React.ReactNode]>) : []),
    ...(tx.installment_group_id ? ([['Parcela', `${tx.installment_number} de ${tx.installments_total}`]] as Array<[string, React.ReactNode]>) : []),
    ...(tx.tags.length ? ([['Tags', tx.tags.map((t) => `#${t}`).join(' ')]] as Array<[string, React.ReactNode]>) : []),
    ['Criado em', formatDateTime(tx.created_at)],
    ...(tx.updated_at !== tx.created_at ? ([['Alterado em', formatDateTime(tx.updated_at)]] as Array<[string, React.ReactNode]>) : []),
  ];

  return (
    <>
      <Modal open onClose={onClose} title={tx.description} size="md">
        <div className="flex flex-col gap-5">
          <div className="rounded-2xl border border-line bg-surface-2/50 p-5 text-center">
            <Money cents={tx.kind === 'income' ? tx.amount_cents : -tx.amount_cents} tone={tx.kind === 'income' ? 'income' : tx.kind === 'expense' ? 'expense' : 'muted'} className="font-num text-3xl font-semibold" />
            <div className="mt-2 flex justify-center gap-2">
              <Badge tone={open ? 'warning' : tx.status === 'cancelled' ? 'neutral' : 'positive'}>{TX_STATUS_LABEL[tx.status]}</Badge>
              {tx.recurrence_id && <Badge tone="info">Recorrente</Badge>}
            </div>
            {tx.settled_principal_cents > 0 && open && (
              <p className="mt-3 text-sm text-muted">
                Pago <Money cents={tx.paid_cents} className="font-semibold text-fg" /> · em aberto <Money cents={remaining} className="font-semibold text-fg" />
              </p>
            )}
          </div>

          <dl className="divide-y divide-line rounded-2xl border border-line">
            {rows.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 px-4 py-2.5 text-sm">
                <dt className="text-subtle">{k}</dt>
                <dd className="text-right font-medium">{v}</dd>
              </div>
            ))}
          </dl>

          {tx.notes && <p className="whitespace-pre-wrap rounded-2xl border border-line p-4 text-sm text-muted">{tx.notes}</p>}

          {(settlements.data?.length ?? 0) > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-semibold">Pagamentos registrados</h3>
              <ul className="divide-y divide-line rounded-2xl border border-line">
                {settlements.data!.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <span className="flex-1">
                      {formatDate(s.paid_on)}
                      {(s.interest_cents > 0 || s.discount_cents > 0) && (
                        <span className="block text-[12px] text-subtle">
                          {s.interest_cents > 0 && <>juros <Money cents={s.interest_cents} /> </>}
                          {s.discount_cents > 0 && <>desconto <Money cents={s.discount_cents} /></>}
                        </span>
                      )}
                    </span>
                    <Money cents={s.principal_cents + s.interest_cents - s.discount_cents} className="font-semibold" />
                    {canModify && (
                      <button type="button" className="text-subtle hover:text-negative" aria-label="Desfazer pagamento" onClick={() => undo.mutate(s.id)}>
                        <RotateCcw className="size-4" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(dueChanges.data?.length ?? 0) > 0 && (
            <p className="text-[13px] text-subtle">
              Vencimento alterado {dueChanges.data!.length}x — último: de {formatDate(dueChanges.data![0].old_due_on)} para {formatDate(dueChanges.data![0].new_due_on)}.
            </p>
          )}

          {brand.features.attachments !== false && tx.kind !== 'transfer' && (
            <section className="flex items-center gap-2">
              {tx.attachment_path ? (
                <>
                  <Button size="sm" icon={<Download className="size-4" />} onClick={async () => { try { window.open(await receiptUrl(tx.attachment_path!), '_blank', 'noopener'); } catch (e) { toast.error(errorMessage(e)); } }}>
                    Ver comprovante
                  </Button>
                  {canModify && (
                    <Button size="sm" variant="ghost" loading={removeFile.isPending} onClick={() => removeFile.mutate()}>
                      Remover
                    </Button>
                  )}
                </>
              ) : (
                canModify && (
                  <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-3 text-sm font-medium hover:border-line-strong">
                    <Paperclip className="size-4" aria-hidden /> {upload.isPending ? 'Enviando…' : 'Anexar comprovante'}
                    <input
                      type="file"
                      className="sr-only"
                      accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        if (f.size > 5 * 1024 * 1024) return void toast.error('Arquivo maior que 5 MB.');
                        upload.mutate(f);
                      }}
                    />
                  </label>
                )
              )}
            </section>
          )}

          {canEdit && (
            <section>
              <button type="button" onClick={() => setShowHistory((v) => !v)} className="flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-fg">
                <History className="size-4" aria-hidden /> {showHistory ? 'Ocultar histórico' : 'Ver histórico de alterações'}
              </button>
              {showHistory && (
                <ol className="mt-3 space-y-2 border-l border-line pl-4">
                  {history.isLoading && <li className="text-sm text-subtle">Carregando…</li>}
                  {history.data?.map((h) => (
                    <li key={h.id} className="text-[13px]">
                      <p className="font-semibold">
                        {h.action === 'INSERT' ? 'Criado' : h.action === 'UPDATE' ? 'Alterado' : 'Excluído'} · <span className="font-normal text-subtle">{formatDateTime(h.created_at)}</span>
                      </p>
                      {h.action === 'UPDATE' && h.new_data && (
                        <p className="text-subtle">
                          {Object.keys(h.new_data)
                            .filter((k) => FIELD_LABELS[k])
                            .map((k) => FIELD_LABELS[k])
                            .join(', ') || 'Campos internos'}
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )}

          <div className="flex flex-wrap gap-2 border-t border-line pt-4">
            {settleable && canContribute && (
              <Button variant="primary" icon={<Wallet className="size-4" />} onClick={() => setSettleOpen(true)}>
                {tx.kind === 'income' ? 'Registrar recebimento' : 'Registrar pagamento'}
              </Button>
            )}
            {canModify && tx.status !== 'cancelled' && (
              <Button icon={<Pencil className="size-4" />} onClick={() => { onClose(); quickAdd({ existing: tx }); }}>
                Editar
              </Button>
            )}
            {canContribute && tx.kind !== 'card_payment' && (
              <Button icon={<Copy className="size-4" />} onClick={() => { onClose(); quickAdd({ duplicateOf: tx }); }}>
                Duplicar
              </Button>
            )}
            {canModify && tx.status !== 'cancelled' && (tx.kind === 'income' || tx.kind === 'expense') && tx.settled_principal_cents === 0 && (
              <Button variant="ghost" icon={<Ban className="size-4" />} loading={setStatus.isPending} onClick={async () => {
                if (await confirm({ title: 'Cancelar lançamento?', description: 'Ele continua visível no histórico, mas deixa de contar em saldos, faturas e relatórios.', confirmLabel: 'Cancelar lançamento' })) setStatus.mutate('cancelled');
              }}>
                Cancelar
              </Button>
            )}
            {canModify && tx.status === 'cancelled' && (
              <Button variant="ghost" icon={<RotateCcw className="size-4" />} onClick={() => setStatus.mutate(tx.card_id ? 'paid' : 'pending')}>
                Reativar
              </Button>
            )}
            {canModify && (
              <Button variant="danger" icon={<Trash2 className="size-4" />} loading={del.isPending || delGroup.isPending} onClick={onDelete} className="ml-auto">
                Excluir
              </Button>
            )}
          </div>
        </div>
      </Modal>
      {settleOpen && <SettleDialog tx={tx} onClose={() => setSettleOpen(false)} onDone={after} />}
    </>
  );
}
