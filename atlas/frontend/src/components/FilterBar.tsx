import clsx from 'clsx'
import { Bookmark, Filter, RotateCcw, Save, SlidersHorizontal } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { nextId, setState, useSession } from '../engine/session'
import { useCase } from '../app/layout'
import { EVENT_TYPE_LABEL, fmtNumber } from '../lib/format'

export type EventFilter = {
  numbers?: string[]
  targets?: string[]
  others?: string[]
  event_types?: string[]
  operators?: string[]
  date_from?: string | null
  date_to?: string | null
  hour_from?: number | null
  hour_to?: number | null
  weekdays?: number[]
  dur_min?: number | null
  dur_max?: number | null
  cell_keys?: string[]
  file_ids?: number[]
  event_ids?: number[]
  resolution?: string[]
  tz_status?: string[]
  only_clean?: boolean
  min_confidence?: number | null
  include_duplicates?: boolean
  include_out_of_scope?: boolean
  only_duplicates?: boolean
  only_out_of_scope?: boolean
  imei?: string | null
  ip?: string | null
}

export function cleanFilter(f: EventFilter): EventFilter {
  const out: any = {}
  for (const [k, v] of Object.entries(f)) {
    if (v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0) || v === false) continue
    out[k] = v
  }
  return out
}

function toggle<T>(arr: T[] | undefined, v: T): T[] {
  const a = arr ?? []
  return a.includes(v) ? a.filter((x) => x !== v) : [...a, v]
}

export function FilterBar({ value, onChange, compact, hide = [] }: { value: EventFilter; onChange: (f: EventFilter) => void; compact?: boolean; hide?: string[] }) {
  const { c, meta } = useCase()
  const [draft, setDraft] = useState<EventFilter>(value)
  const [more, setMore] = useState(false)
  const [numText, setNumText] = useState((value.numbers ?? []).join(', '))
  useEffect(() => {
    setDraft(value)
    setNumText((value.numbers ?? []).join(', '))
  }, [value])
  const saved = { data: useSession((s) => s.savedQueries) }
  const save = {
    mutate: (name: string) => {
      setState((s) => ({ savedQueries: [...s.savedQueries, { id: nextId(), name: name.slice(0, 80), filters: cleanFilter(draft) }] }))
      toast.success('Filtros guardados nesta sessão (somem ao sair)')
    },
  }
  void c
  const targets: { number: string; label: string }[] = meta?.targets ?? []
  const set = (patch: Partial<EventFilter>) => setDraft((d) => ({ ...d, ...patch }))
  const apply = () => {
    const nums = numText
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
    onChange(cleanFilter({ ...draft, numbers: nums }))
  }
  return (
    <form
      className="card mb-5 p-4"
      onSubmit={(e) => {
        e.preventDefault()
        apply()
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        {!hide.includes('targets') && targets.length > 0 && (
          <div>
            <span className="label">Alvos</span>
            <div className="flex flex-wrap gap-1">
              {targets.map((t) => (
                <button
                  type="button"
                  key={t.number}
                  onClick={() => set({ targets: toggle(draft.targets, t.number) })}
                  className={clsx('chip !py-1.5', draft.targets?.includes(t.number) ? 'border-accent bg-accent/20 text-white' : 'border-line text-muted hover:text-text')}
                >
                  {fmtNumber(t.number)}
                  {t.label ? <span className="text-teal">· {t.label}</span> : null}
                </button>
              ))}
            </div>
          </div>
        )}
        {!hide.includes('numbers') && (
          <label className="min-w-52 flex-1">
            <span className="label">Números (qualquer posição)</span>
            <input className="w-full" placeholder="(61) 99999-0000, …" value={numText} onChange={(e) => setNumText(e.target.value)} />
          </label>
        )}
        {!hide.includes('dates') && (
          <>
            <label>
              <span className="label">De</span>
              <input type="datetime-local" value={draft.date_from?.slice(0, 16) ?? ''} onChange={(e) => set({ date_from: e.target.value || null })} />
            </label>
            <label>
              <span className="label">Até</span>
              <input type="datetime-local" value={draft.date_to?.slice(0, 16) ?? ''} onChange={(e) => set({ date_to: e.target.value || null })} />
            </label>
          </>
        )}
        <div className="flex gap-2">
          <button type="submit" className="btn-primary">
            <Filter className="h-4 w-4" /> Aplicar
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              setDraft({})
              setNumText('')
              onChange({})
            }}
            title="Limpar filtros"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
          {!compact && (
            <button type="button" className={clsx('btn-ghost', more && 'border-accent/60')} onClick={() => setMore(!more)}>
              <SlidersHorizontal className="h-4 w-4" /> Mais filtros
            </button>
          )}
        </div>
      </div>
      {more && (
        <div className="mt-4 grid gap-4 border-t border-line pt-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="md:col-span-2">
            <span className="label">Tipos de evento</span>
            <div className="flex flex-wrap gap-1">
              {Object.entries(EVENT_TYPE_LABEL).map(([k, l]) => (
                <button
                  type="button"
                  key={k}
                  onClick={() => set({ event_types: toggle(draft.event_types, k) })}
                  className={clsx('chip !py-1', draft.event_types?.includes(k) ? 'border-accent bg-accent/20 text-white' : 'border-line text-muted')}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label>
              <span className="label">Hora inicial</span>
              <input type="number" min={0} max={23} className="w-full" value={draft.hour_from ?? ''} onChange={(e) => set({ hour_from: e.target.value === '' ? null : +e.target.value })} />
            </label>
            <label>
              <span className="label">Hora final</span>
              <input type="number" min={0} max={23} className="w-full" value={draft.hour_to ?? ''} onChange={(e) => set({ hour_to: e.target.value === '' ? null : +e.target.value })} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label>
              <span className="label">Duração mín. (s)</span>
              <input type="number" min={0} className="w-full" value={draft.dur_min ?? ''} onChange={(e) => set({ dur_min: e.target.value === '' ? null : +e.target.value })} />
            </label>
            <label>
              <span className="label">Duração máx. (s)</span>
              <input type="number" min={0} className="w-full" value={draft.dur_max ?? ''} onChange={(e) => set({ dur_max: e.target.value === '' ? null : +e.target.value })} />
            </label>
          </div>
          <div>
            <span className="label">Operadora</span>
            <div className="flex flex-wrap gap-1">
              {(meta?.operators ?? []).map((o: string) => (
                <button type="button" key={o} onClick={() => set({ operators: toggle(draft.operators, o) })} className={clsx('chip !py-1', draft.operators?.includes(o) ? 'border-accent bg-accent/20 text-white' : 'border-line text-muted')}>
                  {o}
                </button>
              ))}
              {!(meta?.operators ?? []).length && <span className="text-xs text-faint">—</span>}
            </div>
          </div>
          <div>
            <span className="label">Arquivo de origem</span>
            <select
              multiple
              className="h-24 w-full"
              value={(draft.file_ids ?? []).map(String)}
              onChange={(e) => set({ file_ids: Array.from(e.target.selectedOptions).map((o) => +o.value) })}
            >
              {(meta?.files ?? [])
                .filter((f: any) => f.kind === 'cdr')
                .map((f: any) => (
                  <option key={f.id} value={f.id}>
                    #{f.id} {f.name}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <span className="label">Célula (chave)</span>
            <input className="w-full" placeholder="ex.: 3G|724|02|L1100|C20001" value={(draft.cell_keys ?? []).join(', ')} onChange={(e) => set({ cell_keys: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label>
              <span className="label">IMEI</span>
              <input className="w-full" value={draft.imei ?? ''} onChange={(e) => set({ imei: e.target.value || null })} />
            </label>
            <label>
              <span className="label">IP</span>
              <input className="w-full" value={draft.ip ?? ''} onChange={(e) => set({ ip: e.target.value || null })} />
            </label>
          </div>
          <div>
            <span className="label">Qualidade dos dados</span>
            <div className="space-y-1.5 text-sm">
              {(
                [
                  ['only_clean', 'Somente registros sem alertas de validação'],
                  ['include_duplicates', 'Incluir duplicados'],
                  ['include_out_of_scope', 'Incluir fora do período autorizado'],
                ] as const
              ).map(([k, l]) => (
                <label key={k} className="flex items-center gap-2">
                  <input type="checkbox" checked={!!draft[k]} onChange={(e) => set({ [k]: e.target.checked })} /> {l}
                </label>
              ))}
              <div className="flex flex-wrap gap-1 pt-1">
                {[
                  ['confirmed', 'fuso confirmado'],
                  ['assumed', 'presumido'],
                  ['unknown', 'desconhecido'],
                ].map(([k, l]) => (
                  <button type="button" key={k} onClick={() => set({ tz_status: toggle(draft.tz_status, k) })} className={clsx('chip !py-1', draft.tz_status?.includes(k) ? 'border-accent bg-accent/20 text-white' : 'border-line text-muted')}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div>
            <span className="label">Resolução de ERB</span>
            <div className="flex flex-wrap gap-1">
              {[
                ['exact', 'exata'],
                ['probable', 'provável'],
                ['ambiguous', 'ambígua'],
                ['none', 'não resolvida'],
              ].map(([k, l]) => (
                <button type="button" key={k} onClick={() => set({ resolution: toggle(draft.resolution, k) })} className={clsx('chip !py-1', draft.resolution?.includes(k) ? 'border-accent bg-accent/20 text-white' : 'border-line text-muted')}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="label">Filtros desta sessão</span>
            <div className="flex flex-wrap gap-1">
              {(saved.data ?? []).map((s) => (
                <button
                  type="button"
                  key={s.id}
                  className="chip border-line !py-1 text-muted hover:text-text"
                  onClick={() => {
                    setDraft(s.filters)
                    setNumText((s.filters.numbers ?? []).join(', '))
                    onChange(s.filters)
                  }}
                >
                  <Bookmark className="h-3 w-3" /> {s.name}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn-ghost mt-2 !py-1 text-xs"
              onClick={() => {
                const name = prompt('Nome da consulta')
                if (name) save.mutate(name)
              }}
            >
              <Save className="h-3.5 w-3.5" /> Guardar filtros nesta sessão
            </button>
          </div>
        </div>
      )}
    </form>
  )
}
