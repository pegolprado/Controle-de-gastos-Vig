import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleAlert, HelpCircle, LineChart, Plus, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useQuickAdd } from '@/features/transactions/QuickAdd';
import { BIG_ONE_OFF } from '@/domain/forecast';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge, Card, EmptyState, ErrorState, Skeleton } from '@/components/ui/Card';
import { Field, Switch } from '@/components/ui/Field';
import { Money } from '@/components/ui/Money';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { LazyBalanceForecast } from '@/components/charts/LazyCharts';
import { cn } from '@/lib/cn';
import { capitalize, diffDays, formatDate, relativeDay, todayISO } from '@/lib/dates';
import { formatBRL } from '@/lib/money';
import { canSpend, type ForecastEvent } from '@/domain/forecast';
import { useForecast } from './useForecast';

const DAILY_KEY = 'fmv.previsao.diario';
const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const short = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const weekday = (iso: string) => WEEKDAYS[new Date(`${iso}T12:00:00`).getDay()]!;

export default function ForecastPage() {
  const [withDaily, setWithDaily] = useState(() => {
    try {
      return localStorage.getItem(DAILY_KEY) !== '0';
    } catch {
      return true;
    }
  });
  const toggleDaily = (v: boolean) => {
    setWithDaily(v);
    try {
      localStorage.setItem(DAILY_KEY, v ? '1' : '0');
    } catch {
      /* ignore */
    }
  };
  const { data: f, isLoading, error } = useForecast({ withDaily });
  const quickAdd = useQuickAdd();
  const [spend, setSpend] = useState(0);
  const today = todayISO();

  const chart = useMemo(
    () =>
      (f?.days ?? []).map((d) => ({
        label: short(d.date),
        date: `${capitalize(weekday(d.date))}, ${formatDate(d.date)}`,
        balance: d.balance,
        notes: [
          ...d.events.map((e) => `${e.cents > 0 ? '+' : '−'} ${formatBRL(Math.abs(e.cents))} ${e.description}`),
          ...(d.daily ? [`− ${formatBRL(d.daily)} dia a dia (estimado)`] : []),
        ],
      })),
    [f],
  );

  if (error) return <><PageHeader title="Previsão" /><ErrorState error={error} /></>;

  const answer = f && spend > 0 ? canSpend(f, spend) : null;
  const free = f ? canSpend(f, 0) : null;
  const beforePayday = f ? f.events.filter((e) => e.cents < 0 && (!f.payday || e.date < f.payday.date)) : [];
  const firstNegative = f?.negativeDays[0];
  const paydayDay = f?.payday ? f.days.find((d) => d.date === f.payday!.date) : undefined;

  return (
    <>
      <PageHeader title="Previsão" subtitle="Quanto você deve ter nos próximos dias, com as contas, a fatura e o salário que já estão no app." />

      {isLoading || !f ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-36" />
          <Skeleton className="h-64" />
        </div>
      ) : f.days.length === 0 ? (
        <Card><EmptyState icon={<LineChart className="size-6" />} title="Sem dados para prever" description="Cadastre suas contas e lançamentos para ver a previsão." /></Card>
      ) : (
        <div className="flex flex-col gap-4">
          <Card className="p-5" role="region" aria-label="Resumo da previsão">
            {firstNegative ? (
              <p className="flex items-start gap-2 rounded-xl bg-negative/10 px-3 py-2.5 text-[14px]">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-negative" aria-label="Atenção" />
                <span>
                  O saldo pode ficar <strong className="text-negative">negativo {relativeDay(firstNegative, today) === 'hoje' ? 'hoje' : `em ${formatDate(firstNegative)}`}</strong> e chegar a{' '}
                  <strong className="text-negative">{formatBRL(f.low.balance)}</strong> em {formatDate(f.low.date)}. Dá tempo de se organizar: veja abaixo o que vence antes.
                </span>
              </p>
            ) : (
              <p className="flex items-start gap-2 rounded-xl bg-positive/10 px-3 py-2.5 text-[14px]">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-positive" aria-hidden />
                <span>
                  Tudo em dia: o saldo não fica negativo {f.payday ? `até o salário (${formatDate(f.payday.date)})` : 'nos próximos 30 dias'}.
                </span>
              </p>
            )}
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
              <Stat label="Hoje" cents={f.start} />
              <Stat label={`Ponto mais baixo · ${short(f.low.date)}`} cents={f.low.balance} />
              {f.payday && paydayDay ? (
                <Stat label={`No dia do salário · ${short(f.payday.date)}`} cents={paydayDay.balance} hint={`${f.payday.description} em ${diffDays(f.payday.date, today)} dias${f.payday.estimated ? ' (estimado)' : ''}`} />
              ) : (
                <Stat label="Salário" text="não encontrado" hint="veja abaixo como cadastrar" />
              )}
              <Stat label={`Em ${short(f.days[f.days.length - 1]!.date)}`} cents={f.end} />
            </dl>
            {!f.payday && (
              <div className="mt-4 rounded-xl border border-warning/30 bg-warning/8 px-3 py-3 text-[14px]">
                <p className="font-semibold">Não encontrei seu salário</p>
                <p className="mt-0.5 text-muted">
                  Sem ele a previsão só desconta contas e gastos, e o saldo parece despencar. Cadastre o salário como receita que se repete todo mês (marque <strong>Repetir</strong>) ou lance o salário deste mês: depois de dois meses o app passa a prever sozinho.
                </p>
                <Button size="sm" variant="primary" className="mt-2" icon={<Plus className="size-4" />} onClick={() => quickAdd({ kind: 'income' })}>Cadastrar salário</Button>
              </div>
            )}
            {f.payday?.estimated && (
              <p className="mt-3 text-[12px] text-subtle">
                “{f.payday.description}” não está cadastrado como recorrência: estimei pelo que entrou nos últimos meses, no mesmo dia do mês. Cadastre como recorrente para a previsão ficar exata.
              </p>
            )}
            <Breakdown f={f} />
          </Card>

          <Card className="p-5">
            <h2 className="text-[15px] font-semibold">Saldo previsto dia a dia</h2>
            <p className="text-[13px] text-subtle">Contas que entram no total do Painel. Toque no gráfico para ver o que entra e sai em cada dia.</p>
            <div className="mt-3">
              <LazyBalanceForecast data={chart} caption="Saldo previsto dia a dia" paydayLabel={f.payday ? short(f.payday.date) : undefined} />
            </div>
            <div className="mt-3 border-t border-line pt-3">
              <Switch
                checked={withDaily}
                onChange={toggleDaily}
                label="Incluir gastos do dia a dia"
                description={!withDaily ? 'Desligado: a previsão usa só contas, faturas e salário.' : f.dailySpend ? `Cerca de ${formatBRL(f.dailySpend)} por dia, pela média dos últimos 60 dias (mercado, lanches, app…)` : 'Sem gastos avulsos recentes para estimar.'}
              />
            </div>
          </Card>

          <Card className="p-5" role="region" aria-label="Posso gastar?">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand/12 text-brand"><Wallet className="size-5" aria-hidden /></span>
              <div>
                <h2 className="text-[15px] font-semibold">Posso gastar?</h2>
                <p className="text-[13px] text-subtle">
                  Hoje você pode gastar até <strong className="text-fg">{formatBRL(free?.safe ?? 0)}</strong> sem ficar no vermelho {f.payday ? 'até o salário' : 'nos próximos 30 dias'}.
                </p>
              </div>
            </div>
            <Field label="Quanto quer gastar hoje?" className="mt-4 max-w-[240px]">
              {(id) => <MoneyInput id={id} value={spend} onChange={setSpend} />}
            </Field>
            {answer && (
              <p
                className={cn('mt-3 flex items-start gap-2 rounded-xl px-3 py-2.5 text-[14px]', !answer.ok ? 'bg-negative/10' : answer.tight ? 'bg-warning/10' : 'bg-positive/10')}
                role="status"
              >
                {!answer.ok ? (
                  <CircleAlert className="mt-0.5 size-4 shrink-0 text-negative" aria-hidden />
                ) : answer.tight ? (
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                ) : (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-positive" aria-hidden />
                )}
                <span>
                  {!answer.ok ? (
                    <><strong>Melhor esperar.</strong> Gastando {formatBRL(spend)} hoje, o saldo chega a <strong className="text-negative">{formatBRL(answer.lowAfter)}</strong> em {formatDate(answer.lowDate)}{f.payday ? ', antes do salário' : ''}.</>
                  ) : answer.tight ? (
                    <><strong>Pode, mas fica apertado.</strong> Sobram só {formatBRL(answer.lowAfter)} no dia mais baixo ({formatDate(answer.lowDate)}).</>
                  ) : (
                    <><strong>Pode sim.</strong> Mesmo no dia mais apertado ({formatDate(answer.lowDate)}) ainda sobram {formatBRL(answer.lowAfter)}.</>
                  )}
                </span>
              </p>
            )}
          </Card>

          <Card>
            <div className="px-5 pt-5">
              <h2 className="text-[15px] font-semibold">{f.payday ? 'Contas antes do salário' : 'Próximas contas'}</h2>
              <p className="text-[13px] text-subtle">
                {beforePayday.length ? `${beforePayday.length} ${beforePayday.length === 1 ? 'conta' : 'contas'} · ${formatBRL(-beforePayday.reduce((s, e) => s + e.cents, 0))}` : 'Nenhuma conta até lá.'}
              </p>
            </div>
            <ul className="mt-2 divide-y divide-line" aria-label="Movimentos previstos">
              {f.events.map((e, i) => (
                <EventRow key={`${e.date}${e.description}${i}`} e={e} today={today} after={!!f.payday && e.date >= f.payday.date} />
              ))}
            </ul>
          </Card>

          <p className="text-[12px] leading-relaxed text-subtle">
            A previsão usa o saldo das contas que entram no total, os compromissos em aberto, as recorrências ativas e as faturas dos cartões. Contas atrasadas entram como se fossem pagas hoje. É uma estimativa: lançamentos novos mudam a previsão na hora.
          </p>
        </div>
      )}
    </>
  );
}

function Stat({ label, cents, text, hint }: { label: string; cents?: number; text?: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[12px] font-semibold text-subtle">{label}</dt>
      <dd className={cn('font-num text-[18px] font-semibold', cents !== undefined && cents < 0 && 'text-negative')}>{text ?? <Money cents={cents ?? 0} />}</dd>
      {hint && <dd className="truncate text-[12px] text-subtle">{hint}</dd>}
    </div>
  );
}

function EventRow({ e, today, after }: { e: ForecastEvent; today: string; after: boolean }) {
  return (
    <li className={cn('flex items-center gap-3 px-5 py-3', after && 'opacity-60')}>
      <div className="w-12 shrink-0 text-center">
        <p className="font-num text-[15px] font-semibold leading-none">{e.date.slice(8, 10)}</p>
        <p className="text-[11px] uppercase text-subtle">{weekday(e.date)}</p>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{e.description}</p>
        <p className="text-[12px] text-subtle">
          {capitalize(relativeDay(e.date, today))}
          {' · '}
          {{ pending: 'conta', recurrence: 'recorrente', invoice: 'fatura', income: 'entrada', estimated: 'entrada estimada pelo histórico' }[e.source]}
        </p>
      </div>
      {e.overdue && <Badge tone="negative">Atrasada</Badge>}
      <Money cents={e.cents} signed className={cn('font-num font-semibold', e.cents > 0 ? 'text-positive' : 'text-fg')} />
    </li>
  );
}

/** De onde vem o número final: saldo de hoje + entradas − contas − dia a dia. */
function Breakdown({ f }: { f: NonNullable<ReturnType<typeof useForecast>['data']> }) {
  const inflow = f.events.filter((e) => e.cents > 0).reduce((s, e) => s + e.cents, 0);
  const bills = f.events.filter((e) => e.cents < 0).reduce((s, e) => s + e.cents, 0);
  const dailyDays = f.days.filter((d) => d.daily > 0).length;
  const daily = f.days.reduce((s, d) => s + d.daily, 0);
  const last = f.days[f.days.length - 1]!.date;
  const row = (label: string, cents: number, hint?: string) => (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="text-muted">{label}{hint && <span className="block text-[12px] text-subtle">{hint}</span>}</dt>
      <dd className={cn('font-num font-medium', cents < 0 && 'text-negative', cents > 0 && 'text-positive')}>{formatBRL(cents, { signed: true })}</dd>
    </div>
  );
  return (
    <details className="group mt-4 rounded-xl bg-surface-2/60 px-3 py-2 text-[14px]">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 font-semibold text-brand">
        <HelpCircle className="size-4" aria-hidden /> Por que esse número?
      </summary>
      <dl className="mt-2 divide-y divide-line">
        <div className="flex items-baseline justify-between gap-3 py-1"><dt className="text-muted">Saldo hoje</dt><dd className="font-num font-medium">{formatBRL(f.start)}</dd></div>
        {row('Entradas previstas', inflow, inflow ? undefined : 'nenhuma entrada cadastrada no período')}
        {row('Contas, recorrências e faturas', bills)}
        {f.dailySpend > 0 && row('Gasto do dia a dia (estimado)', -daily, `${formatBRL(f.dailySpend)}/dia × ${dailyDays} dias · média de 60 dias, sem contas fixas e compras acima de ${formatBRL(BIG_ONE_OFF)}`)}
        <div className="flex items-baseline justify-between gap-3 py-1 font-semibold"><dt>Em {formatDate(last)}</dt><dd className={cn('font-num', f.end < 0 && 'text-negative')}>{formatBRL(f.end)}</dd></div>
      </dl>
    </details>
  );
}
