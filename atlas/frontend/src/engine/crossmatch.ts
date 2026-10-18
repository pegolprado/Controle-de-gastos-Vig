/**
 * Cruzamento multifonte: validação prévia e correspondência de registros recíprocos.
 *
 * Exemplo: a chamada A→B aparece na bilhetagem de A (originada) e na de B (recebida),
 * possivelmente fornecidas por operadoras diferentes. O cruzamento procura, para cada
 * registro de A cujo interlocutor também é alvo com dados na análise, o registro
 * correspondente na bilhetagem do interlocutor.
 *
 * Classificação:
 *   exata     – mesmo instante (±1 s) e mesma duração (±1 s)
 *   provável  – dentro da tolerância de tempo e de duração configuradas, candidato único
 *   ambígua   – mais de um candidato dentro da tolerância
 *   ausente   – nenhum candidato, embora o interlocutor tenha registros no período
 */
import { criteria, type EventFilter, where } from './analytics'
import { q } from './db'
import { litList } from './text'

const fmtDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

export async function validate(fileIds: number[] = []) {
  const fcond = fileIds.length ? `AND e.file_id IN ${litList(fileIds.map(Number))}` : ''
  const perFile = await q(
    `SELECT s.id AS file_id, s.original_name, s.sha256, s.operator_declared, s.detected_format,
            count(e.id)::INTEGER AS events,
            count(*) FILTER (WHERE e.tz_status = 'confirmed')::INTEGER AS tz_confirmed,
            count(*) FILTER (WHERE e.tz_status = 'assumed')::INTEGER AS tz_assumed,
            count(*) FILTER (WHERE e.tz_status = 'unknown')::INTEGER AS tz_unknown,
            count(*) FILTER (WHERE e.is_duplicate)::INTEGER AS duplicates,
            count(*) FILTER (WHERE e.out_of_scope)::INTEGER AS out_of_scope,
            count(*) FILTER (WHERE e.n_warnings > 0)::INTEGER AS with_warnings,
            count(*) FILTER (WHERE e.other_number IS NOT NULL AND e.other_number NOT LIKE '+%')::INTEGER AS non_e164_numbers,
            count(*) FILTER (WHERE e.cell_key IS NULL)::INTEGER AS without_cell,
            min(e.ts_local) AS first_event, max(e.ts_local) AS last_event,
            list(DISTINCT e.target_number) FILTER (WHERE e.target_number IS NOT NULL) AS targets
       FROM files s JOIN events e ON e.file_id = s.id
      WHERE TRUE ${fcond}
      GROUP BY s.id, s.original_name, s.sha256, s.operator_declared, s.detected_format ORDER BY s.id`,
  )
  const checks: { check: string; ok: boolean; detail: string }[] = []
  const tzKinds = new Set<string>()
  for (const r of perFile) for (const k of ['confirmed', 'assumed', 'unknown']) if (r[`tz_${k}`]) tzKinds.add(k)
  const onlyConfirmed = [...tzKinds].every((k) => k === 'confirmed')
  checks.push({
    check: 'Fuso horário',
    ok: onlyConfirmed,
    detail: onlyConfirmed ? 'todos confirmados' : `há horários ${[...tzKinds].sort().join(', ')}: comparações temporais entre arquivos com fusos diferentes ou desconhecidos exigem cautela`,
  })
  const sum = (k: string) => perFile.reduce((acc, r) => acc + (r[k] ?? 0), 0)
  const nonE164 = sum('non_e164_numbers')
  checks.push({ check: 'Normalização dos números', ok: nonE164 === 0, detail: nonE164 === 0 ? 'todos no formato E.164' : `${nonE164} registros com números curtos/sem DDD ou formato não reconhecido` })
  const dups = sum('duplicates')
  checks.push({ check: 'Duplicidades', ok: dups === 0, detail: `${dups} registros duplicados (excluídos do cruzamento)` })
  const oos = sum('out_of_scope')
  checks.push({ check: 'Período autorizado', ok: oos === 0, detail: `${oos} registros fora do período autorizado (excluídos)` })
  const periods = perFile.filter((r) => r.first_event).map((r) => [r.first_event as string, r.last_event as string])
  let overlap: [string, string] | null = null
  if (periods.length > 1) {
    const start = periods.map((p) => p[0]).sort().at(-1)!
    const end = periods.map((p) => p[1]).sort()[0]
    overlap = start <= end ? [start, end] : null
  }
  checks.push({
    check: 'Sobreposição de períodos',
    ok: overlap !== null || periods.length <= 1,
    detail: overlap ? `período comum: ${fmtDate(overlap[0])} a ${fmtDate(overlap[1])}` : periods.length <= 1 ? 'um único arquivo' : 'arquivos sem período em comum',
  })
  checks.push({ check: 'Proveniência', ok: perFile.every((r) => r.sha256), detail: 'todos os arquivos com SHA-256 calculado no carregamento' })
  const warn = sum('with_warnings')
  checks.push({ check: 'Qualidade', ok: warn === 0, detail: `${warn} registros com alertas de validação` })
  return { files: perFile, checks }
}

const FAM = (a: string) => `CASE WHEN ${a}.event_type LIKE 'voz%' OR ${a}.event_type = 'desvio' THEN 'voz' WHEN ${a}.event_type LIKE 'sms%' THEN 'sms' ELSE ${a}.event_type END`

export async function reciprocalMatch(f: EventFilter, tolS = 60, durTolS = 5, limit = 500) {
  const tol = Math.max(0, Math.trunc(tolS))
  const dtol = Math.max(0, Math.trunc(durTolS))
  const w = where(f, 'e1')
  // Candidatos via junção por intervalo (o DuckDB executa como hash/range join, sem LATERAL).
  const sql = `
    WITH cover AS (
      SELECT target_number, min(ts_utc) AS t0, max(ts_utc) AS t1
        FROM events WHERE NOT is_duplicate AND target_number IS NOT NULL GROUP BY 1
    ), base AS (
      SELECT e1.id, e1.target_number, e1.other_number, e1.ts_local, e1.ts_utc, e1.event_type, e1.duration_s, e1.file_id, ${FAM('e1')} AS fam
        FROM events e1 JOIN cover cv ON cv.target_number = e1.other_number
       WHERE ${w} AND e1.target_number IS NOT NULL AND e1.other_number IS NOT NULL
         AND e1.target_number < e1.other_number
         AND e1.ts_utc BETWEEN cv.t0 - INTERVAL ${tol} SECOND AND cv.t1 + INTERVAL ${tol} SECOND
         AND e1.event_type IN ('voz_originada','voz_recebida','voz','sms_enviado','sms_recebido','sms','desvio')
    ), cand AS (
      SELECT b.id AS bid, e2.id AS cid, e2.file_id AS cfile,
             abs(epoch(e2.ts_utc) - epoch(b.ts_utc)) AS delta,
             abs(coalesce(e2.duration_s, -1) - coalesce(b.duration_s, -1)) AS ddiff
        FROM base b JOIN events e2
          ON e2.target_number = b.other_number AND e2.other_number = b.target_number
         AND e2.ts_utc BETWEEN b.ts_utc - INTERVAL ${tol} SECOND AND b.ts_utc + INTERVAL ${tol} SECOND
       WHERE NOT e2.is_duplicate AND e2.file_id <> b.file_id
         AND ${FAM('e2')} = b.fam
         AND (b.duration_s IS NULL OR e2.duration_s IS NULL OR abs(e2.duration_s - b.duration_s) <= ${dtol})
    ), agg AS (
      SELECT bid, count(*)::INTEGER AS n, list(cid ORDER BY delta) AS ids, min(delta) AS best_delta,
             min(ddiff) AS best_dur_diff, list(DISTINCT cfile) AS files
        FROM cand GROUP BY bid
    ), m AS (
      SELECT b.id, b.target_number, b.other_number, b.ts_local, b.event_type, b.duration_s, b.file_id,
             coalesce(a.n, 0) AS n, a.ids, a.best_delta, a.best_dur_diff, a.files
        FROM base b LEFT JOIN agg a ON a.bid = b.id
    )
    SELECT *, CASE
                WHEN n = 0 THEN 'ausente'
                WHEN n > 1 THEN 'ambigua'
                WHEN best_delta <= 1 AND coalesce(best_dur_diff, 0) <= 1 THEN 'exata'
                ELSE 'provavel' END AS match_class
      FROM m`
  const totals = await q(`SELECT match_class, count(*)::INTEGER AS n FROM (${sql}) x GROUP BY 1`)
  const items = await q(`SELECT * FROM (${sql}) x ORDER BY ts_local, id LIMIT ${Math.max(1, Math.trunc(limit))}`)
  return {
    totals: Object.fromEntries(totals.map((r) => [r.match_class, r.n])) as Record<string, number>,
    items,
    criteria: criteria(f, {
      time_tolerance_s: tol,
      duration_tolerance_s: dtol,
      scope: 'somente registros de voz/SMS entre dois alvos com dados na análise, dentro do período coberto pelo interlocutor',
      classes: 'exata: ±1 s e mesma duração; provável: candidato único na tolerância; ambígua: múltiplos candidatos; ausente: nenhum',
    }),
  }
}
