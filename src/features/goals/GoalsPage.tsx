import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Car, CheckCircle2, CreditCard, Home, Minus, Pencil, Plane, Plus, ShieldCheck, ShoppingBag, Sparkles, Target, Trash2, type LucideIcon } from 'lucide-react';
import { useWorkspace, useWsId } from '@/app/WorkspaceProvider';
import { wsKey } from '@/hooks/useFinance';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge, Card, EmptyState, ErrorState, Progress, Skeleton } from '@/components/ui/Card';
import { Field, Input } from '@/components/ui/Field';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { Modal } from '@/components/ui/Modal';
import { Money } from '@/components/ui/Money';
import { ColorPicker } from '@/components/ui/CategoryIcon';
import { useConfirm } from '@/components/ui/Confirm';
import { capitalize, formatDate, monthLabel, todayISO } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { formatBRL, formatPercent } from '@/lib/money';
import { errorMessage } from '@/lib/errors';
import { newRequestId } from '@/lib/id';
import { invalidateFinance } from '@/lib/queryClient';
import type { Goal } from '@/lib/types';
import { addContribution, createGoal, deleteGoal, listGoals, updateGoal } from '@/services/planning';
import { useCapacity } from './useCapacity';
import { emergencyTarget, GOAL_TYPES, isGoalType, planGoal, type Capacity, type GoalPlan, type GoalType } from '@/domain/goals';

const TYPE_ICON: Record<GoalType, LucideIcon> = { emergency: ShieldCheck, car: Car, home: Home, travel: Plane, debt: CreditCard, purchase: ShoppingBag, target: Target };
const goalType = (g: Pick<Goal, 'icon'>): GoalType => (isGoalType(g.icon) ? g.icon : 'target');
const when = (iso: string) => capitalize(monthLabel(iso));

/** Planos de todas as metas: a sobra é dividida pela ordem de prazo (as mais urgentes primeiro). */
function plansFor(goals: Goal[], cap: Capacity | null, today: string): Map<string, GoalPlan> {
  const out = new Map<string, GoalPlan>();
  let used = 0;
  const ordered = [...goals].sort((a, b) => (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999'));
  for (const g of ordered) {
    const available = (cap?.surplus ?? 0) - used;
    const plan = planGoal({ target: g.target_cents, saved: Number(g.saved_cents), deadline: g.deadline }, today, available);
    // meta que não cabe segue no ritmo realista (metade da sobra livre) e deixa o resto para as outras
    if (plan.status === 'over') used += Math.max(0, Math.round(available * 0.5));
    else if (plan.status !== 'done' && plan.status !== 'late') used += plan.monthly;
    out.set(g.id, plan);
  }
  return out;
}

export default function GoalsPage() {
  const ws = useWsId();
  const { canEdit, canContribute } = useWorkspace();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: wsKey(ws, 'goals'), queryFn: () => listGoals(ws) });
  const [editing, setEditing] = useState<Goal | 'new' | null>(null);
  const [contributing, setContributing] = useState<{ goal: Goal; sign: 1 | -1 } | null>(null);
  const del = useMutation({ mutationFn: deleteGoal, onSuccess: () => void invalidateFinance(ws), onError: (e) => toast.error(errorMessage(e)) });
  const list = (q.data ?? []).filter((g) => !g.archived);
  const cap = useCapacity();
  const today = todayISO();
  const plans = useMemo(() => plansFor(list, cap, today), [list, cap, today]);
  const asked = [...plans.values()].filter((p) => p.status !== 'done' && p.status !== 'late').reduce((s, p) => s + p.monthly, 0);

  return (
    <>
      <PageHeader title="Metas" subtitle="Reserve dinheiro para o que importa e acompanhe o progresso." actions={canEdit && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>Nova meta</Button>} />
      {q.isLoading ? <Skeleton className="h-48" /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : list.length === 0 ? (
        <Card><EmptyState icon={<Target className="size-6" />} title="Nenhuma meta" description="Viagem, reserva de emergência, carro novo… defina um valor e um prazo." action={canEdit && <Button variant="primary" onClick={() => setEditing('new')}>Criar meta</Button>} /></Card>
      ) : (
        <>
        <CapacityCard cap={cap} asked={asked} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((g) => {
            const saved = Number(g.saved_cents);
            const pct = (saved / g.target_cents) * 100;
            const plan = plans.get(g.id)!;
            const Icon = TYPE_ICON[goalType(g)];
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
                    <p className="flex items-center gap-1.5 truncate font-semibold"><Icon className="size-4 shrink-0" style={{ color: g.color }} aria-hidden />{g.name}</p>
                    <p className="font-num text-xl font-semibold"><Money cents={saved} /></p>
                    <p className="text-[13px] text-subtle">de <Money cents={g.target_cents} /> · {formatPercent(pct)}</p>
                  </div>
                </div>
                <PlanLine plan={plan} deadline={g.deadline} hasData={!!cap?.months} />
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
        </>
      )}
      <p className="mt-4 text-[12px] text-subtle">Aportes em metas são reservas de controle e não movimentam saldos de contas. Para mover dinheiro de fato, registre uma transferência.</p>
      {editing && <GoalForm goal={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {contributing && <ContributionForm {...contributing} onClose={() => setContributing(null)} />}
    </>
  );
}

function CapacityCard({ cap, asked }: { cap: Capacity | null; asked: number }) {
  if (!cap) return <Skeleton className="mb-4 h-24" />;
  if (!cap.months) {
    return (
      <Card className="mb-4 flex items-start gap-3 p-4 text-[14px] text-muted">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
        Registre suas receitas e despesas por um mês e o app monta um plano para cada meta, com quanto guardar por mês.
      </Card>
    );
  }
  const pct = cap.surplus > 0 ? (asked / cap.surplus) * 100 : 100;
  return (
    <Card className="mb-4 p-5" role="region" aria-label="Seu plano">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[13px] font-semibold text-muted">Sobra média por mês</p>
          <p className={cn('font-num text-2xl font-bold', cap.surplus > 0 ? 'text-positive' : 'text-negative')}><Money cents={cap.surplus} /></p>
          <p className="text-[12px] text-subtle">entra {formatBRL(cap.income)} · sai {formatBRL(cap.expense)} (média de {cap.months} {cap.months === 1 ? 'mês' : 'meses'})</p>
        </div>
        <div className="sm:text-right">
          <p className="text-[13px] font-semibold text-muted">Suas metas pedem</p>
          <p className="font-num text-2xl font-bold"><Money cents={asked} /><span className="text-sm font-medium text-subtle">/mês</span></p>
        </div>
      </div>
      {cap.surplus > 0 ? (
        <>
          <Progress value={pct} tone={pct > 100 ? 'negative' : pct > 70 ? 'warning' : 'positive'} className="mt-3 h-2.5" label="Parte da sobra usada pelas metas" />
          <p className="mt-2 text-[13px] text-muted">
            {pct > 100
              ? `As metas pedem mais do que sobra. Alongue algum prazo ou corte um gasto: veja a sugestão em cada meta.`
              : `As metas usam ${formatPercent(pct)} da sua sobra. ${pct <= 70 ? 'Sobra folga para imprevistos.' : 'Está apertado: deixe uma folga para imprevistos.'}`}
          </p>
        </>
      ) : (
        <p className="mt-2 flex items-start gap-2 text-[13px] text-muted">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-label="Atenção" />
          Nos últimos meses saiu mais do que entrou. Antes de guardar, vale olhar a Economia e a Previsão para equilibrar as contas.
        </p>
      )}
    </Card>
  );
}

function PlanLine({ plan, deadline, hasData }: { plan: GoalPlan; deadline: string | null; hasData: boolean }) {
  const box = 'mt-4 rounded-xl px-3 py-2.5 text-[13px]';
  if (plan.status === 'done') return <div className="mt-4"><Badge tone="positive">Meta atingida 🎉</Badge></div>;
  if (plan.status === 'late') {
    return <p className={cn(box, 'bg-negative/10')}>O prazo passou ({formatDate(deadline)}) e faltam <Money cents={plan.left} className="font-semibold" />. {plan.eta && <>Um prazo realista seria <strong>{when(plan.eta)}</strong>.</>}</p>;
  }
  if (plan.status === 'open') {
    return (
      <p className={cn(box, 'bg-surface-2 text-muted')}>
        Faltam <Money cents={plan.left} className="font-semibold text-fg" />.{' '}
        {plan.eta ? <>Guardando <strong className="text-fg">{formatBRL(plan.monthly)}/mês</strong> (30% da sua sobra), chega em <strong className="text-fg">{when(plan.eta)}</strong>.</> : hasData ? 'Defina um prazo para ver quanto guardar por mês.' : ''}
      </p>
    );
  }
  const tone = plan.status === 'ok' ? 'bg-positive/10' : plan.status === 'tight' ? 'bg-warning/10' : 'bg-negative/10';
  const Icon = plan.status === 'ok' ? CheckCircle2 : AlertTriangle;
  return (
    <div className={cn(box, tone)}>
      <p className="flex items-start gap-1.5">
        <Icon className={cn('mt-0.5 size-4 shrink-0', plan.status === 'ok' ? 'text-positive' : plan.status === 'tight' ? 'text-warning' : 'text-negative')} aria-hidden />
        <span>
          Guarde <strong>{formatBRL(plan.monthly)}/mês</strong> por {plan.monthsLeft} {plan.monthsLeft === 1 ? 'mês' : 'meses'} até {formatDate(deadline)}.{' '}
          {hasData && plan.share !== null && plan.status === 'ok' && <>Cabe com folga ({formatPercent(plan.share * 100)} da sobra).</>}
          {hasData && plan.share !== null && plan.status === 'tight' && <>Aperta: usa {formatPercent(plan.share * 100)} da sobra livre.</>}
          {hasData && plan.status === 'over' && (plan.eta ? <>Não cabe na sua sobra. Prazo realista: <strong>{when(plan.eta)}</strong>.</> : <>Hoje não sobra dinheiro no mês para esta meta.</>)}
        </span>
      </p>
    </div>
  );
}

function GoalForm({ goal, onClose }: { goal: Goal | null; onClose: () => void }) {
  const ws = useWsId();
  const cap = useCapacity();
  const [type, setType] = useState<GoalType>(goal ? goalType(goal) : 'target');
  const [name, setName] = useState(goal?.name ?? '');
  const [target, setTarget] = useState(goal?.target_cents ?? 0);
  const [deadline, setDeadline] = useState(goal?.deadline ?? '');
  const [color, setColor] = useState(goal?.color ?? '#10b981');
  const info = GOAL_TYPES.find((t) => t.type === type);
  const suggested = type === 'emergency' && cap ? emergencyTarget(cap) : 0;
  const preview = target > 0 ? planGoal({ target, saved: Number(goal?.saved_cents ?? 0), deadline: deadline || null }, todayISO(), cap?.surplus ?? 0) : null;
  const pick = (t: GoalType) => {
    const next = GOAL_TYPES.find((x) => x.type === t);
    // troca o nome só se ainda for o nome sugerido (ou vazio)
    if (next && (!name.trim() || GOAL_TYPES.some((x) => x.name === name))) setName(next.name);
    setType(t);
  };
  const m = useMutation({
    mutationFn: () => {
      const p = { name: name.trim(), target_cents: target, deadline: deadline || null, color, icon: type };
      return goal ? updateGoal(goal.id, p) : createGoal(ws, p);
    },
    onSuccess: () => { toast.success('Meta salva.'); void invalidateFinance(ws); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal open onClose={onClose} title={goal ? 'Editar meta' : 'Nova meta'} size="sm" footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={m.isPending} disabled={!name.trim() || target <= 0} onClick={() => !m.isPending && m.mutate()}>Salvar</Button></div>}>
      <div className="grid gap-4">
        <div role="radiogroup" aria-label="Tipo de meta" className="flex flex-wrap gap-1.5">
          {GOAL_TYPES.map((t) => {
            const Icon = TYPE_ICON[t.type];
            const on = type === t.type;
            return (
              <button key={t.type} type="button" role="radio" aria-checked={on} onClick={() => pick(t.type)} className={cn('flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-semibold transition', on ? 'border-brand/50 bg-brand/10 text-fg' : 'border-line text-muted hover:border-line-strong')}>
                <Icon className="size-3.5" aria-hidden />{t.label}
              </button>
            );
          })}
        </div>
        {info && <p className="-mt-2 text-[12px] text-subtle">{info.hint}</p>}
        <Field label="Nome">{(id) => <Input id={id} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Reserva de emergência" data-autofocus />}</Field>
        <Field label="Valor desejado">{(id) => <MoneyInput id={id} value={target} onChange={setTarget} />}</Field>
        {suggested > 0 && target !== suggested && (
          <button type="button" onClick={() => setTarget(suggested)} className="-mt-2 flex items-start gap-1.5 rounded-xl bg-brand/8 px-3 py-2 text-left text-[13px]">
            <Sparkles className="mt-0.5 size-3.5 shrink-0 text-brand" aria-hidden />
            <span>Sugestão: 6 meses dos seus gastos = <strong>{formatBRL(suggested)}</strong>. Toque para usar.</span>
          </button>
        )}
        <Field label="Prazo" optional>{(id) => <Input id={id} type="date" value={deadline} min={todayISO()} onChange={(e) => setDeadline(e.target.value)} />}</Field>
        {preview && cap && cap.months > 0 && <div className="-mt-2" aria-live="polite"><PlanLine plan={preview} deadline={deadline || null} hasData /></div>}
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
