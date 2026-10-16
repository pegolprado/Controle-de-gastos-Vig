import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { FileUp } from 'lucide-react';
import { useWsId } from '@/app/WorkspaceProvider';
import { useLookups } from '@/hooks/useFinance';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Card';
import { Field, Select, Switch } from '@/components/ui/Field';
import { Money } from '@/components/ui/Money';
import { formatDate } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import { invalidateFinance } from '@/lib/queryClient';
import { decodeStatement, descriptionKey, parseStatement, statementRequestIds, type ParsedStatement, type StatementLine } from '@/lib/statement';
import { importTransactions, listAccountTxForImport, listCategoryHints, type TxInput } from '@/services/transactions';

const MAX_FILE_MB = 5;

type RowState = 'new' | 'imported' | 'similar';

interface Row {
  line: StatementLine;
  amount: number;
  requestId: string;
  state: RowState;
  include: boolean;
  categoryId: string | null;
}

/** Importa extratos OFX/CSV para uma conta, sem duplicar o que já foi importado ou lançado. */
export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ws = useWsId();
  const { accounts, categoryMap } = useLookups();
  const active = accounts.filter((a) => !a.archived);
  const [accountId, setAccountId] = useState('');
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<ParsedStatement | null>(null);
  const [invert, setInvert] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<'reading' | 'analyzing' | 'importing' | null>(null);
  const [progress, setProgress] = useState(0);
  const account = accountId || active[0]?.id || '';

  const reset = () => {
    setParsed(null);
    setRows(null);
    setFileName('');
    setInvert(false);
    setProgress(0);
  };
  const close = () => {
    if (busy === 'importing') return;
    reset();
    onClose();
  };

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      toast.error(`Arquivo muito grande (máximo ${MAX_FILE_MB} MB). Exporte um período menor.`);
      return;
    }
    setBusy('reading');
    try {
      const text = decodeStatement(await file.arrayBuffer());
      const p = parseStatement(file.name, text);
      if (!p.lines.length) throw new Error('Nenhum lançamento encontrado no arquivo.');
      setFileName(file.name);
      setParsed(p);
      setRows(null);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function analyze() {
    if (!parsed || !account) return;
    setBusy('analyzing');
    try {
      const lines = parsed.lines;
      const ids = await statementRequestIds(account, lines);
      const dates = lines.map((l) => l.date).sort();
      const [existing, hints] = await Promise.all([listAccountTxForImport(ws, account, dates[0]!, dates[dates.length - 1]!), listCategoryHints(ws)]);
      const fileIds = new Set(ids);
      const importedIds = new Set(existing.map((t) => t.client_request_id).filter((id): id is string => !!id && fileIds.has(id)));
      // lançamentos digitados à mão com mesma data, valor e tipo (consumidos um a um)
      const similar = new Map<string, number>();
      for (const t of existing) {
        if (t.client_request_id && importedIds.has(t.client_request_id)) continue;
        const k = `${t.occurred_on}|${t.kind}|${t.amount_cents}`;
        similar.set(k, (similar.get(k) ?? 0) + 1);
      }
      const hintMap = new Map<string, string>();
      for (const h of hints) {
        const k = `${h.kind}|${descriptionKey(h.description)}`;
        const cat = h.category_id ? categoryMap.get(h.category_id) : undefined;
        if (!hintMap.has(k) && cat && !cat.archived) hintMap.set(k, cat.id);
      }
      setRows(
        lines.map((line, i) => {
          const amount = invert ? -line.amount_cents : line.amount_cents;
          const kind = amount < 0 ? 'expense' : 'income';
          let state: RowState = 'new';
          if (importedIds.has(ids[i]!)) state = 'imported';
          else {
            const k = `${line.date}|${kind}|${Math.abs(amount)}`;
            const n = similar.get(k) ?? 0;
            if (n > 0) {
              state = 'similar';
              similar.set(k, n - 1);
            }
          }
          return { line, amount, requestId: ids[i]!, state, include: state === 'new', categoryId: hintMap.get(`${kind}|${descriptionKey(line.description)}`) ?? null };
        }),
      );
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const selected = useMemo(() => rows?.filter((r) => r.include && r.state !== 'imported') ?? [], [rows]);
  const counts = useMemo(() => {
    const c = { new: 0, imported: 0, similar: 0, in: 0, out: 0 };
    for (const r of rows ?? []) c[r.state]++;
    for (const r of selected) if (r.amount > 0) c.in += r.amount;
    else c.out += r.amount;
    return c;
  }, [rows, selected]);

  async function runImport() {
    if (!selected.length) return;
    setBusy('importing');
    setProgress(0);
    try {
      const items: Array<TxInput & { client_request_id: string }> = selected.map((r) => ({
        kind: r.amount < 0 ? 'expense' : 'income',
        status: r.amount < 0 ? 'paid' : 'received',
        description: r.line.description,
        amount_cents: Math.abs(r.amount),
        occurred_on: r.line.date,
        due_on: null,
        category_id: r.categoryId,
        account_id: account,
        destination_account_id: null,
        card_id: null,
        payment_method: null,
        tags: ['importado'],
        notes: null,
        client_request_id: r.requestId,
      }));
      const created = await importTransactions(ws, items, setProgress);
      void invalidateFinance(ws);
      const skipped = items.length - created;
      toast.success(`${created} ${created === 1 ? 'lançamento importado' : 'lançamentos importados'}${skipped ? ` (${skipped} já existiam)` : ''}.`);
      setBusy(null);
      close();
    } catch (e) {
      toast.error(errorMessage(e));
      setBusy(null);
    }
  }

  const toggle = (i: number) => setRows((rs) => rs && rs.map((r, j) => (j === i && r.state !== 'imported' ? { ...r, include: !r.include } : r)));

  return (
    <Modal
      open={open}
      onClose={close}
      locked={busy === 'importing'}
      size="lg"
      title="Importar extrato"
      description="Arquivo OFX ou CSV exportado pelo internet banking ou app do banco."
      footer={
        rows ? (
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => setRows(null)} disabled={!!busy}>
              Voltar
            </Button>
            <Button variant="primary" onClick={() => void runImport()} loading={busy === 'importing'} disabled={!selected.length}>
              {busy === 'importing' ? `Importando ${progress}/${selected.length}` : `Importar ${selected.length} ${selected.length === 1 ? 'lançamento' : 'lançamentos'}`}
            </Button>
          </div>
        ) : (
          <div className="flex w-full justify-end gap-2">
            <Button variant="ghost" onClick={close}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={() => void analyze()} loading={busy === 'analyzing'} disabled={!parsed || !account}>
              Revisar lançamentos
            </Button>
          </div>
        )
      }
    >
      {!active.length ? (
        <p className="text-[15px] text-muted">Cadastre primeiro a conta bancária em <strong className="text-fg">Contas</strong>; o extrato é importado para ela.</p>
      ) : !rows ? (
        <div className="flex flex-col gap-4">
          <Field label="Conta do extrato">
            {(id) => (
              <Select id={id} value={account} onChange={(e) => setAccountId(e.target.value)}>
                {active.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed border-line-strong bg-surface-2/40 px-4 py-6 text-center transition hover:border-brand/60">
            <FileUp className="size-6 text-brand" aria-hidden />
            <span className="text-[15px] font-semibold">{fileName || 'Escolher arquivo OFX ou CSV'}</span>
            <span className="text-[13px] text-subtle">
              {parsed ? `${parsed.lines.length} lançamentos encontrados${parsed.skipped ? ` · ${parsed.skipped} linhas ignoradas (saldos e linhas sem valor)` : ''}` : busy === 'reading' ? 'Lendo…' : 'O arquivo é lido no seu aparelho; só os lançamentos escolhidos são enviados.'}
            </span>
            <input type="file" accept=".ofx,.qfx,.csv,.txt,text/csv,application/x-ofx" className="sr-only" aria-label="Arquivo do extrato" onChange={(e) => void onFile(e.target.files?.[0])} />
          </label>
          <Switch checked={invert} onChange={setInvert} label="Inverter sinais" description="Use se as despesas aparecerem como entradas (alguns bancos exportam com o sinal trocado)." />
          <p className="text-[13px] text-subtle">
            Dica: no app do banco, procure por <strong>Exportar extrato</strong> e escolha OFX (Money/Quicken) ou CSV. Pode importar o mesmo período de novo: o que já foi importado é ignorado. Transferências entre suas contas entram como receita/despesa.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2 text-[13px]">
            <Badge tone="brand">{counts.new} {counts.new === 1 ? 'novo' : 'novos'}</Badge>
            {counts.similar > 0 && <Badge tone="warning">{counts.similar === 1 ? '1 parecido com lançamento já cadastrado (desmarcado)' : `${counts.similar} parecidos com lançamentos já cadastrados (desmarcados)`}</Badge>}
            {counts.imported > 0 && <Badge>{counts.imported} já {counts.imported === 1 ? 'importado' : 'importados'}</Badge>}
          </div>
          <p className="text-[13px] text-muted">
            Entradas <Money cents={counts.in} tone="income" /> · Saídas <Money cents={counts.out} tone="expense" />
          </p>
          <ul className="-mx-1 flex max-h-[50dvh] flex-col overflow-y-auto" aria-label="Lançamentos do extrato">
            {rows.map((r, i) => {
              const cat = r.categoryId ? categoryMap.get(r.categoryId) : undefined;
              return (
                <li key={r.requestId}>
                  <label className={`flex items-center gap-3 rounded-xl px-1 py-2 ${r.state === 'imported' ? 'opacity-50' : 'cursor-pointer hover:bg-surface-2/60'}`}>
                    <input type="checkbox" className="size-4 accent-[var(--brand)]" checked={r.include && r.state !== 'imported'} disabled={r.state === 'imported'} onChange={() => toggle(i)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium">{r.line.description}</span>
                      <span className="block truncate text-[12px] text-subtle">
                        {formatDate(r.line.date)}
                        {cat && ` · ${cat.name}`}
                        {r.state === 'imported' && ' · já importado'}
                        {r.state === 'similar' && ' · parecido com um lançamento existente'}
                      </span>
                    </span>
                    <Money cents={r.amount} tone="auto" signed className="text-[14px] font-semibold" />
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Modal>
  );
}
