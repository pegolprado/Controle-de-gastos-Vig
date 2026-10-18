import { useQuery } from '@tanstack/react-query'
import { Lock, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { useCase } from '../../app/layout'
import { BarsChart } from '../../components/charts'
import { Field, Modal, Notice, Stat } from '../../components/ui'
import { summary } from '../../engine/analytics'
import { resetDb } from '../../engine/db'
import { syncTargetsTable } from '../../engine/importer'
import { clearSession, getState, type SessionMeta, setState, useSession } from '../../engine/session'
import { fmtDate, fmtDuration, fmtInt } from '../../lib/format'

export default function Overview() {
  const { c } = useCase()
  const st = useSession((x) => x)
  const s = useQuery({ queryKey: ['summary', c.id, {}], queryFn: () => summary({}) })
  const [edit, setEdit] = useState(false)
  const t = s.data?.totals
  const done = st.imports.filter((i) => i.status === 'done')
  const steps = [
    { label: 'Informar alvos', done: st.targets.length > 0, to: 'alvos' },
    { label: 'Carregar bilhetagem', done: done.some((i) => i.kind === 'cdr'), to: 'arquivos' },
    { label: 'Carregar cadastro de ERB', done: done.some((i) => i.kind === 'erb_registry'), to: 'arquivos' },
    { label: 'Revisar alertas', done: st.alerts.length > 0 && st.alerts.every((a) => a.review_status !== 'pendente'), to: 'alertas' },
    { label: 'Exportar resultados', done: false, to: 'relatorios' },
  ]
  const clearAll = async () => {
    if (!confirm('Apagar todos os arquivos, resultados e alvos desta análise? Esta ação não pode ser desfeita.')) return
    await resetDb()
    clearSession()
    setState({}, true)
    toast.success('Análise apagada da memória.')
  }
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white md:text-3xl">{st.meta.title}</h1>
          <p className="mt-2 text-sm text-muted">
            {st.meta.reference && <>Referência {st.meta.reference} · </>}
            {st.meta.unit && <>{st.meta.unit} · </>}
            Período autorizado: {st.meta.period_start ? `${fmtDate(st.meta.period_start)} a ${fmtDate(st.meta.period_end)}` : <span className="text-amber">não definido</span>}
          </p>
          {st.meta.description && <p className="mt-3 max-w-3xl text-sm text-text/80">{st.meta.description}</p>}
        </div>
        <div className="flex shrink-0 gap-2">
          <button className="btn-ghost" onClick={() => setEdit(true)}>
            <Pencil className="h-4 w-4" /> Identificação
          </button>
          <button className="btn-danger" onClick={clearAll}>
            <Trash2 className="h-4 w-4" /> Apagar análise
          </button>
        </div>
      </div>
      <Notice tone="teal" title="Privacidade">
        <span className="inline-flex items-center gap-1.5">
          <Lock className="h-3.5 w-3.5" /> Esta análise existe apenas na memória desta aba. Os arquivos não foram enviados a nenhum servidor. Sair, fechar a aba, recarregar a página ou ficar inativo por muito tempo apaga tudo — exporte em Excel ou PDF o que precisar guardar.
        </span>
      </Notice>
      {!st.meta.period_start && <Notice tone="amber">Defina o período autorizado (em “Identificação”) para que o sistema sinalize registros fora do escopo antes de carregar os arquivos.</Notice>}
      <div className="card p-5">
        <div className="label mb-3">Fluxo de trabalho</div>
        <ol className="grid gap-2 sm:grid-cols-5">
          {steps.map((x, i) => (
            <li key={x.label}>
              <Link to={x.to} className={`block rounded-lg border p-3 text-sm ${x.done ? 'border-ok/40 bg-ok/5 text-ok' : 'border-line text-muted hover:border-accent/50'}`}>
                <span className="font-mono text-xs">{i + 1}.</span> {x.label}
              </Link>
            </li>
          ))}
        </ol>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Registros considerados" value={fmtInt(t?.events)} hint={t ? `${fmtInt(s.data!.excluded.duplicates)} duplicados e ${fmtInt(s.data!.excluded.out_of_scope)} fora do período excluídos` : undefined} />
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
      {edit && <MetaForm onClose={() => setEdit(false)} />}
    </div>
  )
}

function MetaForm({ onClose }: { onClose: () => void }) {
  const [m, setM] = useState<SessionMeta>(getState().meta)
  const set = (p: Partial<SessionMeta>) => setM((x) => ({ ...x, ...p }))
  const save = async () => {
    if (m.period_start && m.period_end && m.period_start > m.period_end) return toast.error('O início do período não pode ser posterior ao fim.')
    setState({ meta: { ...m, title: m.title.trim() || 'Análise sem título' } }, true)
    await syncTargetsTable()
    toast.success('Identificação atualizada. O período vale para os próximos arquivos processados.')
    onClose()
  }
  return (
    <Modal open title="Identificação da análise" onClose={onClose}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Título" className="sm:col-span-2">
          <input className="w-full" value={m.title} onChange={(e) => set({ title: e.target.value })} maxLength={200} />
        </Field>
        <Field label="Referência (processo, procedimento)">
          <input className="w-full" value={m.reference} onChange={(e) => set({ reference: e.target.value })} maxLength={120} />
        </Field>
        <Field label="Unidade">
          <input className="w-full" value={m.unit} onChange={(e) => set({ unit: e.target.value })} maxLength={120} />
        </Field>
        <Field label="Período autorizado — início">
          <input type="date" className="w-full" value={m.period_start ?? ''} onChange={(e) => set({ period_start: e.target.value || null })} />
        </Field>
        <Field label="Período autorizado — fim">
          <input type="date" className="w-full" value={m.period_end ?? ''} onChange={(e) => set({ period_end: e.target.value || null })} />
        </Field>
        <Field label="Descrição" className="sm:col-span-2">
          <textarea className="w-full" rows={3} value={m.description} onChange={(e) => set({ description: e.target.value })} maxLength={2000} />
        </Field>
      </div>
      <p className="mt-3 text-xs text-faint">Esses dados aparecem nos relatórios exportados e ficam somente na memória desta aba.</p>
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>
          Cancelar
        </button>
        <button className="btn-primary" onClick={save}>
          Salvar na sessão
        </button>
      </div>
    </Modal>
  )
}
