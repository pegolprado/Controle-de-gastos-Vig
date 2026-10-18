import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2, UserPlus, Users } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../api/client'
import { ROLE_LABEL } from '../../app/auth'
import { useCase } from '../../app/layout'
import { Badge, ErrorBox, Loading, Notice, PageHeader } from '../../components/ui'

export default function Members() {
  const { c, canWrite } = useCase()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['members', c.id], queryFn: () => api<any[]>(`/cases/${c.id}/members`) })
  const dir = useQuery({ queryKey: ['directory'], queryFn: () => api<any[]>('/users/directory'), enabled: canWrite })
  const [uid, setUid] = useState('')
  const [role, setRole] = useState('viewer')
  const [exp, setExp] = useState(false)
  const set = async (user_id: number, r: string, can_export: boolean) => {
    try {
      await api(`/cases/${c.id}/members`, { body: { user_id, role: r, can_export } })
      qc.invalidateQueries({ queryKey: ['members', c.id] })
      toast.success('Permissão atualizada')
    } catch (e: any) {
      toast.error(e.message)
    }
  }
  return (
    <div>
      <PageHeader icon={<Users className="h-5 w-5" />} title="Membros e permissões do caso" subtitle="Somente membros acessam o caso. O papel no caso é limitado pelo perfil global (um usuário de Consulta nunca altera dados). Exportação exige permissão específica." />
      <div className="mb-4">
        <Notice>
          <b>Analista</b>: importa, analisa e gera relatórios · <b>Revisor</b>: confere, comenta e aprova relatórios · <b>Consulta</b>: apenas visualiza.
        </Notice>
      </div>
      {canWrite && (
        <div className="card mb-4 flex flex-wrap items-end gap-3 p-4">
          <label className="min-w-64 flex-1">
            <span className="label">Usuário</span>
            <select className="w-full" value={uid} onChange={(e) => setUid(e.target.value)}>
              <option value="">Selecione…</option>
              {(dir.data ?? [])
                .filter((u) => !(q.data ?? []).some((m) => m.user_id === u.id))
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} — {u.email} ({ROLE_LABEL[u.role]})
                  </option>
                ))}
            </select>
          </label>
          <label>
            <span className="label">Papel no caso</span>
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="analyst">Analista</option>
              <option value="reviewer">Revisor</option>
              <option value="viewer">Consulta</option>
            </select>
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input type="checkbox" checked={exp} onChange={(e) => setExp(e.target.checked)} /> pode exportar
          </label>
          <button className="btn-primary" disabled={!uid} onClick={() => set(+uid, role, exp).then(() => setUid(''))}>
            <UserPlus className="h-4 w-4" /> Adicionar
          </button>
        </div>
      )}
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : (
        <div className="card scroll-x">
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>E-mail</th>
                <th>Perfil global</th>
                <th>Papel no caso</th>
                <th>Exportação</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {q.data!.map((m) => (
                <tr key={m.user_id}>
                  <td>{m.name}</td>
                  <td className="text-xs">{m.email}</td>
                  <td>
                    <Badge>{ROLE_LABEL[m.global_role]}</Badge>
                  </td>
                  <td>
                    {canWrite ? (
                      <select value={m.role} onChange={(e) => set(m.user_id, e.target.value, m.can_export)}>
                        <option value="analyst">Analista</option>
                        <option value="reviewer">Revisor</option>
                        <option value="viewer">Consulta</option>
                      </select>
                    ) : (
                      ROLE_LABEL[m.role]
                    )}
                  </td>
                  <td>{canWrite ? <input type="checkbox" checked={m.can_export} onChange={(e) => set(m.user_id, m.role, e.target.checked)} /> : m.can_export ? 'sim' : 'não'}</td>
                  <td>
                    {canWrite && (
                      <button
                        className="p-1 text-muted hover:text-danger"
                        aria-label="Remover membro"
                        onClick={async () => {
                          try {
                            await api(`/cases/${c.id}/members/${m.user_id}`, { method: 'DELETE' })
                            qc.invalidateQueries({ queryKey: ['members', c.id] })
                          } catch (e: any) {
                            toast.error(e.message)
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
