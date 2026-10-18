import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Clock, StickyNote, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuth } from '../../app/auth'
import { timeline } from '../../engine/analytics'
import { addAnnotation, deleteAnnotation } from '../../engine/annotations'
import { useCase } from '../../app/layout'
import { BarsChart } from '../../components/charts'
import { FilterBar } from '../../components/FilterBar'
import { Badge, Criteria, ErrorBox, Field, Loading, Modal, PageHeader, Pagination } from '../../components/ui'
import { EVENT_TYPE_LABEL, fmtDateTime, fmtDuration, fmtNumber } from '../../lib/format'
import { useUrlFilter } from '../../lib/useUrlFilter'

export default function Timeline() {
  const { c, canWrite, meta } = useCase()
  const { me } = useAuth()
  const navigate = useNavigate()
  const [f, setF] = useUrlFilter()
  const [bucket, setBucket] = useState<'day' | 'hour'>('day')
  const [gap, setGap] = useState(12)
  const [page, setPage] = useState(1)
  const [note, setNote] = useState<{ ts: string; number: string; text: string } | null>(null)
  const q = useQuery({
    queryKey: ['timeline', c.id, f, bucket, gap, page],
    queryFn: () => timeline(f, bucket, gap, page, 200) as Promise<any>,
    placeholderData: keepPreviousData,
  })
  const targets: string[] = (meta?.targets ?? []).map((t: any) => t.number)
  const chart = useMemo(() => {
    if (!q.data) return []
    const by: Record<string, any> = {}
    for (const b of q.data.buckets) {
      const k = b.bucket
      by[k] ??= { bucket: k }
      by[k][b.target_number ?? 'sem alvo'] = (by[k][b.target_number ?? 'sem alvo'] ?? 0) + b.n
    }
    return Object.values(by)
  }, [q.data])
  const series = useMemo(() => {
    const keys = new Set<string>()
    q.data?.buckets.forEach((b: any) => keys.add(b.target_number ?? 'sem alvo'))
    const ordered = [...targets.filter((t) => keys.has(t)), ...[...keys].filter((k) => !targets.includes(k))]
    return ordered.slice(0, 5).map((k) => ({ key: k, name: fmtNumber(k) }))
  }, [q.data, targets])
  // mescla eventos e anotações em ordem cronológica
  const rows = useMemo(() => {
    if (!q.data) return []
    const ev = q.data.events.items.map((e: any) => ({ kind: 'event', ts: e.ts_utc, e }))
    const first = ev[0]?.ts
    const last = ev[ev.length - 1]?.ts
    const an = q.data.annotations.filter((a: any) => (!first || a.ts_utc >= first) && (!last || a.ts_utc <= last)).map((a: any) => ({ kind: 'note', ts: a.ts_utc, a }))
    return [...ev, ...an].sort((x, y) => (x.ts < y.ts ? -1 : x.ts > y.ts ? 1 : 0))
  }, [q.data])
  return (
    <div>
      <PageHeader
        icon={<Clock className="h-5 w-5" />}
        title="Linha do tempo"
        subtitle="Eventos em ordem cronológica (UTC para ordenar; exibição no horário do documento), com picos, lacunas e anotações. Eventos com fuso presumido ou desconhecido são marcados individualmente."
        actions={
          canWrite && (
            <button className="btn-ghost" onClick={() => setNote({ ts: '', number: '', text: '' })}>
              <StickyNote className="h-4 w-4" /> Nova anotação
            </button>
          )
        }
      />
      <FilterBar value={f} onChange={(x) => (setF(x), setPage(1))} />
      <div className="card mb-4 flex flex-wrap items-end gap-4 p-4">
        <Field label="Agrupamento">
          <select value={bucket} onChange={(e) => setBucket(e.target.value as any)}>
            <option value="day">por dia</option>
            <option value="hour">por hora</option>
          </select>
        </Field>
        <Field label="Lacuna mínima (horas)">
          <input type="number" min={1} className="w-24" value={gap} onChange={(e) => setGap(+e.target.value)} />
        </Field>
      </div>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : (
        <>
          <BarsChart
            title={`Eventos por ${bucket === 'day' ? 'dia' : 'hora'} (clique numa barra para aproximar)`}
            data={chart}
            x="bucket"
            xFmt={(v) => (bucket === 'day' ? fmtDateTime(v).slice(0, 5) : fmtDateTime(v).slice(0, 13) + 'h')}
            series={series}
            onBarClick={(row) => {
              const d = String(row.bucket).slice(0, 10)
              if (bucket === 'day') {
                setF({ ...f, date_from: `${d}T00:00:00`, date_to: `${d}T23:59:59` })
                setBucket('hour')
              }
            }}
          />
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="card p-4">
              <div className="label mb-2">Períodos de maior atividade</div>
              {q.data.peaks.map((p: any, i: number) => (
                <div key={i} className="flex justify-between border-b border-line/50 py-1 text-sm">
                  <span>
                    {fmtDateTime(p.bucket, false)} · <span className="font-mono text-xs">{fmtNumber(p.target_number)}</span>
                  </span>
                  <b className="tabular-nums">{p.n}</b>
                </div>
              ))}
            </div>
            <div className="card p-4">
              <div className="label mb-2">Lacunas ≥ {gap} h sem registros</div>
              {q.data.gaps.length === 0 && <div className="text-sm text-muted">Nenhuma.</div>}
              {q.data.gaps.slice(0, 12).map((g: any, i: number) => (
                <div key={i} className="flex justify-between border-b border-line/50 py-1 text-sm">
                  <span>
                    <span className="font-mono text-xs">{fmtNumber(g.target_number)}</span> · {fmtDateTime(g.gap_start, false)} → {fmtDateTime(g.gap_end, false)}
                  </span>
                  <Badge tone="amber">{g.hours} h</Badge>
                </div>
              ))}
            </div>
          </div>
          <div className="card mt-4 p-3">
            <ol className="relative ml-3 border-l border-line">
              {rows.map((r: any, i: number) =>
                r.kind === 'event' ? (
                  <li key={'e' + r.e.id} className="mb-1 ml-4 cursor-pointer rounded-lg px-2 py-1.5 hover:bg-white/[0.03]" onClick={() => navigate(`../eventos/${r.e.id}`, { relative: 'path' })}>
                    <span className={`absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full ${r.e.event_type.startsWith('voz') ? 'bg-accent' : r.e.event_type.startsWith('sms') ? 'bg-violet' : r.e.event_type === 'dados' ? 'bg-teal' : 'bg-muted'}`} />
                    <div className="flex flex-wrap items-baseline gap-x-3 text-sm">
                      <span className="font-mono text-xs text-muted">{fmtDateTime(r.e.ts_local)}</span>
                      {r.e.tz_status !== 'confirmed' && <Badge tone="amber">{r.e.tz_status === 'unknown' ? 'fuso desconhecido' : 'fuso presumido'}</Badge>}
                      <span>{EVENT_TYPE_LABEL[r.e.event_type]}</span>
                      <span className="font-mono text-xs">
                        {fmtNumber(r.e.a_number)} → {fmtNumber(r.e.b_number)}
                      </span>
                      {r.e.duration_s !== null && <span className="font-mono text-xs text-faint">{fmtDuration(r.e.duration_s)}</span>}
                      <span className="font-mono text-[11px] text-faint">{r.e.cell_site ?? r.e.cell_key ?? ''}</span>
                      <span className="font-mono text-[11px] text-faint">
                        #{r.e.file_id} l.{r.e.row_number}
                      </span>
                    </div>
                  </li>
                ) : (
                  <li key={'a' + r.a.id + i} className="mb-1 ml-4 rounded-lg border border-violet/40 bg-violet/5 px-3 py-2">
                    <span className="absolute -left-[6px] mt-1 h-3 w-3 rotate-45 bg-violet" />
                    <div className="flex items-start justify-between gap-2 text-sm">
                      <div>
                        <span className="font-mono text-xs text-violet">{fmtDateTime(r.a.ts_utc.slice(0, 19))} UTC · anotação de {r.a.author}</span>
                        {r.a.number && <span className="ml-2 font-mono text-xs">{fmtNumber(r.a.number)}</span>}
                        <div className="mt-1">{r.a.text}</div>
                      </div>
                      {canWrite && (
                        <button
                          className="text-muted hover:text-danger"
                          aria-label="Remover anotação"
                          onClick={async () => {
                            await deleteAnnotation(r.a.id)
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </li>
                ),
              )}
            </ol>
            <Pagination page={page} size={200} total={q.data.events.total} onPage={setPage} />
          </div>
          <Criteria criteria={q.data.criteria} />
        </>
      )}
      <Modal open={!!note} onClose={() => setNote(null)} title="Nova anotação na linha do tempo">
        {note && (
          <div className="space-y-3">
            <Field label="Data e hora (horário de Brasília)">
              <input type="datetime-local" className="w-full" value={note.ts} onChange={(e) => setNote({ ...note, ts: e.target.value })} />
            </Field>
            <Field label="Número relacionado (opcional)">
              <input className="w-full" value={note.number} onChange={(e) => setNote({ ...note, number: e.target.value })} />
            </Field>
            <Field label="Texto">
              <textarea className="w-full" rows={3} value={note.text} onChange={(e) => setNote({ ...note, text: e.target.value })} />
            </Field>
            <button
              className="btn-primary w-full"
              disabled={!note.ts || note.text.length < 2}
              onClick={async () => {
                try {
                  await addAnnotation(note.ts, note.number || null, note.text, me?.name ?? 'analista')
                  setNote(null)
                } catch (e: any) {
                  toast.error(e.message)
                }
              }}
            >
              Salvar anotação
            </button>
          </div>
        )}
      </Modal>
    </div>
  )
}
