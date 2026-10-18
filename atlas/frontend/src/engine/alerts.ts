/**
 * Regras de alerta analítico, executadas sobre os dados da sessão (memória).
 *
 * Alertas apontam padrões que merecem revisão humana. Nunca classificam pessoas
 * como suspeitas ou culpadas.
 */
import { fmtNumberPlain } from '../lib/format'
import { coincidences, comparePeriods, type EventFilter, where } from './analytics'
import { q, q1 } from './db'
import { quickHash } from './normalize'
import { type AlertRec, type AlertRule, getState, nextId, nowIso, setState } from './session'
import { lit } from './text'

export const RULE_TYPES: Record<string, { label: string; params: Record<string, any> }> = {
  volume_diario: { label: 'Quantidade de eventos acima de um limite (por número/dia)', params: { threshold: 50 } },
  mudanca_frequencia: {
    label: 'Mudança significativa na frequência de contatos entre períodos',
    params: { period1_from: null, period1_to: null, period2_from: null, period2_to: null, min_events: 5 },
  },
  faixa_horaria: { label: 'Eventos em faixa de horário acima de um limite (por número/dia)', params: { hour_from: 0, hour_to: 5, threshold: 5 } },
  mesma_celula_janela: { label: 'Registros de múltiplos números na mesma célula (ou mesmo local de estação) e janela temporal', params: { window_s: 600, same_site_m: 200 } },
  divergencia_cadastro: { label: 'Divergência entre cadastros técnicos de ERB', params: {} },
  horario_inconsistente: { label: 'Registros com horários inconsistentes', params: {} },
  duplicidades: { label: 'Duplicidades suspeitas', params: { min: 1 } },
}

export const DEFAULT_RULES: Omit<AlertRule, 'id' | 'active'>[] = [
  { name: 'Volume diário elevado', rule_type: 'volume_diario', params: { threshold: 40 }, severity: 'media' },
  { name: 'Atividade de madrugada', rule_type: 'faixa_horaria', params: { hour_from: 0, hour_to: 5, threshold: 5 }, severity: 'baixa' },
  { name: 'Mudança de frequência de contatos', rule_type: 'mudanca_frequencia', params: { min_events: 5 }, severity: 'media' },
  { name: 'Números no mesmo local de estação (10 min)', rule_type: 'mesma_celula_janela', params: { window_s: 600, same_site_m: 200 }, severity: 'media' },
  { name: 'Divergência no cadastro de ERB', rule_type: 'divergencia_cadastro', params: {}, severity: 'alta' },
  { name: 'Horários inconsistentes', rule_type: 'horario_inconsistente', params: {}, severity: 'alta' },
  { name: 'Duplicidades', rule_type: 'duplicidades', params: { min: 1 }, severity: 'baixa' },
]

export function ensureDefaultRules() {
  if (getState().rules.length) return
  setState({ rules: DEFAULT_RULES.map((r) => ({ ...r, id: nextId(), active: true })) })
}

export function saveRule(rule: Omit<AlertRule, 'id'> & { id?: number }) {
  setState((s) => {
    if (rule.id) return { rules: s.rules.map((r) => (r.id === rule.id ? ({ ...r, ...rule } as AlertRule) : r)) }
    return { rules: [...s.rules, { ...rule, id: nextId() } as AlertRule] }
  })
}

export function deleteRule(id: number) {
  setState((s) => ({ rules: s.rules.filter((r) => r.id !== id), alerts: s.alerts.filter((a) => a.rule_id !== id) }))
}

export function reviewAlert(id: number, review_status: string, analyst_note: string | null) {
  setState((s) => ({ alerts: s.alerts.map((a) => (a.id === id ? { ...a, review_status, analyst_note } : a)) }))
}

const day = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

export async function runRules(ruleIds: number[] | null = null) {
  const st = getState()
  const rules = st.rules.filter((r) => r.active && (!ruleIds || ruleIds.includes(r.id)))
  const existing = new Set(st.alerts.map((a) => a.fingerprint))
  const out: AlertRec[] = []
  const created: Record<number, number> = {}
  const base: EventFilter = {}
  const w = where(base)

  for (const r of rules) {
    let n = 0
    const prm: Record<string, any> = { ...(RULE_TYPES[r.rule_type]?.params ?? {}), ...(r.params ?? {}) }
    const add = (key: unknown[], title: string, description: string, support: number[], params: Record<string, any>) => {
      const fp = quickHash([r.rule_type, r.id, ...key.map((k) => JSON.stringify(k))])
      if (existing.has(fp)) return
      existing.add(fp)
      out.push({
        id: nextId(), rule_id: r.id, rule_type: r.rule_type, title: title.slice(0, 300), description, params,
        support_event_ids: support.slice(0, 500), support_count: support.length, severity: r.severity,
        review_status: 'pendente', analyst_note: null, fingerprint: fp, created_at: nowIso(),
      })
      n++
    }

    if (r.rule_type === 'volume_diario') {
      const th = Math.trunc(Number(prm.threshold))
      const rows = await q(`SELECT target_number, CAST(ts_local AS DATE) AS day, count(*)::INTEGER AS n, list(id ORDER BY ts_local) AS ids
                              FROM events e WHERE ${w} GROUP BY 1, 2 HAVING count(*) > ${th} ORDER BY n DESC LIMIT 500`)
      for (const row of rows)
        add([row.target_number, row.day], `${row.n} eventos de ${fmtNumberPlain(row.target_number)} em ${day(row.day)}`,
          `Quantidade diária acima do limite configurado (${th}).`, row.ids, { threshold: th, number: row.target_number, day: row.day })
    } else if (r.rule_type === 'faixa_horaria') {
      const hf = Math.trunc(Number(prm.hour_from))
      const ht = Math.trunc(Number(prm.hour_to))
      const th = Math.trunc(Number(prm.threshold))
      const w2 = where({ ...base, hour_from: hf, hour_to: ht })
      const rows = await q(`SELECT target_number, CAST(ts_local AS DATE) AS day, count(*)::INTEGER AS n, list(id ORDER BY ts_local) AS ids
                              FROM events e WHERE ${w2} GROUP BY 1, 2 HAVING count(*) >= ${th} ORDER BY n DESC LIMIT 500`)
      const pad = (h: number) => String(h).padStart(2, '0')
      for (const row of rows)
        add([row.target_number, row.day, hf, ht], `${row.n} eventos entre ${hf}h e ${ht}h — ${fmtNumberPlain(row.target_number)} em ${day(row.day)}`,
          `Eventos na faixa ${pad(hf)}h–${pad(ht)}h (horário do documento) acima do limite (${th}).`, row.ids, { ...prm, number: row.target_number, day: row.day })
    } else if (r.rule_type === 'mudanca_frequencia') {
      let p1: [string, string]
      let p2: [string, string]
      if (['period1_from', 'period1_to', 'period2_from', 'period2_to'].every((k) => prm[k])) {
        p1 = [prm.period1_from, prm.period1_to]
        p2 = [prm.period2_from, prm.period2_to]
      } else {
        const span = await q1(`SELECT min(ts_local) AS a, max(ts_local) AS b FROM events e WHERE ${w}`)
        if (!span?.a) {
          created[r.id] = 0
          continue
        }
        const a = Date.parse(`${span.a}Z`)
        const b = Date.parse(`${span.b}Z`)
        const mid = Math.floor((a + (b - a) / 2) / 1000) * 1000
        const iso = (ms: number) => new Date(ms).toISOString().slice(0, 19)
        p1 = [span.a, iso(mid)]
        p2 = [iso(mid + 1000), span.b]
      }
      const res = await comparePeriods(base, p1, p2)
      const minEv = Math.trunc(Number(prm.min_events ?? 5))
      for (const it of res.items) {
        if (!['aumentou', 'novo'].includes(it.status) || it.period2 < minEv) continue
        const ids = (await q(`SELECT id FROM events e WHERE ${where({ ...base, date_from: p2[0], date_to: p2[1] })}
                                AND target_number = ${lit(it.target_number)} AND other_number = ${lit(it.other_number)} ORDER BY ts_local LIMIT 500`)).map((x) => x.id)
        add([it.target_number, it.other_number, p1, p2], `Contato ${fmtNumberPlain(it.other_number)} ${it.status} para ${fmtNumberPlain(it.target_number)}`,
          `Taxa diária passou de ${it.rate1_per_day} para ${it.rate2_per_day} entre os períodos comparados.`, ids, { period1: p1, period2: p2, ...it })
      }
    } else if (r.rule_type === 'mesma_celula_janela') {
      const siteM = Math.trunc(Number(prm.same_site_m || 0)) || null
      const win = Math.trunc(Number(prm.window_s))
      const res = await coincidences([], base, win, siteM === null, 2000, siteM)
      const groups = new Map<string, { key: string[]; ids: number[] }>()
      for (const it of res.items) {
        const place = it.site1 || it.cell1
        const key = [place, it.number1, it.number2, String(it.ts1).slice(0, 10)]
        const k = key.join('|')
        if (!groups.has(k)) groups.set(k, { key, ids: [] })
        groups.get(k)!.ids.push(it.id1, it.id2)
      }
      const whereTxt = siteM ? `estações a até ${siteM} m` : 'mesma célula'
      for (const { key, ids } of groups.values())
        add(key, `${fmtNumberPlain(key[1])} e ${fmtNumberPlain(key[2])} — ${key[0]} — ${day(key[3])}`,
          `Registros dos dois números (${whereTxt}) em janela de até ${win} s. Coincidência de registros de rede não indica presença física conjunta.`,
          [...new Set(ids)].sort((x, y) => x - y), { ...prm, place: key[0] })
    } else if (r.rule_type === 'divergencia_cadastro') {
      for (const row of await q(`SELECT cell_key, count(*)::INTEGER AS n, list(id) AS ids FROM erb_cells WHERE validation_status = 'conflito' GROUP BY 1`))
        add(['conflito', row.cell_key], `Cadastro de ERB com coordenadas conflitantes: ${row.cell_key}`,
          `${row.n} linhas do cadastro com o mesmo identificador e coordenadas diferentes.`, [], { erb_cell_ids: row.ids })
      for (const row of await q(`SELECT resolution_note, count(*)::INTEGER AS n, list(id) AS ids FROM events e WHERE ${w} AND resolution_note LIKE '%divergentes entre versões%' GROUP BY 1`))
        add(['versoes', row.resolution_note], 'Coordenadas divergentes entre versões do cadastro', row.resolution_note, row.ids, {})
    } else if (r.rule_type === 'horario_inconsistente') {
      const checks: [string, string, string][] = [
        ['futuro', 'ts_utc > CAST(now() AS TIMESTAMP)', 'Registros com data/hora no futuro'],
        ['antigo', "ts_local < TIMESTAMP '2000-01-01 00:00:00'", 'Registros com data anterior a 2000'],
        ['fuso', "tz_status = 'unknown'", 'Registros com fuso horário desconhecido'],
      ]
      for (const [key, cond, title] of checks) {
        const cnt = (await q1(`SELECT count(*)::INTEGER AS n FROM events e WHERE ${w} AND ${cond}`)).n
        if (!cnt) continue
        const ids = (await q(`SELECT id FROM events e WHERE ${w} AND ${cond} ORDER BY id LIMIT 500`)).map((x) => x.id)
        add([key, cnt], `${title}: ${cnt}`, 'Verifique o fuso e o formato de data definidos na importação.', ids, { count: cnt })
      }
      const oos = await q1(`SELECT count(*)::INTEGER AS n FROM events WHERE out_of_scope`)
      if (oos.n) {
        const ids = (await q(`SELECT id FROM events WHERE out_of_scope ORDER BY id LIMIT 500`)).map((x) => x.id)
        add(['fora_periodo', oos.n], `Registros fora do período autorizado: ${oos.n}`,
          'Esses registros ficam fora das análises por padrão. O aviso não amplia o escopo autorizado.', ids, {})
      }
    } else if (r.rule_type === 'duplicidades') {
      const min = Math.max(1, Math.trunc(Number(prm.min ?? 1)))
      const rows = await q(`SELECT s.original_name, e.file_id, count(*)::INTEGER AS n, list(e.id ORDER BY e.id) AS ids
                              FROM events e JOIN files s ON s.id = e.file_id
                             WHERE e.is_duplicate GROUP BY 1, 2 HAVING count(*) >= ${min}`)
      for (const row of rows)
        add([row.file_id, row.n], `${row.n} registros duplicados em ${row.original_name}`,
          'Registros idênticos a outros já carregados (não contabilizados nas estatísticas).', row.ids, { file_id: row.file_id })
    }
    created[r.id] = n
  }
  setState((s) => ({ alerts: [...s.alerts, ...out] }))
  return { created, rules: rules.length, ran_at: new Date().toISOString() }
}
