import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowDownRight, ArrowLeftRight, ArrowUpRight, CalendarClock, ChevronRight, CreditCard, Lightbulb,
  Minus, Plus, Repeat, SlidersHorizontal, TrendingDown, TrendingUp, Wallet,
} from 'lucide-react';
import { useWorkspace, useWsId } from '@/app/WorkspaceProvider';
import { useBalances, useCardLimits, useLookups, useOpenInvoices, wsKey } from '@/hooks/useFinance';
import { useQuickAdd } from '@/features/transactions/QuickAdd';
import { TransactionDetail } from '@/features/transactions/TransactionDetail';
import { MonthPicker } from '@/components/layout/PageHeader';
import { Card, CardHeader, EmptyState, ErrorState, Progress, Skeleton, Badge } from '@/components/ui/Card';
import { Money } from '@/components/ui/Money';
import { Select } from '@/components/ui/Field';
import { CategoryBars } from '@/components/charts/CategoryBars';
import { LazyArea, LazyBars, SERIES_COLORS } from '@/components/charts/LazyCharts';
import { addDays, addMonths, capitalize, endOfMonth, formatDate, monthLabel, relativeDay, startOfMonth, todayISO } from '@/lib/dates';
import { formatBRL, formatPercent, percentChange } from '@/lib/money';
import { cn } from '@/lib/cn';
import { buildInsights } from '@/domain/insights';
import { nextOccurrences, describeRecurrence } from '@/domain/recurrence';
import { INVOICE_STATUS_LABEL } from '@/domain/labels';
import type { Transaction } from '@/lib/types';
import { reportCategories, reportMonthly, upcomingCommitments } from '@/services/reports';
import { MonthRecap } from './MonthRecap';
import { HealthCard } from './HealthCard';
import { ForecastCard } from '@/features/forecast/ForecastCard';
import { budgetProgress, listRecurrences } from '@/services/planning';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

function Delta({ current, previous, inverse }: { current: number; previous: number; inverse?: boolean }) {
  const pct = percentChange(current, previous);
  if (pct === null) return <span className="text-[13px] text-subtle">sem base no mês anterior</span>;
  const up = pct > 0;
  const good = inverse ? !up : up;
  const Icon = Math.abs(pct) < 0.5 ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-[13px] font-semibold', Math.abs(pct) < 0.5 ? 'text-subtle' : good ? 'text-positive' : 'text-negative')}>
      <Icon className="size-3.5" aria-hidden />
      {formatPercent(Math.abs(pct))} <span className="font-normal text-subtle">vs. mês anterior</span>
    </span>
  );
}

export default function DashboardPage() {
  const ws = useWsId();
  const { ctx, workspace, canContribute } = useWorkspace();
  const quickAdd = useQuickAdd();
  const { accounts, cards, cardMap, accountMap, categories } = useLookups();
  const [month, setMonth] = useState(startOfMonth(todayISO()));
  const [accountId, setAccountId] = useState('');
  const [cardId, setCardId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const filters = { accountId: accountId || null, cardId: cardId || null, categoryId: categoryId || null };
  // lançamentos do mês escolhido, com os mesmos filtros do Painel
  const txLink = (kind: 'income' | 'expense') => {
    const q = new URLSearchParams({ tipo: kind, periodo: 'custom', de: month, ate: endOfMonth(month) });
    if (accountId) q.set('conta', accountId);
    if (cardId) q.set('cartao', cardId);
    if (categoryId) q.set('categoria', categoryId);
    return `/lancamentos?${q}`;
  };
  const prevMonth = addMonths(month, -1);
  const today = todayISO();

  const balances = useBalances();
  const limits = useCardLimits();
  const invoices = useOpenInvoices();
  const series = useQuery({
    queryKey: wsKey(ws, 'report-monthly', month, filters),
    queryFn: () => reportMonthly(ws, addMonths(month, -11), month, filters),
  });
  const cats = useQuery({
    queryKey: wsKey(ws, 'report-categories', month, filters),
    queryFn: () => reportCategories(ws, month, endOfMonth(month), 'expense', filters),
  });
  const prevCats = useQuery({
    queryKey: wsKey(ws, 'report-categories', prevMonth, filters),
    queryFn: () => reportCategories(ws, prevMonth, endOfMonth(prevMonth), 'expense', filters),
  });
  const budgets = useQuery({ queryKey: wsKey(ws, 'budgets', month), queryFn: () => budgetProgress(ws, month) });
  const upcoming = useQuery({
    queryKey: wsKey(ws, 'upcoming', today),
    queryFn: () => upcomingCommitments(ws, addDays(today, -60), addDays(today, 15)),
  });
  const recurrences = useQuery({ queryKey: wsKey(ws, 'recurrences'), queryFn: () => listRecurrences(ws) });

  const consolidated = useMemo(() => {
    const included = new Set(accounts.filter((a) => a.include_in_total && !a.archived).map((a) => a.id));
    const rows = (balances.data ?? []).filter((b) => included.has(b.account_id));
    const sum = (k: 'current_balance_cents' | 'projected_balance_cents' | 'pending_in_cents' | 'pending_out_cents') => rows.reduce((a, b) => a + Number(b[k]), 0);
    return { current: sum('current_balance_cents'), projected: sum('projected_balance_cents'), pendingIn: sum('pending_in_cents'), pendingOut: sum('pending_out_cents') };
  }, [balances.data, accounts]);

  const invoiceDebt = (invoices.data ?? []).reduce((a, i) => a + Math.max(i.remaining_cents, 0), 0);
  const rows = useMemo(() => series.data ?? [], [series.data]);
  const cur = rows.find((r) => r.month === month);
  const prev = rows.find((r) => r.month === prevMonth);
  const income = cur?.income_cents ?? 0;
  const expense = cur?.expense_cents ?? 0;
  const result = income - expense;

  const budgetTotals = (budgets.data ?? []).reduce((a, b) => ({ limit: a.limit + b.limit_cents, spent: a.spent + b.spent_cents }), { limit: 0, spent: 0 });
  const budgetPct = budgetTotals.limit ? (budgetTotals.spent / budgetTotals.limit) * 100 : null;

  const insights = useMemo(() => buildInsights(cats.data ?? [], prevCats.data ?? [], rows), [cats.data, prevCats.data, rows]);

  const upcomingRows = (upcoming.data ?? []).filter((t) => t.kind === 'expense' || t.kind === 'income');
  const overdue = upcomingRows.filter((t) => t.due_on! < today);
  const soon = upcomingRows.filter((t) => t.due_on! >= today && t.due_on! <= addDays(today, 7));

  const nextRecurring = useMemo(() => {
    const list: Array<{ id: string; description: string; date: string; amount: number; kind: string; label: string }> = [];
    for (const r of recurrences.data ?? []) {
      if (r.status !== 'active') continue;
      const [d] = nextOccurrences(r.start_date, r.frequency, r.interval_count, r.occurrences_generated, 1, r.end_date);
      if (d) list.push({ id: r.id, description: r.description, date: d, amount: r.amount_cents, kind: r.kind, label: describeRecurrence(r.frequency, r.interval_count) });
    }
    return list.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
  }, [recurrences.data]);

  const chartData = rows.map((r) => ({ label: monthLabel(r.month, { short: true }), income: r.income_cents, expense: r.expense_cents, net: r.income_cents - r.expense_cents }));
  let running = 0;
  const netData = rows.map((r) => {
    running += r.income_cents - r.expense_cents;
    return { label: monthLabel(r.month, { short: true }), net: running };
  });
  const firstName = ctx?.profile?.full_name?.split(' ')[0];
  const hasAnyData = rows.some((r) => r.income_cents || r.expense_cents);
  const filtersActive = Boolean(accountId || cardId || categoryId);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-muted">
            {greeting()}
            {firstName ? `, ${firstName}` : ''} 👋
          </p>
          <h1 className="font-display text-[26px] font-semibold tracking-tight sm:text-[30px]">{workspace?.kind === 'personal' ? 'Seu painel' : workspace?.name}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <MonthPicker value={month} onChange={setMonth} />
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            aria-expanded={showFilters}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-sm font-semibold text-muted sm:hidden"
          >
            <SlidersHorizontal className="size-4" aria-hidden /> Filtros{filtersActive ? ' •' : ''}
          </button>
          <div className={cn('w-full flex-wrap gap-2 sm:flex sm:w-auto', showFilters ? 'flex' : 'hidden')}>
          <Select aria-label="Filtrar por conta" value={accountId} onChange={(e) => { setAccountId(e.target.value); if (e.target.value) setCardId(''); }} className="h-10 text-sm sm:w-48">
            <option value="">Todas as contas</option>
            {accounts.filter((a) => !a.archived).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
          {cards.length > 0 && (
            <Select aria-label="Filtrar por cartão" value={cardId} onChange={(e) => { setCardId(e.target.value); if (e.target.value) setAccountId(''); }} className="h-10 text-sm sm:w-48">
              <option value="">Todos os cartões</option>
              {cards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          )}
          <Select aria-label="Filtrar por categoria" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="h-10 text-sm sm:w-48">
            <option value="">Todas as categorias</option>
            {categories.filter((c) => !c.parent_id && c.kind === 'expense' && !c.archived).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          </div>
        </div>
      </div>

      {/* Herói: saldo consolidado */}
      <section className="relative overflow-hidden rounded-[28px] border border-white/[0.06] bg-[linear-gradient(150deg,var(--hero-from),var(--hero-to))] p-6 text-white shadow-float sm:p-8">
        <div className="pointer-events-none absolute -right-20 -top-28 size-80 rounded-full bg-brand/25 blur-[90px]" aria-hidden />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:28px_28px] [mask-image:linear-gradient(to_bottom,black,transparent)]" aria-hidden />
        <div className="relative grid gap-6 lg:grid-cols-[1.3fr_1fr]">
          <div>
            <Link to="/contas" className="group inline-block rounded-xl focus-visible:outline-2 focus-visible:outline-white/60" aria-label="Saldo consolidado hoje: ver contas">
              <p className="flex items-center gap-1 text-[12px] font-semibold uppercase tracking-[0.18em] text-white/50">
                Saldo consolidado hoje <ChevronRight className="size-3.5 opacity-60 transition group-hover:translate-x-0.5 group-hover:opacity-100" aria-hidden />
              </p>
              {balances.isLoading ? (
                <Skeleton className="mt-2 h-12 w-64 bg-white/10" />
              ) : (
                <p className="money font-num mt-1 text-[40px] font-semibold leading-none sm:text-[52px]">
                  {formatBRL(consolidated.current)}
                </p>
              )}
            </Link>
            <p className="mt-3 text-sm text-white/60">
              Em contas e dinheiro. Previsto após compromissos em aberto:{' '}
              <span className="money font-semibold text-white">{formatBRL(consolidated.projected)}</span>
            </p>
            {canContribute && (
              <div className="mt-6 flex flex-wrap gap-2">
                <HeroAction label="Despesa" icon={<TrendingDown className="size-4" />} onClick={() => quickAdd({ kind: 'expense' })} />
                <HeroAction label="Receita" icon={<TrendingUp className="size-4" />} onClick={() => quickAdd({ kind: 'income' })} />
                <HeroAction label="Transferir" icon={<ArrowLeftRight className="size-4" />} onClick={() => quickAdd({ kind: 'transfer' })} />
                {cards.length > 0 && <HeroAction label="Pagar fatura" icon={<CreditCard className="size-4" />} onClick={() => quickAdd({ kind: 'card_payment' })} />}
              </div>
            )}
          </div>
          <dl className="grid grid-cols-2 gap-3 self-end">
            <HeroStat label="A receber" cents={consolidated.pendingIn} tone="text-emerald-300" to="/compromissos?aba=receber" />
            <HeroStat label="A pagar (contas)" cents={consolidated.pendingOut} tone="text-rose-300" to="/compromissos?aba=pagar" />
            <HeroStat label="Faturas em aberto" cents={invoiceDebt} tone="text-rose-300" to="/cartoes" />
            <HeroStat label="Contas ativas" text={String(accounts.filter((a) => !a.archived).length)} to="/contas" />
          </dl>
        </div>
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <ForecastCard />
        <HealthCard />
      </div>
      <MonthRecap />

      {/* Indicadores do mês */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label={`Resumo de ${monthLabel(month)}`}>
        <StatCard label="Receitas do mês" to={txLink('income')} loading={series.isLoading} cents={income} tone="income" footer={<Delta current={income} previous={prev?.income_cents ?? 0} />} />
        <StatCard label="Despesas do mês" to={txLink('expense')} loading={series.isLoading} cents={expense} tone="expense" footer={<Delta current={expense} previous={prev?.expense_cents ?? 0} inverse />} />
        <StatCard
          to={`/relatorios?de=${addMonths(month, -5)}&ate=${month}`}
          label="Resultado"
          loading={series.isLoading}
          cents={result}
          tone={result >= 0 ? 'income' : 'expense'}
          signed
          footer={<span className="text-[13px] text-subtle">{income > 0 ? `${formatPercent((result / income) * 100)} da renda ${result >= 0 ? 'poupada' : 'excedida'}` : 'receitas menos despesas'}</span>}
        />
        <Card className="relative p-4 transition hover:border-line-strong sm:p-5">
          <Link to="/orcamentos" className="absolute inset-0 z-0 rounded-[inherit]" aria-label="Orçamento utilizado: ver orçamentos" />
          <p className="flex items-center justify-between text-[13px] font-semibold text-muted">Orçamento utilizado <ChevronRight className="size-4 text-subtle" aria-hidden /></p>
          {budgets.isLoading ? (
            <Skeleton className="mt-2 h-8 w-24" />
          ) : budgetPct === null ? (
            <>
              <p className="font-num mt-1 text-2xl font-semibold text-subtle">—</p>
              <span className="text-[13px] font-semibold text-brand">Definir orçamentos</span>
            </>
          ) : (
            <>
              <p className={cn('font-num mt-1 text-2xl font-semibold', budgetPct > 100 ? 'text-negative' : budgetPct >= 90 ? 'text-warning' : '')}>{formatPercent(budgetPct)}</p>
              <Progress className="mt-2" value={budgetPct} tone={budgetPct > 100 ? 'negative' : budgetPct >= 75 ? 'warning' : 'positive'} label="Orçamento utilizado" />
              <p className="mt-1.5 text-[13px] text-subtle"><Money cents={budgetTotals.spent} /> de <Money cents={budgetTotals.limit} /></p>
            </>
          )}
        </Card>
      </section>

      {!hasAnyData && !series.isLoading && !filtersActive && (
        <Card>
          <EmptyState
            icon={<Wallet className="size-6" />}
            title="Vamos começar?"
            description="Cadastre suas contas e cartões e registre o primeiro lançamento. O painel se monta sozinho a partir dos seus dados reais."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Link to="/contas" className="inline-flex h-11 items-center rounded-xl border border-line bg-surface-2 px-4 font-medium">Cadastrar conta</Link>
                {canContribute && (
                  <button type="button" onClick={() => quickAdd()} className="inline-flex h-11 items-center gap-2 rounded-xl bg-brand px-4 font-semibold text-[color:var(--brand-fg)]">
                    <Plus className="size-4" aria-hidden /> Primeiro lançamento
                  </button>
                )}
              </div>
            }
          />
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-[1.45fr_1fr]">
        <Card>
          <CardHeader title="Receitas × despesas" subtitle="Últimos 12 meses (competência)" />
          <div className="p-3 pt-2 sm:p-5 sm:pt-3">
            {series.error ? <ErrorState error={series.error} onRetry={() => void series.refetch()} /> : series.isLoading ? <Skeleton className="h-60" /> : (
              <LazyBars
                caption="Receitas e despesas por mês"
                data={chartData}
                series={[{ key: 'income', name: 'Receitas', color: SERIES_COLORS.income }, { key: 'expense', name: 'Despesas', color: SERIES_COLORS.expense }]}
              />
            )}
          </div>
        </Card>
        <Card>
          <CardHeader
            title="Despesas por categoria"
            subtitle={capitalize(monthLabel(month))}
            action={<Link to={`/relatorios?de=${month}`} className="text-[13px] font-semibold text-brand">Relatório</Link>}
          />
          <div className="p-5 pt-4">
            {cats.isLoading ? <Skeleton className="h-52" /> : (cats.data ?? []).length === 0 ? (
              <p className="py-10 text-center text-sm text-subtle">Nenhuma despesa registrada neste mês.</p>
            ) : (
              <CategoryBars data={cats.data!} onSelect={(c) => c.category_id && setCategoryId(c.category_id)} />
            )}
          </div>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Contas a vencer */}
        <Card className="lg:col-span-1">
          <CardHeader
            title="Vencem em breve"
            subtitle="Próximos 7 dias e em atraso"
            action={<Link to="/compromissos" className="text-[13px] font-semibold text-brand">Ver todos</Link>}
          />
          <div className="p-3 pt-2">
            {upcoming.isLoading ? <Skeleton className="m-2 h-28" /> : overdue.length + soon.length === 0 ? (
              <p className="flex flex-col items-center gap-2 py-8 text-center text-sm text-subtle">
                <CalendarClock className="size-6 text-positive" aria-hidden /> Nada vencendo nos próximos dias.
              </p>
            ) : (
              <ul>
                {[...overdue, ...soon].slice(0, 6).map((t) => (
                  <li key={t.id}>
                    <button type="button" onClick={() => setSelected(t)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-surface-2">
                      <span className={cn('grid size-9 shrink-0 place-items-center rounded-xl text-[11px] font-bold leading-none', t.due_on! < today ? 'bg-negative/12 text-negative' : 'bg-warning/12 text-warning')}>
                        {t.due_on!.slice(8, 10)}/{t.due_on!.slice(5, 7)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{t.description}</span>
                        <span className="block text-[12px] text-subtle">{t.due_on! < today ? `Atrasado ${relativeDay(t.due_on!)}` : `Vence ${relativeDay(t.due_on!)}`} · {accountMap.get(t.account_id ?? '')?.name}</span>
                      </span>
                      <Money cents={t.kind === 'income' ? t.amount_cents - t.settled_principal_cents : -(t.amount_cents - t.settled_principal_cents)} tone={t.kind === 'income' ? 'income' : 'neutral'} className="text-sm font-semibold" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        {/* Faturas */}
        <Card>
          <CardHeader title="Faturas em aberto" action={<Link to="/cartoes" className="text-[13px] font-semibold text-brand">Cartões</Link>} />
          <div className="p-3 pt-2">
            {invoices.isLoading ? <Skeleton className="m-2 h-28" /> : (invoices.data ?? []).filter((i) => i.total_cents > 0).length === 0 ? (
              <p className="flex flex-col items-center gap-2 py-8 text-center text-sm text-subtle">
                <CreditCard className="size-6" aria-hidden /> {cards.length ? 'Nenhuma fatura em aberto.' : 'Nenhum cartão cadastrado.'}
              </p>
            ) : (
              <ul>
                {(invoices.data ?? []).filter((i) => i.total_cents > 0).slice(0, 5).map((i) => {
                  const card = cardMap.get(i.card_id);
                  const limit = limits.data?.find((l) => l.card_id === i.card_id);
                  return (
                    <li key={i.id}>
                      <Link to={`/cartoes/${i.card_id}?fatura=${i.id}`} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-surface-2">
                        <span className="h-9 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: card?.color }} aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{card?.name} · {monthLabel(i.reference_month, { year: false })}</span>
                          <span className="block text-[12px] text-subtle">
                            {INVOICE_STATUS_LABEL[i.status]} · vence {formatDate(i.due_date)}
                            {limit && <> · disponível <Money cents={limit.available_cents} /></>}
                          </span>
                        </span>
                        <span className="text-right">
                          <Money cents={i.remaining_cents} className="block text-sm font-semibold" />
                          {i.status === 'overdue' && <Badge tone="negative">Vencida</Badge>}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Card>

        {/* Próximas recorrências */}
        <Card>
          <CardHeader title="Próximas recorrências" action={<Link to="/recorrencias" className="text-[13px] font-semibold text-brand">Gerenciar</Link>} />
          <div className="p-3 pt-2">
            {recurrences.isLoading ? <Skeleton className="m-2 h-28" /> : nextRecurring.length === 0 ? (
              <p className="flex flex-col items-center gap-2 py-8 text-center text-sm text-subtle">
                <Repeat className="size-6" aria-hidden /> Nenhuma recorrência ativa.
              </p>
            ) : (
              <ul>
                {nextRecurring.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 px-2 py-2">
                    <Repeat className="size-4 shrink-0 text-subtle" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{r.description}</span>
                      <span className="block text-[12px] text-subtle">{formatDate(r.date)} · {r.label}</span>
                    </span>
                    <Money cents={r.kind === 'income' ? r.amount : -r.amount} tone={r.kind === 'income' ? 'income' : 'neutral'} className="text-sm font-semibold" />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
        <Card>
          <CardHeader title="Inteligência financeira" subtitle="Baseada exclusivamente nos seus lançamentos" />
          <div className="p-5 pt-4">
            {cats.isLoading || series.isLoading ? <Skeleton className="h-28" /> : insights.length === 0 ? (
              <p className="flex items-start gap-3 text-sm text-subtle">
                <Lightbulb className="mt-0.5 size-5 shrink-0" aria-hidden />
                Ainda não existem informações suficientes para gerar comparações confiáveis. Continue registrando — precisamos de pelo menos dois meses com gastos relevantes.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {insights.map((i) => (
                  <li key={i.id} className="flex gap-3">
                    <span className={cn('mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg', i.tone === 'positive' ? 'bg-positive/12 text-positive' : i.tone === 'negative' ? 'bg-negative/12 text-negative' : 'bg-info/12 text-info')}>
                      {i.tone === 'positive' ? <TrendingDown className="size-4" aria-hidden /> : i.tone === 'negative' ? <AlertTriangle className="size-4" aria-hidden /> : <Lightbulb className="size-4" aria-hidden />}
                    </span>
                    <span>
                      <span className="block text-sm font-semibold">{i.title}</span>
                      <span className="block text-[13px] text-muted">{i.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="Evolução do resultado acumulado" subtitle="Soma de (receitas − despesas) nos últimos 12 meses" />
          <div className="p-3 pt-2 sm:p-5 sm:pt-3">
            {series.isLoading ? <Skeleton className="h-52" /> : <LazyArea caption="Resultado acumulado" data={netData} series={[{ key: 'net', name: 'Acumulado', color: SERIES_COLORS.net }]} />}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Contas" action={<Link to="/contas" className="inline-flex items-center text-[13px] font-semibold text-brand">Todas <ChevronRight className="size-4" aria-hidden /></Link>} />
        <div className="grid gap-2 p-3 pt-2 sm:grid-cols-2 lg:grid-cols-4">
          {accounts.filter((a) => !a.archived).slice(0, 8).map((a) => {
            const b = balances.data?.find((x) => x.account_id === a.id);
            return (
              <Link key={a.id} to={`/contas/${a.id}`} className="flex items-center gap-3 rounded-xl border border-line px-3 py-3 transition hover:border-line-strong">
                <span className="size-2.5 rounded-full" style={{ backgroundColor: a.color }} aria-hidden />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{a.name}</span>
                <Money cents={b?.current_balance_cents ?? a.initial_balance_cents} tone={(b?.current_balance_cents ?? 0) < 0 ? 'expense' : 'neutral'} className="text-sm font-semibold" />
              </Link>
            );
          })}
        </div>
      </Card>

      {selected && <TransactionDetail tx={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function HeroAction({ label, icon, onClick }: { label: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3.5 text-sm font-semibold text-white transition hover:bg-white/[0.12] active:scale-[0.98]">
      {icon}
      {label}
    </button>
  );
}

function HeroStat({ label, cents, text, tone, to }: { label: string; cents?: number; text?: string; tone?: string; to: string }) {
  return (
    <div className="group relative rounded-2xl border border-white/[0.07] bg-white/[0.04] px-4 py-3 transition hover:border-white/20 hover:bg-white/[0.08] has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-white/60">
      <Link to={to} className="absolute inset-0 rounded-[inherit] outline-none" aria-label={`${label}: ver detalhes`} />
      <dt className="flex items-center justify-between gap-1 text-[12px] text-white/50">
        {label}
        <ChevronRight className="size-3.5 shrink-0 opacity-50 transition group-hover:translate-x-0.5 group-hover:opacity-100" aria-hidden />
      </dt>
      <dd className={cn('money font-num mt-0.5 text-lg font-semibold', tone)}>
        {text ?? formatBRL(cents ?? 0)}
      </dd>
    </div>
  );
}

function StatCard({ label, cents, tone, footer, loading, signed, to }: { label: string; cents: number; tone: 'income' | 'expense'; footer?: React.ReactNode; loading?: boolean; signed?: boolean; to: string }) {
  return (
    <Card className="group relative p-4 transition hover:border-line-strong sm:p-5">
      <Link to={to} className="absolute inset-0 rounded-[inherit]" aria-label={`${label}: ver detalhes`} />
      <p className="flex items-center justify-between text-[13px] font-semibold text-muted">
        {label}
        <ChevronRight className="size-4 text-subtle transition group-hover:translate-x-0.5" aria-hidden />
      </p>
      {loading ? <Skeleton className="mt-2 h-8 w-28" /> : <Money cents={cents} tone={tone} signed={signed} className="font-num mt-1 block text-xl font-semibold sm:text-2xl" />}
      <div className="mt-1.5">{footer}</div>
    </Card>
  );
}

