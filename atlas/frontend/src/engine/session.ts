/**
 * Estado da sessão de análise — existe SOMENTE na memória desta aba do navegador.
 * Não usa localStorage, sessionStorage, IndexedDB nem cookies. Sair, fechar a aba,
 * recarregar a página ou ficar inativo apaga tudo.
 */
import { useSyncExternalStore } from 'react'
import type { Fmt, TableInfo } from './readers'

export type Target = {
  id: number
  number_normalized: string
  number_original: string
  operator: string | null
  internal_id: string | null
  label: string | null
  period_start: string | null
  period_end: string | null
  source: string | null
  notes: string | null
  validation_status: string
}

export type Issue = { row: number | null; page?: number | null; field: string; severity: 'error' | 'warning'; code: string; message: string; raw?: Record<string, string> | null }

export type ImportRec = {
  id: number
  file_id: number
  kind: 'cdr' | 'erb_registry'
  mapping: Record<string, string>
  options: Record<string, any>
  status: 'draft' | 'running' | 'done' | 'failed' | 'cancelled' | 'superseded'
  rows_total: number
  rows_ok: number
  rows_error: number
  rows_warning: number
  rows_duplicate: number
  rows_out_of_scope: number
  rules_version: string
  summary: Record<string, any>
  issues: Issue[]
  progress: number
  message: string | null
  created_at: string
  finished_at: string | null
}

export type SessionFile = {
  id: number
  parent_id: number | null
  original_name: string
  size_bytes: number
  sha256: string
  detected_format: Fmt
  kind: 'cdr' | 'erb_registry' | 'other'
  operator_declared: string | null
  operator_detected: string | null
  operator_confidence: number | null
  status: string
  received_at: string
  blob: Blob
  table?: Partial<TableInfo>
  meta: Record<string, any>
}

export type AlertRec = {
  id: number
  rule_id: number
  rule_type: string
  title: string
  description: string
  params: Record<string, any>
  support_event_ids: number[]
  support_count: number
  severity: string
  review_status: string
  analyst_note: string | null
  fingerprint: string
  created_at: string
}

export type AlertRule = { id: number; name: string; rule_type: string; params: Record<string, any>; severity: string; active: boolean }

export type Correction = { id: number; event_id: number; revision: number; field: string; old: string | null; new: string | null; reason: string; at: string }

export type SessionMeta = { title: string; reference: string; unit: string; period_start: string | null; period_end: string | null; description: string }

export type State = {
  meta: SessionMeta
  targets: Target[]
  files: SessionFile[]
  imports: ImportRec[]
  alerts: AlertRec[]
  rules: AlertRule[]
  savedQueries: { id: number; name: string; filters: any }[]
  resolutionRuns: { id: number; created_at: string; result: any }[]
  corrections: Correction[]
  isDemo: boolean
  busy: { label: string; progress: number } | null
  version: number // incrementa a cada alteração de dados (invalida consultas)
}

const initial = (): State => ({
  meta: { title: 'Análise sem título', reference: '', unit: '', period_start: null, period_end: null, description: '' },
  targets: [],
  files: [],
  imports: [],
  alerts: [],
  rules: [],
  savedQueries: [],
  resolutionRuns: [],
  corrections: [],
  isDemo: false,
  busy: null,
  version: 0,
})

let state: State = initial()
const listeners = new Set<() => void>()
let seq = 1

export function nextId() {
  return seq++
}

export function getState() {
  return state
}

export function setState(patch: Partial<State> | ((s: State) => Partial<State>), bumpData = false) {
  const p = typeof patch === 'function' ? patch(state) : patch
  state = { ...state, ...p, version: bumpData ? state.version + 1 : state.version }
  listeners.forEach((l) => l())
}

export function subscribe(l: () => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

export function useSession<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => sel(state))
}

export function updateImport(id: number, patch: Partial<ImportRec>, bumpData = false) {
  setState((s) => ({ imports: s.imports.map((i) => (i.id === id ? { ...i, ...patch } : i)) }), bumpData)
}

export function updateFile(id: number, patch: Partial<SessionFile>) {
  setState((s) => ({ files: s.files.map((f) => (f.id === id ? { ...f, ...patch } : f)) }))
}

/** Zera a sessão em memória (os dados do banco local são limpos por resetDb). */
export function clearSession() {
  state = initial()
  listeners.forEach((l) => l())
}

export function nowIso() {
  return new Date().toISOString().slice(0, 19)
}
