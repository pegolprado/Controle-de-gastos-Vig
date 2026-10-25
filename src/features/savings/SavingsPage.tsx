import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronDown, Copy, CreditCard, PiggyBank, Repeat, ShoppingBag, Sparkles, TrendingUp, X, type LucideIcon } from 'lucide-react';
import { useWorkspace, useWsId } from '@/app/WorkspaceProvider';
import { wsKey } from '@/hooks/useFinance';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge, Card, ErrorState, Skeleton } from '@/components/ui/Card';
import { Money } from '@/components/ui/Money';
import { cn } from '@/lib/cn';
import { addMonths, formatDate, todayISO } from '@/lib/dates';
import { formatBRL } from '@/lib/money';
import { descriptionKey } from '@/lib/statement';
import { errorMessage } from '@/lib/errors';
import { invalidateFinance } from '@/lib/queryClient';
import { detectWaste, type Subscription, type WasteItem, type WasteKind } from '@/domain/waste';
import { createRecurrence } from '@/services/planning';
import { listExpensesSince } from '@/services/transactions';

const HIDDEN_KEY = 'fmv.economia.ocultos';
const ICON: Record<WasteKind, LucideIcon> = { subscription: Repeat, increase: TrendingUp, repeat: ShoppingBag, fee: CreditCard, duplicate: Copy };
const LABEL: Record<WasteKind, string> = { subscription: 'Assinaturas', increase: 'Conta subiu', repeat: 'Compras frequentes', fee: 'Tarifas e juros', duplicate: 'Possível cobrança dupla' };

function readHidden(): string[] {
  try {
    return JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

export default function SavingsPage() {
  const ws = useWsId();
  const { canEdit } = useWorkspace();
  const today = todayISO();
  const q = useQuery({ queryKey: wsKey(ws, 'expenses-since', addMonths(today, -7).slice(0, 7)), queryFn: () => listExpensesSince(ws, addMonths(today, -7)) });
  const result = useMemo(() => (q.data ? detectWaste(q.data, today) : null), [q.data, today]);
  const [hidden, setHidden] = useState<string[]>(readHidden);
  const hide = (id: string) => {
    const next = [...hidden, id];
    setHidden(next);
    try {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify(next.slice(-200)));
    } catch {
      /* ignore */
    }
  };
  const items = (result?.items ?? []).filter((i) => !hidden.includes(i.id));
  const saving = items.reduce((s, i) => s + i.monthly_saving, 0);

  return (
    <>
      <PageHeader title="Economia" subtitle="Padrões que passam despercebidos no extrato. Sem julgamento: são só oportunidades." />
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !result ? (
        <div className="flex flex-col gap-4"><Skeleton className="h-28" /><Skeleton className="h-40" /></div>
      ) : (
        <div className="flex flex-col gap-4">
          <Card className="flex items-center gap-4 p-5" role="region" aria-label="Economia possível">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-positive/12 text-positive"><PiggyBank className="size-6" aria-hidden /></span>
            {saving > 0 ? (
              <div>
                <p className="text-[13px] font-semibold text-muted">Dá para economizar cerca de</p>
                <p className="font-num text-2xl font-bold text-positive"><Money cents={saving} /><span className="text-sm font-medium text-subtle">/mês</span></p>
                <p className="text-[13px] text-subtle">{formatBRL(saving * 12)} por ano, se seguir as sugestões abaixo.</p>
              </div>
            ) : (
              <div>
                <p className="font-semibold">Nada fora do comum por aqui 👏</p>
                <p className="text-[13px] text-subtle">{items.length ? 'Confira os avisos abaixo.' : 'O app olha os últimos meses de despesas e avisa quando achar algo.'}</p>
              </div>
            )}
          </Card>

          {items.map((i) => <WasteCard key={i.id} item={i} onHide={() => hide(i.id)} />)}

          <Subscriptions subs={result.subscriptions.filter((s) => s.active)} txs={q.data ?? []} canEdit={canEdit} ws={ws} />

          <p className="text-[12px] leading-relaxed text-subtle">
            A análise usa os últimos 7 meses de despesas (contas e cartões) e roda no seu aparelho. Economias são estimativas conservadoras.
            {hidden.length > 0 && (
              <> <button type="button" className="font-semibold text-brand hover:underline" onClick={() => { setHidden([]); try { localStorage.removeItem(HIDDEN_KEY); } catch { /* ignore */ } }}>Mostrar avisos ocultos ({hidden.length})</button></>
            )}
          </p>
        </div>
      )}
    </>
  );
}

function WasteCard({ item, onHide }: { item: WasteItem; onHide: () => void }) {
  const [open, setOpen] = useState(false);
  const Icon = ICON[item.kind];
  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl', item.kind === 'duplicate' || item.kind === 'increase' ? 'bg-warning/12 text-warning' : 'bg-brand/12 text-brand')}>
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-subtle">{LABEL[item.kind]}</p>
          <h2 className="font-semibold">{item.title}</h2>
          <p className="mt-1 text-[14px] text-muted">{item.detail}</p>
          {item.monthly_saving > 0 && (
            <Badge tone="positive" className="mt-2">economia de {formatBRL(item.monthly_saving)}/mês</Badge>
          )}
        </div>
        <IconButton size="sm" label="Ocultar este aviso" onClick={onHide}><X className="size-4" /></IconButton>
      </div>
      {item.examples.length > 0 && (
        <>
          <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="mt-3 flex items-center gap-1 text-[13px] font-semibold text-brand">
            Ver lançamentos <ChevronDown className={cn('size-4 transition', open && 'rotate-180')} aria-hidden />
          </button>
          {open && (
            <ul className="mt-2 divide-y divide-line text-[14px]">
              {item.examples.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0 truncate">{e.description} <span className="text-[12px] text-subtle">· {formatDate(e.occurred_on)}</span></span>
                  <Money cents={e.amount_cents} className="font-num font-medium" />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}

type ExpenseRow = Awaited<ReturnType<typeof listExpensesSince>>[number];

function Subscriptions({ subs, txs, canEdit, ws }: { subs: Subscription[]; txs: ExpenseRow[]; canEdit: boolean; ws: string }) {
  const lastOf = (s: Subscription) => [...txs].reverse().find((t) => descriptionKey(t.description) === s.key);
  const make = useMutation({
    mutationFn: async (s: Subscription) => {
      const t = lastOf(s)!;
      // começa na próxima cobrança: as já lançadas continuam como estão
      return createRecurrence(ws, {
        kind: 'expense',
        description: t.description,
        amount_cents: s.monthly,
        category_id: t.category_id,
        account_id: t.card_id ? null : t.account_id,
        card_id: t.card_id,
        payment_method: t.payment_method,
        frequency: 'monthly',
        interval_count: 1,
        start_date: addMonths(s.last, 1),
        end_date: null,
        notes: 'Criada pela Economia (cobrança mensal detectada)',
      });
    },
    onSuccess: (_, s) => {
      toast.success(`${s.name} agora é recorrente: as próximas cobranças entram sozinhas na agenda e na previsão.`);
      void invalidateFinance(ws);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!subs.length) return null;
  const total = subs.reduce((s, x) => s + x.monthly, 0);
  return (
    <Card>
      <div className="px-5 pt-5">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold"><Sparkles className="size-4 text-brand" aria-hidden />Cobranças que se repetem todo mês</h2>
        <p className="text-[13px] text-subtle">{subs.length} encontradas · {formatBRL(total)}/mês · {formatBRL(total * 12)}/ano</p>
      </div>
      <ul className="mt-2 divide-y divide-line" aria-label="Cobranças mensais">
        {subs.map((s) => {
          const t = lastOf(s);
          const linked = !!t?.recurrence_id;
          return (
            <li key={s.key} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{s.name}</p>
                <p className="text-[12px] text-subtle">{s.count} meses seguidos · próxima ~{formatDate(addMonths(s.last, 1))}</p>
              </div>
              <Money cents={s.monthly} className="font-num font-semibold" />
              {canEdit && !linked && t && (
                <Button size="sm" variant="subtle" className="w-full sm:w-auto" icon={<Repeat className="size-4" />} loading={make.isPending && make.variables?.key === s.key} onClick={() => make.mutate(s)}>
                  Tornar recorrente
                </Button>
              )}
              {linked && <Badge tone="info">Recorrente</Badge>}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
