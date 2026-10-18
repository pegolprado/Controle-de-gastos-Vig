import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { EventFilter } from '../components/FilterBar'
import { decodeFilter, encodeFilter } from './format'

/** Filtro guardado na URL: compartilhável e usado pelo "abrir os registros". */
export function useUrlFilter(defaults: EventFilter = {}): [EventFilter, (f: EventFilter) => void] {
  const [sp, setSp] = useSearchParams()
  const raw = sp.get('f')
  const f = useMemo(() => decodeFilter(raw) ?? defaults, [raw]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (nf: EventFilter) => {
    const next = new URLSearchParams(sp)
    if (Object.keys(nf).length) next.set('f', encodeFilter(nf))
    else next.delete('f')
    setSp(next, { replace: true })
  }
  return [f, set]
}
