import { useQuery } from '@tanstack/react-query'
import { Activity, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { api } from '../api/client'
import { useAuth } from '../app/auth'
import { Badge, ErrorBox, Loading, PageHeader, Pagination } from '../components/ui'
import { fmtDateTime } from '../lib/format'

export default function Audit() {
  const { me } = useAuth()
  const [page, setPage] = useState(1)
  const [action, setAction] = useState('')
  const [caseId, setCaseId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const params = new URLSearchParams({ page: String(page), size: '50' })
  if (action) params.set('action', action)
  if (caseId) params.set('case_id', caseId)
  if (from) params.set('date_from', from)
  if (to) params.set('date_to', to)
  const q = useQuery({ queryKey: ['audit', params.toString()], queryFn: () => api(`/audit?${params}`) })
  const verify = useQuery({ queryKey: ['audit-verify'], queryFn: () => api('/audit/verify'), enabled: false })
  return (
    <div>
      <PageHeader
        icon={<Activity className="h-5 w-5" />}
        title="Auditoria"
        subtitle={
          me?.role === 'admin'
            ? 'Trilha completa de operações. Cada linha guarda o hash da anterior: qualquer alteração ou remoção quebra a cadeia e é detectada na verificação.'
            : 'Operações registradas nos casos de que você participa.'
        }
        actions={
          me?.role === 'admin' && (
            <button className="btn-ghost" onClick={() => verify.refetch()}>
              <ShieldCheck className="h-4 w-4" /> Verificar integridade da trilha
            </button>
          )
        }
      />
      {verify.data && (
        <div className={`mb-4 rounded-xl border p-3 text-sm ${verify.data.ok ? 'border-ok/40 bg-ok/10 text-ok' : 'border-danger/40 bg-danger/10 text-danger'}`}>
          {verify.data.ok ? `Cadeia íntegra: ${verify.data.checked} registros verificados.` : `Cadeia rompida no registro #${verify.data.broken_at}. Investigue imediatamente.`}
        </div>
      )}
      <div className="card mb-4 flex flex-wrap gap-3 p-4">
        <input placeholder="Ação (ex.: exportados, login)" value={action} onChange={(e) => (setAction(e.target.value), setPage(1))} />
        <input placeholder="ID do caso" className="w-28" value={caseId} onChange={(e) => (setCaseId(e.target.value.replace(/\D/g, '')), setPage(1))} />
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="De" />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Até" />
      </div>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : (
        <div className="card scroll-x">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Data/hora (UTC)</th>
                <th>Usuário</th>
                <th>Ação</th>
                <th>Caso</th>
                <th>Objeto</th>
                <th>IP</th>
                <th>Detalhes</th>
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((a: any) => (
                <tr key={a.id}>
                  <td className="font-mono text-xs text-faint">{a.id}</td>
                  <td className="text-xs whitespace-nowrap">{fmtDateTime(a.ts.slice(0, 19))}</td>
                  <td className="text-xs">{a.user_email ?? <span className="text-faint">anônimo</span>}</td>
                  <td>
                    <Badge tone={a.action.includes('falhou') || a.action.includes('bloqueio') || a.action.includes('excluid') ? 'red' : a.action.includes('export') || a.action.includes('baixado') ? 'amber' : 'blue'}>{a.action}</Badge>
                  </td>
                  <td className="font-mono text-xs">{a.case_id ?? '—'}</td>
                  <td className="text-xs">{a.entity ? `${a.entity} ${a.entity_id ?? ''}` : '—'}</td>
                  <td className="font-mono text-xs text-faint">{a.ip ?? '—'}</td>
                  <td className="max-w-md font-mono text-[11px] break-all text-muted">{Object.keys(a.details ?? {}).length ? JSON.stringify(a.details) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-3 pb-3">
            <Pagination page={page} size={50} total={q.data.total} onPage={setPage} />
          </div>
        </div>
      )}
    </div>
  )
}
