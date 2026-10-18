/**
 * Consultas analíticas no banco local (DuckDB em memória). Toda resposta traz
 * `criteria` (filtros, regras e limites) para o resultado ser reproduzível e
 * aberto até os registros que o sustentam.
 */
import { q, q1 } from './db'
import { EVENT_TYPES, normalizeNumber, RULES_VERSION } from './normalize'
import { lit, litList } from './text'

export const VOICE = ['voz_originada', 'voz_recebida', 'voz', 'desvio']

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
  import_ids?: number[]
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

export function normList(nums: string[] = []): string[] {
  return nums.map((n) => normalizeNumber(n)[0]).filter((x): x is string => !!x)
}

const ts = (v: string) => `TIMESTAMP ${lit(v.replace('T', ' ').slice(0, 19).padEnd(19, ':00').slice(0, 19))}`

function toTs(v: string, end = false) {
  let s = v.replace('T', ' ')
  if (s.length === 10) s += end ? ' 23:59:59' : ' 00:00:00'
  if (s.length === 16) s += end ? ':59' : ':00'
  if (end && s.endsWith('00:00:00')) s = s.slice(0, 11) + '23:59:59'
  return ts(s)
}

export function where(f: EventFilter, a = 'e'): string {
  const c: string[] = ['TRUE']
  if (f.only_duplicates) c.push(`${a}.is_duplicate`)
  else if (!f.include_duplicates) c.push(`NOT ${a}.is_duplicate`)
  if (f.only_out_of_scope) c.push(`${a}.out_of_scope`)
  else if (!f.include_out_of_scope) c.push(`NOT ${a}.out_of_scope`)
  const nums = normList(f.numbers)
  if (f.numbers?.length) c.push(nums.length ? `(${a}.target_number IN ${litList(nums)} OR ${a}.a_number IN ${litList(nums)} OR ${a}.b_number IN ${litList(nums)})` : 'FALSE')
  const tg = normList(f.targets)
  if (f.targets?.length) c.push(tg.length ? `${a}.target_number IN ${litList(tg)}` : 'FALSE')
  const ot = normList(f.others)
  if (f.others?.length) c.push(ot.length ? `${a}.other_number IN ${litList(ot)}` : 'FALSE')
  if (f.event_types?.length) c.push(`${a}.event_type IN ${litList(f.event_types)}`)
  if (f.operators?.length) c.push(`upper(${a}.operator) IN ${litList(f.operators.map((o) => o.toUpperCase()))}`)
  if (f.date_from) c.push(`${a}.ts_local >= ${toTs(f.date_from)}`)
  if (f.date_to) c.push(`${a}.ts_local <= ${toTs(f.date_to, true)}`)
  if (f.hour_from !== null && f.hour_from !== undefined && f.hour_to !== null && f.hour_to !== undefined) {
    const hf = Math.trunc(f.hour_from)
    const ht = Math.trunc(f.hour_to)
    c.push(hf <= ht ? `hour(${a}.ts_local) BETWEEN ${hf} AND ${ht}` : `(hour(${a}.ts_local) >= ${hf} OR hour(${a}.ts_local) <= ${ht})`)
  }
  if (f.weekdays?.length) c.push(`isodow(${a}.ts_local) IN ${litList(f.weekdays.map(Number))}`)
  if (f.dur_min !== null && f.dur_min !== undefined) c.push(`${a}.duration_s >= ${Number(f.dur_min)}`)
  if (f.dur_max !== null && f.dur_max !== undefined) c.push(`${a}.duration_s <= ${Number(f.dur_max)}`)
  if (f.cell_keys?.length) c.push(`${a}.cell_key IN ${litList(f.cell_keys)}`)
  if (f.file_ids?.length) c.push(`${a}.file_id IN ${litList(f.file_ids.map(Number))}`)
  if (f.import_ids?.length) c.push(`${a}.import_id IN ${litList(f.import_ids.map(Number))}`)
  if (f.event_ids?.length) c.push(`${a}.id IN ${litList(f.event_ids.map(Number))}`)
  if (f.resolution?.length) c.push(`(${a}.resolution_status IN ${litList(f.resolution)}${f.resolution.includes('pending') ? ` OR ${a}.resolution_status IS NULL` : ''})`)
  if (f.tz_status?.length) c.push(`${a}.tz_status IN ${litList(f.tz_status)}`)
  if (f.only_clean) c.push(`${a}.n_warnings = 0`)
  if (f.min_confidence !== null && f.min_confidence !== undefined) c.push(`${a}.confidence >= ${Number(f.min_confidence)}`)
  if (f.imei) c.push(`${a}.imei = ${lit(f.imei.trim())}`)
  if (f.ip) c.push(`${a}.ip = ${lit(f.ip.trim())}`)
  return c.join(' AND ')
}

function clean(f: EventFilter) {
  return Object.fromEntries(Object.entries(f).filter(([, v]) => !(v === null || v === undefined || v === '' || v === false || (Array.isArray(v) && !v.length))))
}

export function criteria(f: EventFilter, extra: Record<string, unknown> = {}): Record<string, any> {
  return {
    filters: clean(f),
    rules_version: RULES_VERSION,
    duplicates: f.include_duplicates ? 'incluídos' : 'excluídos (mesmo alvo, origem, destino, data/hora, duração, tipo, célula e IP)',
    out_of_scope: f.include_out_of_scope ? 'incluídos' : 'excluídos (fora do período autorizado da análise/alvo)',
    hours: 'horário local conforme o documento de origem',
    ...extra,
  }
}

const VOICE_IN = litList(VOICE)

// ---------------------------------------------------------------- explorador

const SORTABLE: Record<string, string> = { ts: 'e.ts_local', duration: 'e.duration_s', type: 'e.event_type', a: 'e.a_number', b: 'e.b_number', target: 'e.target_number', cell: 'e.cell_key', id: 'e.id' }

export const EVENT_COLUMNS = `e.id, e.ts_local, e.ts_utc, e.tz_status, e.tz_name, e.ts_original, e.event_type, e.direction,
  e.target_number, e.other_number, e.a_number, e.b_number, e.duration_s, e.status, e.operator, e.tech, e.mcc, e.mnc,
  e.lac, e.tac, e.cell_id, e.eci, e.nci, e.cgi, e.erb_raw, e.cell_key, e.imei, e.ip, e.lat, e.lon,
  e.resolution_status, e.resolution_rule, e.resolution_note, e.resolved_cell_id, e.file_id, e.import_id,
  e.row_number, e.page, e.warnings, e.n_warnings, e.confidence, e.is_duplicate, e.duplicate_of, e.out_of_scope, e.revision,
  c.lat AS cell_lat, c.lon AS cell_lon, c.azimuth AS cell_azimuth, c.site_name AS cell_site, c.site_code AS cell_site_code`

function parseWarnings<T extends Record<string, any>>(rows: T[]): T[] {
  for (const r of rows) if (typeof r.warnings === 'string') (r as any).warnings = JSON.parse(r.warnings)
  return rows
}

export async function listEvents(f: EventFilter, page = 1, size = 50, sort = 'ts', order = 'asc') {
  const w = where(f)
  const col = SORTABLE[sort] ?? 'e.ts_local'
  const dir = order === 'desc' ? 'DESC' : 'ASC'
  size = Math.max(1, Math.min(size, 1000))
  const total = (await q1<{ n: number }>(`SELECT count(*)::INTEGER AS n FROM events e WHERE ${w}`)).n
  const items = parseWarnings(
    await q(`SELECT ${EVENT_COLUMNS} FROM events e LEFT JOIN erb_cells c ON c.id = e.resolved_cell_id
             WHERE ${w} ORDER BY ${col} ${dir} NULLS LAST, e.id ${dir} LIMIT ${size} OFFSET ${(Math.max(page, 1) - 1) * size}`),
  )
  return { total, page, size, items, criteria: criteria(f) }
}

export async function allEvents(f: EventFilter, limit = 2_000_000) {
  return parseWarnings(await q(`SELECT ${EVENT_COLUMNS} FROM events e LEFT JOIN erb_cells c ON c.id = e.resolved_cell_id WHERE ${where(f)} ORDER BY e.ts_local, e.id LIMIT ${limit}`))
}

export async function eventDetail(id: number) {
  const e = await q1(`SELECT e.*, f.original_name AS file_name, f.detected_format AS file_format FROM events e LEFT JOIN files f ON f.id = e.file_id WHERE e.id = ${Number(id)}`)
  if (!e) throw new Error('Registro não encontrado')
  const cell = e.resolved_cell_id ? await q1(`SELECT * FROM erb_cells WHERE id = ${e.resolved_cell_id}`) : null
  const cands: number[] = e.resolution_candidates ? JSON.parse(e.resolution_candidates) : []
  const candidates = cands.length ? await q(`SELECT id, cell_key, site_name, lat, lon, version_id FROM erb_cells WHERE id IN ${litList(cands)}`) : []
  return {
    event: { ...e, raw: JSON.parse(e.raw ?? '{}'), warnings: JSON.parse(e.warnings ?? '[]') },
    file: { id: e.file_id, name: e.file_name, sha256: e.file_sha256, format: e.file_format },
    cell,
    candidates,
    type_label: EVENT_TYPES[e.event_type] ?? e.event_type,
  }
}

// ---------------------------------------------------------------- estatísticas

export async function summary(f: EventFilter) {
  const w = where(f)
  const t = await q1(`SELECT count(*)::INTEGER AS events,
      (count(*) FILTER (WHERE event_type IN ${VOICE_IN}))::INTEGER AS calls,
      (count(*) FILTER (WHERE event_type LIKE 'sms%'))::INTEGER AS sms,
      (count(*) FILTER (WHERE event_type = 'dados'))::INTEGER AS data_sessions,
      (count(*) FILTER (WHERE direction = 'out'))::INTEGER AS outgoing,
      (count(*) FILTER (WHERE direction = 'in'))::INTEGER AS incoming,
      (count(*) FILTER (WHERE event_type IN ${VOICE_IN} AND coalesce(duration_s, 0) = 0))::INTEGER AS zero_duration_calls,
      (sum(duration_s) FILTER (WHERE event_type IN ${VOICE_IN}))::DOUBLE AS call_seconds,
      round(avg(duration_s) FILTER (WHERE event_type IN ${VOICE_IN} AND duration_s > 0), 1) AS call_avg,
      round(quantile_cont(duration_s, 0.5) FILTER (WHERE event_type IN ${VOICE_IN} AND duration_s > 0), 1) AS call_median,
      count(DISTINCT CAST(ts_local AS DATE))::INTEGER AS active_days,
      count(DISTINCT other_number)::INTEGER AS distinct_contacts,
      count(DISTINCT cell_key)::INTEGER AS distinct_cells,
      count(DISTINCT imei)::INTEGER AS distinct_imeis,
      min(ts_local) AS first_event, max(ts_local) AS last_event,
      (count(*) FILTER (WHERE tz_status <> 'confirmed'))::INTEGER AS tz_not_confirmed,
      (count(*) FILTER (WHERE n_warnings > 0))::INTEGER AS with_warnings
    FROM events e WHERE ${w}`)
  const byType = (await q(`SELECT event_type, count(*)::INTEGER AS n FROM events e WHERE ${w} GROUP BY 1 ORDER BY 2 DESC`)).map((r) => ({ ...r, label: EVENT_TYPES[r.event_type] ?? r.event_type }))
  const byHour = await q(`SELECT hour(ts_local)::INTEGER AS hour, count(*)::INTEGER AS n FROM events e WHERE ${w} GROUP BY 1 ORDER BY 1`)
  const byWd = await q(`SELECT isodow(ts_local)::INTEGER AS weekday, count(*)::INTEGER AS n FROM events e WHERE ${w} GROUP BY 1 ORDER BY 1`)
  const byDay = await q(`SELECT CAST(ts_local AS DATE) AS day, count(*)::INTEGER AS n,
      (count(*) FILTER (WHERE event_type IN ${VOICE_IN}))::INTEGER AS calls, (count(*) FILTER (WHERE event_type LIKE 'sms%'))::INTEGER AS sms,
      (count(*) FILTER (WHERE event_type = 'dados'))::INTEGER AS data FROM events e WHERE ${w} GROUP BY 1 ORDER BY 1`)
  const gaps = await q1(`SELECT round(quantile_cont(gap, 0.5), 1) AS median_gap, round(avg(gap), 1) AS avg_gap, round(max(gap), 1) AS max_gap
      FROM (SELECT epoch(ts_utc) - epoch(lag(ts_utc) OVER (PARTITION BY target_number ORDER BY ts_utc)) AS gap FROM events e WHERE ${w}) g WHERE gap IS NOT NULL`)
  const hw = where({ ...f, include_duplicates: true, include_out_of_scope: true, only_duplicates: false, only_out_of_scope: false })
  const hidden = await q1(`SELECT (count(*) FILTER (WHERE is_duplicate))::INTEGER AS duplicates, (count(*) FILTER (WHERE out_of_scope))::INTEGER AS out_of_scope FROM events e WHERE ${hw}`)
  const sources = await q(`SELECT s.id, s.original_name, s.sha256, count(*)::INTEGER AS n FROM events e JOIN files s ON s.id = e.file_id WHERE ${w} GROUP BY s.id, s.original_name, s.sha256 ORDER BY s.id`)
  return {
    totals: t,
    by_type: byType,
    by_hour: byHour,
    by_weekday: byWd,
    by_day: byDay,
    intervals_s: gaps,
    excluded: hidden,
    sources,
    criteria: criteria(f, {
      duration_rule: 'durações somadas apenas para chamadas de voz; SMS e dados não entram no total de duração',
      interval_rule: 'intervalo entre eventos consecutivos do mesmo número alvo (UTC)',
    }),
  }
}

export async function contacts(f: EventFilter, limit = 200) {
  const w = where(f)
  const rows = await q(`SELECT target_number, other_number, count(*)::INTEGER AS events, count(DISTINCT CAST(ts_local AS DATE))::INTEGER AS days,
      (count(*) FILTER (WHERE direction = 'out'))::INTEGER AS outgoing, (count(*) FILTER (WHERE direction = 'in'))::INTEGER AS incoming,
      (count(*) FILTER (WHERE event_type IN ${VOICE_IN}))::INTEGER AS calls, (count(*) FILTER (WHERE event_type LIKE 'sms%'))::INTEGER AS sms,
      coalesce(sum(duration_s) FILTER (WHERE event_type IN ${VOICE_IN}), 0)::DOUBLE AS call_seconds,
      min(ts_local) AS first_event, max(ts_local) AS last_event, list(DISTINCT file_id ORDER BY file_id) AS file_ids
    FROM events e WHERE ${w} AND other_number IS NOT NULL GROUP BY 1, 2 ORDER BY events DESC, days DESC LIMIT ${Number(limit)}`)
  for (const r of rows) {
    r.reciprocal = r.outgoing > 0 && r.incoming > 0
    const span = r.first_event ? Math.floor((Date.parse(r.last_event + 'Z') - Date.parse(r.first_event + 'Z')) / 86400000) + 1 : 1
    r.regularity = span ? Math.round((r.days / span) * 1000) / 1000 : null
  }
  return {
    items: rows,
    criteria: criteria(f, {
      note: 'frequência de comunicação, isoladamente, não comprova vínculo pessoal nem participação em fato ilícito',
      regularity: 'dias com contato ÷ dias entre o primeiro e o último contato',
    }),
  }
}

export async function comparePeriods(f: EventFilter, p1: [string, string], p2: [string, string]) {
  const per = async (p: [string, string]) => {
    const ff = { ...f, date_from: p[0], date_to: p[1] }
    const rows = await q(`SELECT target_number, other_number, count(*)::INTEGER AS n, count(DISTINCT CAST(ts_local AS DATE))::INTEGER AS days FROM events e WHERE ${where(ff)} AND other_number IS NOT NULL GROUP BY 1, 2`)
    const days = Math.max(Math.floor((Date.parse(p[1].slice(0, 10)) - Date.parse(p[0].slice(0, 10))) / 86400000) + 1, 1)
    return [new Map(rows.map((r) => [`${r.target_number}|${r.other_number}`, r])), days] as const
  }
  const [a, da] = await per(p1)
  const [b, db] = await per(p2)
  const items: any[] = []
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    const na = a.get(key)?.n ?? 0
    const nb = b.get(key)?.n ?? 0
    const ra = na / da
    const rb = nb / db
    const status = na === 0 ? 'novo' : nb === 0 ? 'deixou de ocorrer' : rb >= ra * 1.5 ? 'aumentou' : rb <= ra / 1.5 ? 'reduziu' : 'estável'
    const [t, o] = key.split('|')
    items.push({ target_number: t, other_number: o, period1: na, period2: nb, rate1_per_day: Math.round(ra * 1000) / 1000, rate2_per_day: Math.round(rb * 1000) / 1000, days1: a.get(key)?.days ?? 0, days2: b.get(key)?.days ?? 0, status })
  }
  items.sort((x, y) => Math.abs(y.rate2_per_day - y.rate1_per_day) - Math.abs(x.rate2_per_day - x.rate1_per_day))
  return { items: items.slice(0, 500), period1: [...p1, da], period2: [...p2, db], criteria: criteria(f, { rule: 'taxas normalizadas por dia; variação ≥ 1,5× = aumento/redução' }) }
}

export async function commonContacts(numbers: string[], f: EventFilter) {
  const nums = normList(numbers)
  if (!nums.length) return { numbers: nums, shared: [], exclusive: {}, criteria: criteria(f) }
  const rows = await q(`SELECT other_number, target_number, count(*)::INTEGER AS n, count(DISTINCT CAST(ts_local AS DATE))::INTEGER AS days,
      min(ts_local) AS first_event, max(ts_local) AS last_event
    FROM events e WHERE ${where(f)} AND target_number IN ${litList(nums)} AND other_number IS NOT NULL GROUP BY 1, 2`)
  const byContact = new Map<string, Record<string, any>>()
  for (const r of rows) {
    const m = byContact.get(r.other_number) ?? {}
    m[r.target_number] = { n: r.n, days: r.days, first: r.first_event, last: r.last_event }
    byContact.set(r.other_number, m)
  }
  const shared: any[] = []
  const exclusive: Record<string, any[]> = {}
  for (const [contact, per] of byContact) {
    if (nums.includes(contact)) continue
    const ks = Object.keys(per)
    if (ks.length > 1) shared.push({ contact, per_number: per, numbers: ks.length, total: ks.reduce((a, k) => a + per[k].n, 0) })
    else (exclusive[ks[0]] ??= []).push({ contact, ...per[ks[0]] })
  }
  shared.sort((x, y) => y.numbers - x.numbers || y.total - x.total)
  for (const k of Object.keys(exclusive)) exclusive[k] = exclusive[k].sort((x, y) => y.n - x.n).slice(0, 50)
  return { numbers: nums, shared: shared.slice(0, 500), exclusive, criteria: criteria(f) }
}

const DIST = `6371000 * sqrt(power(radians(c2.lat - c1.lat), 2) + power(radians(c2.lon - c1.lon) * cos(radians((c1.lat + c2.lat) / 2)), 2))`

export async function coincidences(numbers: string[], f: EventFilter, windowS = 300, sameCell = false, limit = 1000, sameSiteM: number | null = null) {
  const nums = normList(numbers)
  const w1 = where(f, 'e1')
  const w2 = where(f, 'e2')
  const win = Math.max(1, Math.trunc(windowS))
  const numCond = nums.length ? `AND e1.target_number IN ${litList(nums)} AND e2.target_number IN ${litList(nums)}` : 'AND e1.target_number IS NOT NULL'
  const cellCond = sameCell ? 'AND e1.cell_key = e2.cell_key AND e1.cell_key IS NOT NULL' : ''
  const siteCond = sameSiteM ? `AND c1.lat IS NOT NULL AND c2.lat IS NOT NULL AND ${DIST} <= ${Number(sameSiteM)}` : ''
  const rows = await q(`SELECT e1.id AS id1, e2.id AS id2, e1.target_number AS number1, e2.target_number AS number2, e1.ts_local AS ts1, e2.ts_local AS ts2,
      e1.event_type AS type1, e2.event_type AS type2, e1.cell_key AS cell1, e2.cell_key AS cell2,
      abs(epoch(e2.ts_utc) - epoch(e1.ts_utc))::INTEGER AS delta_s, (e1.cell_key = e2.cell_key) AS same_cell,
      CASE WHEN c1.lat IS NOT NULL AND c2.lat IS NOT NULL THEN round(${DIST})::INTEGER END AS distance_m,
      c1.site_name AS site1, c2.site_name AS site2, e1.tz_status AS tz1, e2.tz_status AS tz2
    FROM events e1 JOIN events e2 ON e2.ts_utc BETWEEN e1.ts_utc - INTERVAL ${win} SECOND AND e1.ts_utc + INTERVAL ${win} SECOND AND e2.target_number > e1.target_number
      LEFT JOIN erb_cells c1 ON c1.id = e1.resolved_cell_id LEFT JOIN erb_cells c2 ON c2.id = e2.resolved_cell_id
    WHERE ${w1} AND ${w2} ${numCond} ${cellCond} ${siteCond} ORDER BY e1.ts_utc LIMIT ${Number(limit)}`)
  for (const r of rows) r.tz_mixed = r.tz1 !== r.tz2 || r.tz1 !== 'confirmed'
  return {
    items: rows,
    truncated: rows.length >= limit,
    criteria: criteria(f, {
      window_s: win, same_cell: sameCell, same_site_m: sameSiteM,
      classification: 'coincidência temporal observada — não indica que os titulares estavam juntos fisicamente',
      distance: 'distância entre as coordenadas cadastradas das estações (não entre aparelhos)',
    }),
  }
}

export async function compareNumbers(numbers: string[], f: EventFilter, windowS = 300) {
  const nums = normList(numbers)
  const per = []
  for (const n of nums) {
    const s = await summary({ ...f, targets: [n] })
    per.push({ number: n, totals: s.totals, by_hour: s.by_hour, by_weekday: s.by_weekday })
  }
  const cc = await commonContacts(nums, f)
  const w = where(f)
  const shared = (
    await q(`SELECT x.cell_key, count(DISTINCT x.target_number)::INTEGER AS numbers, sum(x.cnt)::INTEGER AS events,
        list(x.target_number || '=' || x.cnt) AS per_number, max(c.site_name) AS site_name, max(c.lat) AS lat, max(c.lon) AS lon
      FROM (SELECT cell_key, target_number, count(*)::INTEGER AS cnt, max(resolved_cell_id) AS rc FROM events e
            WHERE ${w} AND target_number IN ${litList(nums.length ? nums : [''])} AND cell_key IS NOT NULL GROUP BY 1, 2) x
      LEFT JOIN erb_cells c ON c.id = x.rc GROUP BY x.cell_key HAVING count(DISTINCT x.target_number) > 1 ORDER BY events DESC LIMIT 200`)
  ).map((r) => ({ ...r, per_number: Object.fromEntries((r.per_number as string[]).map((kv) => [kv.split('=')[0], Number(kv.split('=')[1])])) }))
  const coin = await coincidences(nums, f, windowS, false, 200)
  const direct = await q(`SELECT a_number, b_number, count(*)::INTEGER AS n, min(ts_local) AS first_event, max(ts_local) AS last_event
      FROM events e WHERE ${w} AND a_number IN ${litList(nums.length ? nums : [''])} AND b_number IN ${litList(nums.length ? nums : [''])} AND a_number <> b_number GROUP BY 1, 2`)
  return { numbers: nums, per_number: per, common_contacts: cc, shared_cells: shared, direct_contacts: direct, coincidences: coin, criteria: criteria(f, { window_s: windowS, note: 'compatibilidade temporal ou de célula não indica presença física conjunta' }) }
}

// ---------------------------------------------------------------- vínculos

export async function linkGraph(f: EventFilter, center: string | null = null, depth = 2, minEvents = 1, reciprocalOnly = false, maxEdges = 3000) {
  const w = where(f)
  let edges = await q(`SELECT least(a_number, b_number) AS n1, greatest(a_number, b_number) AS n2, count(*)::INTEGER AS events,
      count(DISTINCT CAST(ts_local AS DATE))::INTEGER AS days,
      (count(*) FILTER (WHERE a_number = least(a_number, b_number)))::INTEGER AS n1_to_n2,
      (count(*) FILTER (WHERE a_number = greatest(a_number, b_number)))::INTEGER AS n2_to_n1,
      coalesce(sum(duration_s) FILTER (WHERE event_type IN ${VOICE_IN}), 0)::DOUBLE AS call_seconds,
      min(ts_local) AS first_event, max(ts_local) AS last_event, list(DISTINCT file_id ORDER BY file_id) AS file_ids
    FROM events e WHERE ${w} AND a_number IS NOT NULL AND b_number IS NOT NULL AND a_number <> b_number
    GROUP BY 1, 2 HAVING count(*) >= ${Math.max(1, Number(minEvents))} ORDER BY events DESC LIMIT ${Number(maxEdges)}`)
  for (const e of edges) e.reciprocal = e.n1_to_n2 > 0 && e.n2_to_n1 > 0
  if (reciprocalOnly) edges = edges.filter((e) => e.reciprocal)
  if (center) {
    const c = normalizeNumber(center)[0]
    const adj = new Map<string, Set<string>>()
    for (const e of edges) {
      ;(adj.get(e.n1) ?? adj.set(e.n1, new Set()).get(e.n1)!).add(e.n2)
      ;(adj.get(e.n2) ?? adj.set(e.n2, new Set()).get(e.n2)!).add(e.n1)
    }
    const keep = new Set([c])
    let frontier = new Set([c])
    for (let i = 0; i < Math.max(depth, 1); i++) {
      const next = new Set<string>()
      for (const x of frontier) for (const n of adj.get(x!) ?? []) if (!keep.has(n)) next.add(n)
      next.forEach((n) => keep.add(n))
      frontier = next
    }
    edges = edges.filter((e) => keep.has(e.n1) && keep.has(e.n2))
  }
  const targets = new Map((await q(`SELECT number_normalized, label, internal_id FROM targets`)).map((t) => [t.number_normalized, t]))
  const deg = new Map<string, number>()
  const weight = new Map<string, number>()
  for (const e of edges)
    for (const n of [e.n1, e.n2]) {
      deg.set(n, (deg.get(n) ?? 0) + 1)
      weight.set(n, (weight.get(n) ?? 0) + e.events)
    }
  const tn = new Map<string, Set<string>>()
  for (const e of edges) {
    if (targets.has(e.n1)) (tn.get(e.n2) ?? tn.set(e.n2, new Set()).get(e.n2)!).add(e.n1)
    if (targets.has(e.n2)) (tn.get(e.n1) ?? tn.set(e.n1, new Set()).get(e.n1)!).add(e.n2)
  }
  const nodes = [...deg.keys()].map((id) => {
    const t = targets.get(id)
    return { id, is_target: !!t, label: t ? t.label || t.internal_id : null, degree: deg.get(id), events: weight.get(id), common_to_targets: t ? 0 : tn.get(id)?.size ?? 0 }
  })
  return {
    nodes,
    edges,
    truncated: edges.length >= maxEdges,
    criteria: criteria(f, { center, depth, min_events: minEvents, reciprocal_only: reciprocalOnly, note: 'conexões representam registros documentados de comunicação, não prova de vínculo pessoal ou associação' }),
  }
}

// ---------------------------------------------------------------- linha do tempo

export async function timeline(f: EventFilter, bucket: 'day' | 'hour' = 'day', gapHours = 12, page = 1, size = 200) {
  const w = where(f)
  const buckets = await q(`SELECT date_trunc('${bucket === 'hour' ? 'hour' : 'day'}', ts_local) AS bucket, target_number, count(*)::INTEGER AS n FROM events e WHERE ${w} GROUP BY 1, 2 ORDER BY 1`)
  const gaps = await q(`SELECT target_number, prev_ts AS gap_start, ts_local AS gap_end, round(gap / 3600.0, 1) AS hours
      FROM (SELECT target_number, ts_local, lag(ts_local) OVER (PARTITION BY target_number ORDER BY ts_local) AS prev_ts,
                   epoch(ts_local) - epoch(lag(ts_local) OVER (PARTITION BY target_number ORDER BY ts_local)) AS gap FROM events e WHERE ${w}) g
      WHERE gap >= ${Number(gapHours) * 3600} ORDER BY gap DESC LIMIT 100`)
  const events = await listEvents(f, page, size, 'ts', 'asc')
  const annotations = await q(`SELECT id, ts_utc, number, text, author, created_at FROM annotations ORDER BY ts_utc`)
  return {
    buckets,
    peaks: [...buckets].sort((a, b) => b.n - a.n).slice(0, 10),
    gaps,
    events,
    annotations,
    criteria: criteria(f, { bucket, gap_hours: gapHours, tz_note: 'eventos com fuso não confirmado são sinalizados individualmente' }),
  }
}

// ---------------------------------------------------------------- ERB e geografia

export async function cells(f: EventFilter, limit = 500) {
  const w = where(f)
  const items = await q(`SELECT e.cell_key, count(*)::INTEGER AS events, count(DISTINCT e.target_number)::INTEGER AS numbers,
      list(DISTINCT e.target_number) AS target_numbers, min(e.ts_local) AS first_event, max(e.ts_local) AS last_event,
      max(e.resolution_status) AS resolution_status, max(e.resolution_rule) AS resolution_rule, max(e.resolution_note) AS resolution_note,
      max(e.resolved_cell_id) AS cell_id_ref, max(e.tech) AS tech, max(e.operator) AS operator,
      max(c.site_name) AS site_name, max(c.site_code) AS site_code, max(c.lat) AS lat, max(c.lon) AS lon, max(c.azimuth) AS azimuth,
      max(c.beamwidth) AS beamwidth, max(c.address) AS address, max(c.version_id) AS version_id
    FROM events e LEFT JOIN erb_cells c ON c.id = e.resolved_cell_id WHERE ${w} AND e.cell_key IS NOT NULL
    GROUP BY e.cell_key ORDER BY events DESC LIMIT ${Number(limit)}`)
  const resolution = await q(`SELECT coalesce(resolution_status, 'pendente') AS status, count(*)::INTEGER AS n FROM events e WHERE ${w} GROUP BY 1`)
  const noId = (await q1<{ n: number }>(`SELECT count(*)::INTEGER AS n FROM events e WHERE ${w} AND cell_key IS NULL`)).n
  return { items, resolution, events_without_cell: noId, criteria: criteria(f, { limit_note: 'a ERB registrada não comprova a posição exata do aparelho ou da pessoa' }) }
}

export async function cellsByPeriod(f: EventFilter, p1: [string, string], p2: [string, string]) {
  const per = async (p: [string, string]) =>
    new Map((await q(`SELECT cell_key, count(*)::INTEGER AS n FROM events e WHERE ${where({ ...f, date_from: p[0], date_to: p[1] })} AND cell_key IS NOT NULL GROUP BY 1`)).map((r) => [r.cell_key, r.n]))
  const a = await per(p1)
  const b = await per(p2)
  const items = [...new Set([...a.keys(), ...b.keys()])].map((k) => ({ cell_key: k, period1: a.get(k) ?? 0, period2: b.get(k) ?? 0, status: !b.has(k) ? 'só período 1' : !a.has(k) ? 'só período 2' : 'ambos' }))
  items.sort((x, y) => y.period1 + y.period2 - (x.period1 + x.period2))
  return { items: items.slice(0, 500), criteria: criteria(f) }
}

export async function registry(qtext: string | null, versionId: number | null, status: string | null, page: number, size: number) {
  const c = ['TRUE']
  if (qtext) c.push(`(c.cell_key ILIKE ${lit('%' + qtext + '%')} OR c.site_name ILIKE ${lit('%' + qtext + '%')} OR c.site_code ILIKE ${lit('%' + qtext + '%')} OR c.cgi ILIKE ${lit('%' + qtext + '%')} OR c.address ILIKE ${lit('%' + qtext + '%')} OR c.cell_id = ${lit(qtext)} OR c.eci = ${lit(qtext)})`)
  if (versionId) c.push(`c.version_id = ${Number(versionId)}`)
  if (status) c.push(`c.validation_status = ${lit(status)}`)
  const w = c.join(' AND ')
  const total = (await q1<{ n: number }>(`SELECT count(*)::INTEGER AS n FROM erb_cells c WHERE ${w}`)).n
  const items = (
    await q(`SELECT c.* EXCLUDE (raw), v.name AS version_name, v.reference_date,
        (SELECT count(*)::INTEGER FROM events e WHERE e.resolved_cell_id = c.id) AS events
      FROM erb_cells c JOIN erb_versions v ON v.id = c.version_id WHERE ${w} ORDER BY c.id LIMIT ${size} OFFSET ${(page - 1) * size}`)
  ).map((r) => ({ ...r, validation_notes: JSON.parse(r.validation_notes ?? '[]') }))
  const versions = await q(`SELECT v.*, s.original_name, s.sha256 FROM erb_versions v LEFT JOIN files s ON s.id = v.file_id ORDER BY v.id`)
  const statusCounts = await q(`SELECT validation_status, count(*)::INTEGER AS n FROM erb_cells GROUP BY 1`)
  return { total, items, versions, status_counts: statusCounts }
}

export async function candidatesFor(cellKey: string) {
  const parts = cellKey.split('|')
  const ident = parts[parts.length - 1] ?? ''
  let cond = 'FALSE'
  if (/^[CEN]\d+$/.test(ident)) cond = `${{ C: 'cell_id', E: 'eci', N: 'nci' }[ident[0] as 'C' | 'E' | 'N']} = ${lit(ident.slice(1))}`
  else if (parts[0] === 'CGI') cond = `cgi = ${lit(parts.slice(1).join('|'))}`
  else if (parts[0] === 'ERB') cond = `(site_code ILIKE ${lit(parts.slice(1).join('|'))} OR site_name ILIKE ${lit(parts.slice(1).join('|'))})`
  return q(`SELECT id, cell_key, tech, mcc, mnc, lac, tac, site_name, site_code, lat, lon, azimuth, version_id, operator, validation_status FROM erb_cells WHERE ${cond} LIMIT 50`)
}

export async function geoPoints(f: EventFilter) {
  const w = where(f)
  const registryPoints = await q(`SELECT c.id AS cell_ref, c.lat, c.lon, c.azimuth, c.beamwidth, c.site_name, c.site_code, c.tech, c.operator, c.cell_key, c.address,
      c.version_id, count(*)::INTEGER AS events, list(DISTINCT e.target_number) AS numbers, min(e.ts_local) AS first_event, max(e.ts_local) AS last_event,
      max(e.resolution_status) AS resolution_status
    FROM events e JOIN erb_cells c ON c.id = e.resolved_cell_id WHERE ${w} AND c.lat IS NOT NULL AND c.lon IS NOT NULL
    GROUP BY c.id, c.lat, c.lon, c.azimuth, c.beamwidth, c.site_name, c.site_code, c.tech, c.operator, c.cell_key, c.address, c.version_id
    ORDER BY events DESC LIMIT 5000`)
  const documentPoints = await q(`SELECT round(e.lat, 5) AS lat, round(e.lon, 5) AS lon, max(e.azimuth) AS azimuth, e.cell_key, count(*)::INTEGER AS events,
      list(DISTINCT e.target_number) AS numbers, min(e.ts_local) AS first_event, max(e.ts_local) AS last_event
    FROM events e WHERE ${w} AND e.lat IS NOT NULL AND e.lon IS NOT NULL AND e.resolved_cell_id IS NULL
    GROUP BY 1, 2, e.cell_key ORDER BY events DESC LIMIT 5000`)
  const without = (await q1<{ n: number }>(`SELECT count(*)::INTEGER AS n FROM events e WHERE ${w} AND e.resolved_cell_id IS NULL AND e.lat IS NULL`)).n
  return {
    registry_points: registryPoints,
    document_points: documentPoints,
    events_without_coordinates: without,
    criteria: criteria(f, {
      source: 'coordenadas do cadastro técnico importado (pontos de estação) ou informadas no próprio documento',
      limit_note: 'a coordenada é da estação/antena, não a localização do aparelho; setores são representações esquemáticas',
    }),
  }
}

export async function cellSequence(f: EventFilter, limit = 5000) {
  const rows = await q(`SELECT e.id, e.ts_local, e.tz_status, e.target_number, e.event_type, e.cell_key, e.file_id, e.row_number,
      coalesce(c.lat, e.lat) AS lat, coalesce(c.lon, e.lon) AS lon, coalesce(c.azimuth, e.azimuth) AS azimuth, c.beamwidth, c.site_name, e.resolution_status,
      CASE WHEN c.id IS NOT NULL THEN 'cadastro' WHEN e.lat IS NOT NULL THEN 'documento' END AS coord_source
    FROM events e LEFT JOIN erb_cells c ON c.id = e.resolved_cell_id WHERE ${where(f)} AND e.cell_key IS NOT NULL ORDER BY e.ts_utc, e.id LIMIT ${limit}`)
  let prev: number | null = null
  rows.forEach((r, i) => {
    const t = Date.parse(r.ts_local + 'Z')
    r.interval_s = prev === null ? null : Math.round((t - prev) / 1000)
    r.cell_changed = i === 0 ? null : r.cell_key !== rows[i - 1].cell_key
    prev = t
  })
  return { items: rows, truncated: rows.length >= limit, criteria: criteria(f, { note: 'sequência de registros de rede; não representa trajeto físico, velocidade ou permanência' }) }
}

// ---------------------------------------------------------------- padrões

function mean(xs: number[]) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
}
function pstdev(xs: number[]) {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)))
}

export async function patterns(f: EventFilter, z = 2.5) {
  const s = await summary(f)
  const hours = new Map(s.by_hour.map((r: any) => [r.hour, r.n]))
  const hv = Array.from({ length: 24 }, (_, h) => hours.get(h) ?? 0)
  const mh = mean(hv)
  const sh = pstdev(hv)
  const hourPeaks = hv.map((n, h) => ({ hour: h, n, z: sh ? Math.round(((n - mh) / sh) * 100) / 100 : 0 })).filter((x) => sh && x.z >= 1.5)
  const dv = s.by_day.map((d: any) => d.n)
  const md = mean(dv)
  const sd = pstdev(dv)
  const dayAnomalies = s.by_day.filter((d: any) => sd && Math.abs(d.n - md) / sd >= z).map((d: any) => ({ day: d.day, n: d.n, z: Math.round(((d.n - md) / sd) * 100) / 100 }))
  const gapsDays: string[] = []
  if (s.by_day.length) {
    const present = new Set(s.by_day.map((d: any) => d.day))
    for (let t = Date.parse(s.by_day[0].day); t <= Date.parse(s.by_day[s.by_day.length - 1].day); t += 86400000) {
      const d = new Date(t).toISOString().slice(0, 10)
      if (!present.has(d)) gapsDays.push(d)
    }
  }
  const w = where(f)
  const weekly = await q(`SELECT CAST(date_trunc('week', ts_local) AS DATE) AS week, count(*)::INTEGER AS events, count(DISTINCT other_number)::INTEGER AS contacts FROM events e WHERE ${w} GROUP BY 1 ORDER BY 1`)
  const unusual = await q(`WITH g AS (SELECT id, target_number, ts_local, epoch(ts_utc) - epoch(lag(ts_utc) OVER (PARTITION BY target_number ORDER BY ts_utc)) AS gap FROM events e WHERE ${w})
      SELECT g.id, g.target_number, g.ts_local, round(g.gap)::INTEGER AS gap_s FROM g
      JOIN (SELECT target_number, avg(gap) AS m, stddev_pop(gap) AS sd FROM g WHERE gap IS NOT NULL GROUP BY 1) st ON st.target_number IS NOT DISTINCT FROM g.target_number
      WHERE st.sd > 0 AND (g.gap - st.m) / st.sd >= ${Number(z)} ORDER BY g.gap DESC LIMIT 50`)
  return {
    hour_peaks: hourPeaks,
    day_anomalies: dayAnomalies,
    days_without_events: gapsDays.slice(0, 366),
    weekly,
    unusual_intervals: unusual,
    stats: { hour_mean: Math.round(mh * 100) / 100, hour_sd: Math.round(sh * 100) / 100, day_mean: Math.round(md * 100) / 100, day_sd: Math.round(sd * 100) / 100 },
    criteria: criteria(f, {
      z_threshold: z,
      method: 'z-score = (valor − média) ÷ desvio-padrão populacional; picos horários com z ≥ 1,5; dias anômalos com |z| ≥ limiar',
      note: 'padrões estatísticos indicam pontos para revisão, não conclusões',
    }),
  }
}

export async function meta() {
  const operators = (await q(`SELECT DISTINCT operator FROM events WHERE operator IS NOT NULL ORDER BY 1`)).map((r) => r.operator)
  const span = await q1(`SELECT min(ts_local) AS a, max(ts_local) AS b FROM events`)
  return { operators, span: [span?.a ?? null, span?.b ?? null] }
}
