import { useQuery } from '@tanstack/react-query'
import L from 'leaflet'
import { Map as MapIcon, Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../../api/client'
import { cellSequence, geoPoints } from '../../engine/analytics'
import { useCase } from '../../app/layout'
import { SERIES } from '../../components/charts'
import { FilterBar } from '../../components/FilterBar'
import { Badge, Criteria, DrillLink, Empty, ErrorBox, Field, Loading, Notice, PageHeader, Tabs } from '../../components/ui'
import { EVENT_TYPE_LABEL, fmtDateTime, fmtDuration, fmtNumber } from '../../lib/format'
import { useUrlFilter } from '../../lib/useUrlFilter'

function sectorPolygon(lat: number, lon: number, az: number, bw: number, radiusM: number): [number, number][] {
  const pts: [number, number][] = [[lat, lon]]
  const steps = 16
  for (let i = 0; i <= steps; i++) {
    const a = ((az - bw / 2 + (bw * i) / steps) * Math.PI) / 180
    const dLat = (radiusM * Math.cos(a)) / 111320
    const dLon = (radiusM * Math.sin(a)) / (111320 * Math.cos((lat * Math.PI) / 180))
    pts.push([lat + dLat, lon + dLon])
  }
  return pts
}

function useLeaflet(tileUrl?: string, attribution?: string) {
  const ref = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)
  useEffect(() => {
    if (!ref.current || map.current || !tileUrl) return
    map.current = L.map(ref.current, { preferCanvas: true }).setView([-15.79, -47.88], 11)
    L.tileLayer(tileUrl, { attribution, maxZoom: 19 }).addTo(map.current)
    layer.current = L.layerGroup().addTo(map.current)
    return () => {
      map.current?.remove()
      map.current = null
    }
  }, [tileUrl, attribution])
  return { ref, map, layer }
}

export default function GeoMap() {
  const [sp] = useSearchParams()
  const [tab, setTab] = useState(sp.get('aba') ?? 'mapa')
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api('/settings') })
  return (
    <div>
      <PageHeader
        icon={<MapIcon className="h-5 w-5" />}
        title="Geolocalização"
        subtitle="Somente coordenadas válidas do cadastro técnico importado ou informadas no próprio documento. A coordenada é da estação (antena), não do aparelho; setores são representações esquemáticas, não cobertura real comprovada."
      />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'mapa', label: 'Mapa de estações' },
          { value: 'sequencia', label: 'Sequência de células' },
          { value: 'reproducao', label: 'Reprodução cronológica' },
        ]}
      />
      {settings.data && tab === 'mapa' && <StationsMap tile={settings.data.map_tile_url} attr={settings.data.map_attribution} />}
      {settings.data && tab !== 'mapa' && <SequenceView tile={settings.data.map_tile_url} attr={settings.data.map_attribution} playback={tab === 'reproducao'} />}
    </div>
  )
}

function StationsMap({ tile, attr }: { tile: string; attr: string }) {
  const { c, meta } = useCase()
  const [f, setF] = useUrlFilter()
  const [radius, setRadius] = useState(600)
  const [showSectors, setShowSectors] = useState(true)
  const [sel, setSel] = useState<any>(null)
  const q = useQuery({ queryKey: ['geo', c.id, f], queryFn: () => geoPoints(f) as Promise<any> })
  const { ref, map, layer } = useLeaflet(tile, attr)
  const targetIdx = useMemo(() => Object.fromEntries((meta?.targets ?? []).map((t: any, i: number) => [t.number, i])), [meta])
  useEffect(() => {
    if (!q.data || !map.current || !layer.current) return
    layer.current.clearLayers()
    const pts = [...q.data.registry_points.map((p: any) => ({ ...p, src: 'cadastro' })), ...q.data.document_points.map((p: any) => ({ ...p, src: 'documento' }))]
    if (!pts.length) return
    const maxE = Math.max(...pts.map((p) => p.events))
    const bounds: [number, number][] = []
    for (const p of pts) {
      const color = p.numbers?.length > 1 ? '#c27f10' : SERIES[(targetIdx[p.numbers?.[0]] ?? 0) % SERIES.length]
      if (showSectors && p.azimuth !== null && p.azimuth !== undefined) {
        L.polygon(sectorPolygon(p.lat, p.lon, p.azimuth, p.beamwidth ?? 65, radius), { color, weight: 1, fillOpacity: 0.12, opacity: 0.5, dashArray: '4 3' }).addTo(layer.current)
      }
      const m = L.circleMarker([p.lat, p.lon], { radius: 5 + 10 * Math.sqrt(p.events / maxE), color: '#0b0f1a', weight: 2, fillColor: color, fillOpacity: 0.9 })
      m.on('click', () => setSel(p))
      m.bindTooltip(`${p.site_name ?? p.cell_key} · ${p.events} eventos`)
      m.addTo(layer.current)
      bounds.push([p.lat, p.lon])
    }
    map.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 })
  }, [q.data, radius, showSectors, map, layer, targetIdx])
  return (
    <>
      <FilterBar value={f} onChange={setF} compact />
      <div className="card mb-4 flex flex-wrap items-end gap-4 p-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={showSectors} onChange={(e) => setShowSectors(e.target.checked)} /> desenhar setores (azimute)
        </label>
        <Field label="Raio esquemático do setor (m)">
          <input type="number" min={100} max={10000} step={100} className="w-28" value={radius} onChange={(e) => setRadius(+e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-2 text-xs text-muted">
          {(meta?.targets ?? []).map((t: any, i: number) => (
            <span key={t.number} className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: SERIES[i % SERIES.length] }} /> {fmtNumber(t.number)}
            </span>
          ))}
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full bg-[#c27f10]" /> mais de um número
          </span>
        </div>
      </div>
      {q.error && <ErrorBox error={q.error} />}
      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="card relative overflow-hidden">
          <div ref={ref} className="h-[600px] w-full" />
          {q.isLoading && <div className="absolute inset-0 grid place-items-center bg-ink/50"><Loading /></div>}
          {q.data && !q.data.registry_points.length && !q.data.document_points.length && (
            <div className="absolute inset-0 grid place-items-center bg-ink/70 p-6">
              <Empty title="Sem coordenadas válidas">Importe o cadastro técnico de ERB e execute a resolução para posicionar as estações.</Empty>
            </div>
          )}
        </div>
        <aside className="card p-4 text-sm">
          {sel ? (
            <div className="space-y-2">
              <div className="font-bold text-white">{sel.site_name ?? 'Ponto informado no documento'}</div>
              <Badge tone={sel.src === 'cadastro' ? 'green' : 'amber'}>coordenada do {sel.src}</Badge>
              <dl className="grid grid-cols-2 gap-1 text-xs">
                <dt className="text-muted">Célula</dt>
                <dd className="font-mono break-all">{sel.cell_key}</dd>
                <dt className="text-muted">Coordenadas</dt>
                <dd className="font-mono">
                  {sel.lat.toFixed(5)}, {sel.lon.toFixed(5)}
                </dd>
                <dt className="text-muted">Azimute</dt>
                <dd>{sel.azimuth ?? '—'}°</dd>
                <dt className="text-muted">Eventos</dt>
                <dd>{sel.events}</dd>
                <dt className="text-muted">Números</dt>
                <dd>{sel.numbers.map(fmtNumber).join(', ')}</dd>
                <dt className="text-muted">Período</dt>
                <dd>
                  {fmtDateTime(sel.first_event, false)} → {fmtDateTime(sel.last_event, false)}
                </dd>
                {sel.version_id && (
                  <>
                    <dt className="text-muted">Versão cadastro</dt>
                    <dd>#{sel.version_id}</dd>
                  </>
                )}
              </dl>
              <DrillLink caseId={c.id} filter={{ ...f, cell_keys: [sel.cell_key] }} className="btn-ghost !py-1 text-xs">
                Abrir registros associados
              </DrillLink>
            </div>
          ) : (
            <p className="text-muted">Clique numa estação para ver os detalhes e os registros associados.</p>
          )}
          {q.data && (
            <div className="mt-6 space-y-2">
              <Notice tone="amber">{q.data.criteria.limit_note}</Notice>
              <p className="text-xs text-faint">Eventos sem coordenada (não resolvidos ou sem cadastro): {q.data.events_without_coordinates}</p>
            </div>
          )}
        </aside>
      </div>
      {q.data && <Criteria criteria={q.data.criteria} />}
    </>
  )
}

function SequenceView({ tile, attr, playback }: { tile: string; attr: string; playback: boolean }) {
  const { c, meta } = useCase()
  const targets = meta?.targets ?? []
  const [target, setTarget] = useState<string>(targets[0]?.number ?? '')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [showLine, setShowLine] = useState(false)
  const filter = { targets: target ? [target] : [], ...(from ? { date_from: from } : {}), ...(to ? { date_to: to } : {}) }
  const q = useQuery({ queryKey: ['seq', c.id, filter], queryFn: () => cellSequence(filter) as Promise<any>, enabled: !!target })
  const { ref, map, layer } = useLeaflet(tile, attr)
  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(700)
  const items: any[] = q.data?.items ?? []
  const withCoords = items.filter((x) => x.lat !== null)
  useEffect(() => setIdx(0), [q.data])
  useEffect(() => {
    if (!playing) return
    const t = setInterval(() => setIdx((i) => (i + 1 >= items.length ? (setPlaying(false), i) : i + 1)), speed)
    return () => clearInterval(t)
  }, [playing, speed, items.length])
  useEffect(() => {
    if (!map.current || !layer.current) return
    layer.current.clearLayers()
    if (!withCoords.length) return
    const visible = playback ? items.slice(0, idx + 1).filter((x) => x.lat !== null) : withCoords
    const seen = new Map<string, number>()
    visible.forEach((x) => seen.set(`${x.lat},${x.lon}`, (seen.get(`${x.lat},${x.lon}`) ?? 0) + 1))
    for (const [k, n] of seen) {
      const [la, lo] = k.split(',').map(Number)
      L.circleMarker([la, lo], { radius: 5 + Math.min(10, Math.sqrt(n) * 2), color: '#0b0f1a', weight: 2, fillColor: '#4c8dff', fillOpacity: 0.55 })
        .bindTooltip(`${n} registro(s)`)
        .addTo(layer.current)
    }
    if (showLine && visible.length > 1) {
      L.polyline(
        visible.map((x) => [x.lat, x.lon]),
        { color: '#8d97ab', weight: 1, dashArray: '2 6', opacity: 0.7 },
      )
        .bindTooltip('sequência de registros de rede (não é trajeto físico)')
        .addTo(layer.current)
    }
    const cur = playback ? items[idx] : null
    if (cur && cur.lat !== null) {
      if (cur.azimuth !== null) L.polygon(sectorPolygon(cur.lat, cur.lon, cur.azimuth, cur.beamwidth ?? 65, 700), { color: '#f5a524', weight: 1, fillOpacity: 0.2, dashArray: '4 3' }).addTo(layer.current)
      L.circleMarker([cur.lat, cur.lon], { radius: 11, color: '#fff', weight: 2, fillColor: '#f5a524', fillOpacity: 1 }).addTo(layer.current)
    }
    if (!playback || idx === 0) map.current.fitBounds(withCoords.map((x) => [x.lat, x.lon]) as [number, number][], { padding: [40, 40], maxZoom: 15 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data, idx, playback, showLine])
  const cur = items[idx]
  return (
    <>
      <div className="card mb-4 flex flex-wrap items-end gap-4 p-4 text-sm">
        <Field label="Número">
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            {targets.map((t: any) => (
              <option key={t.number} value={t.number}>
                {fmtNumber(t.number)} {t.label ? `— ${t.label}` : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label="De">
          <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="Até">
          <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 pb-2">
          <input type="checkbox" checked={showLine} onChange={(e) => setShowLine(e.target.checked)} /> ligar a ordem dos registros (tracejado)
        </label>
      </div>
      <Notice tone="amber">Sequência documental de registros de rede. Não representa trajeto físico, velocidade, permanência ou endereço; a posição contínua do aparelho não é simulada.</Notice>
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox error={q.error} />}
      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_420px]">
        <div className="card overflow-hidden">
          <div ref={ref} className="h-[560px] w-full" />
          {playback && items.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 border-t border-line p-3">
              <button className="btn-ghost !p-2" onClick={() => setIdx(Math.max(0, idx - 1))} aria-label="Retroceder">
                <SkipBack className="h-4 w-4" />
              </button>
              <button className="btn-primary !p-2" onClick={() => setPlaying(!playing)} aria-label={playing ? 'Pausar' : 'Reproduzir'}>
                {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </button>
              <button className="btn-ghost !p-2" onClick={() => setIdx(Math.min(items.length - 1, idx + 1))} aria-label="Avançar">
                <SkipForward className="h-4 w-4" />
              </button>
              <input type="range" min={0} max={items.length - 1} value={idx} onChange={(e) => setIdx(+e.target.value)} className="flex-1 !p-0" aria-label="Posição na sequência" />
              <select value={speed} onChange={(e) => setSpeed(+e.target.value)} aria-label="Velocidade">
                <option value={1500}>lenta</option>
                <option value={700}>normal</option>
                <option value={250}>rápida</option>
              </select>
              <span className="font-mono text-xs text-muted">
                {idx + 1}/{items.length}
              </span>
            </div>
          )}
        </div>
        <aside className="card max-h-[620px] overflow-auto p-3">
          {playback && cur && (
            <div className="mb-3 rounded-lg border border-amber/40 bg-amber/5 p-3 text-sm">
              <div className="font-mono text-amber">{fmtDateTime(cur.ts_local)}</div>
              <div>{EVENT_TYPE_LABEL[cur.event_type]}</div>
              <div className="font-mono text-xs break-all text-muted">{cur.cell_key}</div>
              <div className="text-xs text-muted">
                {cur.site_name ?? 'estação sem nome'} · coordenada: {cur.coord_source ?? 'indisponível'}
                {cur.interval_s !== null && ` · ${fmtDuration(cur.interval_s)} após o registro anterior`}
              </div>
            </div>
          )}
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Data/hora</th>
                <th>Célula / estação</th>
                <th>Intervalo</th>
              </tr>
            </thead>
            <tbody>
              {items.map((x, i) => (
                <tr key={x.id} className={playback && i === idx ? 'bg-amber/10' : ''} onClick={() => setIdx(i)}>
                  <td className="font-mono text-xs text-faint">{i + 1}</td>
                  <td className="text-xs whitespace-nowrap">
                    {fmtDateTime(x.ts_local)}
                    {x.tz_status !== 'confirmed' && <span className="text-amber"> *</span>}
                  </td>
                  <td className="text-xs">
                    {x.cell_changed && <Badge tone="teal" className="mr-1">troca</Badge>}
                    {x.site_name ?? <span className="font-mono">{x.cell_key}</span>}
                    {x.lat === null && <span className="text-faint"> (sem coordenada)</span>}
                  </td>
                  <td className="font-mono text-xs">{x.interval_s !== null ? fmtDuration(x.interval_s) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {q.data?.truncated && <p className="mt-2 text-xs text-amber">Sequência limitada a 5.000 registros: reduza o período.</p>}
          <p className="mt-2 text-xs text-faint">* fuso horário não confirmado</p>
        </aside>
      </div>
      {q.data && <Criteria criteria={q.data.criteria} />}
    </>
  )
}
