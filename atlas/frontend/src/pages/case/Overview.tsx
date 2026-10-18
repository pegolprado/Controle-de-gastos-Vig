import { useQuery } from '@tanstack/react-query'
import { Pencil } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api } from '../../api/client'
import { useCase } from '../../app/layout'
import { BarsChart } from '../../components/charts'
import { Badge, Notice, Progress, Stat } from '../../components/ui'
import { fmtDate, fmtDateTime, fmtDuration, fmtInt } from '../../lib/format'
import { STATUS_LABEL } from '../Cases'

export default function Overview() {
  const { c, canWrite } = useCase()
  const s = useQuery({ queryKey: ['summary', c.id, {}], queryFn: () => api(`/cases/${c.id}/analytics/summary`, { body: { filter: {} } }) })
  const jobs = useQuery({ queryKey: ['jobs', c.id], queryFn: () => api<any[]>(`/cases/${c.id}/jobs?limit=5`), refetchInterval: (q) => ((q.state.data ?? []).some((j: any) => ['queued', 'running'].includes(j.status)) ? 2000 : false) })
  const t = s.data?.totals
  const steps = [
    { label: 'Cadastrar alvos', done: c.stats.targets > 0, to: 'alvos' },
    { label: 'Importar bilhetagem', done: c.stats.events > 0, to: 'arquivos' },
    { label: 'Importar cadastro de ERB', done: c.stats.erb_cells > 0, to: 'arquivos' },
    { label: 'Revisar alertas', done: c.stats.alerts_pending === 0 && c.stats.events > 0, to: 'alertas' },
    { label: 'Gerar relatório', done: c.stats.reports > 0, to: 'relatorios' },
  ]
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge tone="blue">{STATUS_LABEL[c.status] ?? c.status}</Badge>
            <Badge>{c.access_level}</Badge>
            {c.require_justification && <Badge tone="red">exige justificativa</Badge>}
          </div>
          <h1 className="text-2xl font-bold text-white md:text-3xl">{c.title}</h1>
          <p className="mt-2 text-sm text-muted">
            {c.process_number && <>Processo {c.process_number} · </>}
            {c.unit && <>{c.unit} · </>}
            Período autorizado: {c.period_start ? `${fmtDate(c.period_start)} a ${fmtDate(c.period_end)}` : <span className="text-amber">não definido</span>}
          </p>
          {c.description && <p className="mt-3 max-w-3xl text-sm text-text/80">{c.description}</p>}
          {c.authorized_docs && <p className="mt-2 text-xs text-faint">Documentos de referência: {c.authorized_docs}</p>}
        </div>
        {canWrite && (
          <Link to="editar" className="btn-ghost shrink-0">
            <Pencil className="h-4 w-4" /> Editar caso
          </Link>
        )}
      </div>
      {!c.period_start && <Notice tone="amber">Defina o período autorizado do caso para que o sistema sinalize registros fora do escopo.</Notice>}
      <div className="card p-5">
        <div className="label mb-3">Fluxo de trabalho</div>
        <ol className="grid gap-2 sm:grid-cols-5">
          {steps.map((st, i) => (
            <li key={st.label}>
              <Link to={st.to} className={`block rounded-lg border p-3 text-sm ${st.done ? 'border-ok/40 bg-ok/5 text-ok' : 'border-line text-muted hover:border-accent/50'}`}>
                <span className="font-mono text-xs">{i + 1}.</span> {st.label}
              </Link>
            </li>
          ))}
        </ol>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Registros considerados" value={fmtInt(t?.events)} hint={t ? `${fmtInt(s.data.excluded.duplicates)} duplicados e ${fmtInt(s.data.excluded.out_of_scope)} fora do período excluídos` : undefined} />
        <Stat label="Chamadas / SMS / dados" value={t ? `${fmtInt(t.calls)} / ${fmtInt(t.sms)} / ${fmtInt(t.data_sessions)}` : '—'} hint={t ? `duração total ${fmtDuration(t.call_seconds)}` : undefined} />
        <Stat label="Contatos distintos" value={fmtInt(t?.distinct_contacts)} hint={t ? `${fmtInt(t.distinct_cells)} células · ${fmtInt(t.distinct_imeis)} IMEIs` : undefined} />
        <Stat label="Primeiro / último registro" value={<span className="text-base">{t?.first_event ? `${fmtDate(t.first_event)} → ${fmtDate(t.last_event)}` : '—'}</span>} hint={t ? `${fmtInt(t.active_days)} dias com atividade` : undefined} />
      </div>
      {s.data && s.data.by_day.length > 0 && (
        <BarsChart
          title="Registros por dia"
          data={s.data.by_day}
          x="day"
          xFmt={(d) => fmtDate(d).slice(0, 5)}
          series={[
            { key: 'calls', name: 'Chamadas' },
            { key: 'sms', name: 'SMS' },
            { key: 'data', name: 'Dados' },
          ]}
        />
      )}
      {(jobs.data ?? []).length > 0 && (
        <div className="card p-4">
          <div className="label mb-2">Tarefas recentes</div>
          <div className="space-y-3">
            {jobs.data!.map((j) => (
              <div key={j.id} className="grid items-center gap-2 text-sm sm:grid-cols-[180px_1fr_120px]">
                <span className="font-mono text-xs text-muted">
                  #{j.id} {j.type}
                </span>
                <div>
                  <Progress value={j.progress} tone={j.status === 'failed' ? 'red' : j.status === 'done' ? 'green' : 'blue'} />
                  {j.message && <div className="mt-1 text-xs text-faint">{j.message}</div>}
                </div>
                <span className="text-right text-xs text-faint">{j.status} · {fmtDateTime(j.created_at?.slice(0, 19), false)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
