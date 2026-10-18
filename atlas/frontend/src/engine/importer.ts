/** Importação universal no navegador: recebe, analisa, pré-visualiza e processa arquivos. */
import { csvCell, exec, insertCsv, q, q1 } from './db'
import { resolveErb } from './erb'
import { catalog, type Kind, suggestMapping } from './fields'
import * as N from './normalize'
import { expandZip, type RawRow, type ReadOptions, sha256, sniffFormat, Table, TABULAR } from './readers'
import { getState, type ImportRec, type Issue, nextId, nowIso, type SessionFile, setState, type Target, updateFile, updateImport } from './session'
import { lit, normHeader } from './text'

const BATCH = 20000
const MAX_ISSUES = 20000
export const MAX_FILE_MB = 1024
const ALLOWED = new Set(['csv', 'txt', 'tsv', 'xls', 'xlsx', 'xml', 'json', 'zip', 'pdf', 'html', 'htm', 'dat', 'prn'])

// ------------------------------------------------------------------ recebimento

export async function addFiles(list: FileList | File[], kind: SessionFile['kind'], operator: string | null, onStatus?: (s: string) => void): Promise<SessionFile[]> {
  const out: SessionFile[] = []
  for (const f of Array.from(list)) {
    const ext = f.name.includes('.') ? f.name.split('.').pop()!.toLowerCase() : ''
    if (ext && !ALLOWED.has(ext)) throw new Error(`Extensão não permitida: .${ext}`)
    if (!f.size) throw new Error(`Arquivo vazio: ${f.name}`)
    if (f.size > MAX_FILE_MB * 1024 * 1024) throw new Error(`Arquivo maior que ${MAX_FILE_MB} MB: ${f.name}`)
    out.push(...(await register(f, f.name, kind, operator, null, onStatus)))
  }
  setState((s) => ({ files: [...s.files, ...out] }))
  await syncFilesTable()
  return out
}

async function register(blob: Blob, name: string, kind: SessionFile['kind'], operator: string | null, parent: number | null, onStatus?: (s: string) => void): Promise<SessionFile[]> {
  onStatus?.(`Calculando SHA-256 de ${name}`)
  const hash = await sha256(blob)
  const fmt = await sniffFormat(blob, name)
  const dup = [...getState().files].find((x) => x.sha256 === hash)
  const sf: SessionFile = {
    id: nextId(), parent_id: parent, original_name: name, size_bytes: blob.size, sha256: hash, detected_format: fmt, kind,
    operator_declared: operator || null, operator_detected: null, operator_confidence: null,
    status: TABULAR.includes(fmt) || fmt === 'zip' ? 'recebido' : 'nao_suportado', received_at: nowIso(), blob,
    meta: dup ? { duplicate_of: dup.id } : {},
  }
  const out = [sf]
  if (fmt === 'zip') {
    try {
      for (const e of await expandZip(blob)) out.push(...(await register(new Blob([e.data as BlobPart]), `${name}/${e.name}`, kind, operator, sf.id, onStatus)))
      sf.status = 'expandido'
    } catch (e: any) {
      sf.status = 'rejeitado'
      sf.meta = { ...sf.meta, error: e.message }
    }
  }
  return out
}

export async function syncFilesTable() {
  const files = getState().files
  await exec('DELETE FROM files')
  if (files.length)
    await exec(`INSERT INTO files VALUES ${files.map((f) => `(${f.id}, ${lit(f.original_name)}, ${lit(f.sha256)}, ${lit(f.operator_declared)}, ${lit(f.detected_format)}, ${lit(f.kind)})`).join(',')}`)
}

export async function syncTargetsTable() {
  const ts = getState().targets
  await exec('DELETE FROM targets')
  if (ts.length)
    await exec(`INSERT INTO targets VALUES ${ts.map((t) => `(${lit(t.number_normalized)}, ${lit(t.label)}, ${lit(t.internal_id)}, ${lit(t.operator)}, ${t.period_start ? `DATE ${lit(t.period_start)}` : 'NULL'}, ${t.period_end ? `DATE ${lit(t.period_end)}` : 'NULL'})`).join(',')}`)
}

export function removeFile(id: number) {
  const ids = new Set([id, ...getState().files.filter((f) => f.parent_id === id).map((f) => f.id)])
  return (async () => {
    await exec(`DELETE FROM events WHERE file_id IN (${[...ids].join(',')})`)
    await exec(`DELETE FROM erb_cells WHERE version_id IN (SELECT id FROM erb_versions WHERE file_id IN (${[...ids].join(',')}))`)
    await exec(`DELETE FROM erb_versions WHERE file_id IN (${[...ids].join(',')})`)
    setState((s) => ({ files: s.files.filter((f) => !ids.has(f.id)), imports: s.imports.filter((i) => !ids.has(i.file_id)) }), true)
    await syncFilesTable()
    await recomputeDuplicates()
  })()
}

// ------------------------------------------------------------------ análise

export function layoutSignature(columns: string[]) {
  return N.quickHash(columns.map(normHeader))
}

/** Mapeamentos reaproveitáveis DENTRO da sessão (memória), por assinatura de cabeçalhos. */
const profiles = new Map<string, { name: string; kind: Kind; mapping: Record<string, string>; options: Record<string, any> }>()
export function saveProfile(columns: string[], name: string, kind: Kind, mapping: Record<string, string>, options: Record<string, any>) {
  const { target_number: _t, read: _r, ...opts } = options
  profiles.set(`${kind}|${layoutSignature(columns)}`, { name, kind, mapping, options: opts })
}
export function clearProfiles() {
  profiles.clear()
}

export async function analyze(fileId: number, kind: Kind, read: ReadOptions) {
  const f = getState().files.find((x) => x.id === fileId)!
  const table = await Table.open(f.blob, f.detected_format, read)
  const info = table.info
  const sample = await table.sample(25)
  const columns = info.columns
  const mapping = suggestMapping(columns, kind)
  const mncCol = mapping.mnc
  let sampleMnc = mncCol ? sample.map((r) => String(r[mncCol] ?? '')) : []
  if (!sampleMnc.length && mapping.cgi) sampleMnc = sample.map((r) => N.splitCgi(N.normalizeCgi(String(r[mapping.cgi] ?? ''))).mnc ?? '')
  const operator = N.detectOperator(f.original_name, info.preamble, columns, sampleMnc)
  const formats = detectFormats(sample, mapping)
  const pre = info.preamble.join(' ')
  const preNums = new Set((pre.match(/\(?\+?\d[\d\s().-]{7,}\d/g) ?? []).map((m) => N.normalizeNumber(m)[0]))
  const targetHint = getState().targets.filter((t) => preNums.has(t.number_normalized)).map((t) => t.number_normalized)
  const typeValues = kind === 'cdr' && mapping.event_type ? [...new Set(sample.map((r) => String(r[mapping.event_type] ?? '')).filter(Boolean))].sort() : []
  updateFile(fileId, { operator_detected: operator.operator, operator_confidence: operator.confidence, kind, table: { ...info } })
  return {
    table: info,
    columns,
    sample,
    signature: layoutSignature(columns),
    suggested_mapping: profiles.get(`${kind}|${layoutSignature(columns)}`)?.mapping ?? mapping,
    profile: profiles.get(`${kind}|${layoutSignature(columns)}`) ?? null,
    fields: Object.fromEntries(Object.entries(catalog(kind)).map(([k, v]) => [k, v.label])),
    operator_detection: operator,
    formats,
    target_hint: targetHint,
    event_type_values: typeValues,
    event_types: N.EVENT_TYPES,
  }
}

export function detectFormats(sample: Record<string, unknown>[], mapping: Record<string, string>) {
  const out: Record<string, { format: string | null; rate: number; ambiguous: boolean }> = {}
  for (const [field, cands] of [
    ['date', N.DATE_FORMATS],
    ['time', N.TIME_FORMATS],
    ['datetime', N.DATETIME_FORMATS],
  ] as const) {
    const col = mapping[field]
    if (!col) continue
    let vals = sample.map((r) => String(r[col] ?? ''))
    if (field === 'date') vals = vals.map((v) => (/^\d{4}-\d{2}-\d{2} 00:00:00$/.test(v) ? v.slice(0, 10) : v))
    if (field === 'time') vals = vals.map((v) => (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v) ? v.slice(11) : v))
    const r = N.detectFormat(vals, [...cands])
    out[field] = { ...r, rate: Math.round(r.rate * 1000) / 1000 }
  }
  return out
}

// ------------------------------------------------------------------ normalização de linha

type IssueT = [Issue['severity'], string, string, string]

export class RowNormalizer {
  m: Record<string, string>
  o: Record<string, any>
  targets: Map<string, Target>
  constructor(mapping: Record<string, string>, options: Record<string, any>, targets: Target[], private file: SessionFile) {
    this.m = Object.fromEntries(Object.entries(mapping ?? {}).filter(([, v]) => v))
    this.o = options ?? {}
    this.targets = new Map(targets.map((t) => [t.number_normalized, t]))
  }

  g(rec: Record<string, string>, field: string): string | null {
    const col = this.m[field]
    if (!col) return null
    const v = rec[col]
    return typeof v === 'string' && v.trim() ? v.trim() : null
  }

  run(raw: RawRow, rec: Record<string, string>): [Record<string, any> | null, IssueT[]] {
    const o = this.o
    const meta = getState().meta
    const issues: IssueT[] = []
    const warns: string[] = []
    const warn = (code: string, field: string, msg: string, sev: Issue['severity'] = 'warning') => {
      issues.push([sev, code, field, msg])
      if (sev === 'warning') warns.push(msg)
    }
    const aRaw = this.g(rec, 'a_number')
    const bRaw = this.g(rec, 'b_number')
    const tRaw = this.g(rec, 'target_number')
    const oRaw = this.g(rec, 'other_number')
    let [a, wa] = N.normalizeNumber(aRaw)
    let [b, wb] = N.normalizeNumber(bRaw)
    const [tnum, wt] = N.normalizeNumber(tRaw)
    const [onum, wo] = N.normalizeNumber(oRaw)
    for (const w of [...wa, ...wb, ...wt, ...wo]) if (w.includes('não reconhecido')) warn('numero_formato', 'numero', w)

    let [et, direction, recognized] = N.classifyEvent(this.g(rec, 'event_type'), this.g(rec, 'direction'), o.value_map ?? {}, o.default_event_type ?? null)
    if (!recognized) warn('tipo_nao_reconhecido', 'event_type', `tipo de evento não reconhecido: '${this.g(rec, 'event_type') ?? ''}'`)

    let target = tnum || o.target_number || null
    if (!target) target = a && this.targets.has(a) ? a : b && this.targets.has(b) ? b : null
    if (!a && !b && target && onum) {
      if (direction === 'out') [a, b] = [target, onum]
      else if (direction === 'in') [a, b] = [onum, target]
      else warn('sentido_desconhecido', 'direction', 'sentido não informado: origem/destino não definidos')
    }
    let other = onum
    if (!other) other = target && a === target ? b : target && b === target ? a : null
    if (target && a && b && target !== a && target !== b && !tnum) warn('alvo_ausente', 'target_number', 'o número alvo do arquivo não aparece como origem nem destino')
    if (direction === 'unknown' && target && a && b) {
      direction = a === target ? 'out' : b === target ? 'in' : 'unknown'
      if (et === 'voz' && direction !== 'unknown') et = direction === 'out' ? 'voz_originada' : 'voz_recebida'
      else if (et === 'sms' && direction !== 'unknown') et = direction === 'out' ? 'sms_enviado' : 'sms_recebido'
    }

    const dtRaw = this.g(rec, 'datetime')
    const dRaw = this.g(rec, 'date')
    const tmRaw = this.g(rec, 'time')
    let [local, offset, err] = N.parseLocalDatetime(dRaw, tmRaw, dtRaw, o.date_format, o.time_format, o.datetime_format)
    const tzRaw = this.g(rec, 'timezone')
    if (tzRaw && !offset) {
      const m = /([+-])\s*(\d{1,2})(?::?(\d{2}))?/.exec(tzRaw)
      if (m) offset = `${m[1]}${m[2].padStart(2, '0')}:${m[3] ?? '00'}`
      else if (['UTC', 'GMT', 'Z'].includes(tzRaw.trim().toUpperCase())) offset = 'Z'
    }
    if (!local) {
      warn('data_invalida', 'datetime', err ?? 'data/hora ausente', 'error')
      return [null, issues]
    }
    if (err) warn('data_parcial', 'datetime', err)
    const tzMode = o.tz_mode ?? 'unknown'
    let tzStatus = tzMode
    let tzName: string | null = o.tz_name || 'America/Sao_Paulo'
    let utcMs: number
    if (offset) {
      utcMs = N.toUtcMs(local, offset, null)
      tzStatus = 'confirmed'
      tzName = `UTC${offset === 'Z' ? '+00:00' : offset}`
    } else {
      utcMs = N.toUtcMs(local, null, tzName)
      if (tzMode === 'unknown') tzName = null
    }
    const tsLocal = N.localIso(local)
    const tsUtc = new Date(utcMs).toISOString().slice(0, 19)

    const [dur, derr] = N.parseDuration(this.g(rec, 'duration'), o.duration_unit ?? 's')
    if (derr) warn('duracao_invalida', 'duration', derr)

    const tech = N.normalizeTech(this.g(rec, 'tech')) ?? N.normalizeTech(o.default_tech)
    let mcc = N.normalizeId(this.g(rec, 'mcc')) ?? o.default_mcc ?? null
    const mncRaw = this.g(rec, 'mnc')
    let mnc = mncRaw && /^\d+$/.test(mncRaw) ? mncRaw.padStart(2, '0') : mncRaw ?? o.default_mnc ?? null
    const hex = !!o.hex_ids
    const lac = N.normalizeId(this.g(rec, 'lac'), hex)
    const tac = N.normalizeId(this.g(rec, 'tac'), hex)
    const cid = N.normalizeId(this.g(rec, 'cell_id'), hex)
    const eci = N.normalizeId(this.g(rec, 'eci'), hex)
    const nci = N.normalizeId(this.g(rec, 'nci'), hex)
    const cgi = N.normalizeCgi(this.g(rec, 'cgi'))
    const erbRaw = this.g(rec, 'erb_raw')
    if (cgi && !(mcc && mnc && (cid || eci || nci))) {
      const p = N.splitCgi(cgi)
      mcc = mcc ?? p.mcc ?? null
      mnc = mnc ?? p.mnc ?? null
    }
    if (o.default_mcc && !this.g(rec, 'mcc')) warns.push('MCC declarado no assistente')
    if (o.default_mnc && !mncRaw) warns.push('MNC declarado no assistente')
    const cellKey = N.buildCellKey(tech, mcc, mnc, lac, tac, cid, eci, nci, cgi, erbRaw)

    let [lat, le] = N.parseCoord(this.g(rec, 'lat'), 'latitude')
    let [lon, lo] = N.parseCoord(this.g(rec, 'lon'), 'longitude')
    for (const e of [le, lo]) if (e) warn('coordenada', 'lat/lon', e)
    const ci = N.coordsIssue(lat, lon)
    if (ci) {
      warn('coordenada', 'lat/lon', ci)
      if (ci.includes('0,0')) lat = lon = null
    }
    let az: number | null = null
    const azRaw = this.g(rec, 'azimuth')
    if (azRaw) {
      const x = Number(azRaw.replace(',', '.'))
      if (!Number.isFinite(x)) warn('azimute', 'azimuth', `azimute não reconhecido: '${azRaw}'`)
      else if (x < 0 || x > 360) warn('azimute', 'azimuth', `azimute fora de 0–360: ${azRaw}`)
      else az = x
    }

    let outOfScope = false
    const day = tsLocal.slice(0, 10)
    if ((meta.period_start && day < meta.period_start) || (meta.period_end && day > meta.period_end)) {
      outOfScope = true
      warn('fora_periodo_caso', 'datetime', 'evento fora do período autorizado da análise')
    }
    const t = target ? this.targets.get(target) : undefined
    if (t && ((t.period_start && day < t.period_start) || (t.period_end && day > t.period_end))) {
      outOfScope = true
      warn('fora_periodo_alvo', 'datetime', 'evento fora do período pertinente ao alvo')
    }
    if (target && this.targets.size && !this.targets.has(target)) warn('alvo_nao_cadastrado', 'target_number', 'número alvo não cadastrado nos alvos')
    const conf = raw.confidence ?? 1
    if (raw.confidence !== null && raw.confidence !== undefined && raw.confidence < 0.8) warn('ocr_baixa_confianca', '*', `linha obtida por OCR com confiança ${Math.round(raw.confidence * 100)}% — revisar`)

    const ip = this.g(rec, 'ip')
    const sig = { operator: o.operator || this.file.operator_declared || null, tech, mcc, mnc, lac, tac, cell_id: cid, eci, nci, cgi, erb_raw: erbRaw ? erbRaw.slice(0, 120) : null }
    const ev = {
      row_number: raw.row, page: raw.page ?? null, event_type: et, direction, a_number: a, b_number: b,
      a_raw: (aRaw || tRaw)?.slice(0, 80) ?? null, b_raw: (bRaw || oRaw)?.slice(0, 80) ?? null, target_number: target, other_number: other,
      ts_original: [dtRaw, dRaw, tmRaw, tzRaw].filter(Boolean).join(' ').slice(0, 80), ts_utc: tsUtc, ts_local: tsLocal, tz_name: tzName, tz_status: tzStatus,
      duration_s: dur, status: this.g(rec, 'status'), ...sig, cell_key: cellKey, lat, lon, azimuth: az,
      imei: (this.g(rec, 'imei') ?? '').replace(/\D/g, '').slice(0, 20) || null, imsi: (this.g(rec, 'imsi') ?? '').replace(/\D/g, '').slice(0, 20) || null,
      ip, bytes_up: N.parseIntLoose(this.g(rec, 'bytes_up')), bytes_down: N.parseIntLoose(this.g(rec, 'bytes_down')),
      raw: JSON.stringify(rec), warnings: JSON.stringify(warns), n_warnings: warns.length, confidence: conf, out_of_scope: outOfScope,
      dedup_hash: N.quickHash([target, a, b, tsUtc, dur, et, cellKey, ip]),
      sig_key: N.quickHash(Object.values(sig)),
    }
    return [ev, issues]
  }
}

export const EVENT_COLS: { name: string; type: string }[] = [
  ['import_id', 'INTEGER'], ['file_id', 'INTEGER'], ['file_sha256', 'VARCHAR'], ['row_number', 'INTEGER'], ['page', 'INTEGER'], ['operator', 'VARCHAR'],
  ['event_type', 'VARCHAR'], ['direction', 'VARCHAR'], ['a_number', 'VARCHAR'], ['b_number', 'VARCHAR'], ['a_raw', 'VARCHAR'], ['b_raw', 'VARCHAR'],
  ['target_number', 'VARCHAR'], ['other_number', 'VARCHAR'], ['ts_original', 'VARCHAR'], ['ts_utc', 'TIMESTAMP'], ['ts_local', 'TIMESTAMP'],
  ['tz_name', 'VARCHAR'], ['tz_status', 'VARCHAR'], ['duration_s', 'INTEGER'], ['status', 'VARCHAR'], ['tech', 'VARCHAR'], ['mcc', 'VARCHAR'],
  ['mnc', 'VARCHAR'], ['lac', 'VARCHAR'], ['tac', 'VARCHAR'], ['cell_id', 'VARCHAR'], ['eci', 'VARCHAR'], ['nci', 'VARCHAR'], ['cgi', 'VARCHAR'],
  ['erb_raw', 'VARCHAR'], ['cell_key', 'VARCHAR'], ['lat', 'DOUBLE'], ['lon', 'DOUBLE'], ['azimuth', 'DOUBLE'], ['imei', 'VARCHAR'], ['imsi', 'VARCHAR'],
  ['ip', 'VARCHAR'], ['bytes_up', 'BIGINT'], ['bytes_down', 'BIGINT'], ['raw', 'VARCHAR'], ['warnings', 'VARCHAR'], ['n_warnings', 'INTEGER'],
  ['confidence', 'DOUBLE'], ['out_of_scope', 'BOOLEAN'], ['dedup_hash', 'VARCHAR'], ['sig_key', 'VARCHAR'],
].map(([name, type]) => ({ name, type }))

export function createImport(fileId: number, kind: ImportRec['kind'], mapping: Record<string, string>, options: Record<string, any>): ImportRec {
  const imp: ImportRec = {
    id: nextId(), file_id: fileId, kind, mapping: Object.fromEntries(Object.entries(mapping).filter(([, v]) => v)), options, status: 'draft',
    rows_total: 0, rows_ok: 0, rows_error: 0, rows_warning: 0, rows_duplicate: 0, rows_out_of_scope: 0, rules_version: N.RULES_VERSION,
    summary: {}, issues: [], progress: 0, message: null, created_at: nowIso(), finished_at: null,
  }
  setState((s) => ({ imports: [imp, ...s.imports] }))
  if (options.operator) updateFile(fileId, { operator_declared: options.operator })
  return imp
}

export function saveDraft(id: number, mapping: Record<string, string>, options: Record<string, any>) {
  updateImport(id, { mapping: Object.fromEntries(Object.entries(mapping).filter(([, v]) => v)), options })
}

export async function preview(id: number, n = 300) {
  const imp = getState().imports.find((i) => i.id === id)!
  const f = getState().files.find((x) => x.id === imp.file_id)!
  const table = await Table.open(f.blob, f.detected_format, imp.options.read ?? {})
  const counts = new Map<string, number>()
  const issueList: any[] = []
  const rows: any[] = []
  const types: Record<string, number> = {}
  let total = 0
  const norm = imp.kind === 'cdr' ? new RowNormalizer(imp.mapping, imp.options, getState().targets, f) : null
  for await (const [raw, rec] of table.rows()) {
    total++
    const [item, issues] = norm ? norm.run(raw, rec) : normalizeErbRow(imp.mapping, imp.options, raw, rec)
    for (const [sev, code, field, msg] of issues) {
      counts.set(`${sev}|${code}`, (counts.get(`${sev}|${code}`) ?? 0) + 1)
      if (issueList.length < 200) issueList.push({ row: raw.row, page: raw.page, severity: sev, code, field, message: msg })
    }
    if (item) {
      if (norm) types[item.event_type] = (types[item.event_type] ?? 0) + 1
      if (rows.length < 50) rows.push({ ...item, raw: undefined, warnings: norm ? JSON.parse(item.warnings) : item.validation_notes })
    }
    if (total >= n) break
  }
  const req: string[] = []
  if (imp.kind === 'cdr') {
    if (!imp.mapping.date && !imp.mapping.datetime) req.push('mapeie a data/hora (campo único ou data + horário)')
    if (!['a_number', 'b_number', 'target_number', 'other_number'].some((k) => imp.mapping[k]) && !imp.options.target_number)
      req.push('mapeie ao menos um número ou informe o número alvo do arquivo')
  } else if (!['cell_id', 'eci', 'nci', 'cgi', 'site_code'].some((k) => imp.mapping[k])) req.push('mapeie ao menos um identificador (CI, ECI, NCI, CGI ou código da estação)')
  return {
    rows, checked: total, issues: issueList,
    issue_counts: [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, c]) => ({ severity: k.split('|')[0], code: k.split('|')[1], count: c })),
    event_types: norm ? types : undefined,
    required_problems: req,
  }
}

// ------------------------------------------------------------------ execução

const cancelFlags = new Set<number>()
export function cancelImport(id: number) {
  cancelFlags.add(id)
}

export async function recomputeDuplicates() {
  await exec(`UPDATE events SET is_duplicate = (events.id <> d.first_id), duplicate_of = CASE WHEN events.id <> d.first_id THEN d.first_id END
              FROM (SELECT id, min(id) OVER (PARTITION BY dedup_hash) AS first_id FROM events) d WHERE events.id = d.id`)
}

export async function runImport(id: number, opts: { autoResolve?: boolean } = {}) {
  const imp = getState().imports.find((i) => i.id === id)!
  const f = getState().files.find((x) => x.id === imp.file_id)!
  cancelFlags.delete(id)
  updateImport(id, { status: 'running', progress: 0, message: 'lendo arquivo' })
  updateFile(f.id, { status: 'em_processamento' })
  try {
    const res = imp.kind === 'erb_registry' ? await runErb(imp, f) : await runCdr(imp, f)
    if (opts.autoResolve !== false) {
      updateImport(id, { message: 'resolvendo identificadores de ERB' })
      await resolveErb(null)
    }
    updateImport(id, { ...res, status: 'done', progress: 1, message: 'importação concluída', finished_at: nowIso() }, true)
    updateFile(f.id, { status: 'processado' })
  } catch (e: any) {
    const cancelled = e?.message === '__cancelado__'
    await exec(`DELETE FROM events WHERE import_id = ${id}`)
    await exec(`DELETE FROM erb_cells WHERE version_id IN (SELECT id FROM erb_versions WHERE import_id = ${id}); DELETE FROM erb_versions WHERE import_id = ${id}`)
    updateImport(id, { status: cancelled ? 'cancelled' : 'failed', message: cancelled ? 'cancelada pelo usuário' : `${e?.message ?? e}` }, true)
    updateFile(f.id, { status: 'recebido' })
    if (!cancelled) throw e
  }
}

async function runCdr(imp: ImportRec, f: SessionFile) {
  await exec(`DELETE FROM events WHERE import_id = ${imp.id}`)
  const table = await Table.open(f.blob, f.detected_format, imp.options.read ?? {}, (s) => updateImport(imp.id, { message: s }))
  const norm = new RowNormalizer(imp.mapping, imp.options, getState().targets, f)
  const issues: Issue[] = []
  const issueCounts = new Map<string, number>()
  const types: Record<string, number> = {}
  let total = 0
  let ok = 0
  let errors = 0
  let warnRows = 0
  let oos = 0
  let lines: string[] = []
  const estimate = Math.max(1, f.size_bytes / 90)
  const flush = async () => {
    if (!lines.length) return
    await insertCsv('events', EVENT_COLS, lines.join('\n') + '\n')
    lines = []
  }
  for await (const [raw, rec] of table.rows()) {
    total++
    const [ev, its] = norm.run(raw, rec)
    let rowWarn = false
    for (const [sev, code, field, msg] of its) {
      issueCounts.set(`${sev}|${code}`, (issueCounts.get(`${sev}|${code}`) ?? 0) + 1)
      rowWarn ||= sev === 'warning'
      if (issues.length < MAX_ISSUES) issues.push({ row: raw.row, page: raw.page, field, severity: sev, code, message: msg, raw: sev === 'error' ? rec : null })
    }
    if (!ev) {
      errors++
      continue
    }
    ok++
    if (rowWarn) warnRows++
    if (ev.out_of_scope) oos++
    types[ev.event_type] = (types[ev.event_type] ?? 0) + 1
    const full: Record<string, any> = { ...ev, import_id: imp.id, file_id: f.id, file_sha256: f.sha256 }
    lines.push(EVENT_COLS.map((c) => csvCell(full[c.name])).join(','))
    if (lines.length >= BATCH) {
      await flush()
      if (cancelFlags.has(imp.id)) throw new Error('__cancelado__')
      updateImport(imp.id, { progress: Math.min(0.95, total / estimate), message: `${total.toLocaleString('pt-BR')} linhas processadas`, rows_total: total })
    }
  }
  await flush()
  updateImport(imp.id, { message: 'marcando duplicidades', progress: 0.97 })
  await recomputeDuplicates()
  const dup = (await q1<{ n: number }>(`SELECT count(*)::INTEGER AS n FROM events WHERE import_id = ${imp.id} AND is_duplicate`)).n
  const span = await q1(`SELECT min(ts_local) AS a, max(ts_local) AS b FROM events WHERE import_id = ${imp.id}`)
  return {
    rows_total: total, rows_ok: ok, rows_error: errors, rows_warning: warnRows, rows_duplicate: dup, rows_out_of_scope: oos, issues,
    summary: {
      event_types: types,
      issues: [...issueCounts.entries()].sort((a, b) => b[1] - a[1]).map(([k, c]) => ({ severity: k.split('|')[0], code: k.split('|')[1], count: c })),
      issues_stored: issues.length,
      dedup_rule: 'mesmo alvo, origem, destino, data/hora UTC, duração, tipo, célula e IP',
      period: [span.a, span.b],
    },
  }
}

// ------------------------------------------------------------------ cadastro de ERB

export function normalizeErbRow(mapping: Record<string, string>, options: Record<string, any>, raw: RawRow, rec: Record<string, string>): [Record<string, any> | null, IssueT[]] {
  const m = Object.fromEntries(Object.entries(mapping ?? {}).filter(([, v]) => v))
  const hex = !!options.hex_ids
  const issues: IssueT[] = []
  const notes: string[] = []
  const g = (field: string) => {
    const col = m[field]
    const v = col ? rec[col] : null
    return typeof v === 'string' && v.trim() ? v.trim() : null
  }
  const tech = N.normalizeTech(g('tech')) ?? N.normalizeTech(options.default_tech)
  let mcc = N.normalizeId(g('mcc')) ?? options.default_mcc ?? null
  const mncRaw = g('mnc')
  let mnc = mncRaw && /^\d+$/.test(mncRaw) ? mncRaw.padStart(2, '0') : mncRaw ?? options.default_mnc ?? null
  const lac = N.normalizeId(g('lac'), hex)
  const tac = N.normalizeId(g('tac'), hex)
  const cid = N.normalizeId(g('cell_id'), hex)
  const eci = N.normalizeId(g('eci'), hex)
  const nci = N.normalizeId(g('nci'), hex)
  const cgi = N.normalizeCgi(g('cgi'))
  if (cgi && !(mcc && mnc)) {
    const p = N.splitCgi(cgi)
    mcc = mcc ?? p.mcc ?? null
    mnc = mnc ?? p.mnc ?? null
  }
  const siteCode = g('site_code')
  if (![cid, eci, nci, cgi, siteCode].some(Boolean)) return [null, [['error', 'sem_identificador', 'cell_id', 'linha sem identificador de célula ou estação']]]
  let [lat, le] = N.parseCoord(g('lat'), 'latitude')
  let [lon, lo] = N.parseCoord(g('lon'), 'longitude')
  let status = 'ok'
  for (const e of [le, lo])
    if (e) {
      issues.push(['warning', 'coordenada', 'lat/lon', e])
      notes.push(e)
    }
  const ci = N.coordsIssue(lat, lon)
  if (ci) {
    issues.push(['warning', 'coordenada', 'lat/lon', ci])
    notes.push(ci)
    status = ci.includes('0,0') ? 'coordenada_invalida' : 'verificar'
    if (ci.includes('0,0')) lat = lon = null
  }
  if ((lat === null || lon === null) && status === 'ok') status = 'sem_coordenada'
  const num = (v: string | null) => (v === null ? null : Number.isFinite(Number(v.replace(',', '.'))) ? Number(v.replace(',', '.')) : null)
  let az = num(g('azimuth'))
  if (az !== null && (az < 0 || az > 360)) {
    issues.push(['warning', 'azimute', 'azimuth', `azimute fora de 0–360: ${g('azimuth')}`])
    notes.push('azimute inválido')
    az = null
  }
  const op = (g('operator') ?? options.operator ?? null)?.toUpperCase() ?? null
  return [
    {
      row_number: raw.row, operator: op, tech, mcc, mnc, lac, tac, cell_id: cid, eci, nci, cgi,
      cell_key: N.buildCellKey(tech, mcc, mnc, lac, tac, cid, eci, nci, cgi, cid || eci || nci || cgi ? null : siteCode),
      site_code: siteCode, site_name: g('site_name'), address: g('address'), lat, lon, azimuth: az, beamwidth: num(g('beamwidth')),
      sector: g('sector'), height_m: num(g('height_m')), validation_status: status, validation_notes: notes, raw: JSON.stringify(rec),
    },
    issues,
  ]
}

const ERB_COLS = [
  ['id', 'INTEGER'], ['version_id', 'INTEGER'], ['row_number', 'INTEGER'], ['operator', 'VARCHAR'], ['tech', 'VARCHAR'], ['mcc', 'VARCHAR'], ['mnc', 'VARCHAR'],
  ['lac', 'VARCHAR'], ['tac', 'VARCHAR'], ['cell_id', 'VARCHAR'], ['eci', 'VARCHAR'], ['nci', 'VARCHAR'], ['cgi', 'VARCHAR'], ['cell_key', 'VARCHAR'],
  ['site_code', 'VARCHAR'], ['site_name', 'VARCHAR'], ['address', 'VARCHAR'], ['lat', 'DOUBLE'], ['lon', 'DOUBLE'], ['azimuth', 'DOUBLE'],
  ['beamwidth', 'DOUBLE'], ['sector', 'VARCHAR'], ['height_m', 'DOUBLE'], ['validation_status', 'VARCHAR'], ['validation_notes', 'VARCHAR'], ['raw', 'VARCHAR'],
].map(([name, type]) => ({ name, type }))

async function runErb(imp: ImportRec, f: SessionFile) {
  await exec(`DELETE FROM erb_cells WHERE version_id IN (SELECT id FROM erb_versions WHERE import_id = ${imp.id}); DELETE FROM erb_versions WHERE import_id = ${imp.id}`)
  const vid = nextId()
  const table = await Table.open(f.blob, f.detected_format, imp.options.read ?? {})
  const issues: Issue[] = []
  const issueCounts = new Map<string, number>()
  let total = 0
  let ok = 0
  let errors = 0
  let warnRows = 0
  const lines: string[] = []
  for await (const [raw, rec] of table.rows()) {
    total++
    const [cell, its] = normalizeErbRow(imp.mapping, imp.options, raw, rec)
    for (const [sev, code, field, msg] of its) {
      issueCounts.set(`${sev}|${code}`, (issueCounts.get(`${sev}|${code}`) ?? 0) + 1)
      if (issues.length < MAX_ISSUES) issues.push({ row: raw.row, field, severity: sev, code, message: msg, raw: sev === 'error' ? rec : null })
    }
    if (!cell) {
      errors++
      continue
    }
    ok++
    if (its.length) warnRows++
    const full: Record<string, any> = { ...cell, id: nextId(), version_id: vid, validation_notes: JSON.stringify(cell.validation_notes) }
    lines.push(ERB_COLS.map((c) => csvCell(full[c.name])).join(','))
  }
  if (lines.length) await insertCsv('erb_cells', ERB_COLS, lines.join('\n') + '\n')
  const ref = imp.options.reference_date
  await exec(`INSERT INTO erb_versions VALUES (${vid}, ${f.id}, ${imp.id}, ${lit(imp.options.operator || f.operator_declared || null)}, ${lit(imp.options.version_name || f.original_name)}, ${ref ? `DATE ${lit(ref)}` : 'NULL'}, ${ok})`)
  const conflicts = await q(`SELECT cell_key FROM erb_cells WHERE version_id = ${vid} AND cell_key IS NOT NULL
                             GROUP BY cell_key HAVING count(DISTINCT round(lat, 4)::VARCHAR || ',' || round(lon, 4)::VARCHAR) > 1`)
  if (conflicts.length)
    await exec(`UPDATE erb_cells SET validation_status = 'conflito',
                  validation_notes = CASE WHEN validation_notes = '[]' THEN '["identificador repetido com coordenadas diferentes"]'
                                          ELSE replace(validation_notes, ']', ',"identificador repetido com coordenadas diferentes"]') END
                WHERE version_id = ${vid} AND cell_key IN (${conflicts.map((c) => lit(c.cell_key)).join(',')})`)
  return {
    rows_total: total, rows_ok: ok, rows_error: errors, rows_warning: warnRows, rows_duplicate: 0, rows_out_of_scope: 0, issues,
    summary: { version_id: vid, conflicts: conflicts.length, issues: [...issueCounts.entries()].map(([k, c]) => ({ severity: k.split('|')[0], code: k.split('|')[1], count: c })) },
  }
}

export async function discardImport(id: number) {
  const n = (await q1<{ n: number }>(`SELECT count(*)::INTEGER AS n FROM events WHERE import_id = ${id}`)).n
  await exec(`DELETE FROM events WHERE import_id = ${id}`)
  await exec(`DELETE FROM erb_cells WHERE version_id IN (SELECT id FROM erb_versions WHERE import_id = ${id}); DELETE FROM erb_versions WHERE import_id = ${id}`)
  updateImport(id, { status: 'superseded' }, true)
  await recomputeDuplicates()
  return n
}
