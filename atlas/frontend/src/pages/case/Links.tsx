import { useQuery } from '@tanstack/react-query'
import cytoscape, { type Core } from 'cytoscape'
import { Download, Network } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ExportButtons } from '../../components/Export'
import { linkGraph } from '../../engine/analytics'
import { useCase } from '../../app/layout'
import { FilterBar } from '../../components/FilterBar'
import { Badge, Criteria, DrillLink, ErrorBox, Field, Loading, Notice, PageHeader } from '../../components/ui'
import { fmtDateTime, fmtDuration, fmtNumber, fmtNumberPlain } from '../../lib/format'
import { useUrlFilter } from '../../lib/useUrlFilter'

export default function Links() {
  const { c } = useCase()
  const [f, setF] = useUrlFilter()
  const [center, setCenter] = useState('')
  const [depth, setDepth] = useState(2)
  const [minEvents, setMinEvents] = useState(2)
  const [reciprocal, setReciprocal] = useState(false)
  const [hideLeaves, setHideLeaves] = useState(false)
  const [sel, setSel] = useState<any>(null)
  const q = useQuery({
    queryKey: ['graph', c.id, f, center, depth, minEvents, reciprocal],
    queryFn: () => linkGraph(f, center || null, depth, minEvents, reciprocal) as Promise<any>,
  })
  const box = useRef<HTMLDivElement>(null)
  const cy = useRef<Core | null>(null)
  useEffect(() => {
    if (!q.data || !box.current) return
    const nodes = q.data.nodes.filter((n: any) => !hideLeaves || n.is_target || n.degree > 1)
    const ids = new Set(nodes.map((n: any) => n.id))
    const maxE = Math.max(1, ...q.data.edges.map((e: any) => e.events))
    cy.current?.destroy()
    cy.current = cytoscape({
      container: box.current,
      elements: [
        ...nodes.map((n: any) => ({
          data: { id: n.id, label: fmtNumber(n.id) + (n.label ? `\n${n.label}` : ''), kind: n.is_target ? 'target' : n.common_to_targets > 1 ? 'common' : 'other', size: n.is_target ? 46 : 18 + Math.min(22, Math.sqrt(n.events) * 3), raw: n },
        })),
        ...q.data.edges
          .filter((e: any) => ids.has(e.n1) && ids.has(e.n2))
          .map((e: any) => ({ data: { id: `${e.n1}~${e.n2}`, source: e.n1, target: e.n2, w: 1 + (5 * e.events) / maxE, recip: e.reciprocal ? 1 : 0, raw: e } })),
      ],
      style: [
        { selector: 'node', style: { width: 'data(size)', height: 'data(size)', 'background-color': '#5d6780', label: 'data(label)', color: '#c9d2e3', 'font-size': 9, 'text-wrap': 'wrap', 'text-valign': 'bottom', 'text-margin-y': 4, 'border-width': 2, 'border-color': '#161b2e' } },
        { selector: 'node[kind = "target"]', style: { 'background-color': '#4c8dff', 'font-size': 11, 'font-weight': 'bold', color: '#ffffff' } },
        { selector: 'node[kind = "common"]', style: { 'background-color': '#c27f10' } },
        { selector: 'edge', style: { width: 'data(w)', 'line-color': '#34405f', 'curve-style': 'haystack', opacity: 0.85 } },
        { selector: 'edge[recip = 1]', style: { 'line-color': '#0f9e8e' } },
        { selector: ':selected', style: { 'border-color': '#ffffff', 'line-color': '#ffffff', 'border-width': 3 } },
      ],
      layout: { name: 'cose', animate: false, nodeRepulsion: () => 9000, idealEdgeLength: () => 90, padding: 30 } as any,
      wheelSensitivity: 0.3,
    })
    cy.current.on('tap', 'node', (ev) => setSel({ type: 'node', ...ev.target.data('raw') }))
    cy.current.on('tap', 'edge', (ev) => setSel({ type: 'edge', ...ev.target.data('raw') }))
    cy.current.on('dbltap', 'node', (ev) => setCenter(ev.target.id()))
    return () => {
      cy.current?.destroy()
      cy.current = null
    }
  }, [q.data, hideLeaves])
  const exportPng = async () => {
    if (!cy.current) return
    const a = document.createElement('a')
    a.href = cy.current.png({ bg: '#0b0f1a', full: true, scale: 2 })
    a.download = 'MARX-grafo-de-vinculos.png'
    a.click()
  }
  return (
    <div>
      <PageHeader
        icon={<Network className="h-5 w-5" />}
        title="Grafo de vínculos"
        subtitle="Números como nós e interações documentadas como conexões. Azul: alvos; âmbar: contatos em comum a dois ou mais alvos; verde-água: comunicação nos dois sentidos; espessura proporcional à quantidade de eventos. Clique duas vezes num nó para centralizar."
        actions={
          <>
            {c.can_export && (
              <button className="btn-ghost" onClick={exportPng}>
                <Download className="h-4 w-4" /> PNG
              </button>
            )}
            {q.data && (
              <ExportButtons
                build={() => ({
                  title: 'Vínculos documentados',
                  subtitle: `${q.data.nodes.length} números · ${q.data.edges.length} conexões`,
                  columns: [
                    { key: 'n1', label: 'Número 1', fmt: (v) => fmtNumberPlain(v) },
                    { key: 'n2', label: 'Número 2', fmt: (v) => fmtNumberPlain(v) },
                    { key: 'events', label: 'Eventos' },
                    { key: 'days', label: 'Dias' },
                    { key: 'n1_to_n2', label: '1→2' },
                    { key: 'n2_to_n1', label: '2→1' },
                    { key: 'reciprocal', label: 'Recíproca', fmt: (v) => (v ? 'sim' : 'não') },
                    { key: 'call_seconds', label: 'Duração (s)' },
                    { key: 'first_event', label: 'Primeiro' },
                    { key: 'last_event', label: 'Último' },
                  ],
                  rows: q.data.edges,
                  criteria: q.data.criteria,
                })}
              />
            )}
          </>
        }
      />
      <FilterBar value={f} onChange={setF} compact />
      <div className="card mb-4 flex flex-wrap items-end gap-4 p-4">
        <Field label="Número central (opcional)">
          <input value={center} placeholder="todos" onChange={(e) => setCenter(e.target.value)} />
        </Field>
        <Field label="Profundidade">
          <select value={depth} onChange={(e) => setDepth(+e.target.value)}>
            {[1, 2, 3].map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </Field>
        <Field label="Mínimo de eventos por conexão">
          <input type="number" min={1} className="w-24" value={minEvents} onChange={(e) => setMinEvents(Math.max(1, +e.target.value))} />
        </Field>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" checked={reciprocal} onChange={(e) => setReciprocal(e.target.checked)} /> somente recíprocas
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" checked={hideLeaves} onChange={(e) => setHideLeaves(e.target.checked)} /> ocultar contatos com uma única conexão
        </label>
      </div>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
          <div className="card relative overflow-hidden">
            <div ref={box} className="h-[620px] w-full" role="img" aria-label="Grafo de contatos" />
            <div className="absolute bottom-3 left-3 flex gap-2 text-[11px] text-muted">
              <Badge tone="blue">{q.data.nodes.length} números</Badge>
              <Badge>{q.data.edges.length} conexões</Badge>
              {q.data.truncated && <Badge tone="amber">limitado às conexões mais fortes</Badge>}
            </div>
          </div>
          <aside className="card p-4 text-sm">
            {!sel ? (
              <p className="text-muted">Selecione um nó ou uma conexão para ver os detalhes e abrir os registros que a sustentam.</p>
            ) : sel.type === 'node' ? (
              <div className="space-y-2">
                <div className="font-mono text-lg text-white">{fmtNumber(sel.id)}</div>
                {sel.label && <div className="text-teal">{sel.label}</div>}
                <div>{sel.is_target ? <Badge tone="blue">alvo</Badge> : sel.common_to_targets > 1 ? <Badge tone="amber">em comum a {sel.common_to_targets} alvos</Badge> : <Badge>contato</Badge>}</div>
                <div className="text-muted">
                  {sel.degree} conexões · {sel.events} eventos
                </div>
                <div className="flex flex-wrap gap-2 pt-2">
                  <button className="btn-ghost !py-1 text-xs" onClick={() => setCenter(sel.id)}>
                    Centralizar / expandir
                  </button>
                  <DrillLink caseId={c.id} filter={{ ...f, numbers: [sel.id] }} className="btn-ghost !py-1 text-xs">
                    Abrir registros
                  </DrillLink>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="font-mono text-white">
                  {fmtNumber(sel.n1)} ⟷ {fmtNumber(sel.n2)}
                </div>
                {sel.reciprocal ? <Badge tone="teal">recíproca</Badge> : <Badge>unidirecional</Badge>}
                <dl className="grid grid-cols-2 gap-1 text-xs">
                  <dt className="text-muted">Eventos</dt>
                  <dd>{sel.events}</dd>
                  <dt className="text-muted">Dias distintos</dt>
                  <dd>{sel.days}</dd>
                  <dt className="text-muted">{fmtNumber(sel.n1)} → </dt>
                  <dd>{sel.n1_to_n2}</dd>
                  <dt className="text-muted">{fmtNumber(sel.n2)} → </dt>
                  <dd>{sel.n2_to_n1}</dd>
                  <dt className="text-muted">Duração (voz)</dt>
                  <dd>{fmtDuration(sel.call_seconds)}</dd>
                  <dt className="text-muted">Primeiro</dt>
                  <dd>{fmtDateTime(sel.first_event)}</dd>
                  <dt className="text-muted">Último</dt>
                  <dd>{fmtDateTime(sel.last_event)}</dd>
                  <dt className="text-muted">Arquivos</dt>
                  <dd>{sel.file_ids.map((x: number) => `#${x}`).join(', ')}</dd>
                </dl>
                <DrillLink caseId={c.id} filter={{ ...f, targets: [sel.n1, sel.n2], others: [sel.n1, sel.n2] }} className="btn-ghost !py-1 text-xs">
                  Abrir registros da conexão
                </DrillLink>
              </div>
            )}
            <div className="mt-6">
              <Notice tone="amber">Conexões representam registros documentados de comunicação; não provam vínculo pessoal ou associação.</Notice>
            </div>
          </aside>
        </div>
      )}
      {q.data && <Criteria criteria={q.data.criteria} />}
    </div>
  )
}
