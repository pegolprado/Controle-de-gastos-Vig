import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Database, Play, RadioTower } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { api } from '../../api/client'
import { useCase } from '../../app/layout'
import { FilterBar } from '../../components/FilterBar'
import { Badge, Criteria, DrillLink, ErrorBox, Field, Loading, Modal, Notice, PageHeader, Progress, Tabs } from '../../components/ui'
import { fmtDateTime, fmtInt, RESOLUTION_LABEL } from '../../lib/format'
import { useUrlFilter } from '../../lib/useUrlFilter'

const RTONE: Record<string, any> = { exact: 'green', probable: 'blue', ambiguous: 'amber', none: 'red' }

export default function Erb() {
  const [sp] = useSearchParams()
  const [tab, setTab] = useState(sp.get('aba') ?? 'celulas')
  return (
    <div>
      <PageHeader
        icon={<RadioTower className="h-5 w-5" />}
        title="Análise de ERB"
        subtitle="Eventos agrupados por célula e resolvidos contra o cadastro técnico importado, respeitando tecnologia, operadora e versão do cadastro. A ERB registrada em um evento não comprova a posição exata do aparelho ou da pessoa."
        actions={
          <Link to="cadastro" className="btn-ghost">
            <Database className="h-4 w-4" /> Cadastro técnico
          </Link>
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'celulas', label: 'Eventos por célula' },
          { value: 'resolucao', label: 'Resolução e revisão' },
          { value: 'periodos', label: 'Comparação de períodos' },
          { value: 'inconsistencias', label: 'Inconsistências' },
        ]}
      />
      {tab === 'celulas' && <CellsTab />}
      {tab === 'resolucao' && <ResolutionTab />}
      {tab === 'periodos' && <PeriodsTab />}
      {tab === 'inconsistencias' && <IssuesTab />}
    </div>
  )
}

function CellsTab() {
  const { c } = useCase()
  const [f, setF] = useUrlFilter()
  const q = useQuery({ queryKey: ['erb-cells', c.id, f], queryFn: () => api(`/cases/${c.id}/erb/cells`, { body: { filter: f } }) })
  return (
    <>
      <FilterBar value={f} onChange={setF} />
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : (
        <div className="card scroll-x p-3">
          <div className="mb-3 flex flex-wrap gap-2">
            {q.data.resolution.map((r: any) => (
              <Badge key={r.status} tone={RTONE[r.status] ?? 'gray'}>
                {RESOLUTION_LABEL[r.status] ?? r.status}: {fmtInt(r.n)} eventos
              </Badge>
            ))}
            <Badge>sem identificador de célula: {fmtInt(q.data.events_without_cell)}</Badge>
          </div>
          <table>
            <thead>
              <tr>
                <th>Célula (chave)</th>
                <th>Op./tec.</th>
                <th className="text-right">Eventos</th>
                <th className="text-right">Números</th>
                <th>Resolução</th>
                <th>Estação</th>
                <th>Coordenadas da estação</th>
                <th className="text-right">Azimute</th>
                <th>Primeiro → último</th>
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((r: any) => (
                <tr key={r.cell_key}>
                  <td className="font-mono text-xs break-all">{r.cell_key}</td>
                  <td className="text-xs">
                    {r.operator ?? '—'} {r.tech ?? ''}
                  </td>
                  <td className="text-right tabular-nums">
                    <DrillLink caseId={c.id} filter={{ ...f, cell_keys: [r.cell_key] }}>
                      {fmtInt(r.events)}
                    </DrillLink>
                  </td>
                  <td className="text-right tabular-nums">{r.numbers}</td>
                  <td>
                    <Badge tone={RTONE[r.resolution_status] ?? 'gray'}>{RESOLUTION_LABEL[r.resolution_status ?? 'pendente']}</Badge>
                    {r.resolution_note && <div className="mt-1 max-w-56 text-[11px] text-faint">{r.resolution_note}</div>}
                  </td>
                  <td className="text-xs">{r.site_name ?? r.site_code ?? '—'}</td>
                  <td className="font-mono text-xs">{r.lat !== null ? `${r.lat.toFixed(5)}, ${r.lon.toFixed(5)}` : <span className="text-faint">indisponível</span>}</td>
                  <td className="text-right text-xs">{r.azimuth ?? '—'}</td>
                  <td className="text-xs whitespace-nowrap">
                    {fmtDateTime(r.first_event, false)} → {fmtDateTime(r.last_event, false)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Criteria criteria={q.data.criteria} />
        </div>
      )}
    </>
  )
}

function ResolutionTab() {
  const { c, canWrite } = useCase()
  const qc = useQueryClient()
  const runs = useQuery({ queryKey: ['erb-runs', c.id], queryFn: () => api<any[]>(`/cases/${c.id}/erb/runs`) })
  const reg = useQuery({ queryKey: ['registry', c.id, 'versions'], queryFn: () => api(`/cases/${c.id}/erb/registry?size=1`) })
  const pending = useQuery({ queryKey: ['erb-cells', c.id, 'pending'], queryFn: () => api(`/cases/${c.id}/erb/cells`, { body: { filter: { resolution: ['ambiguous', 'none', 'probable'] } } }) })
  const [versions, setVersions] = useState<number[]>([])
  const [jobId, setJobId] = useState<number | null>(null)
  const job = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => api(`/jobs/${jobId}`),
    enabled: !!jobId,
    refetchInterval: (q) => {
      const st = q.state.data?.status
      if (st && ['done', 'failed'].includes(st)) {
        qc.invalidateQueries({ queryKey: ['erb-runs', c.id] })
        qc.invalidateQueries({ queryKey: ['erb-cells', c.id] })
        return false
      }
      return 1000
    },
  })
  const [review, setReview] = useState<any>(null)
  return (
    <div className="space-y-4">
      <div className="card p-4">
        <Notice>
          Regras, em ordem: <b>id_completo</b> (tecnologia + MCC + MNC + LAC/TAC + CI/ECI/NCI → exata) · <b>cgi_exato</b> (CGI/ECGI idêntico → exata) · <b>id_sem_area</b> (identificador sem área/PLMN → provável) · <b>codigo_estacao</b> (código ou nome da estação → provável). Vários candidatos com coordenadas diferentes → ambígua. Sem correspondência → “ERB não resolvida”. Coordenadas nunca são estimadas.
        </Notice>
        {canWrite && (
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <Field label="Versões do cadastro (vazio = todas; a mais recente prevalece)">
              <select multiple className="h-24 min-w-80" value={versions.map(String)} onChange={(e) => setVersions(Array.from(e.target.selectedOptions).map((o) => +o.value))}>
                {(reg.data?.versions ?? []).map((v: any) => (
                  <option key={v.id} value={v.id}>
                    #{v.id} {v.name} {v.reference_date ? `(ref. ${v.reference_date})` : ''} — {v.rows} células
                  </option>
                ))}
              </select>
            </Field>
            <button
              className="btn-primary"
              onClick={async () => {
                const r = await api(`/cases/${c.id}/erb/resolve`, { body: { version_ids: versions.length ? versions : null } })
                setJobId(r.id)
              }}
            >
              <Play className="h-4 w-4" /> Executar resolução
            </button>
            {job.data && (
              <div className="w-64">
                <Progress value={job.data.status === 'done' ? 1 : job.data.progress} tone={job.data.status === 'failed' ? 'red' : 'blue'} />
                <div className="mt-1 text-xs text-faint">{job.data.status}</div>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="card scroll-x p-3">
        <div className="label mb-2">Execuções</div>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Data</th>
              <th>Usuário</th>
              <th>Versões</th>
              <th>Assinaturas</th>
              <th>Eventos por resultado</th>
              <th>Regras</th>
            </tr>
          </thead>
          <tbody>
            {(runs.data ?? []).map((r) => (
              <tr key={r.id}>
                <td className="font-mono text-xs">{r.id}</td>
                <td className="text-xs">{fmtDateTime(r.created_at.slice(0, 19))}</td>
                <td className="text-xs">{r.user_name ?? 'sistema'}</td>
                <td className="text-xs">{r.result.versions?.map((v: any) => `#${v.id}`).join(', ') || '—'}</td>
                <td className="text-right">{r.result.signatures}</td>
                <td>
                  {Object.entries(r.result.by_status_events ?? {}).map(([k, v]) => (
                    <Badge key={k} tone={RTONE[k]} className="mr-1">
                      {RESOLUTION_LABEL[k]} {fmtInt(v as number)}
                    </Badge>
                  ))}
                </td>
                <td className="font-mono text-xs">{r.rules_version}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card scroll-x p-3">
        <div className="label mb-2">Revisão: células prováveis, ambíguas ou não resolvidas</div>
        {pending.isLoading ? (
          <Loading />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Célula</th>
                <th>Situação</th>
                <th>Motivo</th>
                <th className="text-right">Eventos</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(pending.data?.items ?? []).map((r: any) => (
                <tr key={r.cell_key}>
                  <td className="font-mono text-xs">{r.cell_key}</td>
                  <td>
                    <Badge tone={RTONE[r.resolution_status]}>{RESOLUTION_LABEL[r.resolution_status]}</Badge>
                  </td>
                  <td className="max-w-md text-xs text-muted">{r.resolution_note}</td>
                  <td className="text-right">
                    <DrillLink caseId={c.id} filter={{ cell_keys: [r.cell_key] }}>
                      {fmtInt(r.events)}
                    </DrillLink>
                  </td>
                  <td>
                    {canWrite && (
                      <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setReview(r)}>
                        Revisar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {review && <ManualReview cell={review} onClose={() => setReview(null)} />}
    </div>
  )
}

function ManualReview({ cell, onClose }: { cell: any; onClose: () => void }) {
  const { c } = useCase()
  const qc = useQueryClient()
  const cands = useQuery({ queryKey: ['cands', cell.cell_key], queryFn: () => api<any[]>(`/cases/${c.id}/erb/candidates?cell_key=${encodeURIComponent(cell.cell_key)}`) })
  const [choice, setChoice] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const m = useMutation({
    mutationFn: () => api(`/cases/${c.id}/erb/manual`, { body: { cell_key: cell.cell_key, erb_cell_id: choice, note } }),
    onSuccess: (r: any) => {
      toast.success(`Revisão registrada em ${r.events} eventos`)
      qc.invalidateQueries({ queryKey: ['erb-cells', c.id] })
      onClose()
    },
    onError: (e: any) => toast.error(e.message),
  })
  return (
    <Modal open onClose={onClose} title={`Revisão manual — ${cell.cell_key}`} wide>
      <Notice tone="amber">A escolha manual fica registrada na auditoria e não é sobrescrita por novas execuções automáticas. Escolha um candidato apenas se houver fundamento técnico documentado.</Notice>
      <div className="mt-3 max-h-80 overflow-auto">
        <table>
          <thead>
            <tr>
              <th />
              <th>Célula do cadastro</th>
              <th>Op./tec.</th>
              <th>LAC/TAC</th>
              <th>Estação</th>
              <th>Coordenadas</th>
              <th>Versão</th>
              <th>Validação</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <input type="radio" checked={choice === null} onChange={() => setChoice(null)} />
              </td>
              <td colSpan={7} className="text-sm text-muted">
                Confirmar como não resolvida (nenhum candidato válido)
              </td>
            </tr>
            {(cands.data ?? []).map((x) => (
              <tr key={x.id}>
                <td>
                  <input type="radio" checked={choice === x.id} onChange={() => setChoice(x.id)} />
                </td>
                <td className="font-mono text-xs">{x.cell_key}</td>
                <td className="text-xs">
                  {x.operator} {x.tech}
                </td>
                <td className="text-xs">{x.lac ?? x.tac ?? '—'}</td>
                <td className="text-xs">{x.site_name}</td>
                <td className="font-mono text-xs">{x.lat !== null ? `${x.lat}, ${x.lon}` : '—'}</td>
                <td className="text-xs">#{x.version_id}</td>
                <td>
                  <Badge tone={x.validation_status === 'ok' ? 'green' : 'amber'}>{x.validation_status}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Field label="Fundamentação" className="mt-3">
        <textarea className="w-full" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="mt-3 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>
          Cancelar
        </button>
        <button className="btn-primary" disabled={note.length < 5 || m.isPending} onClick={() => m.mutate()}>
          Registrar revisão
        </button>
      </div>
    </Modal>
  )
}

function PeriodsTab() {
  const { c, meta } = useCase()
  const span = meta?.span ?? []
  const [p, setP] = useState({ a0: span[0]?.slice(0, 10) ?? '', a1: '', b0: '', b1: span[1]?.slice(0, 10) ?? '' })
  const [target, setTarget] = useState('')
  const m = useMutation({
    mutationFn: () =>
      api(`/cases/${c.id}/erb/cells-by-period`, { body: { filter: target ? { targets: [target] } : {}, period1: [p.a0 + 'T00:00:00', p.a1 + 'T23:59:59'], period2: [p.b0 + 'T00:00:00', p.b1 + 'T23:59:59'] } }),
  })
  return (
    <>
      <div className="card mb-4 grid gap-3 p-4 md:grid-cols-5">
        {(
          [
            ['a0', 'Período 1 — de'],
            ['a1', 'Período 1 — até'],
            ['b0', 'Período 2 — de'],
            ['b1', 'Período 2 — até'],
          ] as const
        ).map(([k, l]) => (
          <Field key={k} label={l}>
            <input type="date" className="w-full" value={p[k]} onChange={(e) => setP({ ...p, [k]: e.target.value })} />
          </Field>
        ))}
        <Field label="Alvo">
          <select className="w-full" value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">todos</option>
            {(meta?.targets ?? []).map((t: any) => (
              <option key={t.number} value={t.number}>
                {t.number}
              </option>
            ))}
          </select>
        </Field>
        <div className="md:col-span-5">
          <button className="btn-primary" disabled={!p.a0 || !p.a1 || !p.b0 || !p.b1} onClick={() => m.mutate()}>
            Comparar células
          </button>
        </div>
      </div>
      {m.isPending && <Loading />}
      {m.error && <ErrorBox error={m.error} />}
      {m.data && (
        <div className="card scroll-x p-3">
          <table>
            <thead>
              <tr>
                <th>Célula</th>
                <th className="text-right">Período 1</th>
                <th className="text-right">Período 2</th>
                <th>Observação</th>
              </tr>
            </thead>
            <tbody>
              {m.data.items.map((r: any) => (
                <tr key={r.cell_key}>
                  <td className="font-mono text-xs">{r.cell_key}</td>
                  <td className="text-right">{r.period1}</td>
                  <td className="text-right">{r.period2}</td>
                  <td>
                    <Badge tone={r.status === 'ambos' ? 'gray' : 'amber'}>{r.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Criteria criteria={m.data.criteria} />
        </div>
      )}
    </>
  )
}

function IssuesTab() {
  const { c } = useCase()
  const reg = useQuery({ queryKey: ['registry', c.id, 'problems'], queryFn: () => api(`/cases/${c.id}/erb/registry?size=200&page=1`) })
  if (reg.isLoading) return <Loading />
  if (reg.error) return <ErrorBox error={reg.error} />
  const bad = reg.data.items.filter((x: any) => x.validation_status !== 'ok')
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {reg.data.status_counts.map((s: any) => (
          <Badge key={s.validation_status} tone={s.validation_status === 'ok' ? 'green' : s.validation_status === 'conflito' ? 'red' : 'amber'}>
            {s.validation_status}: {s.n}
          </Badge>
        ))}
      </div>
      <div className="card scroll-x p-3">
        <table>
          <thead>
            <tr>
              <th>Célula</th>
              <th>Estação</th>
              <th>Coordenadas</th>
              <th>Situação</th>
              <th>Observações</th>
              <th>Versão</th>
            </tr>
          </thead>
          <tbody>
            {bad.map((x: any) => (
              <tr key={x.id}>
                <td className="font-mono text-xs">{x.cell_key}</td>
                <td className="text-xs">{x.site_name}</td>
                <td className="font-mono text-xs">{x.lat !== null ? `${x.lat}, ${x.lon}` : '—'}</td>
                <td>
                  <Badge tone={x.validation_status === 'conflito' ? 'red' : 'amber'}>{x.validation_status}</Badge>
                </td>
                <td className="text-xs text-muted">{(x.validation_notes ?? []).join('; ')}</td>
                <td className="text-xs">{x.version_name}</td>
              </tr>
            ))}
            {bad.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-muted">
                  Nenhuma inconsistência nas primeiras 200 linhas do cadastro.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Notice>Divergências entre versões do cadastro aparecem na nota de resolução dos eventos afetados e na Central de alertas.</Notice>
    </div>
  )
}
