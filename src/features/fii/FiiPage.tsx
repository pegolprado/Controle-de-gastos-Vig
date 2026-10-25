import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Building2, ChevronRight, Plus, RefreshCw } from 'lucide-react';
import { useWorkspace, useWsId } from '@/app/WorkspaceProvider';
import { wsKey } from '@/hooks/useFinance';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState, ErrorState, Skeleton } from '@/components/ui/Card';
import { Money } from '@/components/ui/Money';
import { Segmented } from '@/components/ui/Segmented';
import { useConfirm } from '@/components/ui/Confirm';
import { cn } from '@/lib/cn';
import { addMonths, capitalize, monthLabel, startOfMonth } from '@/lib/dates';
import { formatBRL } from '@/lib/money';
import { errorMessage } from '@/lib/errors';
import { invalidateFinance, queryClient } from '@/lib/queryClient';
import type { FiiPosition, FiiTrade } from '@/lib/types';
import { baseCode, type Holding, monthlyPerShare, monthView, paymentsFor, summarize, undatedFor, type FiiPayment, type MonthMode } from '@/domain/fii';
import {
  deleteFiiPosition,
  deleteTrade,
  getRendaSettings,
  listFiiPositions,
  listFiiTrades,
  listRendaMarket,
  runAutopilot,
  syncAsset,
  type FiiSyncResult,
} from '@/services/fii';
import { listByRequestIds } from '@/services/transactions';
import { AddAssetDialog, LaunchDialog, TradeDialog } from './dialogs';
import { PortfolioOverview } from './PortfolioOverview';
import { PositionCard } from './PositionCard';
import { StatDetails, type StatKind } from './StatDetails';
import { launchId, useToday } from './shared';
import { AgendaTab, GoalTab, IrTab } from './tabs';

const MODE_ORDER: Record<MonthMode, number> = { upcoming: 0, received: 1, next: 2, none: 3 };
type Tab = 'carteira' | 'agenda' | 'meta' | 'ir';

export default function FiiPage() {
  const ws = useWsId();
  const { canEdit, canContribute } = useWorkspace();
  const confirm = useConfirm();
  const [tab, setTab] = useState<Tab>('carteira');
  const [adding, setAdding] = useState(false);
  const [trading, setTrading] = useState<FiiPosition | null>(null);
  const [launching, setLaunching] = useState<FiiPayment[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [detail, setDetail] = useState<StatKind | null>(null);
  const today = useToday();

  const positions = useQuery({ queryKey: wsKey(ws, 'fii-positions'), queryFn: () => listFiiPositions(ws) });
  const trades = useQuery({ queryKey: wsKey(ws, 'fii-trades'), queryFn: () => listFiiTrades(ws) });
  const settings = useQuery({ queryKey: wsKey(ws, 'renda-settings'), queryFn: () => getRendaSettings(ws) });
  const assets = useMemo(() => (positions.data ?? []).map((p) => ({ ticker: p.ticker, asset_type: p.asset_type ?? 'fii' })), [positions.data]);
  const market = useQuery({
    queryKey: ['renda-market', assets.map((a) => `${a.ticker}:${a.asset_type}`).join(',')],
    enabled: positions.isSuccess,
    staleTime: 15 * 60_000,
    queryFn: async () => {
      const results = await Promise.allSettled(assets.map((a) => syncAsset(a.ticker, a.asset_type)));
      const status = new Map<string, FiiSyncResult>(
        assets.map((a, i) => [a.ticker, results[i]!.status === 'fulfilled' ? (results[i] as PromiseFulfilledResult<FiiSyncResult>).value : 'unavailable']),
      );
      return { ...(await listRendaMarket(assets)), status };
    },
  });

  // piloto automático: depois de atualizar os anúncios, lança/recebe o que for devido
  const autopilotRan = useRef('');
  useEffect(() => {
    if (!market.isSuccess || !settings.data?.auto_launch || !canContribute) return;
    const key = `${ws}|${market.dataUpdatedAt}`;
    if (autopilotRan.current === key) return;
    autopilotRan.current = key;
    void runAutopilot(ws)
      .then((n) => {
        if (n) {
          void invalidateFinance(ws);
          void queryClient.invalidateQueries({ queryKey: wsKey(ws, 'fii-launched') });
        }
      })
      .catch(() => {});
  }, [market.isSuccess, market.dataUpdatedAt, settings.data?.auto_launch, canContribute, ws]);

  const tradesByPos = useMemo(() => {
    const m = new Map<string, FiiTrade[]>();
    for (const t of trades.data ?? []) m.set(t.position_id, [...(m.get(t.position_id) ?? []), t]);
    return m;
  }, [trades.data]);
  const nameOf = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const f of market.data?.funds ?? []) m.set(`fii:${f.code}`, f.name);
    for (const c of market.data?.companies ?? []) m.set(`stock:${c.code}`, c.name);
    return m;
  }, [market.data]);
  const quoteOf = useMemo(() => new Map((market.data?.quotes ?? []).map((q) => [q.ticker, q])), [market.data]);
  const syncedOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of market.data?.funds ?? []) m.set(`fii:${f.code}`, f.synced_at);
    for (const c of market.data?.companies ?? []) m.set(`stock:${c.code}`, c.synced_at);
    return m;
  }, [market.data]);

  // cartões: a cair neste mês (mais perto primeiro) → recebidos no mês → próximo mês → sem anúncio
  const byPosition = useMemo(
    () =>
      (positions.data ?? [])
        .map((p) => {
          const t = tradesByPos.get(p.id) ?? [];
          const payments = paymentsFor(p, market.data?.dists ?? [], t);
          return { position: p, trades: t, payments, undated: undatedFor(p, market.data?.dists ?? [], t), ...monthView(payments, today) };
        })
        .sort((a, b) => {
          const byMode = MODE_ORDER[a.mode] - MODE_ORDER[b.mode];
          if (byMode) return byMode;
          const da = a.featured?.dist.payment_date ?? '9999';
          const db = b.featured?.dist.payment_date ?? '9999';
          return (a.mode === 'received' ? db.localeCompare(da) : da.localeCompare(db)) || a.position.ticker.localeCompare(b.position.ticker);
        }),
    [positions.data, tradesByPos, market.data, today],
  );
  const summary = useMemo(
    () => summarize(byPosition.flatMap((x) => x.payments), today, byPosition.flatMap((x) => (x.featured?.projected ? [x.featured] : []))),
    [byPosition, today],
  );
  const thisMonth = byPosition.filter((x) => x.mode === 'upcoming').map((x) => x.featured!);
  const nextMonth = byPosition.filter((x) => x.mode === 'next').map((x) => x.featured!).sort((a, b) => a.dist.payment_date.localeCompare(b.dist.payment_date));
  const thisMonthCents = thisMonth.reduce((s, p) => s + p.amount_cents, 0);
  const thisMonthProjected = thisMonth.filter((p) => p.projected).reduce((s, p) => s + p.amount_cents, 0);
  const monthStart = startOfMonth(today);
  const from12 = addMonths(monthStart, -11);
  const paidSince = (from: string) => byPosition.flatMap((x) => x.payments.filter((p) => !p.projected && p.dist.payment_date >= from && p.dist.payment_date <= today));
  const portfolioCents = byPosition.reduce((s, x) => s + Math.round((quoteOf.get(x.position.ticker)?.price ?? 0) * x.position.quantity * 100), 0);

  const goalItems = useMemo(
    () =>
      byPosition.map((x) => ({
        ticker: x.position.ticker,
        type: x.position.asset_type ?? 'fii',
        quantity: x.position.quantity,
        perShare: monthlyPerShare(x.position.asset_type ?? 'fii', x.payments, today),
        price: quoteOf.get(x.position.ticker)?.price ?? null,
      })),
    [byPosition, quoteOf, today],
  );
  const holdings = useMemo<Holding[]>(
    () =>
      byPosition.map((x) => ({
        ticker: x.position.ticker,
        type: x.position.asset_type ?? 'fii',
        quantity: x.position.quantity,
        price: quoteOf.get(x.position.ticker)?.price ?? null,
        avgPriceCents: x.position.avg_price_cents,
        perShare: monthlyPerShare(x.position.asset_type ?? 'fii', x.payments, today),
      })),
    [byPosition, quoteOf, today],
  );
  const tickerNames = useMemo(
    () => new Map(byPosition.map((x) => [x.position.ticker, nameOf.get(`${x.position.asset_type ?? 'fii'}:${baseCode(x.position.ticker)}`) ?? null])),
    [byPosition, nameOf],
  );
  const irItems = useMemo(
    () =>
      byPosition.map((x) => ({
        ticker: x.position.ticker,
        assetType: x.position.asset_type ?? 'fii',
        name: nameOf.get(`${x.position.asset_type ?? 'fii'}:${baseCode(x.position.ticker)}`) ?? null,
        payments: x.payments,
      })),
    [byPosition, nameOf],
  );

  // proventos futuros já lançados como receita
  const upcomingIds = useQuery({
    queryKey: wsKey(ws, 'fii-launched', summary.upcoming.map((p) => `${p.ticker}${p.dist.payment_date}${p.dist.kind}`).join(',')),
    enabled: summary.upcoming.length > 0,
    queryFn: async () => {
      const ids = await Promise.all(summary.upcoming.map((p) => launchId(ws, p)));
      const found = new Set((await listByRequestIds(ws, ids)).map((t) => t.client_request_id));
      return new Set(summary.upcoming.filter((_, i) => found.has(ids[i]!)).map((p) => `${p.ticker}|${p.dist.payment_date}|${p.dist.kind}`));
    },
  });
  const isLaunched = (p: FiiPayment) => upcomingIds.data?.has(`${p.ticker}|${p.dist.payment_date}|${p.dist.kind}`) ?? false;

  const refreshRenda = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: wsKey(ws, 'fii-positions') }),
      queryClient.invalidateQueries({ queryKey: wsKey(ws, 'fii-trades') }),
    ]);
  const del = useMutation({ mutationFn: deleteFiiPosition, onSuccess: () => void refreshRenda(), onError: (e) => toast.error(errorMessage(e)) });
  const delTrade = useMutation({ mutationFn: deleteTrade, onSuccess: () => void refreshRenda(), onError: (e) => toast.error(errorMessage(e)) });

  async function refresh() {
    setRefreshing(true);
    try {
      const r = await Promise.allSettled(assets.map((a) => syncAsset(a.ticker, a.asset_type, true)));
      if (r.some((x) => x.status === 'fulfilled' && x.value === 'unavailable')) toast.warning('A B3 não respondeu para alguns ativos. Tente de novo em alguns minutos.');
      await queryClient.invalidateQueries({ queryKey: ['renda-market'] });
    } finally {
      setRefreshing(false);
    }
  }

  const loading = positions.isLoading || (positions.isSuccess && assets.length > 0 && (market.isLoading || trades.isLoading));
  const missingDb = [positions.error, settings.error].some((e) => ['PGRST205', 'PGRST202', '42P01', '42703'].includes((e as { code?: string } | null)?.code ?? ''));

  return (
    <>
      <PageHeader
        title="Renda FII"
        subtitle="Quanto e quando seus fundos imobiliários e ações vão pagar, com os anúncios oficiais da B3."
        actions={
          <>
            {assets.length > 0 && (
              <Button size="sm" icon={<RefreshCw className={cn('size-4', refreshing && 'animate-spin')} />} onClick={() => void refresh()} disabled={refreshing}>
                Atualizar
              </Button>
            )}
            {canEdit && (
              <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
                Adicionar
              </Button>
            )}
          </>
        }
      />

      {missingDb ? (
        <Card>
          <EmptyState
            icon={<Building2 className="size-6" />}
            title="Falta atualizar o banco de dados"
            description="Esta tela precisa da atualização mais recente do banco no Supabase. Ela é aplicada automaticamente em alguns minutos depois de publicada; se continuar aparecendo, avise o administrador."
          />
        </Card>
      ) : positions.error ? (
        <ErrorState error={positions.error} onRetry={() => void positions.refetch()} />
      ) : positions.isSuccess && byPosition.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Building2 className="size-6" />}
            title="Nenhum ativo na carteira"
            description="Informe o código (ex.: HGLG11 ou PETR4), quantas cotas ou ações você tem e quando comprou. O app mostra quanto e quando cada um vai pagar."
            action={canEdit && <Button variant="primary" onClick={() => setAdding(true)}>Adicionar à carteira</Button>}
          />
        </Card>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Resumo dos rendimentos">
            <Stat
              onOpen={() => setDetail('receber')}
              label="A receber este mês"
              cents={thisMonthCents}
              tone="warning"
              loading={loading}
              footer={`${thisMonth.length} ${thisMonth.length === 1 ? 'ativo' : 'ativos'}${thisMonthProjected ? ` · ${formatBRL(thisMonthProjected)} previsto` : ''}`}
            />
            <Stat onOpen={() => setDetail('recebido')} label="Recebido este mês" cents={summary.this_month_cents} tone="positive" loading={loading} />
            <Stat onOpen={() => setDetail('12m')} label="Últimos 12 meses" cents={summary.last12_cents} tone="positive" loading={loading} footer={`média ${formatBRL(summary.monthly_avg_cents)}/mês`} />
            <Stat onOpen={() => setDetail('carteira')} label="Valor da carteira" cents={portfolioCents} tone="neutral" loading={loading} footer="pela última cotação" />
          </section>

          <Segmented
            className="mt-5 max-w-md"
            label="Visualização"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'carteira', label: 'Carteira' },
              { value: 'agenda', label: 'Agenda' },
              { value: 'meta', label: 'Meta' },
              { value: 'ir', label: 'IR' },
            ]}
          />

          {market.error && <div className="mt-4"><ErrorState error={market.error} onRetry={() => void market.refetch()} /></div>}

          {tab === 'carteira' && (
            <>
              {!loading && <PortfolioOverview holdings={holdings} names={tickerNames} />}
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                {loading
                  ? [0, 1].map((i) => <Skeleton key={i} className="h-40" />)
                  : byPosition.map((x) => (
                      <PositionCard
                        key={x.position.id}
                        position={x.position}
                        name={nameOf.get(`${x.position.asset_type ?? 'fii'}:${baseCode(x.position.ticker)}`)}
                        syncedAt={syncedOf.get(`${x.position.asset_type ?? 'fii'}:${baseCode(x.position.ticker)}`)}
                        status={market.data?.status.get(x.position.ticker)}
                        quote={quoteOf.get(x.position.ticker)}
                        trades={x.trades}
                        payments={x.payments}
                        undated={x.undated}
                        mode={x.mode}
                        featured={x.featured}
                        last={x.last}
                        today={today}
                        launched={isLaunched}
                        canEdit={canEdit}
                        canLaunch={canContribute && !settings.data?.auto_launch}
                        onTrade={() => setTrading(x.position)}
                        onLaunch={(p) => setLaunching([p])}
                        onDeleteTrade={async (t) => {
                          if (await confirm({ title: 'Excluir esta operação?', description: 'A quantidade e o preço médio serão recalculados.', confirmLabel: 'Excluir' })) delTrade.mutate(t.id);
                        }}
                        onDelete={async () => {
                          if (await confirm({ title: `Remover ${x.position.ticker} da carteira?`, description: 'As compras registradas são apagadas; os lançamentos já feitos continuam no extrato.', confirmLabel: 'Remover' })) del.mutate(x.position.id);
                        }}
                      />
                    ))}
              </div>
              {!loading && summary.last12_cents > 0 && (
                <Card className="mt-4 p-5">
                  <h2 className="text-[15px] font-semibold">Proventos por mês</h2>
                  <MonthBars months={summary.months} />
                </Card>
              )}
            </>
          )}

          {tab === 'agenda' && (
            <AgendaTab
              agenda={[...thisMonth, ...nextMonth]}
              upcoming={summary.upcoming}
              today={today}
              loading={loading}
              settings={settings.data ?? null}
              canEdit={canEdit}
              canContribute={canContribute}
              isLaunched={isLaunched}
              onLaunch={setLaunching}
            />
          )}
          {tab === 'meta' && <GoalTab key={settings.data?.income_goal_cents ?? 0} settings={settings.data ?? null} canEdit={canEdit} items={goalItems} loading={loading} />}
          {tab === 'ir' && <IrTab items={irItems} today={today} />}

          <p className="mt-5 text-[12px] leading-relaxed text-subtle">
            Cada ativo mostra o pagamento do mês vigente: já pago = <strong>Recebido</strong> (no próprio dia do pagamento); ainda a cair = contagem de dias. Na virada do mês, todos voltam a contar os dias até o próximo. <strong>Previsto</strong> = o fundo ainda não anunciou; data e valor estimados pelo histórico, substituídos pelo anúncio oficial assim que sair. Você recebe pelas cotas ou ações que tinha na <strong>data com</strong> (pelas datas das suas compras). JCP aparece líquido de 15% de IR. Fonte: B3 (consultas públicas), atualizada a cada 6 horas; cotações a cada 20 minutos. Não é recomendação de investimento.
          </p>
        </>
      )}

      {adding && <AddAssetDialog existing={positions.data ?? []} onClose={() => setAdding(false)} />}
      {trading && <TradeDialog position={trading} onClose={() => setTrading(null)} />}
      {detail && (
        <StatDetails
          kind={detail}
          onClose={() => setDetail(null)}
          onGo={(t) => {
            setDetail(null);
            setTab(t);
          }}
          today={today}
          names={tickerNames}
          thisMonth={thisMonth}
          received={paidSince(monthStart)}
          last12={paidSince(from12)}
          months={summary.months}
          holdings={holdings}
        />
      )}
      {launching && <LaunchDialog payments={launching} onClose={() => setLaunching(null)} />}
    </>
  );
}

function Stat({ label, cents, tone, loading, footer, onOpen }: { label: string; cents: number; tone: 'positive' | 'warning' | 'neutral'; loading?: boolean; footer?: string; onOpen: () => void }) {
  return (
    <Card className="group relative p-4 transition hover:border-line-strong sm:p-5">
      <button type="button" onClick={onOpen} disabled={loading} className="absolute inset-0 rounded-[inherit]" aria-label={`${label}: ver detalhes`} />
      <p className="flex items-center justify-between gap-1 text-[13px] font-semibold text-muted">
        {label}
        <ChevronRight className="size-4 shrink-0 text-subtle transition group-hover:translate-x-0.5" aria-hidden />
      </p>
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
