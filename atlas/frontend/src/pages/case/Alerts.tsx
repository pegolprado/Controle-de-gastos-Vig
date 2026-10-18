import { AlertTriangle, Play, Settings2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { deleteRule, ensureDefaultRules, reviewAlert, RULE_TYPES, runRules, saveRule } from '../../engine/alerts'
import { setState as setSession, useSession } from '../../engine/session'
import { useCase } from '../../app/layout'
import { Badge, DrillLink, Empty, ErrorBox, Field, Loading, Modal, Notice, PageHeader } from '../../components/ui'
import { fmtDateTime } from '../../lib/format'

const SEV: Record<string, any> = { alta: 'red', media: 'amber', baixa: 'blue' }
const STATUS: Record<string, string> = { pendente: 'Pendente', em_analise: 'Em análise', relevante: 'Relevante', descartado: 'Descartado' }

export default function Alerts() {
  const { c, canWrite, canReview } = useCase()
  const [status, setStatus] = useState('')
  const [sev, setSev] = useState('')
  const [rulesOpen, setRulesOpen] = useState(false)
  const [running, setRunning] = useState(false)
  useEffect(() => ensureDefaultRules(), [])
  const all = useSession((s) => s.alerts)
  const items = useMemo(() => {
    const order: Record<string, number> = { alta: 0, media: 1, baixa: 2 }
    return all.filter((a) => (!status || a.review_status === status) && (!sev || a.severity === sev)).sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3) || b.id - a.id)
  }, [all, status, sev])
  const q = { isLoading: false, error: null, data: items }
  void c
  const review = (id: number, review_status: string, analyst_note?: string) => reviewAlert(id, review_status, analyst_note ?? null)
  return (
    <div>
      <PageHeader
        icon={<AlertTriangle className="h-5 w-5" />}
        title="Central de alertas"
        subtitle="Padrões que merecem análise, gerados por regras configuráveis. Cada alerta traz a regra, os parâmetros e os registros de suporte. Alertas não classificam pessoas como suspeitas nem constituem conclusões jurídicas."
        actions={
          canWrite && (
            <>
              <button className="btn-ghost" onClick={() => setRulesOpen(true)}>
                <Settings2 className="h-4 w-4" /> Regras
              </button>
              <button
                className="btn-primary"
                disabled={!!running}
                onClick={async () => {
                  setRunning(true)
                  setSession({ busy: { label: 'Executando regras de alerta', progress: 0 } })
                  try {
                    const r = await runRules()
                    toast.success(`Regras executadas: ${Object.values(r.created).reduce((a, b) => a + b, 0)} novos alertas`)
                  } catch (e: any) {
                    toast.error(e?.message ?? String(e))
                  } finally {
                    setSession({ busy: null })
                    setRunning(false)
                  }
                }}
              >
                <Play className="h-4 w-4" /> {running ? 'Executando…' : 'Executar regras'}
              </button>
            </>
          )
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">todas as situações</option>
          {Object.entries(STATUS).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <select value={sev} onChange={(e) => setSev(e.target.value)}>
          <option value="">toda relevância</option>
          <option value="alta">alta</option>
          <option value="media">média</option>
          <option value="baixa">baixa</option>
        </select>
      </div>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : q.data!.length === 0 ? (
        <Empty title="Nenhum alerta">Execute as regras após importar os dados.</Empty>
      ) : (
        <div className="space-y-3">
          {q.data!.map((a) => (
            <AlertCard key={a.id} a={a} canReview={canReview} onReview={review} caseId={c.id} />
          ))}
        </div>
      )}
      {rulesOpen && <RulesModal onClose={() => setRulesOpen(false)} />}
    </div>
  )
}

function AlertCard({ a, canReview, onReview, caseId }: { a: any; canReview: boolean; onReview: (id: number, s: string, n?: string) => void; caseId: number }) {
  const [note, setNote] = useState(a.analyst_note ?? '')
  return (
    <div className={`card p-4 ${a.review_status === 'descartado' ? 'opacity-60' : ''}`}>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <Badge tone={SEV[a.severity]}>relevância {a.severity}</Badge>
            <Badge>{a.rule_type}</Badge>
            <Badge tone={a.review_status === 'relevante' ? 'teal' : a.review_status === 'pendente' ? 'amber' : 'gray'}>{STATUS[a.review_status]}</Badge>
            <span className="text-xs text-faint">
              #{a.id} · {fmtDateTime(a.created_at.slice(0, 19), false)} · regras {a.rules_version}
            </span>
          </div>
          <div className="font-medium text-white">{a.title}</div>
          <div className="mt-1 text-sm text-muted">{a.description}</div>
          <details className="mt-1 text-xs text-faint">
            <summary className="cursor-pointer">parâmetros</summary>
            <code className="break-all">{JSON.stringify(a.params)}</code>
          </details>
          {a.reviewed_by && <div className="mt-1 text-xs text-faint">revisado por {a.reviewed_by}</div>}
        </div>
        <div className="shrink-0 space-y-2 md:w-72">
          {a.support_event_ids.length > 0 && (
            <DrillLink caseId={caseId} filter={{ event_ids: a.support_event_ids, include_duplicates: true, include_out_of_scope: true }} className="btn-ghost w-full !py-1 text-xs">
              Abrir {a.support_count} registro(s) de suporte
            </DrillLink>
          )}
          {canReview && (
            <>
              <textarea className="w-full text-xs" rows={2} placeholder="Observação do analista" value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="grid grid-cols-3 gap-1">
                {(['em_analise', 'relevante', 'descartado'] as const).map((s) => (
                  <button key={s} className="btn-ghost !px-1 !py-1 text-[11px]" onClick={() => onReview(a.id, s, note)}>
                    {STATUS[s]}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function RulesModal({ onClose }: { onClose: () => void }) {
  const rules = useSession((s) => s.rules)
  const q = { isLoading: false, data: { rules, types: RULE_TYPES } }
  const [edit, setEdit] = useState<any>(null)
  const [err, setErr] = useState<unknown>(null)
  const save = async () => {
    setErr(null)
    try {
      const body = { name: edit.name, rule_type: edit.rule_type, params: JSON.parse(edit.paramsText || '{}'), severity: edit.severity, active: edit.active }
      if (!body.name?.trim()) throw new Error('Informe o nome da regra.')
      if (!RULE_TYPES[body.rule_type]) throw new Error('Tipo de regra inválido.')
      saveRule({ ...body, id: edit.id })
      setEdit(null)
    } catch (e) {
      setErr(e)
    }
  }
  return (
    <Modal open onClose={onClose} title="Regras de alerta" wide>
      {q.isLoading ? (
        <Loading />
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>Tipo</th>
                <th>Parâmetros</th>
                <th>Relevância</th>
                <th>Ativa</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {q.data.rules.map((r: any) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td className="text-xs">{q.data.types[r.rule_type]?.label ?? r.rule_type}</td>
                  <td className="font-mono text-xs">{JSON.stringify(r.params)}</td>
                  <td>
                    <Badge tone={SEV[r.severity]}>{r.severity}</Badge>
                  </td>
                  <td>{r.active ? 'sim' : 'não'}</td>
                  <td>
                    <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setEdit({ ...r, paramsText: JSON.stringify(r.params) })}>
                      Editar
                    </button>
                    <button className="btn-ghost !px-2 !py-1 text-xs hover:!text-danger" onClick={() => confirm('Excluir esta regra e os alertas gerados por ela?') && deleteRule(r.id)}>
                      Excluir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="btn-ghost mt-3" onClick={() => setEdit({ name: '', rule_type: 'volume_diario', paramsText: JSON.stringify(q.data.types.volume_diario.params), severity: 'media', active: true })}>
            Nova regra
          </button>
          {edit && (
            <div className="mt-4 grid gap-3 rounded-xl border border-line p-4 md:grid-cols-2">
              <Field label="Nome">
                <input className="w-full" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
              </Field>
              <Field label="Tipo">
                <select className="w-full" value={edit.rule_type} onChange={(e) => setEdit({ ...edit, rule_type: e.target.value, paramsText: JSON.stringify(q.data.types[e.target.value].params) })}>
                  {Object.entries(q.data.types).map(([k, v]: any) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Parâmetros (JSON)" className="md:col-span-2">
                <input className="w-full font-mono" value={edit.paramsText} onChange={(e) => setEdit({ ...edit, paramsText: e.target.value })} />
              </Field>
              <Field label="Relevância">
                <select className="w-full" value={edit.severity} onChange={(e) => setEdit({ ...edit, severity: e.target.value })}>
                  <option value="alta">alta</option>
                  <option value="media">média</option>
                  <option value="baixa">baixa</option>
                </select>
              </Field>
              <label className="flex items-center gap-2 pt-6 text-sm">
                <input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> ativa
              </label>
              {err ? <div className="md:col-span-2"><ErrorBox error={err} /></div> : null}
              <div className="flex justify-end gap-2 md:col-span-2">
                <button className="btn-ghost" onClick={() => setEdit(null)}>
                  Cancelar
                </button>
                <button className="btn-primary" onClick={save}>
                  Salvar regra
                </button>
              </div>
            </div>
          )}
          <div className="mt-4">
            <Notice>Para “mudança de frequência”, sem datas informadas o período observado é dividido ao meio. Datas no formato AAAA-MM-DDTHH:MM:SS.</Notice>
          </div>
        </>
      )}
    </Modal>
  )
}
