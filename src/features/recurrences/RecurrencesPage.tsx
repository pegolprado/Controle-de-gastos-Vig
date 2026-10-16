import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Pause, Pencil, Play, Plus, Repeat, XCircle } from 'lucide-react';
import { useWorkspace, useWsId } from '@/app/WorkspaceProvider';
import { useLookups, wsKey } from '@/hooks/useFinance';
import { useQuickAdd } from '@/features/transactions/QuickAdd';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge, Card, EmptyState, ErrorState, Skeleton } from '@/components/ui/Card';
import { Field, Input, Select, Switch } from '@/components/ui/Field';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { Modal } from '@/components/ui/Modal';
import { Money } from '@/components/ui/Money';
import { useConfirm } from '@/components/ui/Confirm';
import { describeRecurrence, nextOccurrences } from '@/domain/recurrence';
import { formatDate, todayISO } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import { invalidateFinance } from '@/lib/queryClient';
import type { Recurrence } from '@/lib/types';
import { listRecurrences, setRecurrenceStatus, updateRecurrence } from '@/services/planning';

export default function RecurrencesPage() {
  const ws = useWsId();
  const { canEdit, canContribute } = useWorkspace();
  const { accountMap, cardMap, categoryMap } = useLookups();
  const quickAdd = useQuickAdd();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: wsKey(ws, 'recurrences'), queryFn: () => listRecurrences(ws) });
  const [editing, setEditing] = useState<Recurrence | null>(null);
  const status = useMutation({
    mutationFn: ({ r, s, remove }: { r: Recurrence; s: Recurrence['status']; remove?: boolean }) => setRecurrenceStatus(r.id, s, remove),
    onSuccess: () => { toast.success('Recorrência atualizada.'); void invalidateFinance(ws); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const list = q.data ?? [];
  const monthlyImpact = list.filter((r) => r.status === 'active').reduce((a, r) => {
    const factor = { daily: 30 / r.interval_count, weekly: 4.345 / r.interval_count, monthly: 1 / r.interval_count, yearly: 1 / (12 * r.interval_count) }[r.frequency];
    return a + (r.kind === 'income' ? 1 : -1) * r.amount_cents * factor;
  }, 0);

  return (
    <>
      <PageHeader
        title="Recorrências"
        subtitle="Contas fixas, assinaturas e receitas que se repetem. Geradas automaticamente, sem duplicar."
        actions={canContribute && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => quickAdd({ kind: 'expense' })}>Nova recorrência</Button>}
      />
      {list.length > 0 && (
        <p className="mb-4 text-sm text-muted">Impacto mensal estimado das recorrências ativas: <Money cents={Math.round(monthlyImpact)} tone="auto" signed className="font-semibold" /></p>
      )}
      {q.isLoading ? <Skeleton className="h-40" /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : list.length === 0 ? (
        <Card><EmptyState icon={<Repeat className="size-6" />} title="Nenhuma recorrência" description="Ao criar um lançamento, ative “Repetir automaticamente” para aluguel, salário, assinaturas etc." /></Card>
      ) : (
        <Card className="divide-y divide-line">
          {list.map((r) => {
            const next = r.status === 'active' ? nextOccurrences(r.start_date, r.frequency, r.interval_count, r.occurrences_generated, 1, r.end_date)[0] : undefined;
            const cat = r.category_id ? categoryMap.get(r.category_id) : undefined;
            return (
              <div key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5 sm:flex-nowrap">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 font-medium">
                    <span className="truncate">{r.description}</span>
                    {r.status !== 'active' && <Badge tone={r.status === 'paused' ? 'warning' : 'neutral'}>{r.status === 'paused' ? 'Pausada' : 'Cancelada'}</Badge>}
                  </p>
                  <p className="truncate text-[13px] text-subtle">
                    {describeRecurrence(r.frequency, r.interval_count)} · {r.card_id ? cardMap.get(r.card_id)?.name : accountMap.get(r.account_id ?? '')?.name}
                    {cat && ` · ${cat.name}`} · desde {formatDate(r.start_date)}{r.end_date && ` até ${formatDate(r.end_date)}`}
                    {next && <> · próxima <strong className="font-semibold text-muted">{formatDate(next)}</strong></>}
                  </p>
                </div>
                <Money cents={r.kind === 'income' ? r.amount_cents : -r.amount_cents} tone={r.kind === 'income' ? 'income' : 'neutral'} className="font-semibold" />
                {canEdit && r.status !== 'cancelled' && (
                  <div className="flex gap-1">
                    <IconButton size="sm" label="Editar" onClick={() => setEditing(r)}><Pencil className="size-4" /></IconButton>
                    {r.status === 'active' ? (
                      <IconButton size="sm" label="Pausar" onClick={() => status.mutate({ r, s: 'paused' })}><Pause className="size-4" /></IconButton>
                    ) : (
                      <IconButton size="sm" label="Retomar" onClick={() => status.mutate({ r, s: 'active' })}><Play className="size-4" /></IconButton>
                    )}
                    <IconButton size="sm" label="Encerrar" onClick={async () => {
                      if (await confirm({ title: `Encerrar “${r.description}”?`, description: 'Ocorrências futuras ainda pendentes serão removidas. As já pagas e o histórico são mantidos.', confirmLabel: 'Encerrar recorrência' })) status.mutate({ r, s: 'cancelled', remove: true });
                    }}><XCircle className="size-4" /></IconButton>
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      )}
      {editing && <RecurrenceEdit rec={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function RecurrenceEdit({ rec, onClose }: { rec: Recurrence; onClose: () => void }) {
  const ws = useWsId();
  const { categories } = useLookups();
  const [description, setDescription] = useState(rec.description);
  const [amount, setAmount] = useState(rec.amount_cents);
  const [categoryId, setCategoryId] = useState(rec.category_id ?? '');
  const [endDate, setEndDate] = useState(rec.end_date ?? '');
  const [applyFuture, setApplyFuture] = useState(true);
  const m = useMutation({
    mutationFn: () => updateRecurrence(rec.id, { description: description.trim(), amount_cents: amount, category_id: categoryId || null, end_date: endDate || null }, applyFuture ? todayISO() : null),
    onSuccess: (n) => { toast.success(applyFuture ? `Recorrência e ${n ?? 0} ocorrências futuras atualizadas.` : 'Recorrência atualizada para as próximas gerações.'); void invalidateFinance(ws); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal open onClose={onClose} title="Editar recorrência" size="sm" footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={m.isPending} disabled={!description.trim() || amount <= 0} onClick={() => !m.isPending && m.mutate()}>Salvar</Button></div>}>
      <div className="grid gap-4">
        <Field label="Descrição">{(id) => <Input id={id} value={description} maxLength={140} onChange={(e) => setDescription(e.target.value)} />}</Field>
        <Field label="Valor">{(id) => <MoneyInput id={id} value={amount} onChange={setAmount} />}</Field>
        <Field label="Categoria" optional>
          {(id) => (
            <Select id={id} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Sem categoria</option>
              {categories.filter((c) => c.kind === rec.kind && !c.archived).map((c) => <option key={c.id} value={c.id}>{c.parent_id ? `— ${c.name}` : c.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Termina em" optional>{(id) => <Input id={id} type="date" value={endDate} min={rec.start_date} onChange={(e) => setEndDate(e.target.value)} />}</Field>
        <Switch checked={applyFuture} onChange={setApplyFuture} label="Aplicar às ocorrências futuras já geradas" description="Ocorrências pagas ou editadas individualmente não são alteradas." />
      </div>
    </Modal>
  );
}
