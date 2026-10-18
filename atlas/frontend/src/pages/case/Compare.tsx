import { useMutation } from '@tanstack/react-query'
import clsx from 'clsx'
import { GitCompare } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { coincidences, compareNumbers } from '../../engine/analytics'
import { useCase } from '../../app/layout'
import { SERIES } from '../../components/charts'
import { Badge, Criteria, DrillLink, ErrorBox, Field, Loading, Notice, Num, PageHeader, Tabs } from '../../components/ui'
import { EVENT_TYPE_LABEL, fmtDateTime, fmtDuration, fmtInt, fmtNumber, WEEKDAYS } from '../../lib/format'

export default function Compare() {
  const { meta } = useCase()
  const [sp] = useSearchParams()
  const [tab, setTab] = useState(sp.get('aba') ?? 'atividade')
  const targets: any[] = meta?.targets ?? []
  const [nums, setNums] = useState<string[]>(targets.slice(0, 2).map((t) => t.number))
  const [extra, setExtra] = useState('')
  const [win, setWin] = useState(300)
  const [mode, setMode] = useState<'any' | 'cell' | 'site'>('any')
  const [siteM, setSiteM] = useState(200)
  const all = [...nums, ...extra.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean)]
  const cmp = useMutation({ mutationFn: () => compareNumbers(all, {}, win) as Promise<any> })
  const coin = useMutation({
    mutationFn: () => coincidences(all, {}, win, mode === 'cell', 1000, mode === 'site' ? siteM : null) as Promise<any>,
  })
  const run = () => (tab === 'coincidencias' ? coin.mutate() : cmp.mutate())
  return (
    <div>
      <PageHeader
        icon={<GitCompare className="h-5 w-5" />}
        title="Comparação entre números"
        subtitle="Volumes, períodos de atividade, horários, contatos em comum, células compartilhadas e coincidências temporais. Cada resultado indica os critérios e abre os registros que o sustentam."
      />
      <div className="card mb-4 flex flex-wrap items-end gap-4 p-4">
        <div>
          <span className="label">Alvos</span>
          <div className="flex flex-wrap gap-1">
            {targets.map((t, i) => (
              <button
                key={t.number}
                onClick={() => setNums(nums.includes(t.number) ? nums.filter((x) => x !== t.number) : [...nums, t.number])}
                className={clsx('chip !py-1.5', nums.includes(t.number) ? 'border-accent bg-accent/20 text-white' : 'border-line text-muted')}
              >
                <span className="h-2 w-2 rounded-sm" style={{ background: SERIES[i % SERIES.length] }} />
                {fmtNumber(t.number)} {t.label && <span className="text-teal">· {t.label}</span>}
              </button>
            ))}
          </div>
        </div>
        <Field label="Outros números" className="min-w-56 flex-1">
          <input className="w-full" placeholder="(61) 9…, separados por vírgula" value={extra} onChange={(e) => setExtra(e.target.value)} />
        </Field>
        <Field label="Janela temporal (s)">
          <input type="number" min={1} max={86400} className="w-28" value={win} onChange={(e) => setWin(+e.target.value)} />
        </Field>
        <button className="btn-primary" disabled={all.length < 2} onClick={run}>
          Comparar
        </button>
      </div>
      <Tabs
        value={tab}
        onChange={(v) => setTab(v)}
        items={[
          { value: 'atividade', label: 'Atividade' },
          { value: 'comum', label: 'Contatos em comum' },
          { value: 'celulas', label: 'Células compartilhadas' },
          { value: 'coincidencias', label: 'Coincidências temporais' },
        ]}
      />
      {tab !== 'coincidencias' && (
        <>
          {cmp.isPending && <Loading />}
          {cmp.error && <ErrorBox error={cmp.error} />}
          {!cmp.data && !cmp.isPending && <Notice>Selecione dois ou mais números e clique em Comparar.</Notice>}
          {cmp.data && tab === 'atividade' && <Activity data={cmp.data} />}
          {cmp.data && tab === 'comum' && <Common data={cmp.data} />}
          {cmp.data && tab === 'celulas' && <Cells data={cmp.data} />}
        </>
      )}
      {tab === 'coincidencias' && (
        <>
          <div className="card mb-4 flex flex-wrap items-end gap-4 p-4 text-sm">
            {(
              [
                ['any', 'Qualquer local'],
                ['cell', 'Mesma célula'],
                ['site', 'Estações próximas (cadastro)'],
              ] as const
            ).map(([k, l]) => (
              <label key={k} className="flex items-center gap-2">
                <input type="radio" checked={mode === k} onChange={() => setMode(k)} /> {l}
              </label>
            ))}
            {mode === 'site' && (
              <Field label="Distância máxima entre estações (m)">
                <input type="number" className="w-28" value={siteM} onChange={(e) => setSiteM(+e.target.value)} />
              </Field>
            )}
            <button className="btn-primary" disabled={all.length < 2} onClick={() => coin.mutate()}>
              Buscar coincidências
            </button>
          </div>
          <Notice tone="amber">Coincidências são observações sobre registros de rede em janelas de tempo. Não indicam que os titulares estavam juntos fisicamente.</Notice>
          {coin.isPending && <Loading />}
          {coin.error && <ErrorBox error={coin.error} />}
          {coin.data && <Coincidences data={coin.data} />}
        </>
      )}
    </div>
  )
}

function Activity({ data }: { data: any }) {
  const { c } = useCase()
  const maxH = Math.max(1, ...data.per_number.flatMap((p: any) => p.by_hour.map((h: any) => h.n)))
  return (
    <div className="space-y-4">
      <div className="card scroll-x p-3">
        <table>
          <thead>
            <tr>
              <th>Número</th>
              <th className="text-right">Eventos</th>
              <th className="text-right">Chamadas</th>
              <th className="text-right">SMS</th>
              <th className="text-right">Duração</th>
              <th className="text-right">Dias ativos</th>
              <th className="text-right">Contatos</th>
              <th>Período de atividade</th>
            </tr>
          </thead>
          <tbody>
            {data.per_number.map((p: any, i: number) => (
              <tr key={p.number}>
                <td>
                  <span className="mr-2 inline-block h-2 w-2 rounded-sm" style={{ background: SERIES[i % SERIES.length] }} />
                  <Num n={p.number} caseId={c.id} />
                </td>
                <td className="text-right tabular-nums">{fmtInt(p.totals.events)}</td>
                <td className="text-right tabular-nums">{fmtInt(p.totals.calls)}</td>
                <td className="text-right tabular-nums">{fmtInt(p.totals.sms)}</td>
                <td className="text-right font-mono text-xs">{fmtDuration(p.totals.call_seconds)}</td>
                <td className="text-right tabular-nums">{p.totals.active_days}</td>
                <td className="text-right tabular-nums">{p.totals.distinct_contacts}</td>
                <td className="text-xs">
                  {fmtDateTime(p.totals.first_event, false)} → {fmtDateTime(p.totals.last_event, false)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card p-4">
        <div className="label mb-3">Distribuição por hora (horário do documento)</div>
        <div className="space-y-2">
          {data.per_number.map((p: any, i: number) => {
            const by = Object.fromEntries(p.by_hour.map((h: any) => [h.hour, h.n]))
            return (
              <div key={p.number} className="grid grid-cols-[130px_1fr] items-center gap-2">
                <span className="font-mono text-xs">{fmtNumber(p.number)}</span>
                <div className="grid grid-cols-24 gap-[2px]" style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}>
                  {Array.from({ length: 24 }, (_, h) => (
                    <div key={h} title={`${h}h: ${by[h] ?? 0} eventos`} className="h-6 rounded-sm" style={{ background: SERIES[i % SERIES.length], opacity: 0.08 + 0.92 * ((by[h] ?? 0) / maxH) }} />
                  ))}
                </div>
              </div>
            )
          })}
          <div className="grid grid-cols-[130px_1fr] gap-2 text-[10px] text-faint">
            <span />
            <div className="flex justify-between">
              <span>0h</span>
              <span>6h</span>
              <span>12h</span>
              <span>18h</span>
              <span>23h</span>
            </div>
          </div>
        </div>
        <div className="mt-4 text-xs text-faint">
          Dias da semana:{' '}
          {data.per_number.map((p: any) => (
            <span key={p.number} className="mr-4">
              {fmtNumber(p.number)}: {p.by_weekday.map((w: any) => `${WEEKDAYS[w.weekday]} ${w.n}`).join(' · ')}
            </span>
          ))}
        </div>
      </div>
      {data.direct_contacts.length > 0 && (
        <div className="card p-4">
          <div className="label mb-2">Contatos diretos entre os números comparados</div>
          {data.direct_contacts.map((d: any) => (
            <div key={d.a_number + d.b_number} className="text-sm">
              {fmtNumber(d.a_number)} → {fmtNumber(d.b_number)}:{' '}
              <DrillLink caseId={c.id} filter={{ targets: [d.a_number, d.b_number], others: [d.a_number, d.b_number] }}>
                {d.n} registros
              </DrillLink>{' '}
              <span className="text-xs text-faint">
                ({fmtDateTime(d.first_event, false)} a {fmtDateTime(d.last_event, false)})
              </span>
            </div>
          ))}
        </div>
      )}
      <Criteria criteria={data.criteria} />
    </div>
  )
}

function Common({ data }: { data: any }) {
  const { c } = useCase()
  const cc = data.common_contacts
  return (
    <div className="space-y-4">
      <div className="card scroll-x p-3">
        <div className="mb-2 text-sm text-muted">{cc.shared.length} contatos em comum</div>
        <table>
          <thead>
            <tr>
              <th>Contato</th>
              {cc.numbers.map((n: string) => (
                <th key={n} className="text-right">
                  {fmtNumber(n)}
                </th>
              ))}
              <th className="text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {cc.shared.map((r: any) => (
              <tr key={r.contact}>
                <td>
                  <Num n={r.contact} caseId={c.id} />
                </td>
                {cc.numbers.map((n: string) => {
                  const x = r.per_number[n]
                  return (
                    <td key={n} className="text-right tabular-nums" title={x ? `${x.days} dias · ${fmtDateTime(x.first, false)} a ${fmtDateTime(x.last, false)}` : ''}>
                      {x ? (
                        <DrillLink caseId={c.id} filter={{ targets: [n], others: [r.contact] }}>
                          {x.n}
                        </DrillLink>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                  )
                })}
                <td className="text-right font-bold tabular-nums">{r.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {Object.entries(cc.exclusive).map(([n, rows]: any) => (
          <div key={n} className="card p-4">
            <div className="label mb-2">Contatos exclusivos de {fmtNumber(n)} (top 50)</div>
            <div className="flex flex-wrap gap-1">
              {rows.map((r: any) => (
                <Badge key={r.contact}>
                  {fmtNumber(r.contact)} · {r.n}
                </Badge>
              ))}
            </div>
          </div>
        ))}
      </div>
      <Criteria criteria={cc.criteria} />
    </div>
  )
}

function Cells({ data }: { data: any }) {
  const { c } = useCase()
  return (
    <div className="card scroll-x p-3">
      <Notice>Células em que dois ou mais números tiveram registros (em qualquer momento do período). A ERB não indica a posição exata dos aparelhos.</Notice>
      <table className="mt-3">
        <thead>
          <tr>
            <th>Célula</th>
            <th>Estação</th>
            <th className="text-right">Números</th>
            <th className="text-right">Eventos</th>
            <th>Por número</th>
          </tr>
        </thead>
        <tbody>
          {data.shared_cells.map((r: any) => (
            <tr key={r.cell_key}>
              <td className="font-mono text-xs">{r.cell_key}</td>
              <td className="text-xs">{r.site_name ?? '—'}</td>
              <td className="text-right">{r.numbers}</td>
              <td className="text-right">
                <DrillLink caseId={c.id} filter={{ cell_keys: [r.cell_key], targets: data.numbers }}>
                  {r.events}
                </DrillLink>
              </td>
              <td className="text-xs">
                {Object.entries(r.per_number)
                  .map(([n, v]) => `${fmtNumber(n)}: ${v}`)
                  .join(' · ')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Coincidences({ data }: { data: any }) {
  const { c } = useCase()
  return (
    <div className="card scroll-x mt-4 p-3">
      <div className="mb-2 text-sm text-muted">
        {data.items.length} pares{data.truncated ? ' (lista limitada — refine o período)' : ''}
      </div>
      <table>
        <thead>
          <tr>
            <th>Número 1</th>
            <th>Data/hora 1</th>
            <th>Número 2</th>
            <th>Data/hora 2</th>
            <th className="text-right">Δ (s)</th>
            <th>Células</th>
            <th className="text-right">Distância estações</th>
            <th>Registros</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((r: any) => (
            <tr key={r.id1 + '-' + r.id2}>
              <td className="font-mono text-xs">{fmtNumber(r.number1)}</td>
              <td className="text-xs whitespace-nowrap">
                {fmtDateTime(r.ts1)} <span className="text-faint">{EVENT_TYPE_LABEL[r.type1]}</span>
              </td>
              <td className="font-mono text-xs">{fmtNumber(r.number2)}</td>
              <td className="text-xs whitespace-nowrap">
                {fmtDateTime(r.ts2)} <span className="text-faint">{EVENT_TYPE_LABEL[r.type2]}</span>
              </td>
              <td className="text-right tabular-nums">{r.delta_s}</td>
              <td className="font-mono text-[11px]">
                {r.same_cell ? <Badge tone="amber">mesma célula</Badge> : `${r.site1 ?? r.cell1 ?? '—'} / ${r.site2 ?? r.cell2 ?? '—'}`}
                {r.tz_mixed && <Badge tone="amber" className="ml-1">fuso não confirmado</Badge>}
              </td>
              <td className="text-right tabular-nums">{r.distance_m !== null ? `${fmtInt(r.distance_m)} m` : '—'}</td>
              <td>
                <DrillLink caseId={c.id} filter={{ event_ids: [r.id1, r.id2] }}>
                  abrir
                </DrillLink>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Criteria criteria={data.criteria} />
    </div>
  )
}
