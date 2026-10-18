import { useMutation, useQuery } from '@tanstack/react-query'
import { Users2 } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ExportButtons } from '../../components/Export'
import { comparePeriods, contacts } from '../../engine/analytics'
import { useCase } from '../../app/layout'
import { FilterBar } from '../../components/FilterBar'
import { Badge, Criteria, DrillLink, ErrorBox, Field, Loading, Notice, Num, PageHeader, Tabs } from '../../components/ui'
import { fmtDate, fmtDateTime, fmtDuration, fmtInt, fmtNumberPlain } from '../../lib/format'
import { useUrlFilter } from '../../lib/useUrlFilter'

export default function Contacts() {
  const [sp] = useSearchParams()
  const [tab, setTab] = useState(sp.get('aba') === 'periodos' ? 'periodos' : 'frequencia')
  return (
    <div>
      <PageHeader
        icon={<Users2 className="h-5 w-5" />}
        title="Análise de contatos"
        subtitle="Interlocutores por número de eventos, dias distintos, sentido, duração e regularidade. Frequência de comunicação, isoladamente, não comprova vínculo pessoal nem participação em fato ilícito."
      />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'frequencia', label: 'Contatos recorrentes' },
          { value: 'periodos', label: 'Comparação entre períodos' },
        ]}
      />
      {tab === 'frequencia' ? <Frequency /> : <Periods />}
    </div>
  )
}

function Frequency() {
  const { c } = useCase()
  const [f, setF] = useUrlFilter()
  const q = useQuery({ queryKey: ['contacts', c.id, f], queryFn: () => contacts(f, 300) as Promise<any> })
  return (
    <>
      <FilterBar value={f} onChange={setF} />
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : (
        <div className="card scroll-x p-3">
          <div className="mb-2 flex justify-end">
            <ExportButtons
              build={() => ({
                title: 'Contatos recorrentes',
                columns: [
                  { key: 'target_number', label: 'Alvo', fmt: (v) => fmtNumberPlain(v) },
                  { key: 'other_number', label: 'Interlocutor', fmt: (v) => fmtNumberPlain(v) },
                  { key: 'events', label: 'Eventos' },
                  { key: 'days', label: 'Dias' },
                  { key: 'outgoing', label: 'Originados' },
                  { key: 'incoming', label: 'Recebidos' },
                  { key: 'calls', label: 'Chamadas' },
                  { key: 'sms', label: 'SMS' },
                  { key: 'call_seconds', label: 'Duração', fmt: (v) => fmtDuration(v) },
                  { key: 'first_event', label: 'Primeiro', fmt: (v) => fmtDateTime(v) },
                  { key: 'last_event', label: 'Último', fmt: (v) => fmtDateTime(v) },
                  { key: 'regularity', label: 'Regularidade', fmt: (v) => (v === null ? '—' : `${Math.round(v * 100)}%`) },
                  { key: 'reciprocal', label: 'Recíproca', fmt: (v) => (v ? 'sim' : 'não') },
                ],
                rows: q.data.items,
                criteria: q.data.criteria,
              })}
            />
          </div>
          <table>
            <thead>
              <tr>
                <th>Alvo</th>
                <th>Interlocutor</th>
                <th className="text-right">Eventos</th>
                <th className="text-right">Dias</th>
                <th className="text-right">Orig.</th>
                <th className="text-right">Rec.</th>
                <th className="text-right">Chamadas</th>
                <th className="text-right">SMS</th>
                <th className="text-right">Duração</th>
                <th>Primeiro → último</th>
                <th className="text-right">Regularidade</th>
                <th>Reciprocidade</th>
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((r: any) => (
                <tr key={r.target_number + r.other_number}>
                  <td>
                    <Num n={r.target_number} />
                  </td>
                  <td>
                    <Num n={r.other_number} caseId={c.id} />
                  </td>
                  <td className="text-right tabular-nums">
                    <DrillLink caseId={c.id} filter={{ ...f, targets: [r.target_number], others: [r.other_number] }}>
                      {fmtInt(r.events)}
                    </DrillLink>
                  </td>
                  <td className="text-right tabular-nums">{r.days}</td>
                  <td className="text-right tabular-nums">{r.outgoing}</td>
                  <td className="text-right tabular-nums">{r.incoming}</td>
                  <td className="text-right tabular-nums">{r.calls}</td>
                  <td className="text-right tabular-nums">{r.sms}</td>
                  <td className="text-right font-mono text-xs">{fmtDuration(r.call_seconds)}</td>
                  <td className="text-xs whitespace-nowrap">
                    {fmtDate(r.first_event)} → {fmtDate(r.last_event)}
                  </td>
                  <td className="text-right tabular-nums">{r.regularity !== null ? `${Math.round(r.regularity * 100)}%` : '—'}</td>
                  <td>{r.reciprocal ? <Badge tone="teal">recíproca</Badge> : <Badge>unidirecional</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Criteria criteria={q.data.criteria} />
        </div>
      )}
    </>
  )
}

function Periods() {
  const { c, meta } = useCase()
  const span = meta?.span ?? []
  const [p, setP] = useState({ a0: span[0]?.slice(0, 10) ?? '', a1: '', b0: '', b1: span[1]?.slice(0, 10) ?? '' })
  const [targets, setTargets] = useState<string[]>([])
  const m = useMutation({
    mutationFn: () =>
      comparePeriods(targets.length ? { targets } : {}, [p.a0 + 'T00:00:00', p.a1 + 'T23:59:59'], [p.b0 + 'T00:00:00', p.b1 + 'T23:59:59']) as Promise<any>,
  })
  const tone: Record<string, any> = { novo: 'teal', 'deixou de ocorrer': 'red', aumentou: 'amber', reduziu: 'blue', estável: 'gray' }
  return (
    <>
      <div className="card mb-4 grid gap-3 p-4 md:grid-cols-5">
        <Field label="Período 1 — de">
          <input type="date" className="w-full" value={p.a0} onChange={(e) => setP({ ...p, a0: e.target.value })} />
        </Field>
        <Field label="Período 1 — até">
          <input type="date" className="w-full" value={p.a1} onChange={(e) => setP({ ...p, a1: e.target.value })} />
        </Field>
        <Field label="Período 2 — de">
          <input type="date" className="w-full" value={p.b0} onChange={(e) => setP({ ...p, b0: e.target.value })} />
        </Field>
        <Field label="Período 2 — até">
          <input type="date" className="w-full" value={p.b1} onChange={(e) => setP({ ...p, b1: e.target.value })} />
        </Field>
        <Field label="Alvo">
          <select className="w-full" value={targets[0] ?? ''} onChange={(e) => setTargets(e.target.value ? [e.target.value] : [])}>
            <option value="">todos</option>
            {(meta?.targets ?? []).map((t: any) => (
              <option key={t.number} value={t.number}>
                {t.number} {t.label ? `— ${t.label}` : ''}
              </option>
            ))}
          </select>
        </Field>
        <div className="md:col-span-5">
          <button className="btn-primary" disabled={!p.a0 || !p.a1 || !p.b0 || !p.b1} onClick={() => m.mutate()}>
            Comparar períodos
          </button>
        </div>
      </div>
      {m.isPending && <Loading />}
      {m.error && <ErrorBox error={m.error} />}
      {m.data && (
        <div className="card scroll-x p-3">
          <Notice>Taxas por dia normalizadas pelo tamanho de cada período; variação ≥ 1,5× é marcada como aumento ou redução.</Notice>
          <table className="mt-3">
            <thead>
              <tr>
                <th>Alvo</th>
                <th>Interlocutor</th>
                <th className="text-right">Período 1</th>
                <th className="text-right">Período 2</th>
                <th className="text-right">Taxa/dia 1</th>
                <th className="text-right">Taxa/dia 2</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {m.data.items.map((r: any) => (
                <tr key={r.target_number + r.other_number}>
                  <td>
                    <Num n={r.target_number} />
                  </td>
                  <td>
                    <Num n={r.other_number} caseId={c.id} />
                  </td>
                  <td className="text-right tabular-nums">{r.period1}</td>
                  <td className="text-right tabular-nums">{r.period2}</td>
                  <td className="text-right tabular-nums">{r.rate1_per_day}</td>
                  <td className="text-right tabular-nums">{r.rate2_per_day}</td>
                  <td>
                    <Badge tone={tone[r.status]}>{r.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Criteria criteria={m.data.criteria} />
        </div>
      )}
    </>
  )
}
