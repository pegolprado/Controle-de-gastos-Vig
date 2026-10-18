import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ListChecks, XCircle } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { api } from '../../api/client'
import { useCase } from '../../app/layout'
import { Badge, DrillLink, Empty, ErrorBox, Loading, PageHeader, Pagination, Progress } from '../../components/ui'
import { fmtDateTime, fmtInt } from '../../lib/format'

const TONE: Record<string, any> = { done: 'green', running: 'blue', queued: 'blue', failed: 'red', cancelled: 'gray', draft: 'gray', superseded: 'gray' }
const LABEL: Record<string, string> = { done: 'concluída', running: 'processando', queued: 'na fila', failed: 'falhou', cancelled: 'cancelada', draft: 'rascunho', superseded: 'descartada' }

export default function Imports() {
  const { c, canWrite } = useCase()
  const qc = useQueryClient()
  const [sp, setSp] = useSearchParams()
  const sel = sp.get('i')
  const q = useQuery({
    queryKey: ['imports', c.id],
    queryFn: () => api<any[]>(`/cases/${c.id}/imports`),
    refetchInterval: (q) => ((q.state.data ?? []).some((i: any) => ['queued', 'running'].includes(i.status)) ? 1500 : false),
  })
  return (
    <div>
      <PageHeader icon={<ListChecks className="h-5 w-5" />} title="Importações e processamento" subtitle="Histórico de cada processamento: mapeamento usado, versão das regras, contagens e ocorrências por linha. Reprocessar cria nova importação; a anterior pode ser descartada sem afetar o arquivo original." />
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : q.data!.length === 0 ? (
        <Empty title="Nenhuma importação">Envie um arquivo em “Arquivos” e siga o assistente.</Empty>
      ) : (
        <div className="card scroll-x">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Arquivo</th>
                <th>Tipo</th>
                <th>Situação</th>
                <th className="text-right">Lidas</th>
                <th className="text-right">Aceitas</th>
                <th className="text-right">Rejeitadas</th>
                <th className="text-right">Duplic.</th>
                <th className="text-right">Fora período</th>
                <th>Regras</th>
                <th>Criada</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {q.data!.map((i) => (
                <tr key={i.id} className={String(i.id) === sel ? 'bg-accent/5' : ''}>
                  <td className="font-mono text-xs">{i.id}</td>
                  <td className="max-w-56 text-xs break-all">{i.file_name}</td>
                  <td className="text-xs">{i.kind === 'cdr' ? 'eventos' : 'cadastro ERB'}</td>
                  <td className="min-w-36">
                    <Badge tone={TONE[i.status]}>{LABEL[i.status] ?? i.status}</Badge>
                    {i.job && ['queued', 'running'].includes(i.job.status) && (
                      <div className="mt-1.5">
                        <Progress value={i.job.progress} />
                        <div className="mt-0.5 text-[11px] text-faint">{i.job.message}</div>
                      </div>
                    )}
                    {i.status === 'failed' && <div className="mt-1 text-xs text-danger">{i.summary?.error ?? i.job?.message}</div>}
                  </td>
                  <td className="text-right tabular-nums">{fmtInt(i.rows_total)}</td>
                  <td className="text-right tabular-nums">
                    {i.kind === 'cdr' && i.status === 'done' ? (
                      <DrillLink caseId={c.id} filter={{ file_ids: [i.file_id] }}>
                        {fmtInt(i.rows_ok)}
                      </DrillLink>
                    ) : (
                      fmtInt(i.rows_ok)
                    )}
                  </td>
                  <td className={`text-right tabular-nums ${i.rows_error ? 'text-danger' : ''}`}>{fmtInt(i.rows_error)}</td>
                  <td className="text-right tabular-nums">{fmtInt(i.rows_duplicate)}</td>
                  <td className="text-right tabular-nums">{fmtInt(i.rows_out_of_scope)}</td>
                  <td className="font-mono text-xs">{i.rules_version}</td>
                  <td className="text-xs whitespace-nowrap">{fmtDateTime(i.created_at?.slice(0, 19), false)}</td>
                  <td className="whitespace-nowrap">
                    <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setSp({ i: String(i.id) })}>
                      Detalhes
                    </button>
                    {canWrite && i.job && ['queued', 'running'].includes(i.job.status) && (
                      <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => api(`/cases/${c.id}/jobs/${i.job.id}/cancel`, { method: 'POST' }).then(() => qc.invalidateQueries({ queryKey: ['imports', c.id] }))}>
                        <XCircle className="h-3.5 w-3.5" /> Cancelar
                      </button>
                    )}
                    {canWrite && ['done', 'failed', 'cancelled'].includes(i.status) && (
                      <button
                        className="btn-ghost !px-2 !py-1 text-xs hover:!text-danger"
                        onClick={async () => {
                          if (!confirm('Descartar os registros desta importação? O arquivo original é mantido.')) return
                          const r = await api(`/cases/${c.id}/imports/${i.id}/discard`, { method: 'POST' })
                          toast.success(`${r.events_removed} registros removidos`)
                          qc.invalidateQueries()
                        }}
                      >
                        Descartar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {sel && <ImportDetail importId={+sel} />}
    </div>
  )
}

function ImportDetail({ importId }: { importId: number }) {
  const { c } = useCase()
  const [page, setPage] = useState(1)
  const [sev, setSev] = useState('')
  const imp = useQuery({ queryKey: ['import', importId], queryFn: () => api(`/cases/${c.id}/imports/${importId}`) })
  const issues = useQuery({ queryKey: ['issues', importId, page, sev], queryFn: () => api(`/cases/${c.id}/imports/${importId}/issues?page=${page}&size=100${sev ? `&severity=${sev}` : ''}`) })
  if (!imp.data) return <Loading />
  const i = imp.data
  return (
    <div className="mt-6 grid gap-4 lg:grid-cols-[360px_1fr]">
      <div className="card space-y-3 p-4 text-sm">
        <div className="label">Importação #{i.id}</div>
        <div>
          <span className="text-muted">Mapeamento:</span>
          <ul className="mt-1 space-y-0.5 font-mono text-xs">
            {Object.entries(i.mapping).map(([k, v]) => (
              <li key={k}>
                {k} ← <span className="text-teal">“{String(v)}”</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <span className="text-muted">Opções:</span>
          <pre className="mt-1 overflow-auto font-mono text-[11px] whitespace-pre-wrap text-faint">{JSON.stringify(Object.fromEntries(Object.entries(i.options).filter(([k]) => !k.startsWith('_'))), null, 1)}</pre>
        </div>
        {i.summary?.dedup_rule && (
          <div className="text-xs text-faint">
            Regra de duplicidade: {i.summary.dedup_rule}. Período dos registros: {fmtDateTime(i.summary.period?.[0])} a {fmtDateTime(i.summary.period?.[1])}.
          </div>
        )}
        {i.summary?.issues?.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {i.summary.issues.map((x: any) => (
              <Badge key={x.code + x.severity} tone={x.severity === 'error' ? 'red' : 'amber'}>
                {x.code}: {x.count}
              </Badge>
            ))}
          </div>
        )}
      </div>
      <div className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="label !mb-0">Ocorrências por linha</div>
          <select value={sev} onChange={(e) => (setSev(e.target.value), setPage(1))}>
            <option value="">todas</option>
            <option value="error">erros</option>
            <option value="warning">avisos</option>
          </select>
        </div>
        {issues.data && (
          <>
            <div className="max-h-[480px] overflow-auto">
              <table>
                <thead>
                  <tr>
                    <th>Linha</th>
                    <th>Gravidade</th>
                    <th>Código</th>
                    <th>Campo</th>
                    <th>Mensagem</th>
                  </tr>
                </thead>
                <tbody>
                  {issues.data.items.map((x: any, n: number) => (
                    <tr key={n}>
                      <td className="font-mono text-xs">
                        {x.row}
                        {x.page ? ` p.${x.page}` : ''}
                      </td>
                      <td>
                        <Badge tone={x.severity === 'error' ? 'red' : 'amber'}>{x.severity === 'error' ? 'erro' : 'aviso'}</Badge>
                      </td>
                      <td className="font-mono text-xs">{x.code}</td>
                      <td className="font-mono text-xs">{x.field}</td>
                      <td className="text-xs">
                        {x.message}
                        {x.raw && <div className="mt-1 font-mono text-[11px] text-faint">{JSON.stringify(x.raw)}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} size={100} total={issues.data.total} onPage={setPage} />
          </>
        )}
      </div>
    </div>
  )
}
