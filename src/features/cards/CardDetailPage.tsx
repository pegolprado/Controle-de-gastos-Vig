import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Archive, ArrowLeft, CheckCircle2, CircleDashed, Clock, Pencil, Plus, Trash2, Wallet } from 'lucide-react';
import { useWorkspace, useWsId } from '@/app/WorkspaceProvider';
import { useCardLimits, useLookups, wsKey } from '@/hooks/useFinance';
import { useQuickAdd } from '@/features/transactions/QuickAdd';
import { TxRow } from '@/features/transactions/TxRow';
import { TransactionDetail } from '@/features/transactions/TransactionDetail';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge, Card, CardHeader, EmptyState, Progress, Skeleton } from '@/components/ui/Card';
import { Money } from '@/components/ui/Money';
import { useConfirm } from '@/components/ui/Confirm';
import { INVOICE_STATUS_LABEL } from '@/domain/labels';
import { capitalize, formatDate, monthLabel, todayISO } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import { invalidateFinance } from '@/lib/queryClient';
import { cn } from '@/lib/cn';
import type { Transaction } from '@/lib/types';
import { deleteCard, listInvoiceItems, listInvoices, updateCard } from '@/services/cards';
import { CardForm } from './CardForm';
import { CardVisual } from './CardVisual';

export default function CardDetailPage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const ws = useWsId();
  const { canEdit, canContribute } = useWorkspace();
  const { cardMap, loading } = useLookups();
  const limits = useCardLimits();
  const quickAdd = useQuickAdd();
  const confirm = useConfirm();
  const card = cardMap.get(id);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<Transaction | null>(null);

  const invoices = useQuery({ queryKey: wsKey(ws, 'invoices', 'card', id), queryFn: () => listInvoices(ws, { cardId: id }), enabled: Boolean(id) });
  const list = useMemo(() => invoices.data ?? [], [invoices.data]);
  const defaultInvoice = useMemo(() => {
    const today = todayISO();
    return list.find((i) => i.status === 'overdue') ?? list.find((i) => i.status !== 'paid' && i.closing_date <= today && i.total_cents > 0) ?? list.find((i) => i.status === 'open') ?? list[list.length - 1];
  }, [list]);
  const invoiceId = params.get('fatura') ?? defaultInvoice?.id;
  const invoice = list.find((i) => i.id === invoiceId) ?? defaultInvoice;
  useEffect(() => {
    document.getElementById(`inv-${invoice?.id}`)?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [invoice?.id]);

  const items = useQuery({ queryKey: wsKey(ws, 'invoice-items', invoice?.id), queryFn: () => listInvoiceItems(invoice!.id), enabled: Boolean(invoice) });
  const purchases = (items.data ?? []).filter((t) => t.kind === 'expense');
  const payments = (items.data ?? []).filter((t) => t.kind === 'card_payment');
  const limit = limits.data?.find((l) => l.card_id === id);
  const future = list.filter((i) => invoice && i.reference_month > invoice.reference_month && i.total_cents > 0);

  const archive = useMutation({ mutationFn: () => updateCard(id, { archived: !card?.archived }), onSuccess: () => void invalidateFinance(ws), onError: (e) => toast.error(errorMessage(e)) });
  const remove = useMutation({ mutationFn: () => deleteCard(id), onSuccess: () => { toast.success('Cartão excluído.'); void invalidateFinance(ws); history.back(); }, onError: (e) => toast.error(errorMessage(e)) });

  if (loading) return <Skeleton className="h-64" />;
  if (!card) return <EmptyState title="Cartão não encontrado" action={<Link to="/cartoes" className="font-semibold text-brand">Voltar</Link>} />;

  return (
    <>
      <Link to="/cartoes" className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-fg"><ArrowLeft className="size-4" /> Cartões</Link>
      <PageHeader
        title={card.name}
        subtitle={`${card.brand ?? 'Cartão de crédito'} · fecha dia ${card.closing_day}, vence dia ${card.due_day}`}
        actions={
          <>
            {canContribute && <Button size="sm" icon={<Plus className="size-4" />} onClick={() => quickAdd({ kind: 'expense', preset: { cardId: id } })}>Nova compra</Button>}
            {canEdit && <Button size="sm" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>Editar</Button>}
            {canEdit && <Button size="sm" variant="ghost" icon={<Archive className="size-4" />} onClick={() => archive.mutate()}>{card.archived ? 'Desarquivar' : 'Arquivar'}</Button>}
            {canEdit && (
              <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" />} onClick={async () => {
                if (await confirm({ title: 'Excluir cartão?', description: 'Só é possível excluir cartões sem compras registradas. Prefira arquivar.', confirmLabel: 'Excluir' })) remove.mutate();
              }}>Excluir</Button>
            )}
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
        <div className="flex flex-col gap-4">
          <CardVisual card={card} available={limit?.available_cents} used={limit?.used_cents} />
          <Card className="p-4">
            <div className="flex justify-between text-sm"><span className="text-muted">Limite utilizado</span><Money cents={limit?.used_cents ?? 0} className="font-semibold" /></div>
            <Progress className="my-2" value={card.limit_cents ? ((limit?.used_cents ?? 0) / card.limit_cents) * 100 : 0} tone={(limit?.available_cents ?? 0) < 0 ? 'negative' : 'brand'} label="Limite utilizado" />
            <div className="flex justify-between text-[13px] text-subtle"><span>Disponível <Money cents={limit?.available_cents ?? card.limit_cents} /></span><span>Total <Money cents={card.limit_cents} /></span></div>
            <p className="mt-3 text-[12px] text-subtle">O limite considera compras em todas as faturas ainda não pagas, inclusive parcelas futuras.</p>
          </Card>
          {future.length > 0 && (
            <Card>
              <CardHeader title="Projeção de faturas futuras" subtitle="Parcelas e compras já lançadas" />
              <ul className="p-3 pt-2">
                {future.slice(0, 8).map((i) => (
                  <li key={i.id}>
                    <button type="button" onClick={() => setParams({ fatura: i.id }, { replace: true })} className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2">
                      <span className="text-muted">{capitalize(monthLabel(i.reference_month))}</span>
                      <Money cents={i.total_cents} className="font-semibold" />
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          {invoices.isLoading ? <Skeleton className="h-20" /> : list.length === 0 ? (
            <Card><EmptyState icon={<Wallet className="size-6" />} title="Nenhuma fatura ainda" description="As faturas são criadas automaticamente quando você registra compras neste cartão." /></Card>
          ) : (
            <>
              <div className="scrollbar-none -mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Faturas">
                {list.map((i) => (
                  <button
                    key={i.id}
                    id={`inv-${i.id}`}
                    type="button"
                    role="tab"
                    aria-selected={i.id === invoice?.id}
                    onClick={() => setParams({ fatura: i.id }, { replace: true })}
                    className={cn('shrink-0 rounded-xl border px-3.5 py-2 text-left transition', i.id === invoice?.id ? 'border-brand/50 bg-brand/8' : 'border-line hover:border-line-strong')}
                  >
                    <span className="block text-sm font-semibold capitalize">{monthLabel(i.reference_month, { short: true })}</span>
                    <span className={cn('block text-[12px]', i.status === 'overdue' ? 'text-negative' : i.status === 'paid' ? 'text-positive' : 'text-subtle')}>{INVOICE_STATUS_LABEL[i.status]}</span>
                  </button>
                ))}
              </div>

              {invoice && (
                <Card className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-sm text-muted">Fatura de {monthLabel(invoice.reference_month)}</p>
                      <Money cents={invoice.total_cents} className="font-num text-3xl font-semibold" />
                      <p className="mt-1 text-[13px] text-subtle">Fecha em {formatDate(invoice.closing_date)} · vence em {formatDate(invoice.due_date)}</p>
                    </div>
                    <Badge tone={invoice.status === 'overdue' ? 'negative' : invoice.status === 'paid' ? 'positive' : invoice.status === 'open' ? 'info' : 'warning'}>{INVOICE_STATUS_LABEL[invoice.status]}</Badge>
                  </div>

                  {/* Explicação visual: pago / pendente / a vencer */}
                  <div className="mt-5 grid gap-2 sm:grid-cols-3">
                    <Explain icon={<CheckCircle2 className="size-4 text-positive" />} label="Já pago" cents={invoice.paid_cents} />
                    <Explain icon={<Clock className="size-4 text-warning" />} label={invoice.status === 'open' ? 'Acumulado (fatura aberta)' : 'Pendente de pagamento'} cents={Math.max(invoice.remaining_cents, 0)} />
                    <Explain icon={<CircleDashed className="size-4 text-info" />} label="Próximas faturas" cents={future.reduce((a, i) => a + i.total_cents, 0)} />
                  </div>
                  {invoice.remaining_cents < 0 && <p className="mt-3 text-[13px] text-info">Crédito de <Money cents={-invoice.remaining_cents} /> (pagamento maior que o total após estornos).</p>}
                  {canContribute && invoice.remaining_cents > 0 && (
                    <Button className="mt-5" variant="primary" icon={<Wallet className="size-4" />} onClick={() => quickAdd({ kind: 'card_payment', preset: { cardId: id, invoiceId: invoice.id, amount: invoice.remaining_cents, accountId: card.default_payment_account_id ?? undefined } })}>
                      Pagar fatura
                    </Button>
                  )}
                  {invoice.status === 'open' && <p className="mt-3 text-[12px] text-subtle">A fatura ainda está aberta: novas compras até {formatDate(invoice.closing_date)} entram nela.</p>}
                </Card>
              )}

              <Card className="p-2 sm:p-3">
                <h2 className="px-2 pb-1 pt-2 text-sm font-semibold">Compras ({purchases.length})</h2>
                {items.isLoading ? <Skeleton className="m-2 h-24" /> : purchases.length === 0 ? <p className="px-2 py-6 text-sm text-subtle">Nenhuma compra nesta fatura.</p> : purchases.map((t) => <TxRow key={t.id} tx={t} onOpen={setSelected} />)}
                {payments.length > 0 && (
                  <>
                    <h2 className="px-2 pb-1 pt-4 text-sm font-semibold">Pagamentos</h2>
                    {payments.map((t) => <TxRow key={t.id} tx={t} onOpen={setSelected} />)}
                  </>
                )}
              </Card>
            </>
          )}
        </div>
      </div>
      {editing && <CardForm card={card} onClose={() => setEditing(false)} />}
      {selected && <TransactionDetail tx={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

function Explain({ icon, label, cents }: { icon: React.ReactNode; label: string; cents: number }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2/50 px-3.5 py-3">
      <p className="flex items-center gap-1.5 text-[13px] text-muted">{icon}{label}</p>
      <Money cents={cents} className="font-num mt-0.5 block text-lg font-semibold" />
    </div>
  );
}
