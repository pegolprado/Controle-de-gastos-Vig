import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Download, RefreshCw, Sparkles, Trophy, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, Skeleton } from '@/components/ui/Card';
import { Field, Input, Select } from '@/components/ui/Field';
import { Money } from '@/components/ui/Money';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { Segmented } from '@/components/ui/Segmented';
import { LazyArea, SERIES_COLORS } from '@/components/charts/LazyCharts';
import { cn } from '@/lib/cn';
import { centsToCSV, downloadFile, toCSV } from '@/lib/csv';
import { addDays, formatDate, formatDateTime } from '@/lib/dates';
import { formatBRL } from '@/lib/money';
import { normalizeTicker, type Holding } from '@/domain/fii';
import { simulateMagic } from '@/domain/magic';
import { listRendaMarket, syncAsset } from '@/services/fii';

const PREFS = 'fmv.renda.magico';
const parseRate = (s: string) => {
  const n = Number(s.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const fmtRate = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

interface Prefs {
  ticker: string;
  perMonth: number;
  inflation: number;
  goal: number;
  contribution: number;
  years: number;
}

function loadPrefs(fallback: string): Prefs {
  const base: Prefs = { ticker: fallback, perMonth: 2, inflation: 6, goal: 50_000, contribution: 0, years: 30 };
  try {
    return { ...base, ...(JSON.parse(localStorage.getItem(PREFS) ?? '{}') as Partial<Prefs>) };
  } catch {
    return base;
  }
}

/** Dados de mercado do fundo: cotação e último rendimento anunciado na B3. */
function useFundData(ticker: string, today: string) {
  return useQuery({
    queryKey: ['magic-fund', ticker],
    enabled: Boolean(normalizeTicker(ticker)),
    staleTime: 15 * 60_000,
    retry: false,
    queryFn: async () => {
      const status = await syncAsset(ticker, 'fii');
      const m = await listRendaMarket([{ ticker, asset_type: 'fii' }]);
      const last = m.dists
        .filter((d) => d.kind === 'RENDIMENTO' && d.payment_date && d.payment_date <= addDays(today, 45))
        .sort((a, b) => (b.payment_date ?? '').localeCompare(a.payment_date ?? ''))[0];
      const quote = m.quotes.find((q) => q.ticker === ticker);
      const fund = m.funds[0];
      return {
        status,
        name: fund?.name ?? null,
        price: quote ? Math.round(Number(quote.price) * 100) : 0,
        rate: last ? Number(last.rate) : 0,
        recordDate: last?.record_date ?? null,
        syncedAt: quote?.synced_at ?? fund?.synced_at ?? null,
      };
    },
  });
}

/** O Número Mágico: quantas cotas fazem o provento comprar cotas novas sozinho, e a bola de neve por até 30 anos. */
export function MagicTab({ holdings, today }: { holdings: Holding[]; today: string }) {
  const fiis = holdings.filter((h) => h.type === 'fii');
  const [prefs, setPrefs] = useState(() => loadPrefs(fiis[0]?.ticker ?? 'MXRF11'));
  const [tickerInput, setTickerInput] = useState(prefs.ticker);
  const [price, setPrice] = useState(0);
  const [rateText, setRateText] = useState('');
  const [view, setView] = useState<'ano' | 'mes'>('ano');
  const fund = useFundData(prefs.ticker, today);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS, JSON.stringify(prefs));
    } catch {
      /* ignore */
    }
  }, [prefs]);

  // ao trocar de fundo (ou chegar o dado da B3), preenche preço e provento — continuam editáveis
  useEffect(() => {
    if (!fund.data) return;
    setPrice(fund.data.price);
    setRateText(fund.data.rate ? fmtRate(fund.data.rate) : '');
  }, [fund.data]);

  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) => setPrefs((p) => ({ ...p, [k]: v }));
  const pick = (t: string) => {
    const n = normalizeTicker(t);
    if (!n) return;
    setTickerInput(n);
    set('ticker', n);
  };

  const input = useDeferredValue({ price, dividend: parseRate(rateText) * 100, ...prefs });
  const sim = useMemo(
    () =>
      simulateMagic({
        price: input.price,
        dividend: input.dividend,
        perMonth: Math.max(1, Math.round(input.perMonth)),
        inflation: input.inflation,
        goal: input.goal,
        contribution: input.contribution,
        months: input.years * 12,
      }),
    [input],
  );
  const owned = fiis.find((h) => h.ticker === prefs.ticker)?.quantity ?? 0;
  const yearly = useMemo(
    () =>
      sim.rows
        .filter((r) => r.month % 12 === 0)
        .map((r) => ({ label: `Ano ${r.year}`, nominal: r.income, real: r.realIncome })),
    [sim.rows],
  );
  const tableRows = view === 'ano' ? sim.rows.filter((r) => r.month % 12 === 0 || r.goal) : sim.rows;
  const months = prefs.years * 12;
  const goalRow = sim.goalMonth ? sim.rows[sim.goalMonth - 1] : null;

  function exportCsv() {
    const rows = sim.rows.map((r) => ({
      ano: r.year,
      mes: r.month,
      cotas: r.shares,
      valor: centsToCSV(input.price),
      rendimento: centsToCSV(r.income),
      compro: r.bought,
      sobra: centsToCSV(r.leftover),
      patrimonio: centsToCSV(r.equity),
      renda_hoje: centsToCSV(r.realIncome),
      patrimonio_hoje: centsToCSV(r.realEquity),
    }));
    const cols = [
      { key: 'ano', label: 'Ano' },
      { key: 'mes', label: 'Mês' },
      { key: 'cotas', label: 'Cotas que tenho' },
      { key: 'valor', label: 'Valor da cota' },
      { key: 'rendimento', label: 'Rendimento do mês' },
      { key: 'compro', label: 'Cotas que compro' },
      { key: 'sobra', label: 'Sobra' },
      { key: 'patrimonio', label: 'Patrimônio' },
      { key: 'renda_hoje', label: 'Renda em R$ de hoje' },
      { key: 'patrimonio_hoje', label: 'Patrimônio em R$ de hoje' },
    ];
    downloadFile(toCSV(rows, cols), `numero-magico-${prefs.ticker}.csv`, 'text/csv;charset=utf-8');
  }

  return (
    <div className="mt-4 flex flex-col gap-4">
      <Card className="p-5" role="region" aria-label="Número mágico">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-warning/15 text-warning"><Sparkles className="size-5" aria-hidden /></span>
          <div>
            <h2 className="text-[15px] font-semibold">{prefs.ticker} · O Número Mágico</h2>
            <p className="text-[13px] text-subtle">Quantas cotas você precisa para que o próprio rendimento compre <strong className="text-fg">novas cotas todo mês</strong>, e a bola de neve crescendo por {prefs.years} anos.</p>
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
          {/* dados do fundo */}
          <div className="rounded-2xl border border-line p-4">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-subtle">Dados do fundo</p>
            <form
              className="mt-2 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                pick(tickerInput);
              }}
            >
              {fiis.length > 0 && (
                <Select aria-label="Fundo da carteira" value={fiis.some((h) => h.ticker === prefs.ticker) ? prefs.ticker : ''} onChange={(e) => e.target.value && pick(e.target.value)} className="h-10 w-32 text-sm">
                  <option value="">Outro…</option>
                  {fiis.map((h) => <option key={h.ticker} value={h.ticker}>{h.ticker}</option>)}
                </Select>
              )}
              <Input aria-label="Código do fundo" value={tickerInput} maxLength={6} autoCapitalize="characters" onChange={(e) => setTickerInput(e.target.value.toUpperCase())} className="h-10 min-w-0 flex-1" placeholder="MXRF11" />
              <Button type="submit" size="sm" variant="subtle" className="h-10">Buscar</Button>
            </form>
            {fund.isLoading ? (
              <Skeleton className="mt-3 h-16" />
            ) : fund.data?.status === 'not_found' ? (
              <p className="mt-3 text-[13px] text-negative">Não encontramos {prefs.ticker} na B3. Confira o código.</p>
            ) : (
              <>
                {fund.data?.name && <p className="mt-2 truncate text-[13px] text-muted">{fund.data.name}</p>}
                <dl className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <dt className="text-[12px] text-subtle">Preço da cota</dt>
                    <dd className="font-num text-lg font-semibold">{fund.data?.price ? formatBRL(fund.data.price) : '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-[12px] text-subtle">Último rendimento</dt>
                    <dd className="font-num text-lg font-semibold">{fund.data?.rate ? `R$ ${fmtRate(fund.data.rate)}` : '—'}</dd>
                    {fund.data?.recordDate && <dd className="text-[11px] text-subtle">data com {formatDate(fund.data.recordDate)}</dd>}
                  </div>
                </dl>
                <p className="mt-2 flex flex-wrap items-center gap-x-2 text-[11px] text-subtle">
                  {fund.data?.syncedAt ? `Atualizado em ${formatDateTime(fund.data.syncedAt)} · B3` : 'Fonte: B3'}
                  <button type="button" onClick={() => void fund.refetch()} className="inline-flex items-center gap-1 font-semibold text-brand" aria-label="Atualizar dados do fundo">
                    <RefreshCw className={cn('size-3', fund.isFetching && 'animate-spin')} aria-hidden /> Atualizar
                  </button>
                </p>
                {fund.data?.status === 'unavailable' && <p className="mt-1 text-[12px] text-warning">A B3 não respondeu agora: digite os valores ao lado.</p>}
              </>
            )}
          </div>

          {/* parâmetros */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="Preço da cota">{(id) => <MoneyInput id={id} value={price} onChange={setPrice} />}</Field>
            <Field label="Rendimento por cota" hint="R$ por mês">
              {(id, d) => (
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-subtle">R$</span>
                  <Input id={id} aria-describedby={d} inputMode="decimal" value={rateText} onChange={(e) => setRateText(e.target.value.replace(/[^\d,.]/g, '').slice(0, 9))} className="pl-9 font-num" placeholder="0,10" />
                </div>
              )}
            </Field>
            <Field label="Cotas por mês" hint="compradas só com o rendimento">
              {(id, d) => <Input id={id} aria-describedby={d} inputMode="numeric" value={String(prefs.perMonth)} onChange={(e) => set('perMonth', Math.min(1000, Number(e.target.value.replace(/\D/g, '')) || 0))} className="font-num" />}
            </Field>
            <Field label="Inflação ao ano (%)">
              {(id) => <Input id={id} inputMode="decimal" value={String(prefs.inflation).replace('.', ',')} onChange={(e) => set('inflation', Math.min(50, Number(e.target.value.replace(/[^\d,]/g, '').replace(',', '.')) || 0))} className="font-num" />}
            </Field>
            <Field label="Meta de renda mensal" hint="em R$ de hoje">{(id, d) => <MoneyInput id={id} aria-describedby={d} value={prefs.goal} onChange={(v) => set('goal', v)} />}</Field>
            <Field label="Aporte extra por mês" hint="opcional">{(id, d) => <MoneyInput id={id} aria-describedby={d} value={prefs.contribution} onChange={(v) => set('contribution', v)} />}</Field>
            <Field label="Prazo" className="col-span-2 sm:col-span-1">
              {(id) => (
                <Select id={id} value={prefs.years} onChange={(e) => set('years', Number(e.target.value))}>
                  {[5, 10, 15, 20, 25, 30].map((y) => <option key={y} value={y}>{y} anos ({y * 12} meses)</option>)}
                </Select>
              )}
            </Field>
          </div>
        </div>
      </Card>

      {sim.magic === 0 ? (
        <Card className="p-5 text-[14px] text-muted">Informe o preço da cota e o rendimento por cota para calcular.</Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="border-warning/40 bg-warning/[0.06] p-5" role="region" aria-label="Resultado do número mágico">
              <p className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-warning"><Sparkles className="size-4" aria-hidden /> Número mágico</p>
              <p className="font-num mt-1 text-5xl font-bold text-warning">{sim.magic.toLocaleString('pt-BR')} <span className="text-xl font-semibold text-muted">cotas</span></p>
              <p className="mt-1 text-[13px] text-subtle">
                {prefs.perMonth} × {formatBRL(input.price)} ÷ R$ {fmtRate(input.dividend / 100)} = {((prefs.perMonth * input.price) / input.dividend).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} → arredondado para cima
              </p>
              {owned > 0 && (
                <p className="mt-2 text-[13px] font-medium">
                  {owned >= sim.magic ? `Você já tem ${owned} cotas: número mágico atingido ✓` : `Você tem ${owned}: faltam ${sim.magic - owned} cotas (≈ ${formatBRL((sim.magic - owned) * input.price)}).`}
                </p>
              )}
            </Card>
            <Card className="p-5">
              <p className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-subtle"><Wallet className="size-4" aria-hidden /> Investimento inicial (uma única vez)</p>
              <Money cents={sim.initial} className="font-num mt-1 block text-4xl font-bold" />
              <p className="mt-1 text-[13px] text-subtle">Com isso, já no mês 1 o rendimento ({formatBRL(sim.rows[0]?.income ?? 0)}) compra {sim.rows[0]?.bought ?? 0} cotas sozinho.</p>
            </Card>
          </div>

          {prefs.goal > 0 && (
            goalRow ? (
              <p className="flex items-start gap-2 rounded-2xl border border-positive/30 bg-positive/10 px-4 py-3 text-[14px]" role="status">
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-positive" aria-hidden />
                <span>
                  <strong>Meta de {formatBRL(prefs.goal)} por mês (em R$ de hoje) atingida no mês {goalRow.month}</strong> (ano {goalRow.year}), com {goalRow.shares.toLocaleString('pt-BR')} cotas.
                </span>
              </p>
            ) : (
              <p className="flex items-start gap-2 rounded-2xl border border-negative/30 bg-negative/10 px-4 py-3 text-[14px]" role="status">
                <AlertTriangle className="mt-0.5 size-5 shrink-0 text-negative" aria-hidden />
                <span>
                  <strong>Você não atinge {formatBRL(prefs.goal)} por mês (em R$ de hoje) em {months} meses.</strong> No mês {months} a renda real chega a {formatBRL(sim.last?.realIncome ?? 0)}. Experimente aumentar as cotas por mês ou o aporte extra.
                </span>
              </p>
            )
          )}

          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Resumo da simulação">
            <Summary label="Você coloca" value={formatBRL(sim.invested)} hint={prefs.contribution ? 'inicial + aportes' : 'uma única vez'} />
            <Summary label="Cotas no início" value={sim.magic.toLocaleString('pt-BR')} />
            <Summary label={`Cotas no mês ${months}`} value={(sim.last ? sim.last.shares + sim.last.bought : 0).toLocaleString('pt-BR')} />
            <Summary label={`Renda no mês ${months}`} value={formatBRL(sim.last?.income ?? 0)} hint={`${formatBRL(sim.last?.realIncome ?? 0)} em R$ de hoje`} />
          </section>

          <Card className="p-5">
            <h2 className="text-[15px] font-semibold">Renda mensal ao longo dos anos</h2>
            <p className="text-[13px] text-subtle">Em reais da época e em reais de hoje (descontada a inflação de {String(prefs.inflation).replace('.', ',')}% ao ano).</p>
            <div className="mt-3">
              <LazyArea
                data={yearly}
                caption="Renda mensal por ano"
                series={[
                  { key: 'nominal', name: 'Renda (R$ da época)', color: SERIES_COLORS.net },
                  { key: 'real', name: 'Renda (R$ de hoje)', color: SERIES_COLORS.info },
                ]}
              />
            </div>
          </Card>

          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
              <div>
                <h2 className="text-[15px] font-semibold">{view === 'ano' ? 'Ano a ano' : 'Mês a mês'} · {months} meses</h2>
                <p className="flex flex-wrap gap-x-3 text-[12px] text-subtle">
                  <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-sm bg-warning/40" aria-hidden /> recorde de cotas compradas</span>
                  <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-sm bg-positive/40" aria-hidden /> meta de renda atingida</span>
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Segmented size="sm" label="Detalhe da tabela" value={view} onChange={setView} options={[{ value: 'ano', label: 'Por ano' }, { value: 'mes', label: 'Mês a mês' }]} />
                <Button size="sm" variant="primary" icon={<Download className="size-4" />} onClick={exportCsv}>CSV</Button>
              </div>
            </div>
            <div className="mt-3 max-h-[560px] overflow-auto">
              <table className="w-full min-w-[820px] whitespace-nowrap text-[13px]" aria-label="Simulação">
                <thead className="sticky top-0 z-10 border-y border-line bg-surface text-left text-[11px] uppercase tracking-wider text-subtle">
                  <tr>
                    <th className="px-4 py-2.5">Ano</th>
                    <th className="px-3 text-right">Mês</th>
                    <th className="px-3 text-right">Cotas que tenho</th>
                    <th className="px-3 text-right">Valor da cota</th>
                    <th className="px-3 text-right">Rendimento do mês</th>
                    <th className="px-3 text-right">Cotas que compro</th>
                    <th className="px-3 text-right">Sobra</th>
                    <th className="px-3 text-right">Patrimônio</th>
                    <th className="px-4 text-right">Renda em R$ de hoje</th>
                  </tr>
                </thead>
                <tbody className="font-num divide-y divide-line">
                  {tableRows.map((r) => (
                    <tr key={r.month} className={cn(r.goal ? 'bg-positive/10' : r.record ? 'bg-warning/10' : undefined)}>
                      <td className="px-4 py-2 font-sans font-semibold">{view === 'ano' || r.month % 12 === 1 ? `Ano ${r.year}` : ''}</td>
                      <td className="px-3 text-right text-muted">
                        {r.record && <Trophy className="mr-1 inline size-3.5 text-warning" aria-label="recorde" />}
                        {r.month}
                      </td>
                      <td className="px-3 text-right">{r.shares.toLocaleString('pt-BR')}</td>
                      <td className="px-3 text-right text-muted">{formatBRL(input.price)}</td>
                      <td className="px-3 text-right font-medium">{formatBRL(r.income)}</td>
                      <td className={cn('px-3 text-right', r.record && 'font-semibold text-warning')}>{r.bought.toLocaleString('pt-BR')}</td>
                      <td className="px-3 text-right text-muted">{formatBRL(r.leftover)}</td>
                      <td className="px-3 text-right font-medium">{formatBRL(r.equity)}</td>
                      <td className="px-4 text-right text-info">{formatBRL(r.realIncome)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <p className="text-[12px] leading-relaxed text-subtle">
            Simulação com preço e rendimento constantes, reinvestindo todo o rendimento (sem IR, que é isento para pessoa física em FII). Na prática o preço e o rendimento variam todo mês. Não é recomendação de investimento.
          </p>
        </>
      )}
    </div>
  );
}

function Summary({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-4">
      <p className="text-[12px] font-semibold uppercase tracking-wide text-subtle">{label}</p>
      <p className="font-num mt-1 text-xl font-semibold">{value}</p>
      {hint && <p className="text-[12px] text-subtle">{hint}</p>}
    </Card>
  );
}
