import { useQuery } from '@tanstack/react-query'
import { Pencil, Plus, Target as TargetIcon, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { useCase } from '../../app/layout'
import { Badge, DrillLink, Empty, ErrorBox, Field, Modal, Notice, PageHeader } from '../../components/ui'
import { useSession } from '../../engine/session'
import { deleteTarget, eventsPerTarget, saveTarget } from '../../engine/targets'
import { fmtDate, fmtInt, fmtNumber } from '../../lib/format'

const EMPTY = { number_original: '', operator: '', internal_id: '', label: '', period_start: '', period_end: '', source: '', notes: '', validation_status: 'pendente' }

export default function Targets() {
  const { c, canWrite } = useCase()
  const targets = useSession((s) => s.targets)
  const counts = useQuery({ queryKey: ['targets-events', c.id], queryFn: eventsPerTarget })
  const [edit, setEdit] = useState<any | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const save = async () => {
    setErr(null)
    const body: any = { ...edit }
    for (const k of Object.keys(body)) if (body[k] === '') body[k] = null
    body.number_original = edit.number_original
    body.validation_status = edit.validation_status || 'pendente'
    try {
      const warnings = await saveTarget(body)
      warnings.forEach((w: string) => toast.warning(w))
      toast.success('Alvo registrado na sessão')
      setEdit(null)
    } catch (e) {
      setErr(e)
    }
  }
  return (
    <div>
      <PageHeader
        icon={<TargetIcon className="h-5 w-5" />}
        title="Alvos da análise"
        subtitle="Números abrangidos pela autorização. A operadora informada é registrada como recebida: o sistema não deduz a operadora pelo prefixo, por causa da portabilidade numérica."
        actions={
          canWrite && (
            <button className="btn-primary" onClick={() => setEdit({ ...EMPTY })}>
              <Plus className="h-4 w-4" /> Informar alvo
            </button>
          )
        }
      />
      {targets.length === 0 ? (
        <Empty title="Nenhum alvo informado">Informe os números autorizados antes de carregar as bilhetagens.</Empty>
      ) : (
        <div className="card scroll-x">
          <table>
            <thead>
              <tr>
                <th>Número normalizado</th>
                <th>Original</th>
                <th>Identificação</th>
                <th>Operadora informada</th>
                <th>Período pertinente</th>
                <th>Fonte</th>
                <th>Validação</th>
                <th className="text-right">Registros</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {targets.map((t: any) => (
                <tr key={t.id}>
                  <td className="font-mono">{fmtNumber(t.number_normalized)}</td>
                  <td className="text-xs text-muted">{t.number_original}</td>
                  <td>
                    {t.internal_id && <span className="font-mono text-xs text-accent">{t.internal_id} </span>}
                    {t.label}
                  </td>
                  <td>{t.operator ?? '—'}</td>
                  <td className="text-xs">{t.period_start ? `${fmtDate(t.period_start)} a ${fmtDate(t.period_end)}` : 'período da análise'}</td>
                  <td className="text-xs text-muted">{t.source ?? '—'}</td>
                  <td>
                    <Badge tone={t.validation_status === 'validado' ? 'green' : 'amber'}>{t.validation_status}</Badge>
                  </td>
                  <td className="text-right tabular-nums">
                    <DrillLink caseId={c.id} filter={{ targets: [t.number_normalized] }}>
                      {fmtInt(counts.data?.[t.number_normalized] ?? 0)}
                    </DrillLink>
                  </td>
                  <td className="whitespace-nowrap">
                    {canWrite && (
                      <>
                        <button className="p-1 text-muted hover:text-text" onClick={() => setEdit({ ...EMPTY, ...Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v ?? ''])) })} aria-label="Editar">
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          className="p-1 text-muted hover:text-danger"
                          aria-label="Remover"
                          onClick={async () => {
                            if (!confirm('Remover este alvo? Os registros importados não são apagados.')) return
                            await deleteTarget(t.id)
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Editar alvo' : 'Informar alvo'}>
        {edit && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Número (como recebido) *" className="sm:col-span-2" hint={edit.number_original ? `Será tratado como: ${fmtNumber(normalizePreview(edit.number_original))}` : 'Inclua o DDD.'}>
              <input className="w-full font-mono" value={edit.number_original} onChange={(e) => setEdit({ ...edit, number_original: e.target.value })} />
            </Field>
            <Field label="Operadora informada">
              <select className="w-full" value={edit.operator} onChange={(e) => setEdit({ ...edit, operator: e.target.value })}>
                <option value="">não informada</option>
                {['TIM', 'VIVO', 'CLARO', 'OI', 'ALGAR', 'OUTRA'].map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </Field>
            <Field label="Identificador interno">
              <input className="w-full" value={edit.internal_id} onChange={(e) => setEdit({ ...edit, internal_id: e.target.value })} />
            </Field>
            <Field label="Nome ou descrição (quando autorizado)" className="sm:col-span-2">
              <input className="w-full" value={edit.label} onChange={(e) => setEdit({ ...edit, label: e.target.value })} />
            </Field>
            <Field label="Início do período pertinente">
              <input type="date" className="w-full" value={edit.period_start} onChange={(e) => setEdit({ ...edit, period_start: e.target.value })} />
            </Field>
            <Field label="Fim do período pertinente">
              <input type="date" className="w-full" value={edit.period_end} onChange={(e) => setEdit({ ...edit, period_end: e.target.value })} />
            </Field>
            <Field label="Fonte da informação">
              <input className="w-full" value={edit.source} onChange={(e) => setEdit({ ...edit, source: e.target.value })} />
            </Field>
            <Field label="Status da validação">
              <select className="w-full" value={edit.validation_status} onChange={(e) => setEdit({ ...edit, validation_status: e.target.value })}>
                <option value="pendente">pendente</option>
                <option value="validado">validado</option>
                <option value="divergente">divergente</option>
              </select>
            </Field>
            <Field label="Observações" className="sm:col-span-2">
              <textarea className="w-full" rows={2} value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} />
            </Field>
            {c.period_start && (
              <div className="sm:col-span-2">
                <Notice>
                  Período autorizado da análise: {fmtDate(c.period_start)} a {fmtDate(c.period_end)}. Períodos maiores geram aviso e não ampliam o escopo.
                </Notice>
              </div>
            )}
            {err ? <div className="sm:col-span-2"><ErrorBox error={err} /></div> : null}
            <div className="flex justify-end gap-2 sm:col-span-2">
              <button className="btn-ghost" onClick={() => setEdit(null)}>
                Cancelar
              </button>
              <button className="btn-primary" onClick={save}>
                Salvar
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

function normalizePreview(raw: string): string {
  const d = raw.replace(/\D/g, '')
  if (raw.trim().startsWith('+')) return '+' + d
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) return '+' + d
  if (d.startsWith('0') && (d.length === 11 || d.length === 12)) return '+55' + d.slice(1)
  if (d.length === 10 || d.length === 11) return '+55' + d
  return d
}
