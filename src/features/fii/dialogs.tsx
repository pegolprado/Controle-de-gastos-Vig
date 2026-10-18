import { useState } from 'react';
import { toast } from 'sonner';
import { useWsId } from '@/app/WorkspaceProvider';
import { useLookups, wsKey } from '@/hooks/useFinance';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Money } from '@/components/ui/Money';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { Segmented } from '@/components/ui/Segmented';
import { formatDate, todayISO } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import { invalidateFinance, queryClient } from '@/lib/queryClient';
import { supabase } from '@/lib/supabase';
import type { AssetType, FiiPosition } from '@/lib/types';
import { incomeDescription, isJcp, normalizeStockTicker, normalizeTicker, type FiiPayment } from '@/domain/fii';
import { addTrade, createPosition, syncAsset } from '@/services/fii';
import { importTransactions } from '@/services/transactions';
import { fmtRate, launchId, unitLabel } from './shared';

function ErrorBox({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-xl border border-negative/25 bg-negative/8 px-3 py-2 text-sm text-negative">
      {error}
    </p>
  );
}

const refreshRenda = (ws: string) =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: wsKey(ws, 'fii-positions') }),
    queryClient.invalidateQueries({ queryKey: wsKey(ws, 'fii-trades') }),
  ]);

/** Novo ativo: tipo, código, quantidade e quando comprou (para o cálculo pela data com). */
export function AddAssetDialog({ existing, onClose }: { existing: FiiPosition[]; onClose: () => void }) {
  const ws = useWsId();
  const [type, setType] = useState<AssetType>('fii');
  const [ticker, setTicker] = useState('');
  const [quantity, setQuantity] = useState('');
  const [when, setWhen] = useState<'before' | 'date'>('before');
  const [date, setDate] = useState(todayISO());
  const [price, setPrice] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setError(null);
    const t = type === 'fii' ? normalizeTicker(ticker) : normalizeStockTicker(ticker);
    const q = Number(quantity.replace(/\D/g, ''));
    if (!t) return setError(type === 'fii' ? 'Código inválido. Use o formato da B3, por exemplo HGLG11.' : 'Código inválido. Use o formato da B3, por exemplo PETR4, ITSA4 ou TAEE11.');
    if (!q || q < 1) return setError(`Informe quantas ${unitLabel(type, 2)} você tem.`);
    if (when === 'date' && (!date || date > todayISO())) return setError('Informe a data da compra (hoje ou antes).');
    if (existing.some((p) => p.ticker === t)) return setError(`${t} já está na carteira. Abra "Mais detalhes" nele e registre a compra.`);
    setSaving(true);
    try {
      const r = await syncAsset(t, type);
      if (r === 'not_found') return setError(`Não encontramos ${t} na B3. Confira o código.`);
      if (type === 'stock' && r !== 'unavailable') {
        const { data } = await supabase.from('asset_quotes').select('ticker').eq('ticker', t).limit(1);
        if (!data?.length) return setError(`Não encontramos cotação para ${t}. Confira o código (ex.: PETR4).`);
      }
      if (r === 'unavailable') toast.warning('A B3 não respondeu agora; os proventos aparecem na próxima atualização.');
      await createPosition(ws, { ticker: t, asset_type: type, quantity: q, trade_date: when === 'date' ? date : null, price_cents: price || null });
      await refreshRenda(ws);
      toast.success(`${t} adicionado à carteira.`);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      locked={saving}
      size="sm"
      title="Adicionar à carteira"
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button variant="primary" onClick={() => void save()} loading={saving}>Salvar</Button>
        </div>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Segmented
          label="Tipo de ativo"
          value={type}
          onChange={setType}
          options={[
            { value: 'fii', label: 'Fundo imobiliário' },
            { value: 'stock', label: 'Ação' },
          ]}
        />
        <Field label={type === 'fii' ? 'Código do fundo' : 'Código da ação'} hint={type === 'fii' ? 'Ex.: HGLG11, MXRF11, KNRI11' : 'Ex.: PETR4, ITSA4, BBAS3, TAEE11'}>
          {(id, d) => (
            <Input id={id} aria-describedby={d} value={ticker} autoCapitalize="characters" autoComplete="off" maxLength={6} placeholder={type === 'fii' ? 'HGLG11' : 'PETR4'} onChange={(e) => setTicker(e.target.value.toUpperCase())} data-autofocus />
          )}
        </Field>
        <Field label={`Quantidade de ${unitLabel(type, 2)}`}>
          {(id) => <Input id={id} inputMode="numeric" value={quantity} placeholder="100" onChange={(e) => setQuantity(e.target.value.replace(/\D/g, '').slice(0, 9))} />}
        </Field>
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-semibold text-muted">Quando comprou?</span>
          <Segmented
            label="Quando comprou"
            value={when}
            onChange={setWhen}
            options={[
              { value: 'before', label: 'Já tinha antes' },
              { value: 'date', label: 'Em uma data' },
            ]}
          />
          {when === 'date' && (
            <Input type="date" aria-label="Data da compra" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />
          )}
          <p className="text-[12px] text-subtle">A data define em quais proventos você entra: só recebe quem tem as {unitLabel(type, 2)} na data com.</p>
        </div>
        <Field label={`Preço pago por ${unitLabel(type, 1)}`} optional hint="Para ver o rendimento sobre o que você pagou.">
          {(id, d) => <MoneyInput id={id} aria-describedby={d} value={price} onChange={setPrice} />}
        </Field>
        <ErrorBox error={error} />
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}

/** Compra ou venda com data (a quantidade do ativo é a soma das operações). */
export function TradeDialog({ position, onClose }: { position: FiiPosition; onClose: () => void }) {
  const ws = useWsId();
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [quantity, setQuantity] = useState('');
  const [date, setDate] = useState(todayISO());
  const [price, setPrice] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const unit = unitLabel(position.asset_type, 2);

  async function save() {
    setError(null);
    const q = Number(quantity.replace(/\D/g, ''));
    if (!q) return setError(`Informe a quantidade de ${unit}.`);
    if (!date || date > todayISO()) return setError('Informe a data (hoje ou antes).');
    if (side === 'sell' && q > position.quantity) return setError(`Você tem ${position.quantity} ${unit}; não dá para vender ${q}.`);
    setSaving(true);
    try {
      await addTrade(ws, position.id, { trade_date: date, quantity: side === 'buy' ? q : -q, price_cents: side === 'buy' && price ? price : null });
      await refreshRenda(ws);
      toast.success(side === 'buy' ? `Compra de ${q} ${unit} registrada.` : `Venda de ${q} ${unit} registrada.`);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      locked={saving}
      size="sm"
      title={`Registrar operação · ${position.ticker}`}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button variant="primary" onClick={() => void save()} loading={saving}>Salvar</Button>
        </div>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Segmented label="Operação" value={side} onChange={setSide} options={[{ value: 'buy', label: 'Compra', tone: 'income' }, { value: 'sell', label: 'Venda', tone: 'expense' }]} />
        <Field label={`Quantidade de ${unit}`}>
          {(id) => <Input id={id} inputMode="numeric" value={quantity} placeholder="10" onChange={(e) => setQuantity(e.target.value.replace(/\D/g, '').slice(0, 9))} data-autofocus />}
        </Field>
        <Field label="Data">
          {(id) => <Input id={id} type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />}
        </Field>
        {side === 'buy' && (
          <Field label={`Preço por ${unitLabel(position.asset_type, 1)}`} optional hint="Atualiza o preço médio.">
            {(id, d) => <MoneyInput id={id} aria-describedby={d} value={price} onChange={setPrice} />}
          </Field>
        )}
        <ErrorBox error={error} />
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}

/** Lança proventos anunciados como receitas a receber (mesma chave do piloto automático). */
export function LaunchDialog({ payments, onClose }: { payments: FiiPayment[]; onClose: () => void }) {
  const ws = useWsId();
  const { accounts, categories } = useLookups();
  const active = accounts.filter((a) => !a.archived);
  const [picked, setPicked] = useState('');
  const accountId = picked || active[0]?.id || '';
  const [saving, setSaving] = useState(false);
  const category =
    categories.find((c) => c.kind === 'income' && !c.archived && /dividendo|rendimento/i.test(c.name)) ??
    categories.find((c) => c.kind === 'income' && !c.archived && /invest/i.test(c.name));
  const total = payments.reduce((s, p) => s + p.amount_cents, 0);

  async function launch() {
    if (!accountId) return;
    setSaving(true);
    try {
      const items = await Promise.all(
        payments.map(async (p) => ({
          kind: 'income' as const,
          status: 'pending' as const,
          description: incomeDescription(p),
          amount_cents: p.amount_cents,
          occurred_on: p.dist.payment_date,
          due_on: p.dist.payment_date,
          category_id: category?.id ?? null,
          account_id: accountId,
          destination_account_id: null,
          card_id: null,
          payment_method: null,
          tags: [p.asset_type === 'stock' ? 'acoes' : 'fii'],
          notes: `${p.quantity} ${unitLabel(p.asset_type, p.quantity)} × ${fmtRate(p.dist.rate)}${p.dist.record_date ? ` · data com ${formatDate(p.dist.record_date)}` : ''}${isJcp(p.dist.kind) ? ' · líquido de 15% de IR' : ''}`,
          client_request_id: await launchId(ws, p),
        })),
      );
      const created = await importTransactions(ws, items.filter((i) => i.amount_cents > 0));
      void invalidateFinance(ws);
      toast.success(created ? `${created} ${created === 1 ? 'receita lançada' : 'receitas lançadas'} em Compromissos → A receber.` : 'Esses rendimentos já estavam lançados.');
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      locked={saving}
      size="sm"
      title="Lançar como receita"
      description="Os proventos entram como receitas a receber na data de pagamento. Com o piloto automático ligado, viram recebidos sozinhos no dia."
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button variant="primary" onClick={() => void launch()} loading={saving} disabled={!accountId}>
            Lançar <Money cents={total} className="ml-1" />
          </Button>
        </div>
      }
    >
      {active.length === 0 ? (
        <p className="text-[15px] text-muted">Cadastre primeiro a conta da corretora em <strong className="text-fg">Contas</strong>.</p>
      ) : (
        <div className="flex flex-col gap-4">
          <Field label="Conta que recebe (corretora)">
            {(id) => (
              <Select id={id} value={accountId} onChange={(e) => setPicked(e.target.value)}>
                {active.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </Select>
            )}
          </Field>
          <ul className="divide-y divide-line text-[14px]">
            {payments.map((p) => (
              <li key={`${p.ticker}${p.dist.payment_date}${p.dist.kind}${p.dist.isin}`} className="flex justify-between gap-3 py-2">
                <span>{incomeDescription(p)} · {formatDate(p.dist.payment_date)}</span>
                <Money cents={p.amount_cents} className="font-num font-medium" />
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}
