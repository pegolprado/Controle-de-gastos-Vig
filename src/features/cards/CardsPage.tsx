import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CreditCard as CardIcon, Plus } from 'lucide-react';
import { useWorkspace } from '@/app/WorkspaceProvider';
import { useCardLimits, useCards, useOpenInvoices } from '@/hooks/useFinance';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge, Card, EmptyState, ErrorState, Skeleton } from '@/components/ui/Card';
import { Money } from '@/components/ui/Money';
import { INVOICE_STATUS_LABEL } from '@/domain/labels';
import { formatDate, monthLabel } from '@/lib/dates';
import { CardForm } from './CardForm';
import { CardVisual } from './CardVisual';

export default function CardsPage() {
  const { canEdit } = useWorkspace();
  const cards = useCards();
  const limits = useCardLimits();
  const invoices = useOpenInvoices();
  const [creating, setCreating] = useState(false);
  const list = (cards.data ?? []).filter((c) => !c.archived);
  return (
    <>
      <PageHeader
        title="Cartões de crédito"
        subtitle="Compras entram na fatura; o pagamento da fatura não conta como nova despesa."
        actions={canEdit && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>Novo cartão</Button>}
      />
      {cards.isLoading ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="aspect-[1.586]" />)}</div>
      ) : cards.error ? (
        <ErrorState error={cards.error} onRetry={() => void cards.refetch()} />
      ) : list.length === 0 ? (
        <Card><EmptyState icon={<CardIcon className="size-6" />} title="Nenhum cartão" description="Cadastre seus cartões para acompanhar faturas, limite e parcelas futuras." action={canEdit && <Button variant="primary" onClick={() => setCreating(true)}>Cadastrar cartão</Button>} /></Card>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((c) => {
            const l = limits.data?.find((x) => x.card_id === c.id);
            const open = (invoices.data ?? []).filter((i) => i.card_id === c.id && i.total_cents > 0);
            const current = open.find((i) => i.status === 'open') ?? open[0];
            return (
              <Link key={c.id} to={`/cartoes/${c.id}`} className="group flex flex-col gap-3 rounded-[24px] outline-offset-4 transition hover:-translate-y-0.5">
                <CardVisual card={c} available={l?.available_cents} used={l?.used_cents} />
                <div className="flex items-center justify-between gap-2 px-1 text-sm">
                  {current ? (
                    <>
                      <span className="text-muted">
                        Fatura de {monthLabel(current.reference_month, { year: false })} · {formatDate(current.due_date)}
                        <Badge tone={current.status === 'overdue' ? 'negative' : current.status === 'open' ? 'info' : 'warning'} className="ml-2">{INVOICE_STATUS_LABEL[current.status]}</Badge>
                      </span>
                      <Money cents={current.remaining_cents} className="font-semibold" />
                    </>
                  ) : (
                    <span className="text-subtle">Sem fatura em aberto</span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
      {creating && <CardForm onClose={() => setCreating(false)} />}
    </>
  );
}
