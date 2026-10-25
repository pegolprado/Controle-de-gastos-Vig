/**
 * Gráficos (Recharts) — carregados sob demanda num chunk separado.
 * Regras visuais: um único eixo Y, marcas finas, grade recessiva,
 * texto sempre em tokens de texto (nunca na cor da série), tooltip em todo gráfico,
 * legenda presente para 2+ séries e tabela acessível para leitores de tela.
 */
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from 'recharts';
import { formatBRL, formatBRLCompact } from '@/lib/money';

export interface SeriesPoint {
  label: string;
  [key: string]: string | number;
}

interface SeriesDef {
  key: string;
  name: string;
  color: string;
}

function ChartTooltip({ active, payload, label, series }: TooltipContentProps<number, string> & { series: SeriesDef[] }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-line bg-elevated px-3 py-2 text-[13px] shadow-float">
      <p className="mb-1 font-semibold capitalize">{label}</p>
      {series.map((s) => {
        const p = payload.find((x) => x.dataKey === s.key);
        if (!p) return null;
        return (
          <p key={s.key} className="flex items-center gap-2 text-muted">
            <span className="size-2 rounded-full" style={{ backgroundColor: s.color }} aria-hidden />
            <span className="flex-1">{s.name}</span>
            <span className="tabular font-semibold text-fg">{formatBRL(Number(p.value))}</span>
          </p>
        );
      })}
    </div>
  );
}

function Legend({ series }: { series: SeriesDef[] }) {
  if (series.length < 2) return null;
  return (
    <div className="flex flex-wrap gap-4 px-1 pb-2 text-[13px] text-muted">
      {series.map((s) => (
        <span key={s.key} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: s.color }} aria-hidden />
          {s.name}
        </span>
      ))}
    </div>
  );
}

function SrTable({ data, series, caption }: { data: SeriesPoint[]; series: SeriesDef[]; caption: string }) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th>Período</th>
          {series.map((s) => (
            <th key={s.key}>{s.name}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((d) => (
          <tr key={d.label}>
            <td>{d.label}</td>
            {series.map((s) => (
              <td key={s.key}>{formatBRL(Number(d[s.key] ?? 0))}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const axisProps = {
  tick: { fill: 'var(--text-subtle)', fontSize: 12 },
  tickLine: false,
  axisLine: false,
} as const;

export function BarsChart({ data, series, height = 240, caption }: { data: SeriesPoint[]; series: SeriesDef[]; height?: number; caption: string }) {
  return (
    <figure aria-label={caption}>
      <Legend series={series} />
      <div style={{ height }} aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barGap={2} barCategoryGap="28%" margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" />
            <YAxis {...axisProps} width={56} tickFormatter={(v: number) => formatBRLCompact(v)} />
            <Tooltip cursor={{ fill: 'var(--surface-2)', opacity: 0.6 }} content={(p) => <ChartTooltip {...(p as TooltipContentProps<number, string>)} series={series} />} />
            {series.map((s) => (
              <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={22} animationDuration={500} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <SrTable data={data} series={series} caption={caption} />
    </figure>
  );
}

export function AreaTrend({ data, series, height = 220, caption }: { data: SeriesPoint[]; series: SeriesDef[]; height?: number; caption: string }) {
  return (
    <figure aria-label={caption}>
      <Legend series={series} />
      <div style={{ height }} aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
            <defs>
              {series.map((s) => (
                <linearGradient key={s.key} id={`fill-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" />
            <YAxis {...axisProps} width={56} tickFormatter={(v: number) => formatBRLCompact(v)} />
            <Tooltip cursor={{ stroke: 'var(--border-strong)' }} content={(p) => <ChartTooltip {...(p as TooltipContentProps<number, string>)} series={series} />} />
            {series.map((s) => (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.name}
                stroke={s.color}
                strokeWidth={2}
                fill={`url(#fill-${s.key})`}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)' }}
                animationDuration={600}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <SrTable data={data} series={series} caption={caption} />
    </figure>
  );
}

export interface BalancePoint {
  label: string;
  date: string;
  balance: number;
  /** o que entrou/saiu no dia (para o tooltip) */
  notes: string[];
}

/** Saldo previsto dia a dia: degraus (o saldo muda no dia do evento), linha do zero e marcador do salário. */
export function BalanceForecast({ data, height = 240, caption, paydayLabel }: { data: BalancePoint[]; height?: number; caption: string; paydayLabel?: string }) {
  const min = Math.min(0, ...data.map((d) => d.balance));
  return (
    <figure aria-label={caption}>
      <div style={{ height }} aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 16, right: 8, left: 4, bottom: 0 }}>
            <defs>
              <linearGradient id="fill-forecast" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--viz-1)" stopOpacity={0.22} />
                <stop offset="100%" stopColor="var(--viz-1)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={24} />
            <YAxis {...axisProps} width={68} domain={[min < 0 ? 'dataMin' : 0, 'auto']} tickFormatter={(v: number) => formatBRLCompact(v)} />
            {min < 0 && <ReferenceLine y={0} stroke="var(--negative)" strokeDasharray="4 4" />}
            {paydayLabel && <ReferenceLine x={paydayLabel} stroke="var(--border-strong)" strokeDasharray="3 3" label={{ value: 'salário', position: 'top', fill: 'var(--text-subtle)', fontSize: 11 }} />}
            <Tooltip
              cursor={{ stroke: 'var(--border-strong)' }}
              content={({ active, payload }) => {
                const p = active ? (payload?.[0]?.payload as BalancePoint | undefined) : undefined;
                if (!p) return null;
                return (
                  <div className="max-w-[240px] rounded-xl border border-line bg-elevated px-3 py-2 text-[13px] shadow-float">
                    <p className="font-semibold">{p.date}</p>
                    <p className="text-muted">
                      Saldo previsto <span className={p.balance < 0 ? 'font-semibold text-negative' : 'font-semibold text-fg'}>{formatBRL(p.balance)}</span>
                    </p>
                    {p.notes.slice(0, 4).map((n) => (
                      <p key={n} className="truncate text-[12px] text-subtle">{n}</p>
                    ))}
                  </div>
                );
              }}
            />
            <Area type="stepAfter" dataKey="balance" name="Saldo previsto" stroke="var(--viz-1)" strokeWidth={2} fill="url(#fill-forecast)" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)' }} animationDuration={600} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>{caption}</caption>
        <thead><tr><th>Dia</th><th>Saldo previsto</th><th>Movimentos</th></tr></thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.date}><td>{d.date}</td><td>{formatBRL(d.balance)}</td><td>{d.notes.join('; ')}</td></tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export default { BarsChart, AreaTrend, BalanceForecast };
