import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowRightLeft, CalendarClock, ChevronDown, CreditCard as CardIcon, Paperclip, Repeat, Wallet } from 'lucide-react';
import { useWorkspace, useWsId } from '@/app/WorkspaceProvider';
import { useBrand } from '@/app/BrandProvider';
import { useLookups, wsKey } from '@/hooks/useFinance';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Switch, Textarea } from '@/components/ui/Field';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { Segmented } from '@/components/ui/Segmented';
import { Badge } from '@/components/ui/Card';
import { Money } from '@/components/ui/Money';
import { cardCycle } from '@/domain/invoice';
import { FREQ_LABEL, PAYMENT_METHOD_LABEL } from '@/domain/labels';
import { addMonths, formatDate, monthLabel, todayISO } from '@/lib/dates';
import { formatBRL, splitInstallments } from '@/lib/money';
import { newRequestId } from '@/lib/id';
import { errorMessage } from '@/lib/errors';
import { invalidateFinance } from '@/lib/queryClient';
import { setFormDirty, trackPending } from '@/lib/formGuard';
import { cn } from '@/lib/cn';
import type { Category, PaymentMethod, RecurrenceFreq, Transaction, TxKind, TxStatus } from '@/lib/types';
import { createInstallments, createTransaction, listCategoryHints, updateTransaction, uploadReceipt, type TxInput } from '@/services/transactions';
import { parseQuickEntry, type QuickEntry } from '@/domain/quickEntry';
import { historyCategory as historyCat, quickCategory, quickSource } from './quickResolve';
import { QuickEntryBar, type ReceiptResult } from './QuickEntryBar';
import { listInvoices } from '@/services/cards';
import { createRecurrence, settleOccurrence, updateRecurrence } from '@/services/planning';

export interface TransactionFormProps {
  initialKind?: TxKind;
  existing?: Transaction | null;
  duplicateOf?: Transaction | null;
  preset?: Partial<{ cardId: string; invoiceId: string; accountId: string; amount: number }>;
  onDone: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}

type Source = 'account' | 'card';

interface FormState {
  kind: TxKind;
  amount: number;
  description: string;
  occurred_on: string;
  due_on: string;
  source: Source;
  account_id: string;
  destination_account_id: string;
  card_id: string;
  invoice_id: string;
  category_id: string;
  payment_method: PaymentMethod | '';
  settled: boolean;
  installments: number;
  repeat: boolean;
  frequency: RecurrenceFreq;
  interval: number;
  end_date: string;
  tags: string;
  notes: string;
}

function fromTx(tx: Transaction, asDuplicate: boolean): FormState {
  return {
    kind: tx.kind,
    amount: tx.amount_cents,
    description: tx.description.replace(/ \(\d+\/\d+\)$/, ''),
    occurred_on: asDuplicate ? todayISO() : tx.occurred_on,
    due_on: asDuplicate ? '' : (tx.due_on ?? ''),
    source: tx.card_id && tx.kind === 'expense' ? 'card' : 'account',
    account_id: tx.account_id ?? '',
    destination_account_id: tx.destination_account_id ?? '',
    card_id: tx.card_id ?? '',
    invoice_id: tx.invoice_id ?? '',
    category_id: tx.category_id ?? '',
    payment_method: tx.payment_method ?? '',
    settled: asDuplicate ? true : ['paid', 'received'].includes(tx.status),
    installments: 1,
    repeat: false,
    frequency: 'monthly',
    interval: 1,
    end_date: '',
    tags: tx.tags.join(', '),
    notes: tx.notes ?? '',
  };
}

export function TransactionForm({ initialKind = 'expense', existing, duplicateOf, preset, onDone, onDirtyChange }: TransactionFormProps) {
  const ws = useWsId();
  const { workspace } = useWorkspace();
  const brand = useBrand();
  const { accounts, categories, cards, cardMap, balanceMap } = useLookups();
  const activeAccounts = accounts.filter((a) => !a.archived);
  const activeCards = cards.filter((c) => !c.archived);
  const editing = Boolean(existing);
  const formId = useRef(newRequestId());
  // A mesma chave é reutilizada em reenvios até o servidor confirmar → sem duplicatas.
  const requestId = useRef(newRequestId());

  const initial = useMemo<FormState>(() => {
    if (existing) return fromTx(existing, false);
    if (duplicateOf) return fromTx(duplicateOf, true);
    const defaultAccount = activeAccounts[0]?.id ?? '';
    return {
      kind: initialKind,
      amount: preset?.amount ?? 0,
      description: '',
      occurred_on: todayISO(),
      due_on: '',
      source: preset?.cardId ? 'card' : 'account',
      account_id: preset?.accountId ?? defaultAccount,
      destination_account_id: activeAccounts[1]?.id ?? '',
      card_id: preset?.cardId ?? activeCards[0]?.id ?? '',
      invoice_id: preset?.invoiceId ?? '',
      category_id: '',
      payment_method: initialKind === 'income' ? 'pix' : 'pix',
      settled: true,
      installments: 1,
      repeat: false,
      frequency: 'monthly',
      interval: 1,
      end_date: '',
      tags: '',
      notes: '',
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing?.id, duplicateOf?.id]);

  const [f, setF] = useState<FormState>(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [moreOpen, setMoreOpen] = useState(Boolean(initial.notes || initial.tags));
  const [file, setFile] = useState<File | null>(null);
  const [scope, setScope] = useState<'one' | 'future'>('one');

  // completa contas/cartões padrão quando chegam depois da abertura
  useEffect(() => {
    setF((s) => ({
      ...s,
      account_id: s.account_id || activeAccounts[0]?.id || '',
      destination_account_id: s.destination_account_id || activeAccounts.find((a) => a.id !== (s.account_id || activeAccounts[0]?.id))?.id || '',
      card_id: s.card_id || activeCards[0]?.id || '',
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts.length, cards.length]);

  const dirty = JSON.stringify(f) !== JSON.stringify(initial) || Boolean(file);
  useEffect(() => {
    const id = formId.current;
    setFormDirty(id, dirty);
    onDirtyChange?.(dirty);
    return () => setFormDirty(id, false);
  }, [dirty, onDirtyChange]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setF((s) => ({ ...s, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };

  // categoria automática: aprende com os lançamentos anteriores de mesma descrição
  const [catTouched, setCatTouched] = useState(editing || Boolean(initial.category_id));
  const [suggestedCat, setSuggestedCat] = useState('');
  const hints = useQuery({
    queryKey: wsKey(ws, 'category-hints'),
    queryFn: () => listCategoryHints(ws),
    enabled: !editing,
    staleTime: 10 * 60_000,
  });
  const historyCategory = (description: string, kind: TxKind) => historyCat(description, kind, categories, hints.data);
  useEffect(() => {
    if (catTouched || (f.kind !== 'income' && f.kind !== 'expense') || !hints.data) return;
    const found = historyCategory(f.description, f.kind);
    setSuggestedCat(found);
    setF((s) => (s.category_id === found ? s : { ...s, category_id: found }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.description, f.kind, hints.data, catTouched, categories]);

  // faturas com saldo em aberto (pagamento de fatura)
  const invoicesQuery = useQuery({
    queryKey: wsKey(ws, 'invoices', 'payable', f.card_id),
    queryFn: () => listInvoices(ws, { cardId: f.card_id }),
    enabled: f.kind === 'card_payment' && Boolean(f.card_id),
  });
  const payableInvoices = (invoicesQuery.data ?? []).filter((i) => i.remaining_cents > 0 || i.id === f.invoice_id);
  useEffect(() => {
    if (f.kind !== 'card_payment' || editing) return;
    const firstClosed = payableInvoices.find((i) => i.status !== 'open') ?? payableInvoices[0];
    if (firstClosed && !payableInvoices.some((i) => i.id === f.invoice_id)) {
      setF((s) => ({ ...s, invoice_id: firstClosed.id, amount: s.amount || firstClosed.remaining_cents }));
    }
    const card = cardMap.get(f.card_id);
    if (card?.default_payment_account_id && !f.account_id) setF((s) => ({ ...s, account_id: card.default_payment_account_id! }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.kind, f.card_id, invoicesQuery.data]);

  const catKind = f.kind === 'income' ? 'income' : 'expense';
  const groupedCategories = useMemo(() => {
    const roots = categories.filter((c) => c.kind === catKind && !c.parent_id && (!c.archived || c.id === f.category_id));
    return roots.map((r) => ({ root: r, children: categories.filter((c) => c.parent_id === r.id && (!c.archived || c.id === f.category_id)) }));
  }, [categories, catKind, f.category_id]);

  const selectedCard = cardMap.get(f.card_id);
  const cyclePreview = f.kind === 'expense' && f.source === 'card' && selectedCard ? cardCycle(selectedCard.closing_day, selectedCard.due_day, f.occurred_on) : null;
  const installmentPreview = f.installments > 1 && f.amount >= f.installments ? splitInstallments(f.amount, f.installments) : null;
  const canInstall = !editing && f.kind === 'expense';
  const canRepeat = !editing && (f.kind === 'expense' || f.kind === 'income') && f.installments === 1;
  const isRecurring = Boolean(existing?.recurrence_id);

  function validate(): boolean {
    const e: Partial<Record<keyof FormState, string>> = {};
    if (f.amount <= 0) e.amount = 'Informe um valor maior que zero.';
    if (f.amount > 100_000_000_000) e.amount = 'Valor acima do permitido.';
    if (f.kind !== 'card_payment' && !f.description.trim()) e.description = 'Descreva o lançamento.';
    if (!f.occurred_on) e.occurred_on = 'Informe a data.';
    if (f.kind === 'transfer') {
      if (!f.account_id) e.account_id = 'Escolha a conta de origem.';
      if (!f.destination_account_id) e.destination_account_id = 'Escolha a conta de destino.';
      if (f.account_id && f.account_id === f.destination_account_id) e.destination_account_id = 'Origem e destino devem ser diferentes.';
    } else if (f.kind === 'card_payment') {
      if (!f.card_id) e.card_id = 'Escolha o cartão.';
      if (!f.invoice_id) e.invoice_id = 'Escolha a fatura.';
      if (!f.account_id) e.account_id = 'Escolha a conta que pagou.';
      const inv = payableInvoices.find((i) => i.id === f.invoice_id);
      const limit = inv ? inv.remaining_cents + (editing && existing ? existing.amount_cents : 0) : 0;
      if (inv && f.amount > limit) e.amount = `Máximo em aberto: ${formatBRL(limit)}.`;
    } else if (f.source === 'card' && f.kind === 'expense') {
      if (!f.card_id) e.card_id = 'Escolha o cartão.';
    } else if (!f.account_id) e.account_id = 'Escolha a conta.';
    if (f.installments > 1 && f.amount < f.installments) e.installments = 'Valor muito baixo para o número de parcelas.';
    if (f.repeat && f.end_date && f.end_date < f.occurred_on) e.end_date = 'O término deve ser após o início.';
    if (!f.settled && f.due_on && f.due_on < '1990-01-01') e.due_on = 'Data inválida.';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function buildInput(): TxInput {
    const tags = f.tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 12);
    const isCard = f.kind === 'expense' && f.source === 'card';
    let status: TxStatus;
    if (f.kind === 'transfer' || f.kind === 'card_payment' || isCard) status = 'paid';
    else status = f.settled ? (f.kind === 'income' ? 'received' : 'paid') : 'pending';
    const card = cardMap.get(f.card_id);
    return {
      kind: f.kind,
      status,
      description:
        f.kind === 'card_payment'
          ? f.description.trim() || `Pagamento fatura ${card?.name ?? ''}`.trim()
          : f.description.trim(),
      amount_cents: f.amount,
      occurred_on: f.occurred_on,
      due_on: status === 'pending' ? f.due_on || f.occurred_on : f.due_on || null,
      category_id: f.kind === 'transfer' || f.kind === 'card_payment' ? null : f.category_id || null,
      account_id: isCard ? null : f.account_id || null,
      destination_account_id: f.kind === 'transfer' ? f.destination_account_id : null,
      card_id: isCard || f.kind === 'card_payment' ? f.card_id : null,
      invoice_id: f.kind === 'card_payment' ? f.invoice_id : null,
      payment_method: isCard ? 'credit_card' : f.kind === 'transfer' ? 'transfer' : (f.payment_method || null),
      tags,
      notes: f.notes.trim() || null,
    };
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const input = buildInput();
      let saved: Transaction | null = null;
      if (existing) {
        const { kind: _k, ...patch } = input;
        if (isRecurring && scope === 'future' && existing.recurrence_id) {
          await updateRecurrence(
            existing.recurrence_id,
            { description: input.description, amount_cents: input.amount_cents, category_id: input.category_id, payment_method: input.payment_method },
            existing.recurrence_date ?? existing.occurred_on,
          );
        }
        saved = await updateTransaction(existing.id, patch);
      } else if (f.installments > 1 && f.kind === 'expense') {
        await createInstallments(
          ws,
          {
            description: input.description,
            total_cents: input.amount_cents,
            installments: f.installments,
            purchase_date: f.occurred_on,
            card_id: input.card_id,
            account_id: input.account_id,
            category_id: input.category_id,
            tags: input.tags,
            notes: input.notes,
            first_status: input.status,
          },
          requestId.current,
        );
      } else if (f.repeat && (f.kind === 'income' || f.kind === 'expense')) {
        // primeira ocorrência = este lançamento (registrado conforme o status escolhido)
        const rec = await createRecurrence(ws, {
          kind: f.kind,
          description: input.description,
          amount_cents: input.amount_cents,
          category_id: input.category_id,
          account_id: input.account_id,
          card_id: input.card_id,
          payment_method: input.payment_method,
          frequency: f.frequency,
          interval_count: f.interval,
          start_date: f.occurred_on,
          end_date: f.end_date || null,
          notes: input.notes,
        }, requestId.current);
        if (f.settled && input.account_id && (input.status === 'paid' || input.status === 'received')) {
          // a primeira ocorrência já foi paga/recebida no momento do cadastro
          await settleOccurrence(rec.id, f.occurred_on, input.status);
        }
      } else {
        saved = await createTransaction(ws, input, requestId.current);
      }
      if (file && saved) {
        try {
          await uploadReceipt(ws, saved.id, file);
        } catch (err) {
          toast.warning(`Lançamento salvo, mas o comprovante não foi enviado: ${errorMessage(err)}`);
        }
      }
      return saved;
    },
    onSuccess: () => {
      requestId.current = newRequestId();
      setFormDirty(formId.current, false);
      void invalidateFinance(ws);
      const what = { income: 'Receita', expense: 'Despesa', transfer: 'Transferência', card_payment: 'Pagamento' }[f.kind];
      toast.success(editing ? 'Alterações salvas.' : f.installments > 1 ? `Compra parcelada em ${f.installments}x registrada.` : `${what} registrada.`);
      onDone();
    },
    onError: (err) => {
      toast.error(errorMessage(err));
    },
  });

  // lançamento rápido (texto, voz ou comprovante) → preenche o formulário
  const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  function applyQuick(q: QuickEntry) {
    const kind = q.kind;
    const category = quickCategory(q, categories, hints.data);
    const named = (n: string | null) => (n ? norm(n) : '');
    const card = q.sourceName ? activeCards.find((c) => norm(c.name) === named(q.sourceName)) : undefined;
    const account = q.sourceName ? activeAccounts.find((a) => norm(a.name) === named(q.sourceName)) : undefined;
    const { useCard } = quickSource(q, accounts, cards);
    setF((s) => ({
      ...s,
      kind,
      amount: q.amount_cents ?? s.amount,
      description: q.description || s.description,
      occurred_on: q.occurred_on,
      installments: kind === 'expense' ? q.installments : 1,
      source: useCard ? 'card' : 'account',
      card_id: card?.id ?? s.card_id,
      account_id: account?.id ?? s.account_id,
      payment_method: q.payment_method ?? s.payment_method,
      category_id: category || (s.kind === kind ? s.category_id : ''),
      repeat: kind === 'expense' || kind === 'income' ? s.repeat : false,
    }));
    if (category) {
      setCatTouched(true);
      setSuggestedCat(category);
    }
    setErrors({});
    if (q.amount_cents === null) toast.info('Faltou o valor: digite no campo Valor.');
  }
  function applyReceipt(r: ReceiptResult) {
    const merchant = r.merchant ? r.merchant.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase()) : '';
    const q = parseQuickEntry(merchant);
    applyQuick({ ...q, kind: 'expense', amount_cents: r.amount_cents, description: merchant || q.description || 'Compra', occurred_on: r.occurred_on ?? f.occurred_on, installments: 1 });
    setFile(r.file);
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mutation.isPending) return; // trava contra cliques repetidos
    if (!validate()) return;
    void trackPending(mutation.mutateAsync()).catch(() => undefined);
  };

  const kindOptions: Array<{ value: TxKind; label: string; tone?: 'income' | 'expense' }> = [
    { value: 'expense', label: 'Despesa', tone: 'expense' },
    { value: 'income', label: 'Receita', tone: 'income' },
    { value: 'transfer', label: 'Transferência' },
    ...(activeCards.length ? [{ value: 'card_payment' as TxKind, label: 'Pagar fatura' }] : []),
  ];

  const renderCategoryOptions = (list: typeof groupedCategories) =>
    list.map(({ root, children }) =>
      children.length ? (
        <optgroup key={root.id} label={root.name}>
          <option value={root.id}>{root.name} (geral)</option>
          {children.map((c: Category) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </optgroup>
      ) : (
        <option key={root.id} value={root.id}>
          {root.name}
        </option>
      ),
    );

  if (!activeAccounts.length && !activeCards.length) {
    return <p className="py-6 text-center text-sm text-muted">Cadastre uma conta antes de registrar lançamentos.</p>;
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4" aria-label="Formulário de lançamento">
      {!editing && !duplicateOf && !preset && (
        <QuickEntryBar onText={(t) => applyQuick(parseQuickEntry(t, [...activeCards.map((c) => c.name), ...activeAccounts.map((a) => a.name)]))} onReceipt={applyReceipt} />
      )}
      {!editing && (
        <Segmented
          label="Tipo de lançamento"
          value={f.kind}
          onChange={(k) => {
            setF((s) => ({ ...s, kind: k, category_id: '', installments: 1, repeat: k === 'transfer' || k === 'card_payment' ? false : s.repeat }));
            setErrors({});
          }}
          options={kindOptions}
          size="sm"
        />
      )}

      <Field label="Valor" error={errors.amount}>
        {(id, d) => (
          <MoneyInput
            id={id}
            aria-describedby={d}
            aria-invalid={Boolean(errors.amount)}
            value={f.amount}
            onChange={(v) => set('amount', v)}
            hero
            tone={f.kind === 'income' ? 'income' : f.kind === 'expense' ? 'expense' : 'neutral'}
            autoFocus={!editing && Boolean(duplicateOf || preset)}
          />
        )}
      </Field>

      {f.kind !== 'card_payment' && (
        <Field label="Descrição" error={errors.description}>
          {(id, d) => (
            <Input
              id={id}
              aria-describedby={d}
              aria-invalid={Boolean(errors.description)}
              value={f.description}
              maxLength={140}
              onChange={(e) => set('description', e.target.value)}
              placeholder={f.kind === 'income' ? 'Ex.: Salário de outubro' : f.kind === 'transfer' ? 'Ex.: Reserva de emergência' : 'Ex.: Mercado do mês'}
              autoComplete="off"
              enterKeyHint="next"
            />
          )}
        </Field>
      )}

      {/* Origem: conta ou cartão */}
      {f.kind === 'expense' && activeCards.length > 0 && !(editing && existing?.installment_group_id) && (
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Como foi pago">
          {(
            [
              { v: 'account', label: 'Conta / dinheiro', icon: Wallet },
              { v: 'card', label: 'Cartão de crédito', icon: CardIcon },
            ] as const
          ).map((o) => (
            <button
              key={o.v}
              type="button"
              role="radio"
              aria-checked={f.source === o.v}
              disabled={editing}
              onClick={() => set('source', o.v)}
              className={cn(
                'flex h-12 items-center justify-center gap-2 rounded-xl border text-sm font-semibold transition disabled:opacity-60',
                f.source === o.v ? 'border-brand/50 bg-brand/8 text-fg' : 'border-line text-muted hover:border-line-strong',
              )}
            >
              <o.icon className="size-4" aria-hidden /> {o.label}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {(f.kind === 'card_payment' || (f.kind === 'expense' && f.source === 'card')) && (
          <Field label="Cartão" error={errors.card_id}>
            {(id) => (
              <Select id={id} value={f.card_id} onChange={(e) => set('card_id', e.target.value)} disabled={editing}>
                {activeCards.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.last_digits ? ` •${c.last_digits}` : ''}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}

        {f.kind === 'card_payment' && (
          <Field label="Fatura" error={errors.invoice_id} hint={invoicesQuery.isLoading ? 'Carregando faturas…' : payableInvoices.length ? undefined : 'Nenhuma fatura em aberto.'}>
            {(id) => (
              <Select
                id={id}
                value={f.invoice_id}
                onChange={(e) => {
                  const inv = payableInvoices.find((i) => i.id === e.target.value);
                  setF((s) => ({ ...s, invoice_id: e.target.value, amount: inv ? inv.remaining_cents : s.amount }));
                }}
                disabled={editing}
              >
                <option value="">Selecione…</option>
                {payableInvoices.map((i) => (
                  <option key={i.id} value={i.id}>
                    {monthLabel(i.reference_month)} — vence {formatDate(i.due_date)} — {formatBRL(i.remaining_cents)} em aberto
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}

        {(f.kind !== 'expense' || f.source === 'account') && (
          <Field label={f.kind === 'transfer' ? 'De (origem)' : f.kind === 'income' ? 'Recebido em' : f.kind === 'card_payment' ? 'Pago com a conta' : 'Conta'} error={errors.account_id}>
            {(id) => (
              <Select id={id} value={f.account_id} onChange={(e) => set('account_id', e.target.value)}>
                <option value="">Selecione…</option>
                {activeAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {formatBRL(balanceMap.get(a.id)?.current_balance_cents ?? 0)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}

        {f.kind === 'transfer' && (
          <Field label="Para (destino)" error={errors.destination_account_id}>
            {(id) => (
              <Select id={id} value={f.destination_account_id} onChange={(e) => set('destination_account_id', e.target.value)}>
                <option value="">Selecione…</option>
                {activeAccounts
                  .filter((a) => a.id !== f.account_id)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
        )}

        {(f.kind === 'income' || f.kind === 'expense') && (
          <Field label="Categoria" optional hint={!catTouched && suggestedCat && f.category_id === suggestedCat ? 'Sugerida pelo histórico (pode trocar)' : undefined}>
            {(id) => (
              <Select
                id={id}
                value={f.category_id}
                onChange={(e) => {
                  setCatTouched(true);
                  set('category_id', e.target.value);
                }}
              >
                <option value="">Sem categoria</option>
                {renderCategoryOptions(groupedCategories)}
              </Select>
            )}
          </Field>
        )}

        <Field
          label={f.kind === 'expense' && f.source === 'card' ? 'Data da compra' : 'Data'}
          error={errors.occurred_on}
          hint={
            cyclePreview ? (
              <span>
                Entra na fatura de <strong className="text-fg">{monthLabel(cyclePreview.referenceMonth, { year: false })}</strong> (vence {formatDate(cyclePreview.dueDate)})
              </span>
            ) : undefined
          }
        >
          {(id, d) => <Input id={id} aria-describedby={d} type="date" value={f.occurred_on} onChange={(e) => set('occurred_on', e.target.value)} required />}
        </Field>

        {(f.kind === 'income' || f.kind === 'expense') && f.source === 'account' && (
          <Field label="Forma de pagamento" optional>
            {(id) => (
              <Select id={id} value={f.payment_method} onChange={(e) => set('payment_method', e.target.value as PaymentMethod)}>
                <option value="">—</option>
                {(Object.keys(PAYMENT_METHOD_LABEL) as PaymentMethod[])
                  .filter((m) => m !== 'credit_card')
                  .map((m) => (
                    <option key={m} value={m}>
                      {PAYMENT_METHOD_LABEL[m]}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
        )}
      </div>

      {(f.kind === 'income' || f.kind === 'expense') && f.source === 'account' && (
        <div className="rounded-2xl border border-line bg-surface-2/40 p-4">
          <Switch
            checked={f.settled}
            onChange={(v) => set('settled', v)}
            label={f.kind === 'income' ? 'Já recebido' : 'Já pago'}
            description={f.settled ? 'Afeta o saldo da conta agora.' : 'Fica em "Compromissos" até você confirmar o pagamento.'}
          />
          {!f.settled && (
            <div className="mt-3">
              <Field label="Vencimento" error={errors.due_on} hint="Se vazio, usa a data do lançamento.">
                {(id, d) => <Input id={id} aria-describedby={d} type="date" value={f.due_on} onChange={(e) => set('due_on', e.target.value)} />}
              </Field>
            </div>
          )}
        </div>
      )}

      {canInstall && (
        <div className="rounded-2xl border border-line bg-surface-2/40 p-4">
          <Field label="Parcelas" error={errors.installments}>
            {(id) => (
              <Select
                id={id}
                value={f.installments}
                onChange={(e) => setF((s) => ({ ...s, installments: Number(e.target.value), repeat: Number(e.target.value) > 1 ? false : s.repeat }))}
              >
                <option value={1}>À vista</option>
                {Array.from({ length: 47 }, (_, i) => i + 2).map((n) => (
                  <option key={n} value={n}>
                    {n}x {f.amount >= n ? `de ${formatBRL(Math.floor(f.amount / n))}` : ''}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {installmentPreview && (
            <p className="mt-2 text-[13px] text-muted">
              {f.installments} parcelas: a primeira de {formatBRL(installmentPreview[0])}
              {installmentPreview[0] !== installmentPreview[1] && <> e as demais de {formatBRL(installmentPreview[1])}</>}. Última em{' '}
              {monthLabel(addMonths(f.occurred_on, f.installments - 1))}.
            </p>
          )}
        </div>
      )}

      {canRepeat && (
        <div className="rounded-2xl border border-line bg-surface-2/40 p-4">
          <Switch checked={f.repeat} onChange={(v) => set('repeat', v)} label="Repetir automaticamente" description="Cria as próximas ocorrências sem duplicar." />
          {f.repeat && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field label="Frequência">
                {(id) => (
                  <Select id={id} value={f.frequency} onChange={(e) => set('frequency', e.target.value as RecurrenceFreq)}>
                    {(Object.keys(FREQ_LABEL) as RecurrenceFreq[]).map((k) => (
                      <option key={k} value={k}>
                        {FREQ_LABEL[k]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="A cada">
                {(id) => <Input id={id} type="number" min={1} max={366} value={f.interval} onChange={(e) => set('interval', Math.max(1, Number(e.target.value) || 1))} />}
              </Field>
              <Field label="Termina em" optional className="col-span-2" error={errors.end_date}>
                {(id) => <Input id={id} type="date" value={f.end_date} onChange={(e) => set('end_date', e.target.value)} />}
              </Field>
            </div>
          )}
        </div>
      )}

      {isRecurring && (
        <div className="rounded-2xl border border-info/25 bg-info/5 p-4">
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Repeat className="size-4 text-info" aria-hidden /> Este lançamento faz parte de uma recorrência
          </p>
          <Segmented
            label="Aplicar alteração em"
            value={scope}
            onChange={setScope}
            size="sm"
            options={[
              { value: 'one', label: 'Somente este' },
              { value: 'future', label: 'Este e os futuros' },
            ]}
          />
        </div>
      )}

      <button type="button" onClick={() => setMoreOpen((v) => !v)} className="flex items-center gap-1.5 self-start text-sm font-semibold text-muted hover:text-fg" aria-expanded={moreOpen}>
        <ChevronDown className={cn('size-4 transition', moreOpen && 'rotate-180')} aria-hidden /> Mais detalhes
      </button>
      {moreOpen && (
        <div className="grid gap-4">
          <Field label="Tags" optional hint="Separe por vírgula. Ex.: viagem, trabalho">
            {(id, d) => <Input id={id} aria-describedby={d} value={f.tags} onChange={(e) => set('tags', e.target.value)} />}
          </Field>
          <Field label="Observações" optional>
            {(id) => <Textarea id={id} value={f.notes} maxLength={2000} onChange={(e) => set('notes', e.target.value)} />}
          </Field>
          {brand.features.attachments !== false && !editing && f.kind !== 'transfer' && f.installments === 1 && !f.repeat && (
            <Field label="Comprovante" optional hint="Imagem ou PDF até 5 MB.">
              {(id) => (
                <label htmlFor={id} className="flex h-11 cursor-pointer items-center gap-2 rounded-xl border border-dashed border-line-strong px-3.5 text-sm text-muted hover:text-fg">
                  <Paperclip className="size-4" aria-hidden />
                  <span className="truncate">{file ? file.name : 'Anexar arquivo'}</span>
                  <input
                    id={id}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
                    className="sr-only"
                    onChange={(e) => {
                      const fl = e.target.files?.[0] ?? null;
                      if (fl && fl.size > 5 * 1024 * 1024) {
                        toast.error('Arquivo maior que 5 MB.');
                        return;
                      }
                      setFile(fl);
                    }}
                  />
                </label>
              )}
            </Field>
          )}
        </div>
      )}

      {existing && existing.settled_principal_cents > 0 && existing.status === 'pending' && (
        <p className="flex items-center gap-2 text-[13px] text-muted">
          <CalendarClock className="size-4" aria-hidden />
          Já pago parcialmente: <Money cents={existing.paid_cents} />
        </p>
      )}

      <div className="sticky bottom-0 z-10 -mx-5 -mb-5 flex items-center gap-2 border-t border-line bg-elevated px-5 pb-5 pt-3 sm:-mx-6 sm:px-6">
        {workspace && workspace.kind === 'shared' && (
          <Badge tone="neutral" className="hidden sm:inline-flex">
            <ArrowRightLeft className="size-3" aria-hidden /> {workspace.name}
          </Badge>
        )}
        <div className="flex-1" />
        <Button variant="ghost" onClick={onDone} disabled={mutation.isPending}>
          Cancelar
        </Button>
        <Button type="submit" variant="primary" loading={mutation.isPending} className="min-w-32">
          {mutation.isPending ? 'Salvando…' : editing ? 'Salvar alterações' : 'Salvar'}
        </Button>
      </div>
    </form>
  );
}
