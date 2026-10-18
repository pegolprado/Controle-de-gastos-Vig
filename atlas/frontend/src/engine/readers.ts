/**
 * Leitores de arquivo executados no navegador. O arquivo nunca é enviado a um servidor.
 * Cada formato produz linhas cruas (linha/página de origem + células em texto);
 * a detecção de cabeçalho é comum a todos.
 */
import { headerScore } from './fields'
import { cellToStr, yieldToUi } from './text'

export type Fmt = 'csv' | 'fixed' | 'txt' | 'xlsx' | 'xls' | 'json' | 'xml' | 'html' | 'pdf' | 'zip' | 'empty' | 'unknown'
export const TABULAR: Fmt[] = ['csv', 'fixed', 'txt', 'xlsx', 'xls', 'json', 'xml', 'html', 'pdf']
const SCAN = 60

export type ReadOptions = {
  encoding?: string
  delimiter?: string
  header_row?: number // índice 0-based; -1 = sem cabeçalho
  sheet?: string
  fixed_widths?: number[]
  ocr?: boolean
}

export type RawRow = { row: number; cells: string[]; page?: number | null; confidence?: number | null }

export type TableInfo = {
  fmt: Fmt
  encoding?: string | null
  delimiter?: string | null
  sheet?: string | null
  sheets: string[]
  header_row: number
  columns: string[]
  preamble: string[]
  pages?: number | null
  ocr_used: boolean
  ocr_confidence?: number | null
  fixed_widths?: number[] | null
  warnings: string[]
}

// ---------------------------------------------------------------- detecção

export function decodeText(buf: Uint8Array, encoding?: string): { text: string; encoding: string } {
  if (encoding) return { text: new TextDecoder(encoding === 'utf-8-sig' ? 'utf-8' : encoding).decode(buf), encoding }
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return { text: new TextDecoder('utf-8').decode(buf.subarray(3)), encoding: 'utf-8-sig' }
  if (buf[0] === 0xff && buf[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(buf.subarray(2)), encoding: 'utf-16' }
  if (buf[0] === 0xfe && buf[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(buf.subarray(2)), encoding: 'utf-16' }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), encoding: 'utf-8' }
  } catch {
    return { text: new TextDecoder('windows-1252').decode(buf), encoding: 'cp1252' }
  }
}

function countOutsideQuotes(line: string, d: string) {
  let n = 0
  let q = false
  for (const ch of line) {
    if (ch === '"') q = !q
    else if (ch === d && !q) n++
  }
  return n
}

export function sniffDelimiter(lines: string[]): string | null {
  let best: string | null = null
  let bestScore = 0
  for (const d of [';', '\t', ',', '|']) {
    const counts = lines.map((l) => countOutsideQuotes(l, d)).filter((c) => c > 0)
    if (counts.length < Math.max(1, Math.floor(lines.length / 2))) continue
    const freq = new Map<number, number>()
    counts.forEach((c) => freq.set(c, (freq.get(c) ?? 0) + 1))
    const [mode, f] = [...freq.entries()].sort((a, b) => b[1] - a[1])[0]
    const consistency = f / counts.length
    const score = consistency * Math.min(mode, 30) * (counts.length / Math.max(lines.length, 1))
    if (consistency >= 0.6 && score > bestScore) {
      best = d
      bestScore = score
    }
  }
  return best
}

export function inferFixedWidths(lines: string[]): number[] | null {
  if (lines.length < 3) return null
  const maxlen = Math.max(...lines.map((l) => l.trimEnd().length))
  const body = lines.map((l) => l.replace(/[\r\n]+$/, '')).filter((l) => l.trimEnd().length >= maxlen * 0.7)
  if (body.length < 3 || maxlen < 10) return null
  const width = Math.max(...body.map((l) => l.length))
  const first = body[0]
  const isSpace: boolean[] = []
  for (let i = 0; i < width; i++) {
    const spaces = body.filter((l) => i >= l.length || l[i] === ' ').length
    isSpace.push(spaces / body.length >= 0.95 && (i >= first.length || first[i] === ' '))
  }
  const starts: number[] = []
  for (let i = 0; i < width; i++) if (!isSpace[i] && (i === 0 || isSpace[i - 1])) starts.push(i)
  return starts.length >= 3 ? starts : null
}

export async function sniffFormat(file: Blob, name = ''): Promise<Fmt> {
  const head = new Uint8Array(await file.slice(0, 8192).arrayBuffer())
  if (!head.length) return 'empty'
  if (head[0] === 0x50 && head[1] === 0x4b && (head[2] === 3 || head[2] === 5)) {
    const { unzipSync } = await import('fflate')
    try {
      const names = Object.keys(unzipSync(new Uint8Array(await file.arrayBuffer()), { filter: (f) => f.name === 'xl/workbook.xml' }))
      return names.length ? 'xlsx' : 'zip'
    } catch {
      return 'unknown'
    }
  }
  if ([0xd0, 0xcf, 0x11, 0xe0].every((b, i) => head[i] === b)) return 'xls'
  if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) return 'pdf'
  const isUtf16 = (head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff)
  if (!isUtf16 && head.subarray(0, 2048).includes(0)) return 'unknown'
  let text: string
  try {
    text = decodeText(head.subarray(0, head.length - (head.length === 8192 ? 3 : 0))).text
  } catch {
    text = new TextDecoder('windows-1252').decode(head)
  }
  const stripped = text.replace(/^[\ufeff\ufffe\s]+/, '')
  const low = stripped.slice(0, 500).toLowerCase()
  if (low.startsWith('<!doctype html') || low.startsWith('<html') || low.includes('<table')) return 'html'
  if (stripped.startsWith('<')) return 'xml'
  if (stripped.startsWith('{') || stripped.startsWith('[')) return 'json'
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 50)
  if (sniffDelimiter(lines)) return 'csv'
  if (inferFixedWidths(lines)) return 'fixed'
  void name
  return 'txt'
}

// ---------------------------------------------------------------- leitores crus

async function* rowsCsv(file: Blob, o: ReadOptions, info: TableInfo): AsyncGenerator<RawRow> {
  const { text, encoding } = decodeText(new Uint8Array(await file.arrayBuffer()), o.encoding)
  info.encoding = encoding
  const delim = o.delimiter || sniffDelimiter(text.slice(0, 200_000).split(/\r?\n/).filter((l) => l.trim()).slice(0, 80)) || ';'
  info.delimiter = delim
  let row: string[] = []
  let cell = ''
  let q = false
  let n = 1
  const len = text.length
  for (let i = 0; i < len; i++) {
    const ch = text[i]
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else q = false
      } else cell += ch
      continue
    }
    if (ch === '"' && cell.trim() === '') {
      q = true
      cell = ''
    } else if (ch === delim) {
      row.push(cell.trim())
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell.trim())
      yield { row: n++, cells: row }
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell || row.length) {
    row.push(cell.trim())
    yield { row: n, cells: row }
  }
}

async function* rowsLines(file: Blob, o: ReadOptions, info: TableInfo, fixed: boolean): AsyncGenerator<RawRow> {
  const { text, encoding } = decodeText(new Uint8Array(await file.arrayBuffer()), o.encoding)
  info.encoding = encoding
  const lines = text.split(/\r?\n/)
  if (lines.length && lines[lines.length - 1] === '') lines.pop()
  let widths = o.fixed_widths
  if (fixed && !widths?.length) widths = inferFixedWidths(lines.filter((l) => l.trim()).slice(0, 300)) ?? [0]
  if (fixed) info.fixed_widths = widths!
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    const cells = fixed ? widths!.map((a, j) => l.slice(a, widths![j + 1]).trim()) : l.trim().split(/\s{2,}|\t/).map((c) => c.trim())
    yield { row: i + 1, cells }
  }
}

async function* rowsXlsx(file: Blob, o: ReadOptions, info: TableInfo): AsyncGenerator<RawRow> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await file.arrayBuffer())
  info.sheets = wb.worksheets.map((w) => w.name)
  const ws = (o.sheet && wb.getWorksheet(o.sheet)) || [...wb.worksheets].sort((a, b) => b.rowCount - a.rowCount)[0]
  info.sheet = ws.name
  const width = ws.columnCount
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const cells: string[] = []
    for (let c = 1; c <= width; c++) cells.push(cellToStr(row.getCell(c).value))
    yield { row: r, cells }
  }
}

async function* rowsXls(file: Blob, o: ReadOptions, info: TableInfo): AsyncGenerator<RawRow> {
  const XLSX = await import('xlsx')
  const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array', cellDates: false, cellNF: true })
  info.sheets = wb.SheetNames
  const pickName =
    o.sheet && wb.Sheets[o.sheet] ? o.sheet : [...wb.SheetNames].sort((a, b) => XLSX.utils.decode_range(wb.Sheets[b]['!ref'] ?? 'A1').e.r - XLSX.utils.decode_range(wb.Sheets[a]['!ref'] ?? 'A1').e.r)[0]
  info.sheet = pickName
  const ws = wb.Sheets[pickName]
  if (!ws['!ref']) return
  const rg = XLSX.utils.decode_range(ws['!ref'])
  for (let r = rg.s.r; r <= rg.e.r; r++) {
    const cells: string[] = []
    for (let c = rg.s.c; c <= rg.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })]
      if (!cell) cells.push('')
      else if (cell.t === 'n' && cell.z && XLSX.SSF.is_date(cell.z as string)) {
        const p = XLSX.SSF.parse_date_code(cell.v as number)
        const pad = (x: number) => String(x).padStart(2, '0')
        const date = `${p.y}-${pad(p.m)}-${pad(p.d)}`
        cells.push(p.H || p.M || p.S ? `${date} ${pad(p.H)}:${pad(p.M)}:${pad(Math.floor(p.S))}` : date)
      } else cells.push(cellToStr(cell.v))
    }
    yield { row: r + 1, cells }
  }
}

function flatten(obj: any, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix + k
    if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, flatten(v, key + '.'))
    else out[key] = Array.isArray(v) ? JSON.stringify(v) : v
  }
  return out
}

function findRecordList(obj: any): any[] | null {
  if (Array.isArray(obj) && obj.length && obj.slice(0, 50).every((x) => x && typeof x === 'object' && !Array.isArray(x))) return obj
  let best: any[] | null = null
  if (obj && typeof obj === 'object')
    for (const v of Object.values(obj)) {
      const c = findRecordList(v)
      if (c && (!best || c.length > best.length)) best = c
    }
  return best
}

function* recordsToRows(records: Record<string, unknown>[]): Generator<RawRow> {
  const cols: string[] = []
  const seen = new Set<string>()
  for (const r of records)
    for (const k of Object.keys(r))
      if (!seen.has(k)) {
        seen.add(k)
        cols.push(k)
      }
  yield { row: 0, cells: cols }
  for (let i = 0; i < records.length; i++) yield { row: i + 1, cells: cols.map((c) => cellToStr(records[i][c])) }
}

async function* rowsJson(file: Blob, o: ReadOptions, info: TableInfo): AsyncGenerator<RawRow> {
  const { text, encoding } = decodeText(new Uint8Array(await file.arrayBuffer()), o.encoding)
  info.encoding = encoding
  const recs = findRecordList(JSON.parse(text))
  if (!recs) {
    info.warnings.push('JSON sem lista de registros reconhecível')
    return
  }
  yield* recordsToRows(recs.map((r) => flatten(r)))
}

async function* rowsXml(file: Blob, o: ReadOptions, info: TableInfo): AsyncGenerator<RawRow> {
  const { text, encoding } = decodeText(new Uint8Array(await file.arrayBuffer()), o.encoding)
  info.encoding = encoding
  // DOMParser do navegador não resolve entidades externas (sem XXE) nem acessa a rede
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) throw new Error('XML malformado')
  const counts = new Map<string, number>()
  doc.querySelectorAll('*').forEach((el) => {
    if (el.children.length) {
      const k = `${el.parentElement?.tagName ?? ''}>${el.tagName}`
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
  })
  if (!counts.size) {
    info.warnings.push('XML sem registros repetidos')
    return
  }
  const [key] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  const tag = key.split('>')[1]
  info.warnings.push(`registros lidos do elemento <${tag}>`)
  const recs: Record<string, unknown>[] = []
  doc.querySelectorAll('*').forEach((el) => {
    if (el.tagName !== tag || !el.children.length) return
    const r: Record<string, unknown> = {}
    for (const a of Array.from(el.attributes)) r['@' + a.name] = a.value
    for (const ch of Array.from(el.children)) {
      r[ch.localName] = (ch.textContent ?? '').trim()
      for (const a of Array.from(ch.attributes)) r[`${ch.localName}@${a.name}`] = a.value
    }
    recs.push(r)
  })
  yield* recordsToRows(recs)
}

async function* rowsHtml(file: Blob, o: ReadOptions, info: TableInfo): AsyncGenerator<RawRow> {
  const { text, encoding } = decodeText(new Uint8Array(await file.arrayBuffer()), o.encoding)
  info.encoding = encoding
  const doc = new DOMParser().parseFromString(text, 'text/html') // scripts não são executados
  const tables = Array.from(doc.querySelectorAll('table'))
  if (!tables.length) {
    info.warnings.push('HTML sem tabelas')
    return
  }
  const table = tables.sort((a, b) => b.rows.length - a.rows.length)[0]
  table.remove()
  info.preamble = (doc.body?.innerText ?? doc.body?.textContent ?? '').split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 30)
  let n = 0
  for (const tr of Array.from(table.rows)) yield { row: ++n, cells: Array.from(tr.cells).map((td) => (td.textContent ?? '').replace(/\s+/g, ' ').trim()) }
}

type Word = { x0: number; x1: number; y: number; text: string; conf?: number }

function wordsToLines(words: Word[], gap: number, yTol: number): { cells: string[]; conf: number | null }[] {
  const lines: Word[][] = []
  for (const w of [...words].sort((a, b) => a.y - b.y || a.x0 - b.x0)) {
    const last = lines[lines.length - 1]
    if (last && Math.abs(last[0].y - w.y) <= yTol) last.push(w)
    else lines.push([w])
  }
  return lines.map((ln) => {
    ln.sort((a, b) => a.x0 - b.x0)
    const cells: string[] = []
    let cur: string[] = []
    let lastEnd: number | null = null
    for (const w of ln) {
      if (lastEnd !== null && w.x0 - lastEnd > gap) {
        cells.push(cur.join(' '))
        cur = []
      }
      cur.push(w.text)
      lastEnd = w.x1
    }
    cells.push(cur.join(' '))
    const confs = ln.map((w) => w.conf).filter((c): c is number => typeof c === 'number' && c >= 0)
    return { cells, conf: confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length / 100 : null }
  })
}

async function* rowsPdf(file: Blob, o: ReadOptions, info: TableInfo, onStatus?: (s: string) => void): AsyncGenerator<RawRow> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  const pdf = await task.promise
  info.pages = pdf.numPages
  let n = 0
  const confs: number[] = []
  let ocrWorker: any = null
  try {
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p)
      const tc = await page.getTextContent()
      const items = tc.items.filter((it: any) => typeof it.str === 'string' && it.str.trim()) as any[]
      const chars = items.reduce((a, it) => a + it.str.trim().length, 0)
      if (chars >= 20) {
        const words: Word[] = []
        for (const it of items) {
          // divide itens com vários espaços (alguns geradores juntam colunas num só item)
          const x = it.transform[4]
          const y = -it.transform[5]
          const cw = it.width / Math.max(it.str.length, 1)
          let off = 0
          for (const part of it.str.split(/(\s{2,})/)) {
            if (part.trim() && !/^\s+$/.test(part)) words.push({ x0: x + off * cw, x1: x + (off + part.length) * cw, y, text: part.trim() })
            off += part.length
          }
        }
        const charW = Math.max(1, median(words.map((w) => (w.x1 - w.x0) / Math.max(w.text.length, 1))))
        for (const ln of wordsToLines(words, Math.max(4.5, charW * 1.15), 2.5)) yield { row: ++n, cells: ln.cells, page: p, confidence: 1 }
      } else if (o.ocr !== false) {
        info.ocr_used = true
        onStatus?.(`OCR da página ${p} de ${pdf.numPages}`)
        if (!ocrWorker) {
          const T = await import('tesseract.js')
          ocrWorker = await T.createWorker('por', 1, { workerPath: '/vendor/tesseract/worker.min.js', corePath: '/vendor/tesseract/core', langPath: '/vendor/tesseract/lang', cacheMethod: 'none', gzip: true })
        }
        const viewport = page.getViewport({ scale: 300 / 72 })
        const canvas = document.createElement('canvas')
        canvas.width = viewport.width
        canvas.height = viewport.height
        await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport } as any).promise
        const { data } = await ocrWorker.recognize(canvas, {}, { blocks: true })
        const words: Word[] = []
        for (const b of data.blocks ?? []) for (const par of b.paragraphs) for (const l of par.lines) for (const w of l.words) words.push({ x0: w.bbox.x0, x1: w.bbox.x1, y: (l.bbox.y0 + l.bbox.y1) / 2, text: w.text, conf: w.confidence })
        const lines = wordsToLines(words, 35, 12)
        for (const ln of lines) {
          if (ln.conf !== null) confs.push(ln.conf)
          yield { row: ++n, cells: ln.cells, page: p, confidence: ln.conf === null ? null : Math.round(ln.conf * 1000) / 1000 }
        }
        canvas.width = canvas.height = 0
      } else info.warnings.push(`página ${p} sem texto extraível (OCR desativado)`)
    }
  } finally {
    if (ocrWorker) await ocrWorker.terminate()
    await task.destroy()
  }
  if (confs.length) info.ocr_confidence = Math.round((confs.reduce((a, b) => a + b, 0) / confs.length) * 1000) / 1000
}

function median(xs: number[]) {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

const READERS: Partial<Record<Fmt, (f: Blob, o: ReadOptions, i: TableInfo, s?: (m: string) => void) => AsyncGenerator<RawRow>>> = {
  csv: rowsCsv,
  fixed: (f, o, i) => rowsLines(f, o, i, true),
  txt: (f, o, i) => rowsLines(f, o, i, false),
  xlsx: rowsXlsx,
  xls: rowsXls,
  json: rowsJson,
  xml: rowsXml,
  html: rowsHtml,
  pdf: rowsPdf,
}

// ---------------------------------------------------------------- tabela

export function detectHeader(rows: RawRow[]): number {
  let bestI = -1
  let bestS = 0
  rows.slice(0, SCAN).forEach((r, i) => {
    const s = headerScore(r.cells)
    if (s > bestS + 0.01) {
      bestI = i
      bestS = s
    }
  })
  if (bestS >= 3) return bestI
  for (let i = 0; i < Math.min(rows.length, SCAN); i++) {
    const ne = rows[i].cells.filter((c) => c.trim())
    if (ne.length >= 2 && ne.every((c) => !/^[\d\s.,:/+-]+$/.test(c))) return i
  }
  return -1
}

function dedupeColumns(cols: string[]) {
  const seen = new Map<string, number>()
  return cols.map((c, i) => {
    const name = c.trim() || `coluna_${i + 1}`
    const n = (seen.get(name) ?? 0) + 1
    seen.set(name, n)
    return n === 1 ? name : `${name}_${n}`
  })
}

export class Table {
  info: TableInfo
  private constructor(
    private file: Blob,
    fmt: Fmt,
    private opts: ReadOptions,
    private onStatus?: (s: string) => void,
  ) {
    this.info = { fmt, sheets: [], header_row: -1, columns: [], preamble: [], ocr_used: false, warnings: [] }
  }

  static async open(file: Blob, fmt: Fmt, opts: ReadOptions = {}, onStatus?: (s: string) => void): Promise<Table> {
    if (!READERS[fmt]) throw new Error(`formato não suportado para leitura tabular: ${fmt}`)
    const t = new Table(file, fmt, opts, onStatus)
    await t.prepare()
    return t
  }

  private raw() {
    return READERS[this.info.fmt]!(this.file, this.opts, this.info, this.onStatus)
  }

  private async prepare() {
    const head: RawRow[] = []
    const it = this.raw()
    for await (const r of it) {
      head.push(r)
      if (head.length >= SCAN) break
    }
    await it.return?.(undefined)
    const hdr = this.opts.header_row !== undefined && this.opts.header_row !== null ? this.opts.header_row : this.info.fmt === 'json' || this.info.fmt === 'xml' ? 0 : detectHeader(head)
    this.info.header_row = hdr
    if (hdr >= 0 && hdr < head.length) {
      this.info.columns = dedupeColumns(head[hdr].cells)
      this.info.preamble = [...this.info.preamble, ...head.slice(0, hdr).map((r) => r.cells.filter(Boolean).join(' ')).filter((p) => p.trim())]
    } else {
      const width = Math.max(0, ...head.map((r) => r.cells.length))
      this.info.columns = Array.from({ length: width }, (_, i) => `coluna_${i + 1}`)
      if (head.length) this.info.warnings.push('cabeçalho não identificado; colunas numeradas')
    }
  }

  async *rows(): AsyncGenerator<[RawRow, Record<string, string>]> {
    const cols = this.info.columns
    const hdr = this.info.header_row
    let headerCells: string | null = null
    let i = -1
    let sinceYield = 0
    for await (const r of this.raw()) {
      i++
      if (i <= hdr) {
        if (i === hdr) headerCells = r.cells.map((c) => c.trim()).join('\u0001')
        continue
      }
      if (!r.cells.some((c) => c.trim())) continue
      if (headerCells !== null && r.cells.map((c) => c.trim()).join('\u0001') === headerCells) continue
      const rec: Record<string, string> = {}
      r.cells.forEach((c, j) => {
        if (j < cols.length) rec[cols[j]] = c
        else if (c.trim()) rec[`__extra_${j + 1}`] = c
      })
      yield [r, rec]
      if (++sinceYield >= 20000) {
        sinceYield = 0
        await yieldToUi()
      }
    }
  }

  async sample(n = 25) {
    const out: Record<string, unknown>[] = []
    for await (const [r, rec] of this.rows()) {
      out.push({ _row: r.row, _page: r.page ?? null, _conf: r.confidence ?? null, ...rec })
      if (out.length >= n) break
    }
    return out
  }
}

// ---------------------------------------------------------------- ZIP seguro

export const ZIP_LIMITS = { entries: 200, totalBytes: 2000 * 1024 * 1024, ratio: 100 }

export async function expandZip(file: Blob): Promise<{ name: string; data: Uint8Array }[]> {
  const { unzipSync } = await import('fflate')
  const buf = new Uint8Array(await file.arrayBuffer())
  let count = 0
  let total = 0
  const entries = unzipSync(buf, {
    filter: (f) => {
      const n = f.name
      if (n.endsWith('/') || n.startsWith('__MACOSX/') || n.startsWith('/') || n.split('/').includes('..')) return false
      if (++count > ZIP_LIMITS.entries) throw new Error(`ZIP com mais de ${ZIP_LIMITS.entries} arquivos`)
      total += f.originalSize
      if (total > ZIP_LIMITS.totalBytes) throw new Error('conteúdo descompactado excede o limite')
      if (f.size && f.originalSize / f.size > ZIP_LIMITS.ratio) throw new Error(`taxa de compressão suspeita em ${n}`)
      return true
    },
  })
  return Object.entries(entries).map(([name, data]) => ({ name: name.split('/').pop()!, data }))
}

export async function sha256(file: Blob, onProgress?: (p: number) => void): Promise<string> {
  const { createSHA256 } = await import('hash-wasm')
  const h = await createSHA256()
  h.init()
  const step = 8 * 1024 * 1024
  for (let o = 0; o < file.size; o += step) {
    h.update(new Uint8Array(await file.slice(o, o + step).arrayBuffer()))
    onProgress?.(Math.min(1, (o + step) / file.size))
  }
  return h.digest('hex')
}
