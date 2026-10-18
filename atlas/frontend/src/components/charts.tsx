import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

/** Paleta categórica validada (tema escuro, superfície #161b2e): ordem fixa, nunca reciclada. */
export const SERIES = ['#4c8dff', '#0f9e8e', '#c27f10', '#9a7cf0', '#e05c9e']
const AXIS = { stroke: '#5d6780', fontSize: 11, tickLine: false, axisLine: false } as const
const GRID = '#273049'

function Tip({ active, payload, label, labelFmt }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-line-2 bg-ink px-3 py-2 text-xs shadow-xl">
      <div className="mb-1 font-mono text-muted">{labelFmt ? labelFmt(label) : label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2 text-text">
          <span className="h-2 w-2 rounded-sm" style={{ background: p.color }} />
          {p.name}: <b className="tabular-nums">{Number(p.value).toLocaleString('pt-BR')}</b>
        </div>
      ))}
    </div>
  )
}

export type Series = { key: string; name: string }

/** Barras (verticais) com tooltip; >1 série = empilhadas com legenda. Inclui alternância para tabela. */
export function BarsChart({
  data,
  x,
  series,
  height = 240,
  xFmt,
  onBarClick,
  title,
}: {
  data: any[]
  x: string
  series: Series[]
  height?: number
  xFmt?: (v: any) => string
  onBarClick?: (row: any) => void
  title?: string
}) {
  const [table, setTable] = useState(false)
  return (
    <figure className="card p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        {title && <figcaption className="font-mono text-xs font-bold tracking-wider text-muted uppercase">{title}</figcaption>}
        <button className="text-xs text-faint hover:text-text" onClick={() => setTable(!table)}>
          {table ? 'ver gráfico' : 'ver tabela'}
        </button>
      </div>
      {table ? (
        <div className="max-h-72 overflow-auto">
          <table>
            <thead>
              <tr>
                <th>{x}</th>
                {series.map((s) => (
                  <th key={s.key} className="text-right">
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((r, i) => (
                <tr key={i}>
                  <td className="font-mono text-xs">{xFmt ? xFmt(r[x]) : r[x]}</td>
                  {series.map((s) => (
                    <td key={s.key} className="text-right tabular-nums">
                      {(r[s.key] ?? 0).toLocaleString('pt-BR')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: -12 }} barCategoryGap={2}>
              <CartesianGrid vertical={false} stroke={GRID} strokeDasharray="0" />
              <XAxis dataKey={x} {...AXIS} tickFormatter={xFmt} minTickGap={8} />
              <YAxis {...AXIS} allowDecimals={false} width={44} />
              <Tooltip content={<Tip labelFmt={xFmt} />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
              {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12, color: '#8d97ab' }} iconType="square" iconSize={8} />}
              {series.map((s, i) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={s.name}
                  stackId={series.length > 1 ? 'a' : undefined}
                  fill={SERIES[i]}
                  stroke="#161b2e"
                  strokeWidth={series.length > 1 ? 1 : 0}
                  radius={i === series.length - 1 ? [4, 4, 0, 0] : 0}
                  maxBarSize={36}
                  onClick={onBarClick ? (d: any) => onBarClick(d.payload ?? d) : undefined}
                  cursor={onBarClick ? 'pointer' : undefined}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </figure>
  )
}
