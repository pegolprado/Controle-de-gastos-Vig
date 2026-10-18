/**
 * Regras de normalização (versionadas por RULES_VERSION).
 * - o valor original é sempre preservado ao lado do normalizado;
 * - campo ausente ou ilegível vira null + aviso — nunca é deduzido;
 * - a operadora NUNCA é inferida pelo prefixo do número (portabilidade numérica).
 */
import { normHeader, stripAccents } from './text'

export const RULES_VERSION = '2026.10-2'
export const APP_VERSION = '2.0.0'

// ------------------------------------------------------------------ números

const EMPTY_NUM = new Set(['-', '--', '0', 'N/A', 'n/a', 'NA', 'null', 'NULL'])

export function normalizeNumber(raw: string | null | undefined): [string | null, string[]] {
  const w: string[] = []
  if (raw === null || raw === undefined) return [null, w]
  let s = String(raw).trim()
  if (!s || EMPTY_NUM.has(s)) return [null, w]
  if (/^\d+\.0$/.test(s)) s = s.slice(0, -2)
  const intl = s.startsWith('+')
  const d = s.replace(/\D/g, '')
  if (!d) return [null, ['número sem dígitos']]
  if (intl) return ['+' + d, w]
  if (d.startsWith('00') && d.length > 4) return ['+' + d.slice(2), w]
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) return ['+' + d, w]
  if (d.startsWith('0') && (d.length === 13 || d.length === 14)) return ['+55' + d.slice(3), ['código de prestadora (CSP) removido']]
  if (d.startsWith('0') && (d.length === 11 || d.length === 12)) return ['+55' + d.slice(1), w]
  if ((d.length === 10 || d.length === 11) && d[0] !== '0') {
    if (d.length === 10 && '6789'.includes(d[2])) w.push('possível celular sem o nono dígito (mantido como recebido)')
    return ['+55' + d, w]
  }
  if (d.length <= 6) return [d, ['número curto / de serviço']]
  if (d.length === 8 || d.length === 9) return [d, ['número sem DDD']]
  return [d, ['formato de número não reconhecido (mantido como recebido)']]
}

// ------------------------------------------------------------------ datas

export type LocalDT = { y: number; mo: number; d: number; h: number; mi: number; s: number; ms: number }

export const DATE_FORMATS = ['%d/%m/%Y', '%d/%m/%y', '%Y-%m-%d', '%d-%m-%Y', '%d.%m.%Y', '%Y/%m/%d', '%Y%m%d', '%m/%d/%Y']
export const TIME_FORMATS = ['%H:%M:%S', '%H:%M', '%H:%M:%S.%f', '%H%M%S', '%Hh%Mm%Ss']
export const DATETIME_FORMATS = [
  ...DATE_FORMATS.flatMap((d) => TIME_FORMATS.map((t) => `${d} ${t}`)),
  '%Y-%m-%dT%H:%M:%S',
  '%Y-%m-%dT%H:%M:%S.%f',
  '%Y%m%d%H%M%S',
  '%d/%m/%Y - %H:%M:%S',
]

const fmtCache = new Map<string, { re: RegExp; keys: string[] }>()
function compile(fmt: string) {
  let c = fmtCache.get(fmt)
  if (c) return c
  // tokens: diretivas (%X) e literais
  const toks: { k?: string; lit?: string }[] = []
  for (let i = 0; i < fmt.length; i++) {
    if (fmt[i] === '%' && i + 1 < fmt.length) toks.push({ k: fmt[++i] })
    else toks.push({ lit: fmt[i] })
  }
  const keys: string[] = []
  let re = '^'
  toks.forEach((t, i) => {
    if (t.lit !== undefined) {
      re += t.lit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      return
    }
    const k = t.k!
    keys.push(k)
    const adjacent = !!toks[i - 1]?.k || !!toks[i + 1]?.k // sem separador: largura fixa
    const w: Record<string, string> = { Y: '\\d{4}', y: '\\d{2}', f: '\\d{1,6}' }
    re += '(' + (w[k] ?? (adjacent ? '\\d{2}' : '\\d{1,2}')) + ')'
  })
  c = { re: new RegExp(re + '$'), keys }
  fmtCache.set(fmt, c)
  return c
}

function daysIn(y: number, m: number) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

export function strptime(s: string, fmt: string): LocalDT | null {
  const { re, keys } = compile(fmt)
  const m = re.exec(s)
  if (!m) return null
  const o: LocalDT = { y: 1900, mo: 1, d: 1, h: 0, mi: 0, s: 0, ms: 0 }
  keys.forEach((k, i) => {
    const v = m[i + 1]
    if (k === 'Y') o.y = +v
    else if (k === 'y') o.y = +v < 69 ? 2000 + +v : 1900 + +v
    else if (k === 'm') o.mo = +v
    else if (k === 'd') o.d = +v
    else if (k === 'H') o.h = +v
    else if (k === 'M') o.mi = +v
    else if (k === 'S') o.s = +v
    else if (k === 'f') o.ms = Math.round(+v.padEnd(6, '0') / 1000)
  })
  if (o.mo < 1 || o.mo > 12 || o.d < 1 || o.d > daysIn(o.y, o.mo) || o.h > 23 || o.mi > 59 || o.s > 59) return null
  return o
}

const ISO_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/
const OFFSET_IN_TEXT = /(?:UTC|GMT)\s*([+-]\d{1,2})(?::?(\d{2}))?/i

function cleanDt(s: string) {
  return s.trim().replace(/ {2}/g, ' ').replace(/\s+(BRT|BRST|UTC|GMT)([+-]\d.*)?$/i, '')
}

export function detectFormat(values: string[], candidates: string[]): { format: string | null; rate: number; ambiguous: boolean } {
  const vals = values.filter((v) => v && v.trim()).map(cleanDt)
  if (!vals.length) return { format: null, rate: 0, ambiguous: false }
  let best: string | null = null
  let bestRate = 0
  const rates: Record<string, number> = {}
  for (const f of candidates) {
    const ok = vals.filter((v) => strptime(v.replace(ISO_OFFSET, ''), f)).length
    rates[f] = ok / vals.length
    if (rates[f] > bestRate) {
      best = f
      bestRate = rates[f]
    }
  }
  if (best === null && vals.every(isExcelSerial)) return { format: 'excel_serial', rate: 1, ambiguous: false }
  const ambiguous = !!best && best.includes('%d/%m') && rates[best.replace('%d/%m', '%m/%d')] === bestRate
  return { format: best, rate: bestRate, ambiguous }
}

function isExcelSerial(v: string) {
  const x = Number(v.replace(',', '.'))
  return Number.isFinite(x) && x > 20000 && x < 80000
}

function fromExcelSerial(v: string): LocalDT {
  const x = Number(v.replace(',', '.'))
  const t = Date.UTC(1899, 11, 30) + Math.round(x * 86400000)
  const d = new Date(t)
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds(), ms: d.getUTCMilliseconds() }
}

export function parseLocalDatetime(
  dateS: string | null, timeS: string | null, dtS: string | null,
  dateFmt?: string | null, timeFmt?: string | null, dtFmt?: string | null,
): [LocalDT | null, string | null, string | null] {
  let offset: string | null = null
  if (dtS && dtS.trim()) {
    let raw = dtS.trim()
    const m = ISO_OFFSET.exec(raw)
    if (m && (raw.includes('T') || /^\d{4}-\d{2}-\d{2} /.test(raw))) {
      offset = m[1]
      raw = raw.slice(0, m.index)
    }
    const m2 = OFFSET_IN_TEXT.exec(raw)
    if (m2) offset = `${(+m2[1] >= 0 ? '+' : '-') + String(Math.abs(+m2[1])).padStart(2, '0')}:${m2[2] ?? '00'}`
    raw = cleanDt(raw)
    if (dtFmt === 'excel_serial') return [fromExcelSerial(raw), offset, null]
    for (const f of dtFmt ? [dtFmt] : DATETIME_FORMATS) {
      const r = strptime(raw, f)
      if (r) return [r, offset, null]
    }
    return [null, null, `data/hora não reconhecida: '${dtS}'`]
  }
  if (dateS && dateS.trim()) {
    let dRaw = dateS.trim()
    if (/^\d{4}-\d{2}-\d{2} 00:00:00$/.test(dRaw)) dRaw = dRaw.slice(0, 10)
    let d: LocalDT | null = null
    if (dateFmt === 'excel_serial') d = fromExcelSerial(dRaw)
    else
      for (const f of dateFmt ? [dateFmt] : DATE_FORMATS) {
        d = strptime(dRaw, f)
        if (d) break
      }
    if (!d) return [null, null, `data não reconhecida: '${dateS}'`]
    if (timeS && timeS.trim()) {
      let tRaw = timeS.trim()
      if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(tRaw)) tRaw = tRaw.slice(11)
      else if (/^0?[.,]\d+$/.test(tRaw)) {
        const secs = Math.round(Number(tRaw.replace(',', '.')) * 86400)
        tRaw = `${String(Math.floor(secs / 3600)).padStart(2, '0')}:${String(Math.floor((secs % 3600) / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`
      }
      let t: LocalDT | null = null
      for (const f of timeFmt ? [timeFmt] : TIME_FORMATS) {
        t = strptime(tRaw, f)
        if (t) break
      }
      if (!t) return [null, null, `horário não reconhecido: '${timeS}'`]
      return [{ ...d, h: t.h, mi: t.mi, s: t.s, ms: t.ms }, null, null]
    }
    return [d, null, 'evento sem horário (somente data)']
  }
  return [null, null, 'data/hora ausente']
}

function wallMs(l: LocalDT) {
  return Date.UTC(l.y, l.mo - 1, l.d, l.h, l.mi, l.s, l.ms)
}

const dtfCache = new Map<string, Intl.DateTimeFormat>()
function tzOffsetMs(utcMs: number, tz: string): number {
  let f = dtfCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    dtfCache.set(tz, f)
  }
  const p: Record<string, number> = {}
  for (const x of f.formatToParts(new Date(utcMs))) if (x.type !== 'literal') p[x.type] = +x.value
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(utcMs / 1000) * 1000
}

/** Converte data/hora "de parede" para UTC (ms). Offset explícito tem prioridade sobre o fuso IANA. */
export function toUtcMs(local: LocalDT, offset: string | null, tz: string | null): number {
  const w = wallMs(local)
  if (offset) {
    if (offset === 'Z') return w
    const sign = offset[0] === '-' ? -1 : 1
    const digits = offset.slice(1).replace(':', '')
    return w - sign * (+digits.slice(0, 2) * 3600000 + +(digits.slice(2) || '0') * 60000)
  }
  const zone = tz || 'America/Sao_Paulo'
  if (zone === 'UTC') return w
  let guess = w - tzOffsetMs(w, zone)
  guess = w - tzOffsetMs(guess, zone)
  return guess
}

export function localIso(l: LocalDT): string {
  return new Date(wallMs(l)).toISOString().slice(0, 19)
}

// ------------------------------------------------------------------ duração

export function parseDuration(raw: string | null, unit = 's'): [number | null, string | null] {
  if (raw === null || raw === undefined) return [null, null]
  const s = String(raw).trim()
  if (!s || s === '-' || s === '--') return [null, null]
  let m = /^(\d+):(\d{1,2}):(\d{1,2})(?:[.,]\d+)?$/.exec(s)
  if (m) return [+m[1] * 3600 + +m[2] * 60 + +m[3], null]
  m = /^(\d+):(\d{1,2})$/.exec(s)
  if (m) return [+m[1] * 60 + +m[2], null]
  m = /^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m(?:in)?)?\s*(?:(\d+)\s*s)?$/.exec(s.toLowerCase())
  if (m && (m[1] || m[2] || m[3])) return [+(m[1] ?? 0) * 3600 + +(m[2] ?? 0) * 60 + +(m[3] ?? 0), null]
  m = /^(?:1899-12-3[01]|1900-01-0[01]) (\d{2}):(\d{2}):(\d{2})$/.exec(s)
  if (m) return [+m[1] * 3600 + +m[2] * 60 + +m[3], null]
  const x = Number(s.replace(',', '.'))
  if (!Number.isFinite(x) || s === '') return [null, `duração não reconhecida: '${raw}'`]
  if (x < 0) return [null, `duração inválida: '${raw}'`]
  const factor = ({ s: 1, min: 60, ms: 0.001 } as Record<string, number>)[unit] ?? 1
  return [Math.round(x * factor), null]
}

// ------------------------------------------------------------------ tipos de evento

export const EVENT_TYPES: Record<string, string> = {
  voz_originada: 'Chamada originada',
  voz_recebida: 'Chamada recebida',
  voz: 'Chamada (sentido não informado)',
  sms_enviado: 'SMS enviado',
  sms_recebido: 'SMS recebido',
  sms: 'SMS (sentido não informado)',
  dados: 'Sessão de dados',
  desvio: 'Chamada desviada/encaminhada',
  evento_rede: 'Evento de rede',
  outro: 'Outro registro',
}

const OUT = ['originad', 'efetuad', 'sainte', 'saida', 'outgoing', ' mo ', 'orig', 'enviad', 'chamador']
const IN = ['recebid', 'entrante', 'entrada', 'incoming', ' mt ', 'terminad', 'term ', 'receb']

export function classifyDirection(text: string | null): 'out' | 'in' | 'unknown' {
  if (!text) return 'unknown'
  let t = stripAccents(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const bare = t
  t = ` ${t} `
  if (OUT.some((k) => t.includes(k))) return 'out'
  if (IN.some((k) => t.includes(k))) return 'in'
  if (['s', 'o', 'out'].includes(bare)) return 'out'
  if (['e', 'r', 'in'].includes(bare)) return 'in'
  return 'unknown'
}

const has = (t: string, ks: string[]) => ks.some((k) => t.includes(k))

export function classifyEvent(typeText: string | null, dirText: string | null, valueMap: Record<string, string> = {}, defaultType?: string | null): [string, string, boolean] {
  const key = (typeText ?? '').trim()
  let direction: string = dirText ? classifyDirection(dirText) : classifyDirection(typeText)
  if (key && valueMap[key]) {
    const et = valueMap[key]
    if (et === 'voz_originada' || et === 'sms_enviado') direction = 'out'
    else if (et === 'voz_recebida' || et === 'sms_recebido') direction = 'in'
    return [et, direction, true]
  }
  const t = ` ${normHeader(typeText ?? '')} `
  const pick = (base: 'voz' | 'sms') =>
    base === 'voz' ? ({ out: 'voz_originada', in: 'voz_recebida' } as any)[direction] ?? 'voz' : ({ out: 'sms_enviado', in: 'sms_recebido' } as any)[direction] ?? 'sms'
  if (!t.trim()) {
    const base = defaultType || 'outro'
    if (base === 'voz' || base === 'sms') return [pick(base), direction, true]
    return [base, direction, !!defaultType]
  }
  if (has(t, [' sms ', ' mensagem ', ' torpedo ', ' mms '])) return [pick('sms'), direction, true]
  if (has(t, [' dados ', ' gprs ', ' data ', ' internet ', ' pacote ', ' conexao ', ' psd ', ' ps '])) return ['dados', 'unknown', true]
  if (has(t, [' desvio ', ' desviad', ' encaminhad', ' forward', ' siga me '])) return ['desvio', direction, true]
  if (has(t, [' atualizacao ', ' location update ', ' registro ', ' attach ', ' handover ', ' evento de rede '])) return ['evento_rede', 'unknown', true]
  if (has(t, [' voz ', ' chamada ', ' call ', ' ligacao ', ' originada ', ' recebida ', ' mo ', ' mt ', ' moc ', ' mtc ', ' sainte ', ' entrante '])) return [pick('voz'), direction, true]
  return ['outro', direction, false]
}

// ------------------------------------------------------------------ células

const TECH: Record<string, string> = {
  '2g': '2G', gsm: '2G', gprs: '2G', edge: '2G', '3g': '3G', umts: '3G', wcdma: '3G', hspa: '3G', utran: '3G',
  '4g': '4G', lte: '4G', eutran: '4G', 'e utran': '4G', volte: '4G', '5g': '5G', nr: '5G', '5g nr': '5G', nsa: '5G', sa: '5G',
}

export function normalizeTech(raw: string | null | undefined): string | null {
  if (!raw) return null
  const t = normHeader(raw)
  if (TECH[t]) return TECH[t]
  for (const [k, v] of Object.entries(TECH)) if (k.length > 2 && t.includes(k)) return v
  return null
}

export function normalizeId(raw: string | null | undefined, hex = false): string | null {
  if (raw === null || raw === undefined) return null
  let s = String(raw).trim()
  if (!s || ['-', '--', 'N/A', 'NA', 'null'].includes(s)) return null
  if (/^\d+\.0$/.test(s)) s = s.slice(0, -2)
  if (hex) {
    const h = s.toLowerCase().replace(/^0x/, '')
    return /^[0-9a-f]+$/.test(h) ? BigInt('0x' + h).toString() : s
  }
  if (/^0x[0-9a-f]+$/i.test(s)) return BigInt(s).toString()
  if (/^\d+$/.test(s)) return BigInt(s).toString()
  return s
}

export function normalizeCgi(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = String(raw).trim()
  if (!s || s === '-' || s === '--') return null
  const parts = s.split(/[-.:/\s_]+/).filter(Boolean)
  if (parts.length >= 3 && parts.every((p) => /^\d+$/.test(p))) return parts.map((p, i) => (i > 1 ? BigInt(p).toString() : p)).join('-')
  return s.replace(/\s+/g, '').toUpperCase()
}

export function splitCgi(cgi: string | null): { mcc?: string; mnc?: string; area?: string; cid?: string } {
  if (!cgi || !cgi.includes('-')) return {}
  const p = cgi.split('-')
  if (p.length === 4) return { mcc: p[0], mnc: p[1], area: p[2], cid: p[3] }
  if (p.length === 3) return { mcc: p[0], mnc: p[1], cid: p[2] }
  return {}
}

export function buildCellKey(tech: any, mcc: any, mnc: any, lac: any, tac: any, cid: any, eci: any, nci: any, cgi: any, erbRaw: any): string | null {
  if (nci) return `5G|${mcc ?? '?'}|${mnc ?? '?'}|T${tac ?? '?'}|N${nci}`
  if (eci) return `4G|${mcc ?? '?'}|${mnc ?? '?'}|T${tac ?? '?'}|E${eci}`
  if (cid) return `${tech ?? '?'}|${mcc ?? '?'}|${mnc ?? '?'}|${lac ? 'L' + lac : tac ? 'T' + tac : '?'}|C${cid}`
  if (cgi) return `CGI|${cgi}`
  if (erbRaw) return `ERB|${String(erbRaw).trim().toUpperCase()}`
  return null
}

// ------------------------------------------------------------------ coordenadas

const DMS = /^(-?\d+(?:[.,]\d+)?)\s*[°º:\s]\s*(\d+(?:[.,]\d+)?)?\s*['’:\s]?\s*(\d+(?:[.,]\d+)?)?\s*["”]?\s*([NSEWLO])?$/i

export function parseCoord(raw: string | null | undefined, kind: 'latitude' | 'longitude'): [number | null, string | null] {
  if (raw === null || raw === undefined) return [null, null]
  const s = String(raw).trim()
  if (!s || s === '-' || s === '--') return [null, null]
  let v = Number(s.replace(',', '.'))
  if (!Number.isFinite(v)) {
    const m = DMS.exec(s)
    if (!m) return [null, `${kind} não reconhecida: '${raw}'`]
    const deg = Number(m[1].replace(',', '.'))
    v = Math.abs(deg) + Number((m[2] ?? '0').replace(',', '.')) / 60 + Number((m[3] ?? '0').replace(',', '.')) / 3600
    const hemi = (m[4] ?? '').toUpperCase()
    if (deg < 0 || ['S', 'W', 'O'].includes(hemi)) v = -v
  }
  const limit = kind === 'latitude' ? 90 : 180
  if (v < -limit || v > limit) {
    if (Math.abs(v) > 1e5 && Math.abs(v / 1e6) <= limit) return [v / 1e6, `${kind} convertida de micrograus`]
    return [null, `${kind} fora do intervalo válido: '${raw}'`]
  }
  return [v, null]
}

export function coordsIssue(lat: number | null, lon: number | null): string | null {
  if (lat === null || lon === null) return null
  if (lat === 0 && lon === 0) return 'coordenada 0,0 (inválida)'
  if (!(lat >= -34 && lat <= 5.5 && lon >= -74.5 && lon <= -28.5)) return 'coordenada fora do território brasileiro (verificar)'
  return null
}

export function parseIntLoose(raw: string | null): number | null {
  if (raw === null || raw === undefined) return null
  const s = String(raw).trim()
  if (/^\d+$/.test(s)) return Number(s)
  const d = s.split(',')[0].split('.')[0].replace(/\D/g, '')
  return d ? Number(d) : null
}

export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = 6371000
  const p1 = (lat1 * Math.PI) / 180
  const p2 = (lat2 * Math.PI) / 180
  const dp = p2 - p1
  const dl = ((lon2 - lon1) * Math.PI) / 180
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  return 2 * r * Math.asin(Math.sqrt(a))
}

/** Hash rápido e estável (FNV-1a 64 bits) para deduplicação e assinaturas. */
export function quickHash(parts: unknown[]): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  const s = parts.map((p) => (p === null || p === undefined ? '∅' : String(p))).join('|')
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193)
    h2 = Math.imul(h2 ^ c, 0x5bd1e995)
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0')
}

// ------------------------------------------------------------------ operadora

const OP_PATTERNS: Record<string, RegExp[]> = {
  TIM: [/\btim\b/, /tim s\.?a/, /tim celular/, /tim brasil/, /intelig/],
  VIVO: [/\bvivo\b/, /telefonica/, /telefonica brasil/],
  CLARO: [/\bclaro\b/, /embratel/, /\bnet servi/],
  OI: [/\boi\b s\.?a/, /telemar/, /\boi movel\b/],
}
const MNC_HINT: Record<string, string> = { '02': 'TIM', '03': 'TIM', '04': 'TIM', '05': 'CLARO', '06': 'VIVO', '10': 'VIVO', '11': 'VIVO', '23': 'VIVO', '16': 'OI', '24': 'OI', '31': 'OI' }

export function detectOperator(filename: string, preamble: string[], columns: string[], sampleMnc: string[]) {
  const scores: Record<string, number> = {}
  const evidence: string[] = []
  const sources: [string, string, number][] = [
    ['nome do arquivo', filename, 0.35],
    ['cabeçalho do documento', preamble.join(' '), 0.5],
    ['colunas', columns.join(' '), 0.2],
  ]
  for (const [src, text, w] of sources) {
    const low = stripAccents(text ?? '').toLowerCase()
    for (const [op, pats] of Object.entries(OP_PATTERNS)) {
      const p = pats.find((re) => re.test(low))
      if (p) {
        scores[op] = (scores[op] ?? 0) + w
        evidence.push(`'${p.source.replace(/\\b/g, '').replace(/\\/g, '')}' em ${src}`)
      }
    }
  }
  const mncs = sampleMnc.filter((m) => m && /^\d+$/.test(String(m).trim())).map((m) => String(+m).padStart(2, '0'))
  if (mncs.length) {
    const counts: Record<string, number> = {}
    mncs.forEach((m) => (counts[m] = (counts[m] ?? 0) + 1))
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
    const op = MNC_HINT[top]
    if (op) {
      scores[op] = (scores[op] ?? 0) + 0.25
      evidence.push(`MNC predominante ${top} (indício fraco)`)
    }
  }
  if (!Object.keys(scores).length) return { operator: null as string | null, confidence: 0, evidence: ['nenhum indício encontrado'] }
  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0]
  const total = Object.values(scores).reduce((a, b) => a + b, 0)
  return { operator: best[0] as string | null, confidence: Math.round(Math.min(0.99, (best[1] / total) * Math.min(1, best[1])) * 100) / 100, evidence }
}
