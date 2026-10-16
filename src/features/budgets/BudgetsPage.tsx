import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Copy, PieChart, Plus, Trash2 } from 'lucide-react';
import { useWorkspace, useWsId } from '@/app/WorkspaceProvider';
import { useCategories, wsKey } from '@/hooks/useFinance';
import { MonthPicker, PageHeader } from '@/components/layout/PageHeader';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge, Card, EmptyState, ErrorState, Progress, Skeleton } from '@/components/ui/Card';
import { Field, Select } from '@/components/ui/Field';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { Modal } from '@/components/ui/Modal';
import { Money } from '@/components/ui/Money';
import { CategoryIcon } from '@/components/ui/CategoryIcon';
import { useConfirm } from '@/components/ui/Confirm';
import { budgetUsage, projectMonthEnd } from '@/domain/budget';
import { addMonths, capitalize, daysInMonth, monthLabel, parseISO, startOfMonth, todayISO } from '@/lib/dates';
import { formatPercent } from '@/lib/money';
import { errorMessage } from '@/lib/errors';
import { invalidateFinance } from '@/lib/queryClient';
import { cn } from '@/lib/cn';
import type { BudgetProgress } from '@/lib/types';
import { budgetProgress, copyBudgets, deleteBudget, upsertBudget } from '@/services/planning';

const THRESHOLDS = [50, 75, 90, 100];

export default function BudgetsPage() {
  const ws = useWsId();
  const { canEdit } = useWorkspace();
  const confirm = useConfirm();
  const [month, setMonth] = useState(startOfMonth(todayISO()));
  const [editing, setEditing] = useState<BudgetProgress | 'new' | null>(null);
  const q = useQuery({ queryKey: wsKey(ws, 'budgets', month), queryFn: () => budgetProgress(ws, month) });
  const copy = useMutation({
    mutationFn: () => copyBudgets(ws, addMonths(month, -1), month),
    onSuccess: (n) => { toast.success(n ? `${n} orçamentos copiados.` : 'Nada novo para copiar.'); void invalidateFinance(ws); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const del = useMutation({ mutationFn: deleteBudget, onSuccess: () => void invalidateFinance(ws), onError: (e) => toast.error(errorMessage(e)) });

  const list = q.data ?? [];
  const total = list.reduce((a, b) => ({ limit: a.limit + Number(b.limit_cents), spent: a.spent + Number(b.spent_cents) }), { limit: 0, spent: 0 });
  const isCurrent = month === startOfMonth(todayISO());
  const { y, m, d } = parseISO(todayISO());
  const projection = isCurrent ? projectMonthEnd(total.spent, d, daysInMonth(y, m)) : null;

  return (
    <>
      <PageHeader
        title="Orçamentos"
        subtitle="Limites mensais por categoria, com alertas em 50%, 75%, 90% e 100%."
        actions={
          <>
            <MonthPicker value={month} onChange={setMonth} />
            {canEdit && <Button size="sm" icon={<Copy className="size-4" />} loading={copy.isPending} onClick={() => copy.mutate()}>Copiar do mês anterior</Button>}
            {canEdit && <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>Novo</Button>}
          </>
        }
      />
      {list.length > 0 && (
        <Card className="mb-5 p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-sm text-muted">{capitalize(monthLabel(month))}</p>
              <p className="font-num text-2xl font-semibold"><Money cents={total.spent} /> <span className="text-base font-normal text-subtle">de <Money cents={total.limit} /></span></p>
            </div>
            <p className={cn('font-num text-2xl font-semibold', total.spent > total.limit ? 'text-negative' : 'text-positive')}>{formatPercent(total.limit ? (total.spent / total.limit) * 100 : 0)}</p>
          </div>
          <Progress className="mt-3" value={total.limit ? (total.spent / total.limit) * 100 : 0} tone={total.spent > total.limit ? 'negative' : total.spent / total.limit >= 0.75 ? 'warning' : 'positive'} label="Total do orçamento" />
          {projection !== null && (
            <p className="mt-3 text-[13px] text-subtle">
              <Badge tone="info" className="mr-1.5">Estimativa</Badge>
              No ritmo atual, os gastos orçados devem fechar o mês em torno de <Money cents={projection} className="font-semibold text-muted" />. Projeção linear simples, não é garantia.
            </p>
          )}
        </Card>
      )}
      {q.isLoading ? <Skeleton className="h-48" /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : list.length === 0 ? (
        <Card><EmptyState icon={<PieChart className="size-6" />} title="Nenhum orçamento neste mês" description="Defina quanto pretende gastar por categoria. Você será avisado ao atingir 50%, 75%, 90% e 100%." action={canEdit && <Button variant="primary" onClick={() => setEditing('new')}>Criar orçamento</Button>} /></Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {list.map((b) => {
            const u = budgetUsage(Number(b.spent_cents), Number(b.limit_cents));
            const tone = u.level === 'over' ? 'negative' : u.level === 'critical' || u.level === 'warning' ? 'warning' : 'positive';
            return (
              <Card key={b.budget_id} className="p-5">
                <div className="flex items-center gap-3">
                  <CategoryIcon icon={b.icon} color={b.color} />
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => canEdit && setEditing(b)} disabled={!canEdit}>
                    <p className="truncate font-semibold">{b.name}</p>
                    <p className="text-[13px] text-subtle"><Money cents={Number(b.spent_cents)} /> de <Money cents={Number(b.limit_cents)} /></p>
                  </button>
                  <span className={cn('font-num text-lg font-semibold', tone === 'negative' ? 'text-negative' : tone === 'warning' ? 'text-warning' : 'text-fg')}>{formatPercent(u.pct)}</span>
                  {canEdit && (
                    <IconButton size="sm" label="Remover orçamento" onClick={async () => { if (await confirm({ title: `Remover orçamento de ${b.name}?`, confirmLabel: 'Remover' })) del.mutate(b.budget_id); }}>
                      <Trash2 className="size-4" />
                    </IconButton>
                  )}
                </div>
                <div className="relative mt-3">
                  <Progress value={u.pct} tone={tone} label={`Orçamento de ${b.name}`} />
                  {b.alert_thresholds.filter((t) => t < 100).map((t) => <span key={t} className="absolute top-0 h-2 w-px bg-bg/80" style={{ left: `${t}%` }} aria-hidden />)}
                </div>
                <p className={cn('mt-2 text-[13px]', u.remaining < 0 ? 'text-negative' : 'text-subtle')}>
                  {u.remaining >= 0 ? <>Restam <Money cents={u.remaining} className="font-semibold text-muted" /></> : <>Excedido em <Money cents={-u.remaining} className="font-semibold" /></>}
                </p>
              </Card>
            );
          })}
        </div>
      )}
      {editing && <BudgetForm month={month} budget={editing === 'new' ? null : editing} existing={list.map((b) => b.category_id)} onClose={() => setEditing(null)} />}
    </>
  );
}

function BudgetForm({ month, budget, existing, onClose }: { month: string; budget: BudgetProgress | null; existing: string[]; onClose: () => void }) {
  const ws = useWsId();
  const categories = useCategories();
  const [categoryId, setCategoryId] = useState(budget?.category_id ?? '');
  const [limit, setLimit] = useState(Number(budget?.limit_cents ?? 0));
  const [thresholds, setThresholds] = useState<number[]>(budget?.alert_thresholds ?? THRESHOLDS);
  const options = (categories.data ?? []).filter((c) => c.kind === 'expense' && !c.parent_id && !c.archived && (c.id === budget?.category_id || !existing.includes(c.id)));
  const m = useMutation({
    mutationFn: () => upsertBudget(ws, { category_id: categoryId, month, limit_cents: limit, alert_thresholds: [...thresholds].sort((a, b) => a - b) }),
    onSuccess: () => { toast.success('Orçamento salvo.'); void invalidateFinance(ws); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal open onClose={onClose} title={budget ? `Orçamento de ${budget.name}` : 'Novo orçamento'} description={capitalize(monthLabel(month))} size="sm"
      footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={m.isPending} disabled={!categoryId || limit <= 0} onClick={() => !m.isPending && m.mutate()}>Salvar</Button></div>}>
      <div className="grid gap-4">
        <Field label="Categoria">
          {(id) => (
            <Select id={id} value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={Boolean(budget)}>
              <option value="">Selecione…</option>
              {options.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Limite mensal" hint="Inclui todas as subcategorias.">{(id, d) => <MoneyInput id={id} aria-describedby={d} value={limit} onChange={setLimit} />}</Field>
        <fieldset>
          <legend className="mb-2 text-[13px] font-semibold text-muted">Alertas</legend>
          <div className="flex gap-2">
            {THRESHOLDS.map((t) => {
              const on = thresholds.includes(t);
              return (
                <button key={t} type="button" aria-pressed={on} onClick={() => setThresholds((s) => (on ? s.filter((x) => x !== t) : [...s, t]))}
                  className={cn('h-9 flex-1 rounded-lg border text-sm font-semibold transition', on ? 'border-brand/50 bg-brand/10 text-fg' : 'border-line text-subtle')}>
                  {t}%
                </button>
              );
            })}
          </div>
        </fieldset>
      </div>
    </Modal>
  );
}
