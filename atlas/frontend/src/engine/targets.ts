/** Alvos da análise (memória da sessão). A operadora informada é registrada como recebida, nunca deduzida pelo prefixo. */
import { q } from './db'
import { syncTargetsTable } from './importer'
import { normalizeNumber } from './normalize'
import { getState, nextId, setState, type Target } from './session'

export type TargetInput = Omit<Target, 'id' | 'number_normalized'> & { id?: number }

export async function saveTarget(input: TargetInput): Promise<string[]> {
  const [norm, warns] = normalizeNumber(input.number_original)
  if (!norm) throw new Error('Número inválido: informe o número com DDD.')
  const st = getState()
  if (st.targets.some((t) => t.number_normalized === norm && t.id !== input.id)) throw new Error('Este número já está na lista de alvos.')
  if (input.period_start && input.period_end && input.period_start > input.period_end) throw new Error('O início do período não pode ser posterior ao fim.')
  const warnings = [...warns]
  const m = st.meta
  if (m.period_start && input.period_start && input.period_start < m.period_start) warnings.push('O período do alvo começa antes do período autorizado da análise.')
  if (m.period_end && input.period_end && input.period_end > m.period_end) warnings.push('O período do alvo termina depois do período autorizado da análise.')
  const rec: Target = { ...input, id: input.id ?? nextId(), number_normalized: norm }
  setState((s) => ({ targets: input.id ? s.targets.map((t) => (t.id === input.id ? rec : t)) : [...s.targets, rec] }), true)
  await syncTargetsTable()
  return warnings
}

export async function deleteTarget(id: number) {
  setState((s) => ({ targets: s.targets.filter((t) => t.id !== id) }), true)
  await syncTargetsTable()
}

export async function eventsPerTarget(): Promise<Record<string, number>> {
  const rows = await q(`SELECT target_number, count(*)::INTEGER AS n FROM events WHERE NOT is_duplicate AND target_number IS NOT NULL GROUP BY 1`)
  return Object.fromEntries(rows.map((r) => [r.target_number, r.n]))
}
