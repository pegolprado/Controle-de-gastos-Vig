import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FileJson, FileText, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { api, download } from '../../api/client'
import { useAuth } from '../../app/auth'
import { useCase } from '../../app/layout'
import { type EventFilter, FilterBar } from '../../components/FilterBar'
import { Badge, Empty, ErrorBox, Field, Loading, Notice, PageHeader, Progress } from '../../components/ui'
import { fmtBytes, fmtDateTime } from '../../lib/format'

const TYPES: Record<string, string> = { cdr: 'Bilhetagem', erb: 'ERB', links: 'Vínculos', full: 'Completo' }
const SECTIONS: Record<string, [string, string][]> = {
  cdr: [['escopo', 'Identificação e escopo'], ['fontes', 'Arquivos utilizados'], ['metodologia', 'Metodologia de importação'], ['estatisticas', 'Estatísticas'], ['graficos', 'Gráficos'], ['contatos', 'Contatos frequentes'], ['eventos', 'Tabela de eventos'], ['limitacoes', 'Limitações'], ['rastreabilidade', 'Rastreabilidade']],
  erb: [['escopo', 'Identificação e escopo'], ['fontes', 'Arquivos utilizados'], ['cadastro', 'Cadastro técnico'], ['resolucao', 'Critérios de correspondência'], ['celulas', 'Eventos por célula'], ['mapa', 'Mapa esquemático'], ['sequencia', 'Sequência temporal'], ['inconsistencias', 'Inconsistências'], ['limitacoes', 'Limitações'], ['rastreabilidade', 'Rastreabilidade']],
  links: [['escopo', 'Identificação e escopo'], ['fontes', 'Arquivos utilizados'], ['vinculos', 'Relacionamentos'], ['grafo', 'Grafo de contatos'], ['contatos_comuns', 'Contatos em comum'], ['limitacoes', 'Limitações'], ['rastreabilidade', 'Rastreabilidade']],
}
SECTIONS.full = Array.from(new Map([...SECTIONS.cdr, ...SECTIONS.erb, ...SECTIONS.links]).entries())
const STATUS_TONE: Record<string, any> = { gerando: 'blue', rascunho: 'gray', em_revisao: 'amber', aprovado: 'green', devolvido: 'red', falhou: 'red' }

export default function Reports() {
  const { c, canWrite, canReview } = useCase()
  const { me } = useAuth()
  const qc = useQueryClient()
  const [type, setType] = useState('cdr')
  const [fmt, setFmt] = useState('pdf')
  const [title, setTitle] = useState('')
  const [filter, setFilter] = useState<EventFilter>({})
  const [sections, setSections] = useState<string[] | null>(null)
  const [maxEvents, setMaxEvents] = useState(2000)
  const q = useQuery({
    queryKey: ['reports', c.id],
    queryFn: () => api<any[]>(`/cases/${c.id}/reports`),
    refetchInterval: (q) => ((q.state.data ?? []).some((r: any) => r.status === 'gerando') ? 1500 : false),
  })
  const secs = sections ?? SECTIONS[type].map((s) => s[0])
  const generate = async () => {
    try {
      await api(`/cases/${c.id}/reports`, { body: { report_type: type, fmt, title: title || null, filter, options: { sections: secs, max_events: maxEvents } } })
      toast.success('Relatório em geração')
      qc.invalidateQueries({ queryKey: ['reports', c.id] })
    } catch (e: any) {
      toast.error(e.message)
    }
  }
  const act = async (id: number, action: string) => {
    const note = action === 'devolver' || action === 'comentar' ? prompt(action === 'devolver' ? 'Motivo da devolução:' : 'Comentário:') : undefined
    if ((action === 'devolver' || action === 'comentar') && !note) return
    try {
      await api(`/cases/${c.id}/reports/${id}/review`, { body: { action, note } })
      qc.invalidateQueries({ queryKey: ['reports', c.id] })
    } catch (e: any) {
      toast.error(e.message)
    }
  }
  return (
    <div>
      <PageHeader
        icon={<FileText className="h-5 w-5" />}
        title="Relatórios técnicos"
        subtitle="Relatórios congelados no momento da geração, com arquivos de entrada e seus hashes, filtros, versão das regras e hash do arquivo final. Correções posteriores não alteram relatórios emitidos."
      />
      {c.is_demo && <div className="mb-4"><Notice tone="amber">Relatórios deste caso levam a marca DEMONSTRAÇÃO.</Notice></div>}
      {canWrite && (
        <section className="card mb-6 p-5">
          <h2 className="section-title mb-4 text-accent">Gerar relatório</h2>
          <div className="grid gap-4 md:grid-cols-4">
            <Field label="Tipo">
              <select
                className="w-full"
                value={type}
                onChange={(e) => {
                  setType(e.target.value)
                  setSections(null)
                }}
              >
                {Object.entries(TYPES).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Formato">
              <select className="w-full" value={fmt} onChange={(e) => setFmt(e.target.value)}>
                <option value="pdf">PDF</option>
                <option value="xlsx">XLSX</option>
                <option value="csv">CSV</option>
                <option value="json">JSON técnico</option>
                <option value="html">HTML (consulta interna)</option>
              </select>
            </Field>
            <Field label="Título (opcional)" className="md:col-span-2">
              <input className="w-full" value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
          </div>
          <div className="mt-4">
            <span className="label">Seções e anexos</span>
            <div className="flex flex-wrap gap-2">
              {SECTIONS[type].map(([k, l]) => (
                <label key={k} className="chip cursor-pointer border-line !py-1.5 text-muted">
                  <input type="checkbox" checked={secs.includes(k)} onChange={() => setSections(secs.includes(k) ? secs.filter((x) => x !== k) : [...secs, k])} /> {l}
                </label>
              ))}
            </div>
          </div>
          {secs.includes('eventos') && (
            <Field label="Máximo de eventos na tabela do PDF" className="mt-3 w-64">
              <input type="number" min={0} max={20000} className="w-full" value={maxEvents} onChange={(e) => setMaxEvents(+e.target.value)} />
            </Field>
          )}
          <div className="mt-4">
            <span className="label">Filtros aplicados ao relatório</span>
            <FilterBar value={filter} onChange={setFilter} />
          </div>
          <button className="btn-primary" onClick={generate}>
            Gerar
          </button>
        </section>
      )}
      <h2 className="section-title mb-3 text-muted">Histórico de relatórios</h2>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : q.data!.length === 0 ? (
        <Empty title="Nenhum relatório emitido" />
      ) : (
        <div className="space-y-3">
          {q.data!.map((r) => (
            <div key={r.id} className="card p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm text-accent">{r.code}</span>
                    <Badge>{TYPES[r.report_type]}</Badge>
                    <Badge>{r.fmt.toUpperCase()}</Badge>
                    <Badge tone={STATUS_TONE[r.status]}>{r.status.replace('_', ' ')}</Badge>
                  </div>
                  <div className="font-medium text-white">{r.title}</div>
                  <div className="text-xs text-muted">
                    {fmtDateTime(r.created_at?.slice(0, 19))} · {r.created_by} · v{r.app_version} · regras {r.rules_version}
                    {r.size_bytes ? ` · ${fmtBytes(r.size_bytes)}` : ''}
                  </div>
                  {r.sha256 && <div className="mt-1 font-mono text-[11px] break-all text-faint">SHA-256 {r.sha256}</div>}
                  {r.input_files?.length > 0 && <div className="mt-1 text-xs text-faint">Entradas: {r.input_files.map((f: any) => `#${f.id} ${f.name}`).join(' · ')}</div>}
                  {r.status === 'gerando' && r.job && (
                    <div className="mt-2 w-64">
                      <Progress value={r.job.progress} />
                      <div className="mt-1 text-xs text-faint">{r.job.message}</div>
                    </div>
                  )}
                  {r.reviews.length > 0 && (
                    <ul className="mt-2 space-y-0.5 text-xs text-muted">
                      {r.reviews.map((v: any, i: number) => (
                        <li key={i}>
                          {fmtDateTime(v.at.slice(0, 19), false)} — {v.user}: <b>{v.action}</b>
                          {v.note ? ` — ${v.note}` : ''}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {r.sha256 && c.can_export && (
                    <>
                      <button className="btn-ghost !py-1 text-xs" onClick={() => download(`/cases/${c.id}/reports/${r.id}/download`, undefined, `${r.code}.${r.fmt}`).catch((e) => toast.error(e.message))}>
                        <Download className="h-3.5 w-3.5" /> Baixar
                      </button>
                      <button className="btn-ghost !py-1 text-xs" onClick={() => download(`/cases/${c.id}/reports/${r.id}/manifest`, undefined, `${r.code}.manifesto.json`)}>
                        <FileJson className="h-3.5 w-3.5" /> Manifesto
                      </button>
                    </>
                  )}
                  {r.sha256 && (
                    <button
                      className="btn-ghost !py-1 text-xs"
                      onClick={async () => {
                        const v = await api(`/cases/${c.id}/reports/${r.id}/verify`)
                        if (v.intact) toast.success('Íntegro: o arquivo confere com o hash registrado')
                        else toast.error('ALTERADO: o hash não confere!')
                      }}
                    >
                      <ShieldCheck className="h-3.5 w-3.5" /> Verificar
                    </button>
                  )}
                  {canWrite && ['rascunho', 'devolvido'].includes(r.status) && (
                    <button className="btn-ghost !py-1 text-xs" onClick={() => act(r.id, 'submeter')}>
                      Submeter à revisão
                    </button>
                  )}
                  {canReview && r.status === 'em_revisao' && r.created_by_id !== me?.id && (
                    <>
                      <button className="btn-ghost !py-1 text-xs" onClick={() => act(r.id, 'aprovar')}>
                        Aprovar
                      </button>
                      <button className="btn-danger !py-1 text-xs" onClick={() => act(r.id, 'devolver')}>
                        Devolver
                      </button>
                    </>
                  )}
                  {canReview && (
                    <button className="btn-ghost !py-1 text-xs" onClick={() => act(r.id, 'comentar')}>
                      Comentar
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
