import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Plus, Users as UsersIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../api/client'
import { ROLE_LABEL, useAuth } from '../../app/auth'
import { Badge, ErrorBox, Field, Loading, Modal, Notice, PageHeader } from '../../components/ui'
import { fmtDateTime } from '../../lib/format'

function LinkBox({ link }: { link: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-ink-2 p-2">
      <code className="flex-1 text-xs break-all">{link}</code>
      <button className="btn-ghost !p-2" onClick={() => navigator.clipboard.writeText(link).then(() => toast.success('Link copiado'))} aria-label="Copiar link">
        <Copy className="h-4 w-4" />
      </button>
    </div>
  )
}

export default function AdminUsers() {
  const { me } = useAuth()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['admin-users'], queryFn: () => api<any[]>('/admin/users'), enabled: me?.role === 'admin' })
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ email: '', name: '', role: 'analyst', admin_content_access: false })
  const [link, setLink] = useState<string | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: number; body: any }) => api(`/admin/users/${id}`, { method: 'PATCH', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
    onError: (e: any) => toast.error(e.message),
  })
  const action = async (id: number, path: string) => {
    try {
      const r = await api(`/admin/users/${id}/${path}`, { method: 'POST' })
      if (r.link) setLink(r.link)
      else toast.success('Feito')
      qc.invalidateQueries({ queryKey: ['admin-users'] })
    } catch (e: any) {
      toast.error(e.message)
    }
  }
  if (me?.role !== 'admin') return <ErrorBox error="Acesso restrito a administradores." />
  return (
    <div>
      <PageHeader
        icon={<UsersIcon className="h-5 w-5" />}
        title="Usuários e permissões"
        subtitle="Perfis globais limitam o que cada pessoa pode fazer; o acesso ao conteúdo de um caso depende de ser membro dele. Administradores não veem casos automaticamente, salvo quando a opção de acesso ao conteúdo estiver marcada."
        actions={
          <button className="btn-primary" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> Novo usuário
          </button>
        }
      />
      {link && (
        <div className="mb-4 space-y-2">
          <Notice tone="amber" title="Link de definição de senha">
            Entregue por canal seguro. Ele é de uso único e expira. Não é exibido novamente.
          </Notice>
          <LinkBox link={link} />
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
                <th>Perfil</th>
                <th>Situação</th>
                <th>MFA</th>
                <th>Último acesso</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {q.data!.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td className="text-xs">{u.email}</td>
                  <td>
                    <select value={u.role} disabled={u.id === me.id} onChange={(e) => patch.mutate({ id: u.id, body: { role: e.target.value } })}>
                      {Object.entries(ROLE_LABEL).map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                    </select>
                    {u.role === 'admin' && (
                      <label className="mt-1 flex items-center gap-1 text-xs text-muted">
                        <input type="checkbox" checked={u.admin_content_access} onChange={(e) => patch.mutate({ id: u.id, body: { admin_content_access: e.target.checked } })} /> acesso ao conteúdo dos casos
                      </label>
                    )}
                  </td>
                  <td>
                    {u.locked ? <Badge tone="red">bloqueado</Badge> : u.is_active ? <Badge tone="green">ativo</Badge> : <Badge>inativo</Badge>}
                    {u.must_change_password && <Badge tone="amber" className="ml-1">senha pendente</Badge>}
                  </td>
                  <td>{u.mfa_enabled ? <Badge tone="green">ativa</Badge> : <Badge>—</Badge>}</td>
                  <td className="text-xs">{fmtDateTime(u.last_login_at?.slice(0, 19))}</td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => action(u.id, 'reset-link')}>
                        Link de senha
                      </button>
                      {u.locked && (
                        <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => action(u.id, 'unlock')}>
                          Desbloquear
                        </button>
                      )}
                      <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => action(u.id, 'revoke-sessions')}>
                        Encerrar sessões
                      </button>
                      {u.id !== me.id && (
                        <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => patch.mutate({ id: u.id, body: { is_active: !u.is_active } })}>
                          {u.is_active ? 'Desativar' : 'Reativar'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Novo usuário">
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault()
            setErr(null)
            try {
              const r = await api('/admin/users', { body: form })
              setLink(r.activation_link)
              setOpen(false)
              setForm({ email: '', name: '', role: 'analyst', admin_content_access: false })
              qc.invalidateQueries({ queryKey: ['admin-users'] })
            } catch (e) {
              setErr(e)
            }
          }}
        >
          <Field label="Nome">
            <input className="w-full" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="E-mail">
            <input className="w-full" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Perfil">
            <select className="w-full" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {Object.entries(ROLE_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          {err ? <ErrorBox error={err} /> : null}
          <button className="btn-primary w-full">Criar e gerar link de ativação</button>
        </form>
      </Modal>
    </div>
  )
}
