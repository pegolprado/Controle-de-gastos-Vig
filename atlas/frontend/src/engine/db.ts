/**
 * Banco analítico DuckDB executado no navegador, SOMENTE em memória.
 * Nenhum dado é gravado em disco, enviado ao servidor ou mantido após fechar/sair.
 */
import * as duckdb from '@duckdb/duckdb-wasm'
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url'

let dbP: Promise<{ db: duckdb.AsyncDuckDB; conn: duckdb.AsyncDuckDBConnection; worker: Worker }> | null = null

export const SCHEMA = `
CREATE SEQUENCE IF NOT EXISTS ev_seq START 1;
CREATE TABLE IF NOT EXISTS files (id INTEGER, original_name VARCHAR, sha256 VARCHAR, operator_declared VARCHAR, detected_format VARCHAR, kind VARCHAR);
CREATE TABLE IF NOT EXISTS targets (number_normalized VARCHAR, label VARCHAR, internal_id VARCHAR, operator VARCHAR, period_start DATE, period_end DATE);
CREATE TABLE IF NOT EXISTS events (
  id BIGINT DEFAULT nextval('ev_seq'), import_id INTEGER, file_id INTEGER, file_sha256 VARCHAR, row_number INTEGER, page INTEGER,
  operator VARCHAR, event_type VARCHAR, direction VARCHAR, a_number VARCHAR, b_number VARCHAR, a_raw VARCHAR, b_raw VARCHAR,
  target_number VARCHAR, other_number VARCHAR, ts_original VARCHAR, ts_utc TIMESTAMP, ts_local TIMESTAMP, tz_name VARCHAR, tz_status VARCHAR,
  duration_s INTEGER, status VARCHAR, tech VARCHAR, mcc VARCHAR, mnc VARCHAR, lac VARCHAR, tac VARCHAR, cell_id VARCHAR, eci VARCHAR, nci VARCHAR,
  cgi VARCHAR, erb_raw VARCHAR, cell_key VARCHAR, lat DOUBLE, lon DOUBLE, azimuth DOUBLE, imei VARCHAR, imsi VARCHAR, ip VARCHAR,
  bytes_up BIGINT, bytes_down BIGINT, raw VARCHAR, warnings VARCHAR, n_warnings INTEGER, confidence DOUBLE, dedup_hash VARCHAR, sig_key VARCHAR,
  is_duplicate BOOLEAN DEFAULT FALSE, duplicate_of BIGINT, out_of_scope BOOLEAN,
  resolved_cell_id INTEGER, resolution_status VARCHAR, resolution_rule VARCHAR, resolution_version_id INTEGER, resolution_note VARCHAR,
  resolution_candidates VARCHAR, resolution_manual BOOLEAN DEFAULT FALSE, revision INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS erb_versions (id INTEGER, file_id INTEGER, import_id INTEGER, operator VARCHAR, name VARCHAR, reference_date DATE, rows INTEGER);
CREATE TABLE IF NOT EXISTS erb_cells (
  id INTEGER, version_id INTEGER, row_number INTEGER, operator VARCHAR, tech VARCHAR, mcc VARCHAR, mnc VARCHAR, lac VARCHAR, tac VARCHAR,
  cell_id VARCHAR, eci VARCHAR, nci VARCHAR, cgi VARCHAR, cell_key VARCHAR, site_code VARCHAR, site_name VARCHAR, address VARCHAR,
  lat DOUBLE, lon DOUBLE, azimuth DOUBLE, beamwidth DOUBLE, sector VARCHAR, height_m DOUBLE, validation_status VARCHAR, validation_notes VARCHAR, raw VARCHAR
);
CREATE TABLE IF NOT EXISTS annotations (id INTEGER, ts_utc TIMESTAMP, number VARCHAR, text VARCHAR, author VARCHAR, created_at TIMESTAMP);
`

/**
 * Baixa o motor (dividido em partes no próprio site), confere o SHA-256 e entrega uma URL local.
 * Se o arquivo tiver sido alterado no caminho, o motor não é carregado.
 */
async function loadWasm(): Promise<string> {
  const m: { sha256: string; size: number; parts: string[] } = await (await fetch('/vendor/duckdb/manifest.json', { cache: 'no-cache' })).json()
  const bufs = await Promise.all(m.parts.map(async (p) => {
    const r = await fetch(p)
    if (!r.ok) throw new Error(`Falha ao carregar o motor analítico (${r.status})`)
    return new Uint8Array(await r.arrayBuffer())
  }))
  const all = new Uint8Array(m.size)
  let off = 0
  for (const b of bufs) {
    all.set(b, off)
    off += b.length
  }
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', all))].map((b) => b.toString(16).padStart(2, '0')).join('')
  if (off !== m.size || digest !== m.sha256) throw new Error('O motor analítico não passou na verificação de integridade. Recarregue a página.')
  return URL.createObjectURL(new Blob([all], { type: 'application/wasm' }))
}

export async function getDb() {
  if (!dbP) {
    dbP = (async () => {
      const module = await loadWasm()
      const worker = new Worker(ehWorker)
      const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker)
      try {
        await db.instantiate(module)
      } finally {
        URL.revokeObjectURL(module)
      }
      await db.open({ path: ':memory:', query: { castBigIntToDouble: true, castTimestampToDate: false } })
      const conn = await db.connect()
      await conn.query(SCHEMA)
      return { db, conn, worker }
    })()
  }
  return dbP
}

function convert(v: any, typeId: number | undefined): any {
  if (v === null || v === undefined) return null
  if (typeof v === 'bigint') return Number(v)
  // Arrow: 10 = Timestamp, 8 = Date (valores em ms desde a época, "de parede")
  if ((typeId === 10 || typeId === 8) && typeof v === 'number') {
    const iso = new Date(v).toISOString()
    return typeId === 8 ? iso.slice(0, 10) : iso.slice(0, 19)
  }
  if (v && typeof v === 'object' && typeof v.toArray === 'function') return Array.from(v.toArray(), (x: any) => convert(x, undefined))
  if (v && typeof v === 'object' && typeof v.toJSON === 'function') return v.toJSON()
  return v
}

/** Executa SQL e devolve linhas como objetos JS (datas em ISO sem fuso, BIGINT como número). */
export async function q<T = Record<string, any>>(sql: string): Promise<T[]> {
  const { conn } = await getDb()
  const res = await conn.query(sql)
  const fields = res.schema.fields.map((f: any) => ({ name: f.name, typeId: f.type.typeId }))
  const out: any[] = []
  for (const row of res) {
    const o: Record<string, any> = {}
    for (const f of fields) o[f.name] = convert((row as any)[f.name], f.typeId)
    out.push(o)
  }
  return out
}

export async function q1<T = Record<string, any>>(sql: string): Promise<T> {
  return (await q<T>(sql))[0]
}

export async function exec(sql: string): Promise<void> {
  const { conn } = await getDb()
  await conn.query(sql)
}

/** Insere linhas em lote via CSV registrado na memória do DuckDB (rápido para milhões de linhas). */
export async function insertCsv(table: string, columns: { name: string; type: string }[], csv: string): Promise<void> {
  const { db, conn } = await getDb()
  const name = `lote_${Math.random().toString(36).slice(2)}.csv`
  await db.registerFileText(name, csv)
  const colSpec = columns.map((c) => `'${c.name}': '${c.type}'`).join(', ')
  try {
    await conn.query(
      `INSERT INTO ${table} (${columns.map((c) => c.name).join(', ')})
       SELECT * FROM read_csv('${name}', header = false, delim = ',', quote = '"', escape = '"', nullstr = '\\N',
                              columns = {${colSpec}}, auto_detect = false, max_line_size = 20000000)`,
    )
  } finally {
    await db.dropFile(name)
  }
}

export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '\\N'
  const s = typeof v === 'string' ? v : String(v)
  if (s === '\\N') return '"\\N"'
  return /[",\n\r]/.test(s) || s === '' ? `"${s.replace(/"/g, '""')}"` : s
}

/** Apaga todos os dados analíticos da sessão (o banco continua carregado, vazio). */
export async function resetDb(): Promise<void> {
  if (!dbP) return
  const { conn } = await getDb()
  await conn.query(`DROP TABLE IF EXISTS events; DROP TABLE IF EXISTS erb_cells; DROP TABLE IF EXISTS erb_versions; DROP TABLE IF EXISTS files;
                    DROP TABLE IF EXISTS targets; DROP TABLE IF EXISTS annotations; DROP SEQUENCE IF EXISTS ev_seq;`)
  await conn.query(SCHEMA)
}
