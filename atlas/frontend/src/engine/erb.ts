/**
 * Motor de resolução de identificadores de célula contra o cadastro técnico importado.
 *   R1 id_completo    – tecnologia compatível + MCC + MNC + área (LAC/TAC) + CI/ECI/NCI → exata
 *   R2 cgi_exato      – CGI/ECGI/NCGI normalizado idêntico ao do cadastro → exata
 *   R3 id_sem_area    – CI/ECI/NCI sem área (ou sem MCC/MNC) → provável
 *   R4 codigo_estacao – código/nome da estação → provável (nível de estação)
 * Vários candidatos com coordenadas diferentes → ambígua. Nenhum → "ERB não resolvida".
 * Coordenadas nunca são estimadas. CI (2G/3G), ECI (4G) e NCI (5G) nunca se equiparam.
 */
import { csvCell, exec, insertCsv, q } from './db'
import { haversineM, RULES_VERSION, splitCgi } from './normalize'
import { nextId, nowIso, setState } from './session'

export type Cell = {
  id: number; version_id: number; operator: string | null; tech: string | null; mcc: string | null; mnc: string | null; lac: string | null; tac: string | null
  cell_id: string | null; eci: string | null; nci: string | null; cgi: string | null; site_code: string | null; site_name: string | null; sector: string | null
  lat: number | null; lon: number | null
}
export type Version = { id: number; reference_date: string | null; name?: string }
export type Sig = { operator: string | null; tech: string | null; mcc: string | null; mnc: string | null; lac: string | null; tac: string | null; cell_id: string | null; eci: string | null; nci: string | null; cgi: string | null; erb_raw: string | null }
export type Resolution = { status: 'exact' | 'probable' | 'ambiguous' | 'none'; rule: string; cell: Cell | null; candidates: number[]; note: string | null }
export type Index = { cell_id: Map<string, Cell[]>; eci: Map<string, Cell[]>; nci: Map<string, Cell[]>; cgi: Map<string, Cell[]>; site: Map<string, Cell[]> }

const SAME_SITE_M = 75

function techOk(evTech: string | null, cellTech: string | null, kind: string) {
  if (kind === 'eci') return cellTech === null || cellTech === '4G'
  if (kind === 'nci') return cellTech === null || cellTech === '5G'
  if (evTech && cellTech) return evTech === cellTech
  return !(cellTech === '4G' || cellTech === '5G') || evTech === '4G' || evTech === '5G'
}

const opOk = (ev: string | null, cell: string | null) => !ev || !cell || ev.toUpperCase() === cell.toUpperCase()

function pickVersions(cands: Cell[], versions: Map<number, Version>): [Cell[], string | null] {
  const groups = new Map<string, Cell[]>()
  for (const c of cands) {
    const k = [c.tech, c.mcc, c.mnc, c.lac, c.tac, c.cell_id, c.eci, c.nci, c.cgi, c.site_code, c.sector].join('|')
    groups.set(k, [...(groups.get(k) ?? []), c])
  }
  const out: Cell[] = []
  const notes = new Set<string>()
  for (const g of groups.values()) {
    g.sort((a, b) => {
      const ra = versions.get(a.version_id)?.reference_date ?? ''
      const rb = versions.get(b.version_id)?.reference_date ?? ''
      return rb.localeCompare(ra) || b.version_id - a.version_id
    })
    const chosen = g[0]
    out.push(chosen)
    for (const o of g.slice(1))
      if ([chosen.lat, chosen.lon, o.lat, o.lon].every((x) => x !== null) && haversineM(chosen.lat!, chosen.lon!, o.lat!, o.lon!) > SAME_SITE_M)
        notes.add(`coordenadas divergentes entre versões ${chosen.version_id} e ${o.version_id} do cadastro`)
  }
  return [out, [...notes].sort().join('; ') || null]
}

function samePlace(cells: Cell[]) {
  const pts = cells.filter((c) => c.lat !== null && c.lon !== null)
  if (pts.length !== cells.length || !pts.length) return false
  return pts.every((p) => haversineM(pts[0].lat!, pts[0].lon!, p.lat!, p.lon!) <= SAME_SITE_M)
}

export function cgiFromParts(c: Cell): string[] {
  const out: string[] = []
  if (c.cgi) out.push(c.cgi)
  if (c.mcc && c.mnc) {
    if (c.cell_id && c.lac) out.push(`${c.mcc}-${c.mnc}-${c.lac}-${c.cell_id}`)
    if (c.eci) out.push(`${c.mcc}-${c.mnc}-${c.eci}`)
    if (c.nci) out.push(`${c.mcc}-${c.mnc}-${c.nci}`)
  }
  return out
}

export function buildIndex(cells: Cell[]): Index {
  const idx: Index = { cell_id: new Map(), eci: new Map(), nci: new Map(), cgi: new Map(), site: new Map() }
  const add = (m: Map<string, Cell[]>, k: string, c: Cell) => m.set(k, [...(m.get(k) ?? []), c])
  for (const c of cells) {
    if (c.cell_id) add(idx.cell_id, c.cell_id, c)
    if (c.eci) add(idx.eci, c.eci, c)
    if (c.nci) add(idx.nci, c.nci, c)
    for (const k of cgiFromParts(c)) add(idx.cgi, k, c)
    for (const k of [c.site_code, c.site_name]) if (k) add(idx.site, k.trim().toUpperCase(), c)
  }
  return idx
}

export function resolveSignature(sig: Sig, idx: Index, versions: Map<number, Version>): Resolution {
  const { tech, mcc, mnc, lac, tac, cell_id: cid, eci, nci, cgi, erb_raw } = sig
  const fileOp = sig.operator
  // Com MCC/MNC no próprio registro, a rede informada prevalece sobre a operadora do arquivo
  const op = mcc && mnc ? null : sig.operator
  const missing: string[] = []
  const finish = (status: Resolution['status'], rule: string, cands0: Cell[], note: string | null = null): Resolution => {
    const [cands, vnote] = cands0.length ? pickVersions(cands0, versions) : [[], null]
    let onote: string | null = null
    if (fileOp && cands.length && cands.every((c) => c.operator && c.operator.toUpperCase() !== fileOp.toUpperCase()))
      onote = `célula de outra rede (${cands[0].operator}) no arquivo da ${fileOp}: verificar roaming/compartilhamento`
    const notes = [note, vnote, onote].filter(Boolean).join('; ') || null
    if ((status === 'exact' || status === 'probable') && cands.length > 1) {
      if (rule === 'codigo_estacao' && samePlace(cands))
        return { status: 'probable', rule, cell: cands[0], candidates: cands.map((c) => c.id), note: 'resolvido no nível da estação (setor não identificado)' + (notes ? `; ${notes}` : '') }
      return { status: 'ambiguous', rule, cell: null, candidates: cands.map((c) => c.id).slice(0, 20), note: `${cands.length} células candidatas no cadastro` + (notes ? `; ${notes}` : '') }
    }
    return { status, rule, cell: cands[0] ?? null, candidates: cands.map((c) => c.id).slice(0, 20), note: notes }
  }
  for (const [kind, val] of [['nci', nci], ['eci', eci], ['cell_id', cid]] as const) {
    if (!val) continue
    const pool = (idx[kind].get(val) ?? []).filter((c) => techOk(tech, c.tech, kind) && opOk(op, c.operator))
    if (mcc && mnc && (lac || tac || kind !== 'cell_id')) {
      const full = pool.filter(
        (c) => c.mcc === mcc && c.mnc === mnc && (kind !== 'cell_id' || (lac && c.lac === lac) || (tac && c.tac === tac)) && (kind === 'cell_id' || !tac || !c.tac || c.tac === tac),
      )
      if (full.length) return finish('exact', 'id_completo', full)
    }
    let partial = pool.filter((c) => (!mcc || !c.mcc || c.mcc === mcc) && (!mnc || !c.mnc || c.mnc === mnc))
    if (kind === 'cell_id' && (lac || tac)) partial = partial.filter((c) => !(c.lac || c.tac) || (lac && c.lac === lac) || (tac && c.tac === tac))
    if (partial.length) {
      if (!mcc || !mnc) missing.push('MCC/MNC')
      if (kind === 'cell_id' && !(lac || tac)) missing.push('LAC/TAC')
      return finish('probable', 'id_sem_area', partial, `identificador incompleto no evento (faltam ${missing.join(', ') || 'componentes'})`)
    }
  }
  if (cgi) {
    const cgiOp = Object.keys(splitCgi(cgi)).length ? null : op
    const cands = (idx.cgi.get(cgi) ?? []).filter((c) => opOk(cgiOp, c.operator))
    if (cands.length) return finish('exact', 'cgi_exato', cands)
  }
  if (erb_raw) {
    const cands = (idx.site.get(erb_raw.trim().toUpperCase()) ?? []).filter((c) => opOk(op, c.operator))
    if (cands.length) return finish('probable', 'codigo_estacao', cands, 'correspondência pelo código/nome da estação')
  }
  const reason = ![cid, eci, nci, cgi, erb_raw].some(Boolean) ? 'evento sem identificador de célula' : `identificador ${cgi || nci || eci || cid || erb_raw} não encontrado no cadastro técnico importado`
  return { status: 'none', rule: 'sem_correspondencia', cell: null, candidates: [], note: `ERB não resolvida: ${reason}` }
}

const RES_COLS = [['k', 'VARCHAR'], ['cell', 'INTEGER'], ['st', 'VARCHAR'], ['rule', 'VARCHAR'], ['ver', 'INTEGER'], ['note', 'VARCHAR'], ['cands', 'VARCHAR']].map(([name, type]) => ({ name, type }))

export async function resolveErb(versionIds: number[] | null) {
  const vfilter = versionIds?.length ? `WHERE id IN (${versionIds.join(',')})` : ''
  const versions = new Map((await q<Version>(`SELECT id, reference_date, name FROM erb_versions ${vfilter}`)).map((v) => [v.id, v]))
  const cells = versions.size
    ? await q<Cell>(`SELECT id, version_id, operator, tech, mcc, mnc, lac, tac, cell_id, eci, nci, cgi, site_code, site_name, sector, lat, lon
                     FROM erb_cells WHERE version_id IN (${[...versions.keys()].join(',')})`)
    : []
  const idx = buildIndex(cells)
  const sigs = await q<Sig & { sig_key: string; n: number }>(
    `SELECT sig_key, any_value(operator) AS operator, any_value(tech) AS tech, any_value(mcc) AS mcc, any_value(mnc) AS mnc, any_value(lac) AS lac,
            any_value(tac) AS tac, any_value(cell_id) AS cell_id, any_value(eci) AS eci, any_value(nci) AS nci, any_value(cgi) AS cgi,
            any_value(erb_raw) AS erb_raw, count(*)::INTEGER AS n
       FROM events WHERE NOT resolution_manual GROUP BY sig_key`,
  )
  const byStatus: Record<string, number> = {}
  const byStatusEv: Record<string, number> = {}
  const lines: string[] = []
  for (const s of sigs) {
    let r: Resolution
    if (![s.cell_id, s.eci, s.nci, s.cgi, s.erb_raw].some(Boolean)) r = { status: 'none', rule: 'sem_identificador', cell: null, candidates: [], note: 'ERB não resolvida: evento sem identificador de célula' }
    else if (!versions.size) r = { status: 'none', rule: 'sem_cadastro', cell: null, candidates: [], note: 'ERB não resolvida: nenhum cadastro técnico importado' }
    else r = resolveSignature(s, idx, versions)
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1
    byStatusEv[r.status] = (byStatusEv[r.status] ?? 0) + s.n
    lines.push([s.sig_key, r.cell?.id ?? null, r.status, r.rule, r.cell?.version_id ?? null, r.note, JSON.stringify(r.candidates)].map(csvCell).join(','))
  }
  await exec('DROP TABLE IF EXISTS sig_res; CREATE TEMP TABLE sig_res (k VARCHAR, cell INTEGER, st VARCHAR, rule VARCHAR, ver INTEGER, note VARCHAR, cands VARCHAR)')
  if (lines.length) await insertCsv('sig_res', RES_COLS, lines.join('\n') + '\n')
  await exec(`UPDATE events SET resolved_cell_id = r.cell, resolution_status = r.st, resolution_rule = r.rule, resolution_version_id = r.ver,
                     resolution_note = r.note, resolution_candidates = r.cands
                FROM sig_res r WHERE events.sig_key = r.k AND NOT events.resolution_manual`)
  await exec('DROP TABLE sig_res')
  const result = {
    signatures: sigs.length,
    by_status_signatures: byStatus,
    by_status_events: byStatusEv,
    versions: [...versions.values()].map((v) => ({ id: v.id, name: v.name, reference_date: v.reference_date })),
    rules_version: RULES_VERSION,
    finished_at: nowIso(),
  }
  setState((s) => ({ resolutionRuns: [{ id: nextId(), created_at: nowIso(), result }, ...s.resolutionRuns].slice(0, 20) }), true)
  return result
}

/** Revisão manual: escolha do analista (ou confirmação de "não resolvida") para uma chave de célula. */
export async function manualResolution(cellKey: string, erbCellId: number | null, note: string) {
  if (!note || note.trim().length < 5) throw new Error('Descreva o motivo da revisão (mínimo de 5 caracteres).')
  const n = (await q<{ n: number }>(`SELECT count(*)::INTEGER AS n FROM events WHERE cell_key = '${cellKey.replace(/'/g, "''")}'`))[0]?.n ?? 0
  const ver = erbCellId ? (await q<{ v: number }>(`SELECT version_id AS v FROM erb_cells WHERE id = ${erbCellId}`))[0]?.v ?? null : null
  const esc = (s: string) => `'${s.replace(/'/g, "''")}'`
  await exec(`UPDATE events SET resolved_cell_id = ${erbCellId ?? 'NULL'}, resolution_status = ${esc(erbCellId ? 'exact' : 'none')}, resolution_rule = 'manual',
                     resolution_version_id = ${ver ?? 'NULL'}, resolution_note = ${esc('revisão manual: ' + note)}, resolution_manual = TRUE
               WHERE cell_key = ${esc(cellKey)}`)
  setState({}, true)
  return { events: n }
}
