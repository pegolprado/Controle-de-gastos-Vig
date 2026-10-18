/**
 * Dados de DEMONSTRAÇÃO (sintéticos), gerados no navegador.
 *
 * Cria arquivos em layouts diferentes e os processa pelo mesmo fluxo usado com
 * arquivos reais (SHA-256 → análise → mapeamento → importação → resolução de ERB →
 * alertas). Números, células e coordenadas são fictícios. Layouts "estilo TIM/Vivo/Claro"
 * são INVENTADOS para exercitar o importador; não reproduzem os layouts reais.
 */
import { ensureDefaultRules, runRules } from './alerts'
import { resetDb } from './db'
import { resolveErb } from './erb'
import { addFiles, analyze, createImport, runImport, syncTargetsTable } from './importer'
import { clearSession, nextId, setState } from './session'

const T_A = '+5561900000001'
const T_B = '+5561900000002'
const T_C = '+5561900000003'
const CENTER: [number, number] = [-15.79, -47.88]
const OPS: [string, string][] = [['TIM', '02'], ['VIVO', '11'], ['CLARO', '05']]
const N_SITES = 10

type Cell = { idx: number; site_idx: number; op: string; tech: string; mcc: string; mnc: string; lac: string; tac: string; ci: string; eci: string; site: string; name: string; lat: number; lon: number; az: number; bw: number }
type Ev = { ts: Date; kind: 'voz' | 'sms' | 'dados'; out: boolean; other: string | null; dur: number; cell: Cell; imei: string; ip: string }

/** Gerador pseudoaleatório determinístico (mulberry32). */
function rngOf(seed: number) {
  let a = seed >>> 0
  const random = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const randint = (lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1))
  const choice = <T,>(xs: readonly T[]) => xs[Math.floor(random() * xs.length)]
  const weighted = <T,>(xs: readonly T[], ws: number[]) => {
    const tot = ws.reduce((s, w) => s + w, 0)
    let r = random() * tot
    for (let i = 0; i < xs.length; i++) if ((r -= ws[i]) < 0) return xs[i]
    return xs[xs.length - 1]
  }
  const uniform = (lo: number, hi: number) => lo + random() * (hi - lo)
  const expo = (mean: number) => -Math.log(1 - random()) * mean
  return { random, randint, choice, weighted, uniform, expo }
}
type Rng = ReturnType<typeof rngOf>

const num = (i: number) => `+55619${String(80000000 + i).padStart(8, '0')}`
const local = (n: string) => `(${n.slice(3, 5)}) ${n.slice(5, 10)}-${n.slice(10)}`
const p2 = (n: number) => String(n).padStart(2, '0')
const fmtD = (d: Date) => `${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`
const fmtT = (d: Date) => `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`
const iso = (d: Date) => d.toISOString().slice(0, 19)
const hms = (s: number) => `${p2(Math.floor(s / 3600))}:${p2(Math.floor((s % 3600) / 60))}:${p2(s % 60)}`

function makeCells(rng: Rng): Cell[] {
  const cells: Cell[] = []
  for (let s = 0; s < N_SITES; s++) {
    const lat = Math.round((CENTER[0] + rng.uniform(-0.09, 0.09)) * 1e6) / 1e6
    const lon = Math.round((CENTER[1] + rng.uniform(-0.09, 0.09)) * 1e6) / 1e6
    OPS.forEach(([op, mnc], oi) => {
      for (const tech of ['3G', '4G']) {
        const g3 = tech === '3G'
        cells.push({
          idx: cells.length, site_idx: s, op, tech, mcc: '724', mnc,
          lac: g3 ? String(1100 + Math.floor(s / 4)) : '', tac: g3 ? '' : String(5100 + Math.floor(s / 4)),
          ci: g3 ? String(20000 + s * 10 + oi) : '', eci: g3 ? '' : String(256 * (3000 + s) + oi + 1),
          site: `DEMO-SITE-${p2(s + 1)}`, name: `ERB Demonstração ${p2(s + 1)}`, lat, lon, az: oi * 120 + 30, bw: 65,
        })
      }
    })
  }
  return cells
}

const pick = (cells: Cell[], op: string, site: number, techs: readonly string[], rng: Rng) => {
  const tech = rng.choice(techs)
  return cells.find((c) => c.op === op && c.site_idx === site && c.tech === tech)!
}

const HOUR_W = [1, 1, 1, 1, 1, 1, 2, 4, 7, 8, 8, 8, 9, 8, 8, 8, 8, 8, 7, 6, 5, 4, 3, 2]
const HOURS = Array.from({ length: 24 }, (_, i) => i)

function events(rng: Rng, target: string, cells: Cell[], contacts: string[], days: number, peers: [string, number][], op: string, home: number, work: number, techs: readonly string[]): Ev[] {
  const evs: Ev[] = []
  const weights = contacts.map((_, k) => 1 / (k + 1) ** 0.9)
  for (let d = 0; d < days; d++) {
    const day = new Date(Date.UTC(2026, 2, 1 + d))
    const weekday = (day.getUTCDay() + 6) % 7 // 0 = segunda
    let n = weekday < 5 ? rng.randint(18, 45) : rng.randint(6, 20)
    if (d === 17) n += 70 // pico atípico
    for (let i = 0; i < n; i++) {
      const hour = rng.weighted(HOURS, HOUR_W)
      const ts = new Date(Date.UTC(2026, 2, 1 + d, hour, rng.randint(0, 59), rng.randint(0, 59)))
      const r = rng.random()
      let peer: string | null = null
      for (const [p, prob] of peers) if (rng.random() < prob) {
        peer = p
        break
      }
      const other = peer ?? rng.weighted(contacts, weights)
      const kind = r < 0.12 ? 'dados' : r < 0.3 ? 'sms' : 'voz'
      const out = rng.random() < 0.55
      const dur = kind === 'sms' ? 0 : kind === 'dados' ? rng.randint(60, 7200) : rng.random() < 0.07 ? 0 : Math.floor(rng.expo(95)) + 3
      const site = rng.random() < 0.15 ? rng.randint(0, N_SITES - 1) : hour >= 8 && hour < 18 && weekday < 5 ? work : home
      evs.push({
        ts, kind, out, other: kind === 'dados' ? null : other, dur, cell: pick(cells, op, site, techs, rng),
        imei: '35' + Array.from({ length: 13 }, (_, k) => String((target.charCodeAt(target.length - 1) + k) % 10)).join(''),
        ip: kind === 'dados' ? `10.${rng.randint(0, 255)}.${rng.randint(0, 255)}.${rng.randint(1, 254)}` : '',
      })
    }
  }
  return evs.sort((x, y) => +x.ts - +y.ts)
}

/** Registros recíprocos: o que o alvo A falou com B aparece também na bilhetagem de B. */
function mirror(from: Ev[], owner: string, target: string, rng: Rng): Ev[] {
  return from
    .filter((e) => e.other === target && e.kind !== 'dados')
    .map((e) => {
      const skew = e.kind === 'voz' ? rng.choice([0, 0, 0, 1, 2]) : rng.choice([0, 1, 3])
      return { ...e, ts: new Date(+e.ts + skew * 1000), out: !e.out, other: owner, dur: e.dur + rng.choice([0, 0, 1]) }
    })
}

function csv(rows: (string | number)[][], delim = ';', eol = '\n') {
  return rows.map((r) => r.map((v) => (/[";\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(delim)).join(eol) + eol
}

/** Windows-1252 para os caracteres usados (Latin-1). */
function cp1252(s: string) {
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    out[i] = c < 256 ? c : 63
  }
  return out
}

export async function buildFiles(seed = 20260301): Promise<File[]> {
  const rng = rngOf(seed)
  const cells = makeCells(rng)
  const contacts = Array.from({ length: 59 }, (_, i) => num(i + 1))
  const common = contacts.slice(0, 6)
  const a = events(rng, T_A, cells, [...common, ...contacts.slice(6, 28)], 31, [[T_B, 0.06], [T_C, 0.02]], 'TIM', 0, 3, ['3G'])
  let b = events(rng, T_B, cells, [...common, ...contacts.slice(20, 44)], 31, [[T_C, 0.03]], 'VIVO', 1, 3, ['3G', '4G'])
  let c = events(rng, T_C, cells, [...common, ...contacts.slice(36, 59)], 31, [], 'CLARO', 5, 6, ['4G'])
  // registros recíprocos: a célula é a da rede de quem registrou (mesmo local, outra operadora)
  b = [...b, ...mirror(a, T_A, T_B, rng).map((e) => ({ ...e, cell: pick(cells, 'VIVO', e.cell.site_idx, ['3G', '4G'], rng) }))]
  c = [...c, ...mirror(a, T_A, T_C, rng).map((e) => ({ ...e, cell: pick(cells, 'CLARO', e.cell.site_idx, ['4G'], rng) }))]
  c = [...c, ...mirror(b, T_B, T_C, rng).map((e) => ({ ...e, cell: pick(cells, 'CLARO', e.cell.site_idx, ['4G'], rng) }))]
  b.sort((x, y) => +x.ts - +y.ts)
  c.sort((x, y) => +x.ts - +y.ts)

  // ---- Arquivo 1: CSV ';' cp1252 com preâmbulo (layout fictício "estilo TIM")
  const rows: (string | number)[][] = []
  for (const e of a) {
    if (e.kind === 'dados') continue
    const tipo = e.kind === 'voz' ? (e.out ? 'Originada' : 'Recebida') : e.out ? 'SMS Originado' : 'SMS Recebido'
    const [na, nb] = e.out ? [local(T_A), local(e.other!)] : [local(e.other!), local(T_A)]
    rows.push([na, nb, fmtD(e.ts), fmtT(e.ts), hms(e.dur), tipo, 'UMTS', e.cell.mcc, e.cell.mnc, e.cell.lac, e.cell.ci, e.imei])
  }
  rows.splice(5, 0, rows[5]) // duplicidade
  rows.splice(40, 0, rows[40])
  rows.push([local(T_A), local(contacts[2]), '31/02/2026', '10:00:00', '00:01:00', 'Originada', 'UMTS', '724', '02', '1100', '20001', ''])
  rows.push([local(T_A), local(contacts[3]), '28/02/2026', '23:10:00', '00:00:40', 'Originada', 'UMTS', '724', '02', '1100', '20001', ''])
  rows.push([local(T_A), local(contacts[4]), '15/03/2026', '25:61:00', 'abc', 'Originada', 'UMTS', '724', '02', '1100', '29999', ''])
  // CI sem LAC/MCC/MNC: casa com duas células do cadastro (mesmo CI em LACs diferentes) → ambígua
  rows.push([local(T_A), local(contacts[5]), '16/03/2026', '11:11:11', '00:02:10', 'Originada', '', '', '', '', '20000', ''])
  const f1 = csv([
    ['TIM S.A. - EXTRATO DE CHAMADAS - DOCUMENTO DE DEMONSTRAÇÃO (DADOS SINTÉTICOS)'],
    [`Linha: ${local(T_A)}`, 'Período: 01/03/2026 a 31/03/2026'],
    [],
    ['Número A', 'Número B', 'Data', 'Hora', 'Duração', 'Tipo', 'Tecnologia', 'MCC', 'MNC', 'LAC', 'CI', 'IMEI'],
    ...rows,
  ], ';', '\r\n')

  // ---- Arquivo 2: XLSX com data/hora ISO e fuso (layout fictício "estilo Vivo")
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Extrato')
  ws.addRow(['TELEFÔNICA BRASIL (VIVO) — RELATÓRIO DE DEMONSTRAÇÃO — DADOS SINTÉTICOS'])
  ws.addRow([])
  ws.addRow(['Data/Hora Início', 'Linha', 'Interlocutor', 'Sentido', 'Serviço', 'Duração (s)', 'CGI', 'IP', 'Upload', 'Download'])
  for (const e of b) {
    const cl = e.cell
    const cgi = cl.tech !== '4G' ? `${cl.mcc}-${cl.mnc}-${cl.lac}-${cl.ci}` : `${cl.mcc}-${cl.mnc}-${cl.eci}`
    const dados = e.kind === 'dados'
    ws.addRow([
      `${iso(e.ts)}-03:00`, T_B.slice(3), e.other ? e.other.slice(3) : '', dados ? '' : e.out ? 'Sainte' : 'Entrante',
      { voz: 'Voz', sms: 'SMS', dados: 'Dados' }[e.kind], e.dur, cgi, e.ip, dados ? rng.randint(1000, 900000) : '', dados ? rng.randint(1000, 9000000) : '',
    ])
  }
  const f2 = await wb.xlsx.writeBuffer()

  // ---- Arquivo 3: TXT de largura fixa sem fuso (layout fictício "estilo Claro")
  const L = (s: string | number, w: number, right = false) => (right ? String(s).padStart(w) : String(s).padEnd(w))
  const line = (v: (string | number)[]) => L(v[0], 20) + L(v[1], 8) + L(v[2], 16) + L(v[3], 16) + L(v[4], 8, true) + '  ' + L(v[5], 5) + L(v[6], 5) + L(v[7], 8) + L(v[8], 12)
  const lines = ['CLARO S.A. EXTRATO DEMONSTRACAO (SINTETICO)', '', line(['DATA_HORA', 'TIPO', 'ORIGEM', 'DESTINO', 'DURACAO', 'MCC', 'MNC', 'TAC', 'ECI'])]
  for (const e of c) {
    if (e.kind === 'dados') continue
    const tipo = (e.out ? 'MO' : 'MT') + (e.kind === 'sms' ? '-SMS' : '')
    const [o, d] = e.out ? [T_C.slice(3), e.other!.slice(3)] : [e.other!.slice(3), T_C.slice(3)]
    const ts = `${e.ts.getUTCFullYear()}${p2(e.ts.getUTCMonth() + 1)}${p2(e.ts.getUTCDate())} ${p2(e.ts.getUTCHours())}${p2(e.ts.getUTCMinutes())}${p2(e.ts.getUTCSeconds())}`
    lines.push(line([ts, tipo, o, d, e.dur, e.cell.mcc, e.cell.mnc, e.cell.tac, e.cell.eci]))
  }
  const f3 = lines.map((l) => l.trimEnd()).join('\n') + '\n'

  // ---- Cadastro de ERB (versão atual) com problemas propositais
  const regRows = (cs: Cell[], shift = 0) =>
    cs.map((cl) => [cl.op, cl.tech, cl.mcc, cl.mnc, cl.lac, cl.tac, cl.ci, cl.eci, cl.site, cl.name, `Endereço fictício ${cl.site_idx + 1}, Brasília-DF`,
      (cl.lat + shift).toFixed(6).replace('.', ','), (cl.lon + shift).toFixed(6).replace('.', ','), cl.az, cl.bw] as (string | number)[])
  const find = (op: string, site: number, tech: string) => cells.find((x) => x.op === op && x.site_idx === site && x.tech === tech)!
  const header = ['Operadora', 'Tecnologia', 'MCC', 'MNC', 'LAC', 'TAC', 'CI', 'ECI', 'Código ERB', 'Nome ERB', 'Endereço', 'Latitude', 'Longitude', 'Azimute', 'Abertura']
  const missing = find('VIVO', 4, '3G') // ausente do cadastro → "ERB não resolvida"
  const kept = cells.filter((x) => x !== missing)
  const current = regRows(kept)
  const bad = kept.indexOf(find('TIM', 9, '3G'))
  current[bad][11] = '0' // coordenada inválida
  current[bad][12] = '0'
  const conflict = regRows([find('CLARO', 8, '4G')])[0] // mesmo identificador, outra coordenada → conflito
  conflict[11] = (find('CLARO', 8, '4G').lat + 0.05).toFixed(6).replace('.', ',')
  current.push(conflict)
  const twin = regRows([find('TIM', 0, '3G')])[0] // mesmo CI em outra LAC (célula legítima distinta)
  twin[4] = '1105'
  twin[8] = 'DEMO-SITE-90'
  twin[9] = 'ERB Demonstração 90'
  twin[11] = (CENTER[0] + 0.12).toFixed(6).replace('.', ',')
  current.push(twin)
  const f4 = csv([header, ...current])
  const f5 = csv([header, ...regRows(cells.filter((x) => x.site_idx <= 1), 0.004)]) // versão antiga com coordenadas deslocadas

  return [
    new File([f5], 'DEMO_cadastro_ERB_2025-12.csv', { type: 'text/csv' }),
    new File([f4], 'DEMO_cadastro_ERB_2026-03.csv', { type: 'text/csv' }),
    new File([cp1252(f1)], 'DEMO_TIM_extrato_alvoA.csv', { type: 'text/csv' }),
    new File([f2 as ArrayBuffer], 'DEMO_VIVO_extrato_alvoB.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    new File([f3], 'DEMO_CLARO_extrato_alvoC.txt', { type: 'text/plain' }),
  ]
}

/** Substitui a sessão atual por uma análise de demonstração completa (só em memória). */
export async function loadDemo(onStatus: (s: string, p: number) => void = () => {}) {
  await resetDb()
  clearSession()
  setState({
    isDemo: true,
    meta: {
      title: 'Operação Exemplo — DEMONSTRAÇÃO (dados sintéticos)', reference: '0000000-00.0000.0.00.0000 (fictício)', unit: 'Unidade de demonstração',
      period_start: '2026-03-01', period_end: '2026-03-31', description: 'Análise de demonstração com dados 100% sintéticos para validar o fluxo completo da plataforma.',
    },
    targets: ([[T_A, 'TIM', 'Alvo A'], [T_B, 'VIVO', 'Alvo B'], [T_C, 'CLARO', 'Alvo C']] as const).map(([n, op, id]) => ({
      id: nextId(), number_normalized: n, number_original: local(n), operator: op, internal_id: id, label: `${id} (fictício)`,
      period_start: null, period_end: null, source: 'demonstração', notes: null, validation_status: 'validado',
    })),
  })
  await syncTargetsTable()
  onStatus('gerando arquivos sintéticos', 0.05)
  const files = await buildFiles()
  const plan: [string, 'cdr' | 'erb_registry', string | null, Record<string, any>][] = [
    ['DEMO_cadastro_ERB_2025-12.csv', 'erb_registry', null, { reference_date: '2025-12-01', version_name: 'Cadastro DEMO dez/2025' }],
    ['DEMO_cadastro_ERB_2026-03.csv', 'erb_registry', null, { reference_date: '2026-03-01', version_name: 'Cadastro DEMO mar/2026' }],
    ['DEMO_TIM_extrato_alvoA.csv', 'cdr', 'TIM', { target_number: T_A, tz_mode: 'assumed', tz_name: 'America/Sao_Paulo' }],
    ['DEMO_VIVO_extrato_alvoB.xlsx', 'cdr', 'VIVO', { target_number: T_B, tz_mode: 'confirmed', tz_name: 'America/Sao_Paulo' }],
    ['DEMO_CLARO_extrato_alvoC.txt', 'cdr', 'CLARO', {
      target_number: T_C, tz_mode: 'unknown', default_event_type: 'voz',
      value_map: { MO: 'voz_originada', MT: 'voz_recebida', 'MO-SMS': 'sms_enviado', 'MT-SMS': 'sms_recebido' },
    }],
  ]
  for (const [i, [name, kind, op, opts]] of plan.entries()) {
    onStatus(`importando ${name}`, 0.1 + (0.75 * i) / plan.length)
    const file = files.find((f) => f.name === name)!
    const [sf] = await addFiles([file], kind, op)
    const an = await analyze(sf.id, kind, {})
    const mapping = { ...an.suggested_mapping }
    if (kind === 'cdr' && an.columns.includes('ECI')) mapping.eci = 'ECI'
    const fmt: Record<string, string> = {}
    for (const k of ['date', 'time', 'datetime'] as const) if (an.formats[k]?.format) fmt[`${k}_format`] = an.formats[k].format!
    const imp = createImport(sf.id, kind, mapping, { operator: op, read: {}, ...fmt, ...opts })
    await runImport(imp.id, { autoResolve: false })
  }
  onStatus('resolvendo ERB', 0.88)
  await resolveErb(null)
  onStatus('executando regras de alerta', 0.95)
  ensureDefaultRules()
  await runRules()
  onStatus('pronto', 1)
}
