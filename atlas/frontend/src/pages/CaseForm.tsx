import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FolderKanban, Trash2 } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { api } from '../api/client'
import { ErrorBox, Field, Loading, Modal, Notice, PageHeader } from '../components/ui'
import { STATUS_LABEL } from './Cases'

const EMPTY = {
  title: '',
  process_number: '',
  unit: '',
  responsible_user_id: null as number | null,
  period_start: '',
  period_end: '',
  description: '',
  status: 'aberto',
  access_level: 'restrito',
  authorized_docs: '',
  notes: '',
  require_justification: false,
  retention_until: '',
}

export default function CaseForm() {
  const { caseId } = useParams()
  const editing = !!caseId
  const existing = useQuery({ queryKey: ['case', caseId], queryFn: () => api(`/cases/${caseId}`), enabled: editing })
  const users = useQuery({ queryKey: ['directory'], queryFn: () => api<any[]>('/users/directory') })
  if (editing && existing.isLoading) return <Loading />
  return <Form key={existing.data?.id ?? 'novo'} initial={existing.data ?? EMPTY} caseId={caseId} users={users.data ?? []} />
}

function Form({ initial, caseId, users }: { initial: any; caseId?: string; users: any[] }) {
  const [v, setV] = useState({ ...EMPTY, ...Object.fromEntries(Object.entries(initial).map(([k, x]) => [k, x ?? (typeof (EMPTY as any)[k] === 'string' ? '' : x)])) })
  const [err, setErr] = useState<unknown>(null)
  const [del, setDel] = useState(false)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const set = (k: string, x: any) => setV((s: any) => ({ ...s, [k]: x }))
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr(null)
    const body: any = { ...v }
    for (const k of ['period_start', 'period_end', 'retention_until', 'process_number', 'unit', 'description', 'authorized_docs', 'notes']) if (body[k] === '') body[k] = null
    const allowed = Object.keys(EMPTY)
    const payload = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)))
    try {
      const r = caseId ? await api(`/cases/${caseId}`, { method: 'PUT', body: payload }) : await api('/cases', { body: payload })
      qc.invalidateQueries()
      toast.success(caseId ? 'Caso atualizado' : `Caso ${r.code} criado`)
      navigate(`/casos/${r.id}${caseId ? '' : '/alvos'}`)
    } catch (e) {
      setErr(e)
    }
  }
  return (
    <div>
      {!caseId && <PageHeader icon={<FolderKanban className="h-5 w-5" />} title="Novo caso" subtitle="Defina o período e o escopo autorizados. O sistema avisa quando arquivos ou consultas excederem esses limites — o aviso nunca amplia o escopo." />}
      <form onSubmit={submit} className="card grid gap-4 p-6 md:grid-cols-2">
        <Field label="Título do caso *" className="md:col-span-2">
          <input className="w-full" required minLength={3} value={v.title} onChange={(e) => set('title', e.target.value)} />
        </Field>
        <Field label="Número de referência processual">
          <input className="w-full" value={v.process_number} onChange={(e) => set('process_number', e.target.value)} />
        </Field>
        <Field label="Unidade ou setor responsável">
          <input className="w-full" value={v.unit} onChange={(e) => set('unit', e.target.value)} />
        </Field>
        <Field label="Analista responsável">
          <select className="w-full" value={v.responsible_user_id ?? ''} onChange={(e) => set('responsible_user_id', e.target.value ? +e.target.value : null)}>
            <option value="">(quem cria o caso)</option>
            {users.filter((u) => u.role !== 'viewer').map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} — {u.email}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Situação">
          <select className="w-full" value={v.status} onChange={(e) => set('status', e.target.value)}>
            {Object.entries(STATUS_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Início do período autorizado">
          <input type="date" className="w-full" value={v.period_start ?? ''} onChange={(e) => set('period_start', e.target.value)} />
        </Field>
        <Field label="Fim do período autorizado">
          <input type="date" className="w-full" value={v.period_end ?? ''} onChange={(e) => set('period_end', e.target.value)} />
        </Field>
        <Field label="Nível de acesso">
          <select className="w-full" value={v.access_level} onChange={(e) => set('access_level', e.target.value)}>
            <option value="restrito">Restrito (somente membros)</option>
            <option value="sigiloso">Sigiloso</option>
          </select>
        </Field>
        <Field label="Retenção até" hint="Após a data, o caso aparece na verificação de retenção do administrador.">
          <input type="date" className="w-full" value={v.retention_until ?? ''} onChange={(e) => set('retention_until', e.target.value)} />
        </Field>
        <Field label="Documentos de referência autorizados" className="md:col-span-2">
          <textarea className="w-full" rows={2} value={v.authorized_docs} onChange={(e) => set('authorized_docs', e.target.value)} />
        </Field>
        <Field label="Descrição" className="md:col-span-2">
          <textarea className="w-full" rows={3} value={v.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
        <Field label="Observações técnicas" className="md:col-span-2">
          <textarea className="w-full" rows={2} value={v.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm md:col-span-2">
          <input type="checkbox" checked={v.require_justification} onChange={(e) => set('require_justification', e.target.checked)} />
          Exigir justificativa registrada para acessar o caso (vale por 12 horas por usuário)
        </label>
        {err ? <div className="md:col-span-2"><ErrorBox error={err} /></div> : null}
        <div className="flex flex-wrap justify-between gap-2 md:col-span-2">
          {caseId ? (
            <button type="button" className="btn-danger" onClick={() => setDel(true)}>
              <Trash2 className="h-4 w-4" /> Excluir caso
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button type="button" className="btn-ghost" onClick={() => navigate(-1)}>
              Cancelar
            </button>
            <button className="btn-primary">{caseId ? 'Salvar alterações' : 'Criar caso'}</button>
          </div>
        </div>
      </form>
      {caseId && <DeleteCase open={del} onClose={() => setDel(false)} caseId={caseId} code={initial.code} />}
    </div>
  )
}

function DeleteCase({ open, onClose, caseId, code }: { open: boolean; onClose: () => void; caseId: string; code: string }) {
  const [confirm, setConfirm] = useState('')
  const [reason, setReason] = useState('')
  const [err, setErr] = useState<unknown>(null)
  const navigate = useNavigate()
  const qc = useQueryClient()
  return (
    <Modal open={open} onClose={onClose} title="Excluir caso">
      <Notice tone="red">A exclusão remove definitivamente arquivos, registros, análises e relatórios deste caso. A operação fica registrada na auditoria.</Notice>
      <div className="mt-4 space-y-3">
        <Field label={`Digite o código do caso (${code})`}>
          <input className="w-full font-mono" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <Field label="Motivo / autorização da exclusão">
          <textarea className="w-full" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {err ? <ErrorBox error={err} /> : null}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="btn-danger"
            disabled={confirm !== code || reason.length < 10}
            onClick={async () => {
              try {
                await api(`/cases/${caseId}/delete`, { body: { confirm_code: confirm, reason } })
                qc.invalidateQueries()
                toast.success('Caso excluído')
                navigate('/casos')
              } catch (e) {
                setErr(e)
              }
            }}
          >
            Excluir definitivamente
          </button>
        </div>
      </div>
    </Modal>
  )
}
