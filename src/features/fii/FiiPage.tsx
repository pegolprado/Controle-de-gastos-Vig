import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Building2, CalendarPlus, ChevronDown, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useWorkspace, useWsId } from '@/app/WorkspaceProvider';
import { useLookups, wsKey } from '@/hooks/useFinance';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge, Card, EmptyState, ErrorState, Skeleton } from '@/components/ui/Card';
import { Field, Input, Select } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Money } from '@/components/ui/Money';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { Segmented } from '@/components/ui/Segmented';
import { useConfirm } from '@/components/ui/Confirm';
import { cn } from '@/lib/cn';
import { capitalize, formatDate, formatDateTime, monthLabel, todayISO } from '@/lib/dates';
import { formatBRL, formatPercent } from '@/lib/money';
import { errorMessage } from '@/lib/errors';
import { stableUUID } from '@/lib/id';
import { invalidateFinance, queryClient } from '@/lib/queryClient';
import type { FiiFund, FiiPosition } from '@/lib/types';
import { baseCode, nextAndLast, normalizeTicker, paymentsFor, payStatus, summarize, yieldOnCost, type FiiPayment } from '@/domain/fii';
import { deleteFiiPosition, listFiiMarket, listFiiPositions, saveFiiPosition, syncFii, type FiiSyncResult } from '@/services/fii';
import { importTransactions, listByRequestIds } from '@/services/transactions';

const fmtRate = (rate: number) => `R$ ${rate.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;

/** Chave de idempotência do lançamento de um provento (lançar duas vezes não duplica). */
const launchId = (ws: string, p: FiiPayment) => stableUUID(`finance-mv-fii|${ws}|${p.ticker}|${p.dist.isin}|${p.dist.kind}|${p.dist.payment_date}`);

export default function FiiPage() {
  const ws = useWsId();
  const { canEdit, canContribute } = useWorkspace();
  const confirm = useConfirm();
  const [tab, setTab] = useState<'carteira' | 'agenda'>('carteira');
  const [editing, setEditing] = useState<FiiPosition | 'new' | null>(null);
  const [launching, setLaunching] = useState<FiiPayment[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const positions = useQuery({ queryKey: wsKey(ws, 'fii-positions'), queryFn: () => listFiiPositions(ws) });
  const codes = useMemo(() => [...new Set((positions.data ?? []).map((p) => baseCode(p.ticker)))].sort(), [positions.data]);
  const market = useQuery({
    queryKey: ['fii-market', codes.join(',')],
    enabled: positions.isSuccess,
    staleTime: 15 * 60_000,
    queryFn: async () => {
      const results = await Promise.allSettled(codes.map((c) => syncFii(c)));
      const status = new Map<string, FiiSyncResult>(codes.map((c, i) => [c, results[i]!.status === 'fulfilled' ? (results[i] as PromiseFulfilledResult<FiiSyncResult>).value : 'unavailable']));
      return { ...(await listFiiMarket(codes)), status };
    },
  });

  const today = todayISO();
  const fundMap = useMemo(() => new Map<string, FiiFund>((market.data?.funds ?? []).map((f) => [f.code, f])), [market.data]);
  // cartões ordenados pelo próximo pagamento (anunciado ou previsto): o que cai antes aparece primeiro
  const byPosition = useMemo(
    () =>
      (positions.data ?? [])
        .map((p) => {
          const payments = paymentsFor(p, market.data?.dists ?? []);
          return { position: p, payments, ...nextAndLast(payments, today) };
        })
        .sort((a, b) => (a.next?.dist.payment_date ?? '9999').localeCompare(b.next?.dist.payment_date ?? '9999') || a.position.ticker.localeCompare(b.position.ticker)),
    [positions.data, market.data, today],
  );
  const summary = useMemo(
    () => summarize(byPosition.flatMap((x) => x.payments), today, byPosition.flatMap((x) => (x.next?.projected ? [x.next] : []))),
    [byPosition, today],
  );
  const agenda = useMemo(
    () => [...summary.upcoming, ...summary.projected].sort((a, b) => a.dist.payment_date.localeCompare(b.dist.payment_date) || a.ticker.localeCompare(b.ticker)),
    [summary],
  );

  // proventos futuros já lançados como receita
  const upcomingIds = useQuery({
    queryKey: wsKey(ws, 'fii-launched', summary.upcoming.map((p) => `${p.ticker}${p.dist.payment_date}`).join(',')),
    enabled: summary.upcoming.length > 0,
    queryFn: async () => {
      const ids = await Promise.all(summary.upcoming.map((p) => launchId(ws, p)));
      const found = new Set((await listByRequestIds(ws, ids)).map((t) => t.client_request_id));
      return new Set(summary.upcoming.filter((_, i) => found.has(ids[i]!)).map((p) => `${p.ticker}|${p.dist.payment_date}|${p.dist.kind}`));
    },
  });
  const isLaunched = (p: FiiPayment) => upcomingIds.data?.has(`${p.ticker}|${p.dist.payment_date}|${p.dist.kind}`) ?? false;

  const del = useMutation({
    mutationFn: deleteFiiPosition,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: wsKey(ws, 'fii-positions') }),
    onError: (e) => toast.error(errorMessage(e)),
  });

  async function refresh() {
    setRefreshing(true);
    try {
      const r = await Promise.allSettled(codes.map((c) => syncFii(c, true)));
      if (r.some((x) => x.status === 'fulfilled' && x.value === 'unavailable')) toast.warning('A B3 não respondeu para alguns fundos. Tente de novo em alguns minutos.');
      await queryClient.invalidateQueries({ queryKey: ['fii-market'] });
    } finally {
      setRefreshing(false);
    }
  }

  const loading = positions.isLoading || (positions.isSuccess && codes.length > 0 && market.isLoading);
  const list = byPosition;

  return (
    <>
      <PageHeader
        title="Renda FII"
        subtitle="Quanto e quando seus fundos imobiliários vão pagar, com os anúncios oficiais da B3."
        actions={
          <>
            {codes.length > 0 && (
              <Button size="sm" icon={<RefreshCw className={cn('size-4', refreshing && 'animate-spin')} />} onClick={() => void refresh()} disabled={refreshing}>
                Atualizar
              </Button>
            )}
            {canEdit && (
              <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
                Adicionar fundo
              </Button>
            )}
          </>
        }
      />

      {positions.error && ['PGRST205', 'PGRST202', '42P01'].includes((positions.error as { code?: string }).code ?? '') ? (
        <Card>
          <EmptyState
            icon={<Building2 className="size-6" />}
            title="Falta atualizar o banco de dados"
            description="A Renda FII precisa de uma atualização no Supabase: no SQL Editor, rode o arquivo supabase/migrations/20261017001000_renda_fii.sql (uma única vez)."
          />
        </Card>
      ) : positions.error ? (
        <ErrorState error={positions.error} onRetry={() => void positions.refetch()} />
      ) : positions.isSuccess && list.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Building2 className="size-6" />}
            title="Nenhum fundo na carteira"
            description="Informe o código (ex.: HGLG11) e quantas cotas você tem. O app mostra quanto e quando cada fundo vai pagar."
            action={canEdit && <Button variant="primary" onClick={() => setEditing('new')}>Adicionar fundo</Button>}
          />
        </Card>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Resumo dos rendimentos">
            <Stat label="A receber (anunciado)" cents={summary.upcoming_cents} tone="warning" loading={loading} footer={`${summary.upcoming.length} ${summary.upcoming.length === 1 ? 'pagamento' : 'pagamentos'}${summary.projected_cents ? ` · + ${formatBRL(summary.projected_cents)} previstos` : ''}`} />
            <Stat label="Recebido este mês" cents={summary.this_month_cents} tone="positive" loading={loading} />
            <Stat label="Últimos 12 meses" cents={summary.last12_cents} tone="positive" loading={loading} />
            <Stat label="Média mensal" cents={summary.monthly_avg_cents} tone="neutral" loading={loading} footer="nos meses com pagamento" />
          </section>

          <Segmented
            className="mt-5 max-w-xs"
            label="Visualização"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'carteira', label: 'Carteira' },
              { value: 'agenda', label: 'Próximos pagamentos' },
            ]}
          />

          {market.error && <div className="mt-4"><ErrorState error={market.error} onRetry={() => void market.refetch()} /></div>}

          {tab === 'carteira' ? (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {loading
                ? [0, 1].map((i) => <Skeleton key={i} className="h-40" />)
                : list.map(({ position, payments, next, last }) => (
                    <PositionCard
                      key={position.id}
                      position={position}
                      fund={fundMap.get(baseCode(position.ticker))}
                      status={market.data?.status.get(baseCode(position.ticker))}
                      payments={payments}
                      next={next}
                      last={last}
                      launched={isLaunched}
                      canEdit={canEdit}
                      canLaunch={canContribute}
                      onEdit={() => setEditing(position)}
                      onLaunch={(p) => setLaunching([p])}
                      onDelete={async () => {
                        if (await confirm({ title: `Remover ${position.ticker} da carteira?`, description: 'Os lançamentos já feitos continuam no extrato.', confirmLabel: 'Remover' })) del.mutate(position.id);
                      }}
                    />
                  ))}
            </div>
          ) : (
            <Card className="mt-4">
              {loading ? (
                <Skeleton className="m-5 h-24" />
              ) : agenda.length === 0 ? (
                <EmptyState title="Nenhum pagamento previsto" description="Os fundos costumam anunciar os rendimentos no fim de cada mês. Volte depois ou toque em Atualizar." />
              ) : (
                <>
                  <ul className="divide-y divide-line">
                    {agenda.map((p) => {
                      const st = payStatus(p.dist.payment_date, today, p.projected);
                      return (
                        <li key={`${p.ticker}${p.dist.payment_date}${p.dist.kind}${p.dist.isin}`} className="flex items-center gap-3 px-5 py-3.5">
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold">{p.ticker} <span className="text-[13px] font-normal text-subtle">· {p.quantity} cotas × {fmtRate(p.dist.rate)}</span></p>
                            <p className="text-[13px] text-subtle">
                              {p.projected ? 'Previsto para' : 'Pagamento'} {formatDate(p.dist.payment_date)}
                              {p.dist.record_date && ` · data com ${p.projected ? '~' : ''}${formatDate(p.dist.record_date)}`}
                              {p.projected && ' · ainda não anunciado'}
                            </p>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <Money cents={p.amount_cents} className={cn('font-num font-semibold', p.projected ? 'text-info' : 'text-warning')} />
                            <Badge tone={st.tone}>{st.label}</Badge>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  {canContribute && summary.upcoming.length > 0 && (
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4">
                      <p className="text-[13px] text-muted">Lance como receitas a receber para aparecerem na Agenda e no saldo previsto.</p>
                      <Button
                        size="sm"
                        variant="subtle"
                        icon={<CalendarPlus className="size-4" />}
                        disabled={summary.upcoming.every(isLaunched)}
                        onClick={() => setLaunching(summary.upcoming.filter((p) => !isLaunched(p)))}
                      >
                        {summary.upcoming.every(isLaunched) ? 'Tudo lançado' : 'Lançar como receitas'}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </Card>
          )}

          {!loading && summary.last12_cents > 0 && (
            <Card className="mt-4 p-5">
              <h2 className="text-[15px] font-semibold">Rendimentos por mês</h2>
              <MonthBars months={summary.months} />
            </Card>
          )}

          <p className="mt-5 text-[12px] leading-relaxed text-subtle">
            Fonte: B3 (consulta pública de fundos listados), atualizada a cada 6 horas. <strong>Previsto</strong> = o fundo ainda não anunciou; data e valor estimados pelo histórico (dia em que costuma pagar e último valor por cota), substituídos pelo anúncio oficial assim que sair. Os valores usam a quantidade de cotas cadastrada hoje: você recebe se tinha as cotas no fim do pregão da <strong>data com</strong>. Não é recomendação de investimento.
          </p>
        </>
      )}

      {editing && <PositionDialog position={editing === 'new' ? null : editing} existing={positions.data ?? []} onClose={() => setEditing(null)} />}
      {launching && <LaunchDialog payments={launching} onClose={() => setLaunching(null)} />}
    </>
  );
}

function Stat({ label, cents, tone, loading, footer }: { label: string; cents: number; tone: 'positive' | 'warning' | 'neutral'; loading?: boolean; footer?: string }) {
  return (
    <Card className="p-4 sm:p-5">
      <p className="text-[13px] font-semibold text-muted">{label}</p>
      {loading ? (
        <Skeleton className="mt-2 h-8 w-28" />
      ) : (
        <Money cents={cents} className={cn('font-num mt-1 block text-xl font-semibold sm:text-2xl', tone === 'positive' && 'text-positive', tone === 'warning' && 'text-warning')} />
      )}
      {footer && <p className="mt-1.5 text-[13px] text-subtle">{footer}</p>}
    </Card>
  );
}

function MonthBars({ months }: { months: Array<{ month: string; cents: number }> }) {
  const max = Math.max(...months.map((m) => m.cents), 1);
  return (
    <div className="mt-4 flex h-32 items-end gap-1.5" role="img" aria-label="Rendimentos recebidos nos últimos 12 meses">
      {months.map((m) => (
        <div key={m.month} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
          <div
            className="w-full rounded-t-md bg-brand/70"
            style={{ height: `${Math.max(m.cents ? 4 : 0, (m.cents / max) * 100)}%` }}
            title={`${capitalize(monthLabel(m.month, { short: true }))}: R$ ${(m.cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}
          />
          <span className="text-[10px] text-subtle">{monthLabel(m.month, { short: true }).slice(0, 3)}</span>
        </div>
      ))}
    </div>
  );
}

function PositionCard({
  position,
  fund,
  status,
  payments,
  next,
  last,
  launched,
  canEdit,
  canLaunch,
  onEdit,
  onDelete,
  onLaunch,
}: {
  position: FiiPosition;
  fund?: FiiFund;
  status?: FiiSyncResult;
  payments: FiiPayment[];
  next?: FiiPayment;
  last?: FiiPayment;
  launched: (p: FiiPayment) => boolean;
  canEdit: boolean;
  canLaunch: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onLaunch: (p: FiiPayment) => void;
}) {
  const [open, setOpen] = useState(false);
  const today = todayISO();
  const featured = next ?? last;
  const projected = !!featured?.projected;
  const st = featured ? payStatus(featured.dist.payment_date, today, projected) : null;
  const yoc = featured ? yieldOnCost(featured.dist.rate, position.avg_price_cents) : null;

  return (
    <Card className="overflow-hidden">
      <div className="flex items-start gap-4 p-5">
        <div className="min-w-0 flex-1">
          <p className="font-display text-2xl font-bold tracking-tight">{position.ticker}</p>
          <p className="truncate text-[13px] text-subtle">{fund?.name ?? 'Fundo imobiliário'} · {position.quantity} {position.quantity === 1 ? 'cota' : 'cotas'}</p>
          {featured && (
            <p className="mt-2 text-[15px] text-muted">
              {projected ? 'Previsto' : 'Rendimento'}: {fmtRate(featured.dist.rate)} <span className="text-[13px] text-subtle">por cota</span>
            </p>
          )}
          {featured && st && !st.paid && (
            <p className="text-[13px] text-subtle">
              {projected ? 'Deve cair em' : 'Cai em'} <strong className="font-semibold text-fg">{formatDate(featured.dist.payment_date)}</strong>
              {last && featured !== last && <> · último: <Money cents={last.amount_cents} /> em {formatDate(last.dist.payment_date)}</>}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          {featured && st ? (
            <>
              {projected && <span className="-mb-2 text-[11px] font-semibold uppercase tracking-wide text-info">previsto</span>}
              <Money cents={featured.amount_cents} className={cn('font-num text-2xl font-bold', st.paid ? 'text-positive' : projected ? 'text-info' : 'text-warning')} />
              <Badge tone={st.tone} className="px-3 py-1 text-[13px] uppercase tracking-wide">{st.label.replace('Previsto · ', '')}</Badge>
            </>
          ) : (
            <Badge tone="neutral">{status === 'not_found' ? 'Não encontrado na B3' : status === 'unavailable' ? 'B3 indisponível' : 'Sem anúncios'}</Badge>
          )}
        </div>
      </div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-center gap-1.5 border-t border-line bg-surface-2/50 py-3 text-sm font-semibold text-muted transition hover:text-fg"
      >
        Mais detalhes <ChevronDown className={cn('size-4 transition', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div className="border-t border-line p-5 text-[14px]">
          {featured && (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
              <dt className="text-subtle">{projected ? 'Data com (prevista)' : 'Data com'}</dt>
              <dd className="text-right font-medium">{featured.dist.record_date ? formatDate(featured.dist.record_date) : '—'}</dd>
              <dt className="text-subtle">{projected ? 'Pagamento (previsto)' : 'Pagamento'}</dt>
              <dd className="text-right font-medium">{formatDate(featured.dist.payment_date)}</dd>
              {featured.dist.related_to && (
                <>
                  <dt className="text-subtle">Referência</dt>
                  <dd className="text-right font-medium">{capitalize(featured.dist.related_to.split('/').slice(0, 2).join('/').toLowerCase())}</dd>
                </>
              )}
              <dt className="text-subtle">Tipo</dt>
              <dd className="text-right font-medium">{capitalize(featured.dist.kind.toLowerCase())}</dd>
              {yoc !== null && (
                <>
                  <dt className="text-subtle">Sobre o preço médio</dt>
                  <dd className="text-right font-medium">{formatPercent(yoc, 2)} ao mês</dd>
                </>
              )}
            </dl>
          )}
          {payments.length > 0 && (
            <>
              <h3 className="mt-5 text-[13px] font-semibold uppercase tracking-wide text-subtle">Histórico</h3>
              <ul className="mt-2 divide-y divide-line">
                {payments.slice(0, 13).map((p) => (
                  <li key={`${p.dist.payment_date}${p.dist.kind}${p.dist.isin}`} className="flex items-center justify-between gap-3 py-2">
                    <span>
                      {formatDate(p.dist.payment_date)} <span className="text-[13px] text-subtle">· {fmtRate(p.dist.rate)}</span>
                    </span>
                    <Money cents={p.amount_cents} className="font-num font-medium" />
                  </li>
                ))}
              </ul>
            </>
          )}
          {fund?.synced_at && <p className="mt-3 text-[12px] text-subtle">Atualizado em {formatDateTime(fund.synced_at)}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            {canLaunch && featured && !projected && !payStatus(featured.dist.payment_date, today).paid && (
              <Button size="sm" variant="subtle" icon={<CalendarPlus className="size-4" />} disabled={launched(featured)} onClick={() => onLaunch(featured)}>
                {launched(featured) ? 'Lançado como receita' : 'Lançar como receita'}
              </Button>
            )}
            <div className="flex-1" />
            {canEdit && (
              <IconButton size="sm" label={`Editar ${position.ticker}`} onClick={onEdit}>
                <Pencil className="size-4" />
              </IconButton>
            )}
            {canEdit && (
              <IconButton size="sm" label={`Remover ${position.ticker}`} onClick={onDelete}>
                <Trash2 className="size-4" />
              </IconButton>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function PositionDialog({ position, existing, onClose }: { position: FiiPosition | null; existing: FiiPosition[]; onClose: () => void }) {
  const ws = useWsId();
  const [ticker, setTicker] = useState(position?.ticker ?? '');
  const [quantity, setQuantity] = useState(position ? String(position.quantity) : '');
  const [avg, setAvg] = useState(position?.avg_price_cents ?? 0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setError(null);
    const t = position?.ticker ?? normalizeTicker(ticker);
    const q = Number(quantity.replace(/\D/g, ''));
    if (!t) return setError('Código inválido. Use o formato da B3, por exemplo HGLG11.');
    if (!q || q < 1) return setError('Informe quantas cotas você tem.');
    if (!position && existing.some((p) => p.ticker === t)) return setError(`${t} já está na carteira. Edite a quantidade dele.`);
    setSaving(true);
    try {
      if (!position) {
        const r = await syncFii(t);
        if (r === 'not_found') {
          setSaving(false);
          return setError(`Não encontramos ${t} entre os fundos listados na B3. Confira o código.`);
        }
        if (r === 'unavailable') toast.warning('A B3 não respondeu agora; os rendimentos aparecem na próxima atualização.');
      }
      await saveFiiPosition(ws, { id: position?.id, ticker: t, quantity: q, avg_price_cents: avg || null });
      await queryClient.invalidateQueries({ queryKey: wsKey(ws, 'fii-positions') });
      toast.success(position ? `${t} atualizado.` : `${t} adicionado à carteira.`);
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
      title={position ? `Editar ${position.ticker}` : 'Adicionar fundo'}
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
        <Field label="Código do fundo" hint={position ? undefined : 'Ex.: HGLG11, MXRF11, KNRI11'}>
          {(id, d) => (
            <Input id={id} aria-describedby={d} value={ticker} disabled={!!position} autoCapitalize="characters" autoComplete="off" maxLength={6} placeholder="HGLG11" onChange={(e) => setTicker(e.target.value.toUpperCase())} data-autofocus />
          )}
        </Field>
        <Field label="Quantidade de cotas">
          {(id) => <Input id={id} inputMode="numeric" value={quantity} placeholder="100" onChange={(e) => setQuantity(e.target.value.replace(/\D/g, '').slice(0, 9))} />}
        </Field>
        <Field label="Preço médio por cota" optional hint="Para ver o rendimento sobre o que você pagou.">
          {(id, d) => <MoneyInput id={id} aria-describedby={d} value={avg} onChange={setAvg} />}
        </Field>
        {error && (
          <p role="alert" className="rounded-xl border border-negative/25 bg-negative/8 px-3 py-2 text-sm text-negative">
            {error}
          </p>
        )}
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}

function LaunchDialog({ payments, onClose }: { payments: FiiPayment[]; onClose: () => void }) {
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
          description: `Rendimento ${p.ticker}`,
          amount_cents: p.amount_cents,
          occurred_on: p.dist.payment_date,
          due_on: p.dist.payment_date,
          category_id: category?.id ?? null,
          account_id: accountId,
          destination_account_id: null,
          card_id: null,
          payment_method: null,
          tags: ['fii'],
          notes: `${p.quantity} cotas × ${fmtRate(p.dist.rate)}${p.dist.record_date ? ` · data com ${formatDate(p.dist.record_date)}` : ''}`,
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
      description="Os rendimentos entram como receitas a receber na data de pagamento. Quando caírem na conta, marque como recebidos."
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
              <li key={`${p.ticker}${p.dist.payment_date}${p.dist.kind}`} className="flex justify-between gap-3 py-2">
                <span>{p.ticker} · {formatDate(p.dist.payment_date)}</span>
                <Money cents={p.amount_cents} className="font-num font-medium" />
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}
