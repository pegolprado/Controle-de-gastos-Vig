/** Correções manuais de registros, feitas pelo analista e listadas no detalhe do evento (somente na sessão). */
import { exec, q1 } from './db'
import { EVENT_TYPES, normalizeNumber } from './normalize'
import { getState, nextId, nowIso, setState } from './session'
import { lit } from './text'

const NUMBER_FIELDS = ['a_number', 'b_number', 'target_number', 'other_number']
const ALLOWED = ['event_type', 'direction', ...NUMBER_FIELDS, 'duration_s', 'ts_local', 'status']

export async function correctEvent(id: number, field: string, value: string | null, reason: string) {
  if (!ALLOWED.includes(field)) throw new Error('Campo não pode ser corrigido.')
  if (!reason || reason.trim().length < 5) throw new Error('Informe a justificativa (mínimo de 5 caracteres).')
  const cur = await q1(`SELECT CAST(${field} AS VARCHAR) AS v, revision FROM events WHERE id = ${Number(id)}`)
  if (!cur) throw new Error('Registro não encontrado.')
  let v: string | null = value?.trim() || null
  let sqlv = 'NULL'
  if (v !== null) {
    if (NUMBER_FIELDS.includes(field)) {
      const [n] = normalizeNumber(v)
      if (!n) throw new Error('Número inválido.')
      v = n
      sqlv = lit(n)
    } else if (field === 'duration_s') {
      if (!/^\d+$/.test(v)) throw new Error('Duração deve ser um número inteiro de segundos.')
      sqlv = v
    } else if (field === 'event_type') {
      if (!EVENT_TYPES[v]) throw new Error('Tipo de evento inválido.')
      sqlv = lit(v)
    } else if (field === 'direction') {
      if (!['out', 'in', 'unknown'].includes(v)) throw new Error('Sentido deve ser out, in ou unknown.')
      sqlv = lit(v)
    } else if (field === 'ts_local') {
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(v)) throw new Error('Use o formato AAAA-MM-DDTHH:MM:SS.')
      if (v.length === 16) v += ':00'
      sqlv = `TIMESTAMP ${lit(v.replace('T', ' '))}`
    } else sqlv = lit(v)
  } else if (field === 'ts_local' || field === 'event_type') throw new Error('Este campo não pode ficar vazio.')
  // data/hora: o horário UTC acompanha o deslocamento aplicado ao horário local
  const extra = field === 'ts_local' ? `, ts_utc = ts_utc + (${sqlv} - ts_local)` : ''
  await exec(`UPDATE events SET ${field} = ${sqlv}${extra}, revision = revision + 1 WHERE id = ${Number(id)}`)
  const rec = { id: nextId(), event_id: id, revision: (cur.revision ?? 0) + 1, field, old: cur.v ?? null, new: v, reason: reason.trim(), at: nowIso() }
  setState((s) => ({ corrections: [...s.corrections, rec] }), true)
}

export function correctionsFor(id: number) {
  return getState().corrections.filter((c) => c.event_id === id)
}
