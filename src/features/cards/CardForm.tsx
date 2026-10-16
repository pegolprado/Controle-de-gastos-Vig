import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useWsId } from '@/app/WorkspaceProvider';
import { useAccounts } from '@/hooks/useFinance';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Field';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { ColorPicker } from '@/components/ui/CategoryIcon';
import { errorMessage } from '@/lib/errors';
import { invalidateFinance } from '@/lib/queryClient';
import type { CreditCard } from '@/lib/types';
import { createCard, updateCard } from '@/services/cards';

export function CardForm({ card, onClose }: { card?: CreditCard | null; onClose: () => void }) {
  const ws = useWsId();
  const accounts = useAccounts();
  const [name, setName] = useState(card?.name ?? '');
  const [brand, setBrand] = useState(card?.brand ?? '');
  const [digits, setDigits] = useState(card?.last_digits ?? '');
  const [limit, setLimit] = useState(card?.limit_cents ?? 0);
  const [closing, setClosing] = useState(card?.closing_day ?? 1);
  const [due, setDue] = useState(card?.due_day ?? 10);
  const [color, setColor] = useState(card?.color ?? '#6366f1');
  const [account, setAccount] = useState(card?.default_payment_account_id ?? '');
  const valid = name.trim() && (!digits || /^\d{4}$/.test(digits));
  const m = useMutation({
    mutationFn: () => {
      const input = { name: name.trim(), brand: brand.trim() || null, last_digits: digits || null, limit_cents: limit, closing_day: closing, due_day: due, color, default_payment_account_id: account || null };
      return card ? updateCard(card.id, input) : createCard(ws, input);
    },
    onSuccess: () => { toast.success(card ? 'Cartão atualizado.' : 'Cartão cadastrado.'); void invalidateFinance(ws); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const days = Array.from({ length: 31 }, (_, i) => i + 1);
  return (
    <Modal
      open
      onClose={onClose}
      locked={m.isPending}
      title={card ? 'Editar cartão' : 'Novo cartão'}
      description="Nunca informe o número completo, CVV ou senha do cartão."
      footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={m.isPending} disabled={!valid} onClick={() => !m.isPending && m.mutate()}>Salvar</Button></div>}
    >
      <div className="grid gap-4">
        <Field label="Nome do cartão">{(id) => <Input id={id} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Nubank Platinum" autoFocus />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Bandeira" optional>{(id) => <Input id={id} value={brand} maxLength={30} onChange={(e) => setBrand(e.target.value)} placeholder="Visa, Master…" />}</Field>
          <Field label="Final" optional error={digits && !/^\d{4}$/.test(digits) ? '4 dígitos' : undefined}>{(id) => <Input id={id} value={digits} inputMode="numeric" maxLength={4} onChange={(e) => setDigits(e.target.value.replace(/\D/g, ''))} placeholder="1234" />}</Field>
        </div>
        <Field label="Limite total">{(id) => <MoneyInput id={id} value={limit} onChange={setLimit} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Dia de fechamento" hint="Compras a partir deste dia vão para a próxima fatura.">
            {(id, d) => <Select id={id} aria-describedby={d} value={closing} onChange={(e) => setClosing(Number(e.target.value))}>{days.map((n) => <option key={n} value={n}>{n}</option>)}</Select>}
          </Field>
          <Field label="Dia de vencimento">
            {(id) => <Select id={id} value={due} onChange={(e) => setDue(Number(e.target.value))}>{days.map((n) => <option key={n} value={n}>{n}</option>)}</Select>}
          </Field>
        </div>
        <Field label="Conta usada para pagar" optional>
          {(id) => (
            <Select id={id} value={account} onChange={(e) => setAccount(e.target.value)}>
              <option value="">—</option>
              {(accounts.data ?? []).filter((a) => !a.archived).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Cor">{() => <ColorPicker value={color} onChange={setColor} />}</Field>
      </div>
    </Modal>
  );
}
