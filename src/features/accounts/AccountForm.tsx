import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useWsId } from '@/app/WorkspaceProvider';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Switch } from '@/components/ui/Field';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { ColorPicker } from '@/components/ui/CategoryIcon';
import { ACCOUNT_TYPE_LABEL } from '@/domain/labels';
import { errorMessage } from '@/lib/errors';
import { invalidateFinance } from '@/lib/queryClient';
import type { Account, AccountType } from '@/lib/types';
import { createAccount, updateAccount } from '@/services/accounts';

export function AccountForm({ account, onClose }: { account?: Account | null; onClose: () => void }) {
  const ws = useWsId();
  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState<AccountType>(account?.type ?? 'checking');
  const [institution, setInstitution] = useState(account?.institution ?? '');
  const [initial, setInitial] = useState(account?.initial_balance_cents ?? 0);
  const [color, setColor] = useState(account?.color ?? '#10b981');
  const [include, setInclude] = useState(account?.include_in_total ?? true);
  const m = useMutation({
    mutationFn: () => {
      const input = { name: name.trim(), type, institution: institution.trim() || null, initial_balance_cents: initial, color, include_in_total: include };
      return account ? updateAccount(account.id, input) : createAccount(ws, input);
    },
    onSuccess: () => {
      toast.success(account ? 'Conta atualizada.' : 'Conta criada.');
      void invalidateFinance(ws);
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal
      open
      onClose={onClose}
      locked={m.isPending}
      title={account ? 'Editar conta' : 'Nova conta'}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" loading={m.isPending} disabled={!name.trim()} onClick={() => !m.isPending && m.mutate()}>Salvar</Button>
        </div>
      }
    >
      <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (name.trim() && !m.isPending) m.mutate(); }}>
        <Field label="Nome">{(id) => <Input id={id} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Nubank, Itaú, Carteira" autoFocus />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tipo">
            {(id) => (
              <Select id={id} value={type} onChange={(e) => setType(e.target.value as AccountType)}>
                {(Object.keys(ACCOUNT_TYPE_LABEL) as AccountType[]).map((t) => <option key={t} value={t}>{ACCOUNT_TYPE_LABEL[t]}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Instituição" optional>{(id) => <Input id={id} value={institution} maxLength={60} onChange={(e) => setInstitution(e.target.value)} />}</Field>
        </div>
        <Field label="Saldo inicial" hint="Saldo na data em que você começou a registrar. Use “−” para saldo negativo.">
          {(id, d) => <MoneyInput id={id} aria-describedby={d} value={initial} onChange={setInitial} allowNegative />}
        </Field>
        <Field label="Cor">{() => <ColorPicker value={color} onChange={setColor} />}</Field>
        <Switch checked={include} onChange={setInclude} label="Incluir no saldo consolidado" description="Desative para contas que você só acompanha (ex.: investimentos de longo prazo)." />
      </form>
    </Modal>
  );
}
