import { keepPreviousData, useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { ArrowDown, ArrowUp, Columns3, PhoneCall } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ExportButtons } from '../../components/Export'
import { allEvents, listEvents } from '../../engine/analytics'
import { EVENT_EXPORT_COLS } from '../../engine/report'
import { useCase } from '../../app/layout'
import { type EventFilter, FilterBar } from '../../components/FilterBar'
import { Badge, Criteria, ErrorBox, Loading, PageHeader, Pagination, Tabs } from '../../components/ui'
import { EVENT_TYPE_LABEL, fmtDateTime, fmtDuration, fmtInt, fmtNumber, RESOLUTION_LABEL, SMS, VOICE } from '../../lib/format'
import { useUrlFilter } from '../../lib/useUrlFilter'

type Col = { key: string; label: string; sort?: string; render: (e: any) => React.ReactNode; default?: boolean }

const COLS: Col[] = [
  { key: 'id', label: 'ID', sort: 'id', render: (e) => <span className="font-mono text-xs text-faint">{e.id}</span>, default: true },
  {
    key: 'ts',
    label: 'Data/hora (documento)',
    sort: 'ts',
    default: true,
    render: (e) => (
      <span className="whitespace-nowrap">
        {fmtDateTime(e.ts_local)}
        {e.tz_status !== 'confirmed' && (
          <span className={clsx('ml-1 text-[10px]', e.tz_status === 'unknown' ? 'text-amber' : 'text-faint')} title={e.tz_status === 'unknown' ? 'fuso desconhecido' : 'fuso presumido'}>
            {e.tz_status === 'unknown' ? '⚠ fuso?' : 'pres.'}
          </span>
        )}
      </span>
    ),
  },
  { key: 'type', label: 'Tipo', sort: 'type', default: true, render: (e) => <span className="text-xs">{EVENT_TYPE_LABEL[e.event_type] ?? e.event_type}</span> },
  { key: 'target', label: 'Alvo', sort: 'target', default: true, render: (e) => <span className="font-mono text-xs">{fmtNumber(e.target_number)}</span> },
  { key: 'a', label: 'Origem (A)', sort: 'a', default: true, render: (e) => <span className="font-mono text-xs">{fmtNumber(e.a_number)}</span> },
  { key: 'b', label: 'Destino (B)', sort: 'b', default: true, render: (e) => <span className="font-mono text-xs">{fmtNumber(e.b_number)}</span> },
  { key: 'duration', label: 'Duração', sort: 'duration', default: true, render: (e) => <span className="font-mono text-xs tabular-nums">{fmtDuration(e.duration_s)}</span> },
  { key: 'cell', label: 'Célula', sort: 'cell', default: true, render: (e) => <span className="font-mono text-[11px] break-all text-muted">{e.cell_key ?? '—'}</span> },
  {
    key: 'res',
    label: 'ERB',
    default: true,
    render: (e) =>
      e.resolution_status ? (
        <Badge tone={e.resolution_status === 'exact' ? 'green' : e.resolution_status === 'probable' ? 'blue' : e.resolution_status === 'ambiguous' ? 'amber' : 'red'}>{RESOLUTION_LABEL[e.resolution_status]}</Badge>
      ) : (
        <span className="text-faint">—</span>
      ),
  },
  { key: 'site', label: 'Estação', render: (e) => <span className="text-xs">{e.cell_site ?? '—'}</span> },
  { key: 'operator', label: 'Operadora', render: (e) => <span className="text-xs">{e.operator ?? '—'}</span> },
  { key: 'imei', label: 'IMEI', render: (e) => <span className="font-mono text-xs">{e.imei ?? '—'}</span> },
  { key: 'ip', label: 'IP', render: (e) => <span className="font-mono text-xs">{e.ip ?? '—'}</span> },
  { key: 'status', label: 'Status', render: (e) => <span className="text-xs">{e.status ?? '—'}</span> },
  {
    key: 'source',
    label: 'Fonte',
    default: true,
    render: (e) => (
      <span className="font-mono text-[11px] whitespace-nowrap text-faint">
        #{e.file_id} l.{e.row_number ?? '?'}
        {e.page ? ` p.${e.page}` : ''}
      </span>
    ),
  },
  {
    key: 'flags',
    label: 'Alertas',
    default: true,
    render: (e) => (
      <span className="flex flex-wrap gap-1">
        {e.is_duplicate && <Badge tone="gray">duplicado</Badge>}
        {e.out_of_scope && <Badge tone="amber">fora do período</Badge>}
        {e.warnings?.length > 0 && <Badge tone="amber">{e.warnings.length} aviso(s)</Badge>}
        {e.revision > 0 && <Badge tone="violet">corrigido</Badge>}
      </span>
    ),
  },
]

const TAB_TYPES: Record<string, string[]> = { voz: VOICE, sms: SMS, dados: ['dados'] }

export default function Events() {
  const { c } = useCase()
  const navigate = useNavigate()
  const [sp, setSp] = useSearchParams()
  const [filter, setFilter] = useUrlFilter()
  const tab = sp.get('aba') ?? 'todos'
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(50)
  const [sort, setSort] = useState('ts')
  const [order, setOrder] = useState<'asc' | 'desc'>('asc')
  const [cols, setCols] = useState<string[]>(COLS.filter((x) => x.default).map((x) => x.key))
  const [colMenu, setColMenu] = useState(false)
  useEffect(() => setPage(1), [filter, tab])
  const eff: EventFilter = tab !== 'todos' ? { ...filter, event_types: TAB_TYPES[tab] } : filter
  const q = useQuery({
    queryKey: ['events', c.id, eff, page, size, sort, order],
    queryFn: () => listEvents(eff, page, size, sort, order) as Promise<any>,
    placeholderData: keepPreviousData,
  })
  const visible = COLS.filter((x) => cols.includes(x.key))
  return (
    <div>
      <PageHeader
        icon={<PhoneCall className="h-5 w-5" />}
        title="Explorador de registros"
        subtitle="Chamadas, SMS, sessões de dados e eventos normalizados. Horários conforme o documento de origem; duplicados e registros fora do período autorizado ficam ocultos por padrão (ative em “Mais filtros”)."
        actions={
          <ExportButtons
            build={async () => {
              const rows = await allEvents(eff, 1_000_000)
              return { title: 'Registros', subtitle: `${rows.length} registros`, columns: EVENT_EXPORT_COLS.map((k) => ({ key: k, label: k })), rows, criteria: q.data?.criteria }
            }}
          />
        }
      />
      <Tabs
        value={tab}
        onChange={(v) => {
          const n = new URLSearchParams(sp)
          if (v === 'todos') n.delete('aba')
          else n.set('aba', v)
          setSp(n, { replace: true })
        }}
        items={[
          { value: 'todos', label: 'Todos' },
          { value: 'voz', label: 'Chamadas' },
          { value: 'sms', label: 'SMS' },
          { value: 'dados', label: 'Dados' },
        ]}
      />
      <FilterBar value={filter} onChange={setFilter} />
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} onRetry={q.refetch} />
      ) : (
        <div className="card p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-muted">
              <b className="text-text">{fmtInt(q.data.total)}</b> registros
            </div>
            <div className="relative flex items-center gap-2">
              <select value={size} onChange={(e) => setSize(+e.target.value)} aria-label="Itens por página">
                {[25, 50, 100, 250].map((n) => (
                  <option key={n} value={n}>
                    {n} por página
                  </option>
                ))}
              </select>
              <button className="btn-ghost" onClick={() => setColMenu(!colMenu)}>
                <Columns3 className="h-4 w-4" /> Colunas
              </button>
              {colMenu && (
                <div className="absolute top-11 right-0 z-30 w-56 rounded-xl border border-line bg-panel p-3 shadow-xl">
                  {COLS.map((x) => (
                    <label key={x.key} className="flex items-center gap-2 py-0.5 text-sm">
                      <input type="checkbox" checked={cols.includes(x.key)} onChange={() => setCols(cols.includes(x.key) ? cols.filter((k) => k !== x.key) : [...cols, x.key])} /> {x.label}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="scroll-x max-h-[65vh] overflow-y-auto">
            <table>
              <thead>
                <tr>
                  {visible.map((x) => (
                    <th
                      key={x.key}
                      className={x.sort ? 'cursor-pointer select-none hover:text-text' : ''}
                      onClick={() => {
                        if (!x.sort) return
                        if (sort === x.sort) setOrder(order === 'asc' ? 'desc' : 'asc')
                        else {
                          setSort(x.sort)
                          setOrder('asc')
                        }
                      }}
                    >
                      <span className="inline-flex items-center gap-1">
                        {x.label}
                        {sort === x.sort && (order === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {q.data.items.map((e: any) => (
                  <tr key={e.id} className="cursor-pointer" onClick={() => navigate(`${e.id}`)}>
                    {visible.map((x) => (
                      <td key={x.key}>{x.render(e)}</td>
                    ))}
                  </tr>
                ))}
                {q.data.items.length === 0 && (
                  <tr>
                    <td colSpan={visible.length} className="py-10 text-center text-muted">
                      Nenhum registro com esses critérios.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination page={page} size={size} total={q.data.total} onPage={setPage} />
          <Criteria criteria={q.data.criteria} />
        </div>
      )}
    </div>
  )
}
