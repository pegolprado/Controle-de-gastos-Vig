import { useQuery } from '@tanstack/react-query'
import { Server } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../../api/client'
import { useAuth } from '../../app/auth'
import { Badge, ErrorBox, Loading, PageHeader, Progress, Stat } from '../../components/ui'
import { fmtBytes, fmtDateTime, fmtInt } from '../../lib/format'

export default function AdminOps() {
  const { me } = useAuth()
  const q = useQuery({ queryKey: ['admin-status'], queryFn: () => api('/admin/status'), refetchInterval: 5000, enabled: me?.role === 'admin' })
  const jobs = useQuery({ queryKey: ['admin-jobs'], queryFn: () => api<any[]>('/admin/jobs?size=30'), refetchInterval: 5000, enabled: me?.role === 'admin' })
  if (me?.role !== 'admin') return <ErrorBox error="Acesso restrito a administradores." />
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  const s = q.data
  return (
    <div>
      <PageHeader
        icon={<Server className="h-5 w-5" />}
        title="Monitoramento operacional"
        subtitle={`Versão ${s.app_version} · regras ${s.rules_version} · ambiente ${s.env} · worker ${s.embedded_worker ? 'embutido na API' : 'processo dedicado'}`}
        actions={
          <button
            className="btn-ghost"
            onClick={async () => {
              const r = await api<any[]>('/admin/retention/apply', { method: 'POST' })
              toast.message(r.length ? `${r.length} casos com retenção vencida: ${r.map((c) => c.code).join(', ')}` : 'Nenhum caso com retenção vencida')
            }}
          >
            Verificar retenção
          </button>
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Banco de dados" value={fmtBytes(s.database_bytes)} hint={`${fmtInt(s.counts.events)} registros normalizados`} />
        <Stat label="Armazenamento de arquivos" value={fmtBytes(s.storage_bytes)} hint={`${fmtInt(s.counts.files)} arquivos`} />
        <Stat label="Casos / usuários" value={`${fmtInt(s.counts.cases)} / ${fmtInt(s.counts.users)}`} hint={`${fmtInt(s.counts.reports)} relatórios`} />
        <Stat
          label="Fila de tarefas"
          value={`${s.jobs.queued ?? 0} na fila`}
          hint={`${s.jobs.running ?? 0} em execução · ${s.jobs.failed ?? 0} falhas · último sinal ${s.worker_last_heartbeat ? fmtDateTime(s.worker_last_heartbeat.slice(0, 19)) : '—'}`}
          tone={(s.jobs.failed ?? 0) > 0 ? 'amber' : undefined}
        />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-4">
          <h2 className="section-title mb-3 text-muted">Tarefas recentes</h2>
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Tipo</th>
                  <th>Caso</th>
                  <th>Situação</th>
                  <th>Progresso</th>
                </tr>
              </thead>
              <tbody>
                {(jobs.data ?? []).map((j) => (
                  <tr key={j.id}>
                    <td className="font-mono text-xs">{j.id}</td>
                    <td className="text-xs">{j.type}</td>
                    <td className="font-mono text-xs">{j.case_id ?? '—'}</td>
                    <td>
                      <Badge tone={j.status === 'done' ? 'green' : j.status === 'failed' ? 'red' : j.status === 'running' ? 'blue' : 'gray'}>{j.status}</Badge>
                      {j.message && <div className="mt-1 max-w-xs text-xs break-words text-faint">{j.message}</div>}
                    </td>
                    <td className="w-32">
                      <Progress value={j.progress} tone={j.status === 'failed' ? 'red' : 'blue'} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="card p-4">
          <h2 className="section-title mb-3 text-muted">Maiores tabelas</h2>
          <table>
            <tbody>
              {s.largest_tables.map((t: any) => (
                <tr key={t.relname}>
                  <td className="font-mono text-xs">{t.relname}</td>
                  <td className="text-right text-xs">{fmtBytes(t.bytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h2 className="section-title mt-6 mb-3 text-muted">Limites configurados</h2>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-muted">Upload máximo</dt>
            <dd>{s.limits.max_upload_mb} MB</dd>
            <dt className="text-muted">Linhas por importação</dt>
            <dd>{fmtInt(s.limits.max_rows_per_import)}</dd>
            <dt className="text-muted">Sessão / inatividade</dt>
            <dd>
              {s.limits.session_minutes} / {s.limits.idle_minutes} min
            </dd>
          </dl>
          {s.recent_failures.length > 0 && (
            <>
              <h2 className="section-title mt-6 mb-3 text-danger">Falhas recentes</h2>
              {s.recent_failures.map((f: any) => (
                <div key={f.id} className="mb-2 text-xs text-muted">
                  #{f.id} {f.type}: {f.message}
                </div>
              ))}
            </>
          )}
        </section>
      </div>
    </div>
  )
}
