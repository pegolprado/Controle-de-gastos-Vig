import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { Money } from '@/components/ui/Money';
import { settleTransaction } from '@/services/transactions';
import { errorMessage } from '@/lib/errors';
import { newRequestId } from '@/lib/id';
import { todayISO } from '@/lib/dates';
import { setFormDirty, trackPending } from '@/lib/formGuard';
import type { Transaction } from '@/lib/types';

/** Pagamento total ou parcial, com juros e descontos — sempre por ação explícita. */
export function SettleDialog({ tx, onClose, onDone }: { tx: Transaction; onClose: () => void; onDone: () => void }) {
  const remaining = tx.amount_cents - tx.settled_principal_cents;
  const [principal, setPrincipal] = useState(remaining);
  const [interest, setInterest] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [date, setDate] = useState(todayISO());
  const requestId = useRef(newRequestId());
  const formId = useRef(newRequestId());
  useEffect(() => {
    const id = formId.current;
    setFormDirty(id, true);
    return () => setFormDirty(id, false);
  }, []);

  const m = useMutation({
    mutationFn: () => settleTransaction(tx.id, { principal_cents: principal, interest_cents: interest, discount_cents: discount, paid_on: date }, requestId.current),
    onSuccess: () => {
      toast.success(principal >= remaining ? 'Liquidado por completo.' : 'Pagamento parcial registrado.');
      onDone();
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const invalid = principal <= 0 || principal > remaining || discount > principal + interest;
  const total = principal + interest - discount;

  return (
    <Modal
      open
      onClose={onClose}
      locked={m.isPending}
      title={tx.kind === 'income' ? 'Registrar recebimento' : 'Registrar pagamento'}
      description={<>Em aberto: <Money cents={remaining} className="font-semibold text-fg" /></>}
      size="sm"
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted">
            Total: <Money cents={total} className="font-semibold text-fg" />
          </p>
          <Button variant="primary" loading={m.isPending} disabled={invalid} onClick={() => !m.isPending && void trackPending(m.mutateAsync()).catch(() => undefined)}>
            Confirmar
          </Button>
        </div>
      }
    >
      <div className="grid gap-4">
        <Field label="Valor principal" hint={principal < remaining ? 'Pagamento parcial — o restante continua em aberto.' : 'Quita o valor em aberto.'} error={principal > remaining ? 'Maior que o valor em aberto.' : undefined}>
          {(id, d) => <MoneyInput id={id} aria-describedby={d} value={principal} onChange={setPrincipal} />}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Juros/multa">{(id) => <MoneyInput id={id} value={interest} onChange={setInterest} />}</Field>
          <Field label="Desconto" error={discount > principal + interest ? 'Desconto excessivo.' : undefined}>{(id) => <MoneyInput id={id} value={discount} onChange={setDiscount} />}</Field>
        </div>
        <Field label="Data do pagamento">{(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
      </div>
    </Modal>
  );
}
