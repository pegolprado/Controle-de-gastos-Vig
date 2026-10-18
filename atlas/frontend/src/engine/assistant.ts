/**
 * Assistente analítico LOCAL (determinístico), executado no navegador.
 *
 * Converte perguntas em português em filtros estruturados e verificáveis, executa a
 * consulta correspondente e descreve o resultado citando os números calculados.
 * Não usa serviços externos: nenhum dado sai do computador do usuário. Toda resposta
 * separa o que é dado extraído, cálculo, correlação e o que depende de validação humana.
 */
import { fmtNumberPlain } from '../lib/format'
import * as A from './analytics'
import { EVENT_TYPES, normalizeNumber } from './normalize'
import { stripAccents } from './text'

const PERIODS: Record<string, [number, number]> = { madrugada: [0, 5], manha: [6, 11], tarde: [12, 17], noite: [18, 23] }

export type Intent = 'list' | 'summary' | 'contacts' | 'common' | 'coincidence' | 'timeline'
export type AnswerLine = { kind: 'dado' | 'calculo' | 'correlacao' | 'hipotese' | 'limite' | 'indisponivel' | 'validacao'; text: string }

const pad = (n: number) => String(n).padStart(2, '0')
const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

function parseBrDate(s: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s)
  if (!m) return null
  const d = Number(m[1])
  const mo = Number(m[2])
  let y = Number(m[3])
  if (m[3].length === 2) y += y < 69 ? 2000 : 1900
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null
  return `${y}-${pad(mo)}-${pad(d)}`
}

export function parse(question: string, targets: string[]): { filter: A.EventFilter; intent: Intent; notes: string[] } {
  const q = stripAccents(question.toLowerCase())
  const notes: string[] = []
  const f: A.EventFilter = {}
  const nums: string[] = []
  for (const m of question.match(/\+?\(?\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}/g) ?? []) {
    const [n] = normalizeNumber(m)
    if (n && !nums.includes(n)) nums.push(n)
  }
  const alvoRefs = [...q.matchAll(/alvo\s+([a-z])\b/g)].map((m) => m[1])
  const dates = (q.match(/\d{1,2}\/\d{1,2}\/\d{2,4}/g) ?? []).map(parseBrDate).filter((x): x is string => !!x).sort()
  if (dates.length >= 2) {
    f.date_from = dates[0]
    f.date_to = dates[dates.length - 1]
    notes.push(`período de ${br(f.date_from)} a ${br(f.date_to)}`)
  } else if (dates.length === 1) {
    f.date_from = f.date_to = dates[0]
    notes.push(`data ${br(dates[0])}`)
  }
  const hm = /entre\s+(\d{1,2})\s*h?\s*e\s+(\d{1,2})\s*h/.exec(q)
  if (hm) {
    f.hour_from = Number(hm[1]) % 24
    f.hour_to = Number(hm[2]) % 24
    notes.push(`faixa horária ${f.hour_from}h–${f.hour_to}h`)
  } else {
    for (const [word, [h0, h1]] of Object.entries(PERIODS)) {
      if (new RegExp(`\\b${word}\\b`).test(q)) {
        f.hour_from = h0
        f.hour_to = h1
        notes.push(`${word} = ${h0}h–${h1}h (horário do documento)`)
        break
      }
    }
  }
  const types: string[] = []
  if (/\b(sms|mensage)/.test(q)) types.push('sms_enviado', 'sms_recebido', 'sms')
  if (/\b(chamad|ligac|ligou|ligaram|voz)/.test(q)) {
    if (q.includes('originad') || q.includes('efetuad') || /\bfez\b/.test(q)) types.push('voz_originada')
    else if (q.includes('recebid')) types.push('voz_recebida')
    else types.push('voz_originada', 'voz_recebida', 'voz')
  }
  if (/\b(dados|internet|conex)/.test(q)) types.push('dados')
  if (types.length) {
    f.event_types = types
    notes.push('tipos: ' + types.map((t) => EVENT_TYPES[t] ?? t).join(', '))
  }
  const dm = /(acima|mais) de\s+(\d+)\s*(min|seg|s\b)/.exec(q)
  if (dm) {
    const v = Number(dm[2])
    f.dur_min = dm[3].startsWith('min') ? v * 60 : v
    notes.push(`duração mínima ${f.dur_min} s`)
  }
  let intent: Intent = 'list'
  if (/\bem comum\b|compartilh/.test(q)) intent = 'common'
  else if (/mesma (erb|celula|antena)|mesmo local|juntos|coincid/.test(q)) intent = 'coincidence'
  else if (/mais frequent|quem mais|principais contatos|\btop\b|ranking|frequencia/.test(q)) intent = 'contacts'
  else if (/quant|total|resumo|estatistic|media|duracao total/.test(q)) intent = 'summary'
  else if (/linha do tempo|cronolog|sequencia/.test(q)) intent = 'timeline'
  if (alvoRefs.length && targets.length) {
    for (const ref of alvoRefs) {
      const idx = ref.charCodeAt(0) - 97
      if (idx >= 0 && idx < targets.length && !nums.includes(targets[idx])) {
        nums.push(targets[idx])
        notes.push(`'alvo ${ref.toUpperCase()}' interpretado como o ${idx + 1}º alvo cadastrado (${fmtNumberPlain(targets[idx])})`)
      }
    }
  }
  if (nums.length) {
    if (intent === 'common' || intent === 'coincidence') f.targets = nums
    else {
      f.numbers = nums
      if (nums.length === 2 && (intent === 'list' || intent === 'summary')) notes.push('eventos envolvendo os números citados')
    }
    notes.push('números: ' + nums.map((n) => fmtNumberPlain(n)).join(', '))
  }
  if (!notes.length) notes.push('nenhum critério reconhecido: considerando todos os eventos da análise')
  return { filter: f, intent, notes }
}

export async function answer(question: string, targets: string[]) {
  const { filter: f, intent, notes } = parse(question, targets)
  const out: Record<string, any> = { intent, interpretation: notes, filter: f, engine: 'assistente local determinístico (executado no seu navegador, sem envio de dados)' }
  const lines: AnswerLine[] = []
  if (intent === 'summary' || intent === 'list') {
    const s = await A.summary(f)
    const t = s.totals
    lines.push({ kind: 'dado', text: `${t.events} eventos atendem aos critérios (${t.calls} chamadas, ${t.sms} SMS, ${t.data_sessions} sessões de dados).` })
    if (t.events) {
      lines.push({ kind: 'dado', text: `Primeiro evento em ${String(t.first_event).replace('T', ' ')}, último em ${String(t.last_event).replace('T', ' ')}, em ${t.active_days} dias distintos.` })
      if (t.call_seconds) lines.push({ kind: 'calculo', text: `Duração total das chamadas: ${Math.floor(t.call_seconds / 60)} min; mediana de ${t.call_median} s (somente chamadas com duração > 0).` })
      if (t.tz_not_confirmed) lines.push({ kind: 'limite', text: `${t.tz_not_confirmed} eventos têm fuso horário não confirmado.` })
    }
    out.result = { totals: t }
  } else if (intent === 'contacts') {
    const c = await A.contacts(f, 10)
    for (const r of c.items.slice(0, 5))
      lines.push({ kind: 'calculo', text: `${fmtNumberPlain(r.other_number)}: ${r.events} eventos em ${r.days} dias com ${fmtNumberPlain(r.target_number)} (${r.outgoing} originados, ${r.incoming} recebidos).` })
    if (!c.items.length) lines.push({ kind: 'indisponivel', text: 'Nenhum interlocutor encontrado com os critérios.' })
    lines.push({ kind: 'limite', text: String(c.criteria.note) })
    out.result = c
  } else if (intent === 'common') {
    const nums = f.targets?.length ? f.targets : targets
    const c = await A.commonContacts(nums, { ...f, targets: [] })
    lines.push({ kind: 'calculo', text: `${c.shared.length} contatos em comum entre ${c.numbers.length} números.` })
    for (const r of c.shared.slice(0, 5))
      lines.push({ kind: 'dado', text: `${fmtNumberPlain(r.contact)}: ` + Object.entries(r.per_number as Record<string, any>).map(([k, v]) => `${fmtNumberPlain(k)} ${v.n}×`).join('; ') })
    lines.push({ kind: 'limite', text: 'Contato em comum não indica relação entre os titulares.' })
    out.result = c
  } else if (intent === 'coincidence') {
    const nums = f.targets?.length ? f.targets : targets
    const qq = stripAccents(question.toLowerCase())
    const sameCell = /erb|celula|antena/.test(qq)
    const c = await A.coincidences(nums, { ...f, targets: [] }, 600, sameCell, 200)
    lines.push({ kind: 'correlacao', text: `${c.items.length} pares de eventos em janela de 10 minutos${sameCell ? ' na mesma célula' : ''}${c.truncated ? ' (lista truncada)' : ''}.` })
    lines.push({ kind: 'hipotese', text: 'Coincidência de registros de rede é um indício para análise, não prova de presença física conjunta.' })
    out.result = c
  } else if (intent === 'timeline') {
    const t = await A.timeline(f, 'day', 12, 1, 50)
    lines.push({ kind: 'dado', text: `${t.events.total} eventos na linha do tempo; ${t.gaps.length} lacunas ≥ 12 h identificadas.` })
    out.result = { peaks: t.peaks, gaps: t.gaps }
  }
  lines.push({ kind: 'validacao', text: 'Confira os registros de origem antes de usar qualquer conclusão: use “Abrir registros”.' })
  out.answer = lines
  return out
}
