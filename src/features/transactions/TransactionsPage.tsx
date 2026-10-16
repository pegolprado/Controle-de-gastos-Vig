import { useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Download, FileSearch, Plus, Search, SlidersHorizontal, X } from 'lucide-react';
import { useWorkspace, useWsId } from '@/app/WorkspaceProvider';
import { useBrand } from '@/app/BrandProvider';
import { useLookups, wsKey } from '@/hooks/useFinance';
import { useDebounce } from '@/hooks/useDebounce';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState, ErrorState, Skeleton } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Field';
import { Money } from '@/components/ui/Money';
import { addDays, endOfMonth, formatDate, startOfMonth, todayISO, addMonths } from '@/lib/dates';
import { centsToCSV, downloadFile, toCSV } from '@/lib/csv';
import { errorMessage } from '@/lib/errors';
import { PAYMENT_METHOD_LABEL, TX_KIND_LABEL, TX_STATUS_LABEL } from '@/domain/labels';
import type { Transaction, TxKind } from '@/lib/types';
import { listAllTransactions, listTransactions, type TxFilters } from '@/services/transactions';
import { useQuickAdd } from './QuickAdd';
import { groupByDate, txSignedAmount, TxRow } from './TxRow';
import { TransactionDetail } from './TransactionDetail';

type Period = 'month' | 'last' | '90' | 'year' | 'all' | 'custom';

function periodRange(p: Period, custom: { from: string; to: string }): { from?: string; to?: string } {
  const t = todayISO();
  switch (p) {
    case 'month':
      return { from: startOfMonth(t), to: endOfMonth(t) };
    case 'last': {
      const prev = addMonths(startOfMonth(t), -1);
      return { from: prev, to: endOfMonth(prev) };
    }
    case '90':
      return { from: addDays(t, -90), to: t };
    case 'year':
      return { from: `${t.slice(0, 4)}-01-01`, to: `${t.slice(0, 4)}-12-31` };
    case 'custom':
      return { from: custom.from || undefined, to: custom.to || undefined };
    default:
      return {};
  }
}

export default function TransactionsPage() {
  const ws = useWsId();
  const brand = useBrand();
  const { canContribute } = useWorkspace();
  const { accounts, cards, categories, accountMap, categoryMap, cardMap } = useLookups();
  const quickAdd = useQuickAdd();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [period, setPeriod] = useState<Period>((params.get('periodo') as Period) || 'month');
  const [custom, setCustom] = useState({ from: params.get('de') ?? '', to: params.get('ate') ?? '' });
  const [kind, setKind] = useState<TxKind | ''>((params.get('tipo') as TxKind) || '');
  const [status, setStatus] = useState(params.get('situacao') ?? '');
  const [accountId, setAccountId] = useState(params.get('conta') ?? '');
  const [cardId, setCardId] = useState(params.get('cartao') ?? '');
  const [categoryId, setCategoryId] = useState(params.get('categoria') ?? '');
  const [showFilters, setShowFilters] = useState(Boolean(kind || status || accountId || cardId || categoryId));
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [exporting, setExporting] = useState(false);
  const q = useDebounce(search, 350);

  // mantém filtros na URL (compartilháveis e preservados ao voltar)
  useEffect(() => {
    const next = new URLSearchParams();
    if (q) next.set('q', q);
    if (period !== 'month') next.set('periodo', period);
    if (period === 'custom') {
      if (custom.from) next.set('de', custom.from);
      if (custom.to) next.set('ate', custom.to);
    }
    if (kind) next.set('tipo', kind);
    if (status) next.set('situacao', status);
    if (accountId) next.set('conta', accountId);
    if (cardId) next.set('cartao', cardId);
    if (categoryId) next.set('categoria', categoryId);
    setParams(next, { replace: true });
  }, [q, period, custom, kind, status, accountId, cardId, categoryId, setParams]);

  const filters = useMemo<TxFilters>(() => {
    const norm = q.trim().toLowerCase();
    const categoryIds = categoryId ? [categoryId, ...categories.filter((c) => c.parent_id === categoryId).map((c) => c.id)] : undefined;
    return {
      ...periodRange(period, custom),
      kind,
      status: status as TxFilters['status'],
      accountId: accountId || undefined,
      cardId: cardId || undefined,
      categoryIds,
      search: q,
      searchCategoryIds: norm.length >= 3 ? categories.filter((c) => c.name.toLowerCase().includes(norm)).map((c) => c.id).slice(0, 30) : undefined,
      searchAccountIds: norm.length >= 3 ? accounts.filter((a) => a.name.toLowerCase().includes(norm)).map((a) => a.id) : undefined,
    };
  }, [q, period, custom, kind, status, accountId, cardId, categoryId, categories, accounts]);

  const query = useInfiniteQuery({
    queryKey: wsKey(ws, 'transactions', filters),
    queryFn: ({ pageParam }) => listTransactions(ws, filters, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, all) => (last.hasMore ? all.length : undefined),
    enabled: Boolean(ws),
  });
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.rows) ?? [], [query.data]);
  const groups = useMemo(() => groupByDate(rows), [rows]);

  // carregamento progressivo ao rolar
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
    }, { rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, [query]);

  const loadedTotals = useMemo(() => {
    let inc = 0;
    let exp = 0;
    for (const r of rows) {
      if (r.status === 'cancelled') continue;
      if (r.kind === 'income') inc += r.amount_cents;
      if (r.kind === 'expense') exp += r.amount_cents;
    }
    return { inc, exp };
  }, [rows]);

  const activeFilterCount = [kind, status, accountId, cardId, categoryId].filter(Boolean).length;
  const clearFilters = () => {
    setKind('');
    setStatus('');
    setAccountId('');
    setCardId('');
    setCategoryId('');
  };

  async function exportCSV() {
    setExporting(true);
    try {
      const all = await listAllTransactions(ws, filters);
      const csv = toCSV(
        all.map((t) => {
          const cat = t.category_id ? categoryMap.get(t.category_id) : undefined;
          const parent = cat?.parent_id ? categoryMap.get(cat.parent_id) : undefined;
          return {
            data: formatDate(t.occurred_on),
            vencimento: formatDate(t.due_on),
            tipo: TX_KIND_LABEL[t.kind],
            descricao: t.description,
            categoria: parent ? parent.name : cat?.name ?? '',
            subcategoria: parent ? cat?.name ?? '' : '',
            conta: accountMap.get(t.account_id ?? '')?.name ?? '',
            destino: accountMap.get(t.destination_account_id ?? '')?.name ?? '',
            cartao: cardMap.get(t.card_id ?? '')?.name ?? '',
            forma: t.payment_method ? PAYMENT_METHOD_LABEL[t.payment_method] : '',
            situacao: TX_STATUS_LABEL[t.status],
            valor: centsToCSV(txSignedAmount(t) || t.amount_cents),
            pago: centsToCSV(t.paid_cents),
            parcela: t.installment_number ? `${t.installment_number}/${t.installments_total}` : '',
            tags: t.tags.join(', '),
            observacoes: t.notes ?? '',
          };
        }),
        [
          { key: 'data', label: 'Data' }, { key: 'vencimento', label: 'Vencimento' }, { key: 'tipo', label: 'Tipo' },
          { key: 'descricao', label: 'Descrição' }, { key: 'categoria', label: 'Categoria' }, { key: 'subcategoria', label: 'Subcategoria' },
          { key: 'conta', label: 'Conta' }, { key: 'destino', label: 'Conta destino' }, { key: 'cartao', label: 'Cartão' },
          { key: 'forma', label: 'Forma de pagamento' }, { key: 'situacao', label: 'Situação' }, { key: 'valor', label: 'Valor (R$)' },
          { key: 'pago', label: 'Pago (R$)' }, { key: 'parcela', label: 'Parcela' }, { key: 'tags', label: 'Tags' }, { key: 'observacoes', label: 'Observações' },
        ],
      );
      downloadFile(csv, `lancamentos-${todayISO()}.csv`, 'text/csv;charset=utf-8');
      toast.success(`${all.length} lançamentos exportados.`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setExporting(false);
    }
  }

  const roots = categories.filter((c) => !c.parent_id && !c.archived);

  return (
    <>
      <PageHeader
        title="Lançamentos"
        subtitle="Receitas, despesas, transferências e pagamentos."
        actions={
          <>
            {brand.features.exports !== false && (
              <Button size="sm" icon={<Download className="size-4" />} loading={exporting} onClick={exportCSV} disabled={!rows.length}>
                CSV
              </Button>
            )}
            {canContribute && (
              <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => quickAdd()} className="lg:hidden">
                Novo
              </Button>
            )}
          </>
        }
      />

      <Card className="mb-4 p-3 sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
            <Input
              type="search"
              aria-label="Pesquisar lançamentos"
              placeholder="Buscar por descrição, categoria, conta, valor (12,50) ou data (16/10/2026)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
          <div className="flex gap-2">
            <Select aria-label="Período" value={period} onChange={(e) => setPeriod(e.target.value as Period)} className="min-w-40">
              <option value="month">Este mês</option>
              <option value="last">Mês passado</option>
              <option value="90">Últimos 90 dias</option>
              <option value="year">Este ano</option>
              <option value="all">Todo o período</option>
              <option value="custom">Personalizado…</option>
            </Select>
            <Button onClick={() => setShowFilters((v) => !v)} icon={<SlidersHorizontal className="size-4" />} aria-expanded={showFilters}>
              <span className="hidden sm:inline">Filtros</span>
              {activeFilterCount > 0 && <span className="grid size-5 place-items-center rounded-full bg-brand text-[11px] text-[color:var(--brand-fg)]">{activeFilterCount}</span>}
            </Button>
          </div>
        </div>
        {period === 'custom' && (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:max-w-md">
            <Input type="date" aria-label="De" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
            <Input type="date" aria-label="Até" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
          </div>
        )}
        {showFilters && (
          <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-5">
            <Select aria-label="Tipo" value={kind} onChange={(e) => setKind(e.target.value as TxKind | '')}>
              <option value="">Todos os tipos</option>
              {(Object.keys(TX_KIND_LABEL) as TxKind[]).map((k) => <option key={k} value={k}>{TX_KIND_LABEL[k]}</option>)}
            </Select>
            <Select aria-label="Situação" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Qualquer situação</option>
              <option value="open">Em aberto</option>
              <option value="paid">Pago</option>
              <option value="received">Recebido</option>
              <option value="cancelled">Cancelado</option>
            </Select>
            <Select aria-label="Conta" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">Todas as contas</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
            <Select aria-label="Cartão" value={cardId} onChange={(e) => setCardId(e.target.value)}>
              <option value="">Todos os cartões</option>
              {cards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <Select aria-label="Categoria" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Todas as categorias</option>
              {roots.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            {activeFilterCount > 0 && (
              <Button size="sm" variant="ghost" icon={<X className="size-4" />} onClick={clearFilters} className="col-span-2 justify-self-start lg:col-span-5">
                Limpar filtros
              </Button>
            )}
          </div>
        )}
      </Card>

      {rows.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 px-1 text-sm text-muted" aria-live="polite">
          <span>{rows.length}{query.hasNextPage ? '+' : ''} lançamentos</span>
          <span>Receitas <Money cents={loadedTotals.inc} tone="income" className="font-semibold" /></span>
          <span>Despesas <Money cents={loadedTotals.exp} tone="expense" className="font-semibold" /></span>
        </div>
      )}

      <Card className="p-2 sm:p-3">
        {query.isLoading ? (
          <div className="space-y-2 p-2">
            {Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
          </div>
        ) : query.error ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<FileSearch className="size-6" />}
            title={q || activeFilterCount ? 'Nada encontrado' : 'Nenhum lançamento neste período'}
            description={q || activeFilterCount ? 'Ajuste a busca ou os filtros.' : 'Registre sua primeira receita ou despesa para começar a acompanhar.'}
            action={canContribute && !q ? <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => quickAdd()}>Novo lançamento</Button> : undefined}
          />
        ) : (
          <div>
            {groups.map((g) => (
              <section key={g.date} aria-label={formatDate(g.date)}>
                <h2 className="sticky top-14 z-10 bg-surface/95 px-2 pb-1 pt-3 text-[12px] font-semibold uppercase tracking-wider text-subtle backdrop-blur">
                  {formatDate(g.date)}
                </h2>
                {g.rows.map((tx) => (
                  <TxRow key={tx.id} tx={tx} onOpen={setSelected} showDate={false} accountId={accountId || undefined} />
                ))}
              </section>
            ))}
            <div ref={sentinel} />
            {query.isFetchingNextPage && <Skeleton className="m-2 h-12" />}
            {query.hasNextPage && !query.isFetchingNextPage && (
              <div className="p-3 text-center">
                <Button size="sm" onClick={() => void query.fetchNextPage()}>Carregar mais</Button>
              </div>
            )}
          </div>
        )}
      </Card>

      {selected && <TransactionDetail tx={selected} onClose={() => setSelected(null)} />}
    </>
  );
}
