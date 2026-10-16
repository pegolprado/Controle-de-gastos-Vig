import { useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Minus, Pencil, Plus, Target, Trash2 } from 'lucide-react';
import { useWorkspace, useWsId } from '@/app/WorkspaceProvider';
import { wsKey } from '@/hooks/useFinance';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge, Card, EmptyState, ErrorState, Skeleton } from '@/components/ui/Card';
import { Field, Input } from '@/components/ui/Field';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { Modal } from '@/components/ui/Modal';
import { Money } from '@/components/ui/Money';
import { ColorPicker } from '@/components/ui/CategoryIcon';
import { useConfirm } from '@/components/ui/Confirm';
import { diffDays, formatDate, todayISO } from '@/lib/dates';
import { formatPercent } from '@/lib/money';
import { errorMessage } from '@/lib/errors';
import { newRequestId } from '@/lib/id';
import { invalidateFinance } from '@/lib/queryClient';
import type { Goal } from '@/lib/types';
import { addContribution, createGoal, deleteGoal, listGoals, updateGoal } from '@/services/planning';

export default function GoalsPage() {
  const ws = useWsId();
  const { canEdit, canContribute } = useWorkspace();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: wsKey(ws, 'goals'), queryFn: () => listGoals(ws) });
  const [editing, setEditing] = useState<Goal | 'new' | null>(null);
  const [contributing, setContributing] = useState<{ goal: Goal; sign: 1 | -1 } | null>(null);
  const del = useMutation({ mutationFn: deleteGoal, onSuccess: () => void invalidateFinance(ws), onError: (e) => toast.error(errorMessage(e)) });
  const list = (q.data ?? []).filter((g) => !g.archived);

  return (
    <>
      <PageHeader title="Metas" subtitle="Reserve dinheiro para o que importa e acompanhe o progresso." actions={canEdit && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>Nova meta</Button>} />
      {q.isLoading ? <Skeleton className="h-48" /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : list.length === 0 ? (
        <Card><EmptyState icon={<Target className="size-6" />} title="Nenhuma meta" description="Viagem, reserva de emergência, carro novo… defina um valor e um prazo." action={canEdit && <Button variant="primary" onClick={() => setEditing('new')}>Criar meta</Button>} /></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((g) => {
            const saved = Number(g.saved_cents);
            const pct = (saved / g.target_cents) * 100;
            const left = g.target_cents - saved;
            const days = g.deadline ? diffDays(g.deadline, todayISO()) : null;
            const months = days !== null ? Math.max(1, Math.ceil(days / 30)) : null;
            const r = 30;
            const c = 2 * Math.PI * r;
            return (
              <Card key={g.id} className="flex flex-col p-5">
                <div className="flex items-start gap-4">
                  <svg viewBox="0 0 72 72" className="size-[72px] shrink-0 -rotate-90" role="img" aria-label={`${formatPercent(pct)} concluído`}>
                    <circle cx="36" cy="36" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="7" />
                    <circle cx="36" cy="36" r={r} fill="none" stroke={g.color} strokeWidth="7" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(pct, 100) / 100)} className="transition-[stroke-dashoffset] duration-700" />
                  </svg>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{g.name}</p>
                    <p className="font-num text-xl font-semibold"><Money cents={saved} /></p>
                    <p className="text-[13px] text-subtle">de <Money cents={g.target_cents} /> · {formatPercent(pct)}</p>
                  </div>
                </div>
                <div className="mt-4 text-[13px] text-muted">
                  {left <= 0 ? <Badge tone="positive">Meta atingida 🎉</Badge> : g.deadline ? (
                    days! < 0 ? <span className="text-negative">Prazo encerrado em {formatDate(g.deadline)}</span> : (
                      <span>Faltam <Money cents={left} className="font-semibold" /> até {formatDate(g.deadline)} — cerca de <Money cents={Math.ceil(left / months!)} className="font-semibold" />/mês <span className="text-subtle">(estimativa)</span></span>
                    )
                  ) : <span>Faltam <Money cents={left} className="font-semibold" /></span>}
                </div>
                <div className="mt-auto flex gap-2 pt-4">
                  {canContribute && <Button size="sm" variant="subtle" icon={<Plus className="size-4" />} onClick={() => setContributing({ goal: g, sign: 1 })}>Guardar</Button>}
                  {canContribute && saved > 0 && <Button size="sm" variant="ghost" icon={<Minus className="size-4" />} onClick={() => setContributing({ goal: g, sign: -1 })}>Retirar</Button>}
                  <div className="flex-1" />
                  {canEdit && <IconButton size="sm" label="Editar" onClick={() => setEditing(g)}><Pencil className="size-4" /></IconButton>}
                  {canEdit && <IconButton size="sm" label="Excluir" onClick={async () => { if (await confirm({ title: `Excluir a meta “${g.name}”?`, description: 'Os aportes registrados também serão removidos.', confirmLabel: 'Excluir' })) del.mutate(g.id); }}><Trash2 className="size-4" /></IconButton>}
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <p className="mt-4 text-[12px] text-subtle">Aportes em metas são reservas de controle e não movimentam saldos de contas. Para mover dinheiro de fato, registre uma transferência.</p>
      {editing && <GoalForm goal={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {contributing && <ContributionForm {...contributing} onClose={() => setContributing(null)} />}
    </>
  );
}

function GoalForm({ goal, onClose }: { goal: Goal | null; onClose: () => void }) {
  const ws = useWsId();
  const [name, setName] = useState(goal?.name ?? '');
  const [target, setTarget] = useState(goal?.target_cents ?? 0);
  const [deadline, setDeadline] = useState(goal?.deadline ?? '');
  const [color, setColor] = useState(goal?.color ?? '#10b981');
  const m = useMutation({
    mutationFn: () => {
      const p = { name: name.trim(), target_cents: target, deadline: deadline || null, color };
      return goal ? updateGoal(goal.id, p) : createGoal(ws, p);
    },
    onSuccess: () => { toast.success('Meta salva.'); void invalidateFinance(ws); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal open onClose={onClose} title={goal ? 'Editar meta' : 'Nova meta'} size="sm" footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={m.isPending} disabled={!name.trim() || target <= 0} onClick={() => !m.isPending && m.mutate()}>Salvar</Button></div>}>
      <div className="grid gap-4">
        <Field label="Nome">{(id) => <Input id={id} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Reserva de emergência" autoFocus />}</Field>
        <Field label="Valor desejado">{(id) => <MoneyInput id={id} value={target} onChange={setTarget} />}</Field>
        <Field label="Prazo" optional>{(id) => <Input id={id} type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />}</Field>
        <Field label="Cor">{() => <ColorPicker value={color} onChange={setColor} />}</Field>
      </div>
    </Modal>
  );
}

function ContributionForm({ goal, sign, onClose }: { goal: Goal; sign: 1 | -1; onClose: () => void }) {
  const ws = useWsId();
  const [amount, setAmount] = useState(0);
  const [date, setDate] = useState(todayISO());
  const req = useRef(newRequestId());
  const m = useMutation({
    mutationFn: () => addContribution(ws, goal.id, sign * amount, date, req.current),
    onSuccess: () => { toast.success(sign > 0 ? 'Aporte registrado.' : 'Retirada registrada.'); void invalidateFinance(ws); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const over = sign < 0 && amount > Number(goal.saved_cents);
  return (
    <Modal open onClose={onClose} title={sign > 0 ? `Guardar em “${goal.name}”` : `Retirar de “${goal.name}”`} size="sm" footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={m.isPending} disabled={amount <= 0 || over} onClick={() => !m.isPending && m.mutate()}>Confirmar</Button></div>}>
      <div className="grid gap-4">
        <Field label="Valor" error={over ? 'Maior que o valor guardado.' : undefined}>{(id) => <MoneyInput id={id} value={amount} onChange={setAmount} hero autoFocus />}</Field>
        <Field label="Data">{(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
      </div>
    </Modal>
  );
}
