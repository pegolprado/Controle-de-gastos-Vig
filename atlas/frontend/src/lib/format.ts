export const EVENT_TYPE_LABEL: Record<string, string> = {
  voz_originada: 'Chamada originada',
  voz_recebida: 'Chamada recebida',
  voz: 'Chamada (sentido n/i)',
  sms_enviado: 'SMS enviado',
  sms_recebido: 'SMS recebido',
  sms: 'SMS (sentido n/i)',
  dados: 'Sessão de dados',
  desvio: 'Chamada desviada',
  evento_rede: 'Evento de rede',
  outro: 'Outro registro',
}

export const VOICE = ['voz_originada', 'voz_recebida', 'voz', 'desvio']
export const SMS = ['sms_enviado', 'sms_recebido', 'sms']

let masked = false
/** Liga/desliga a ocultação de números NA TELA (exportações sempre usam o número completo). */
export function setNumberMask(v: boolean) {
  masked = v
}

/** Esconde os dígitos do meio, mantendo DDD e os dois últimos: (61) 9••••-••32. */
export function maskNumber(formatted: string): string {
  const total = (formatted.match(/\d/g) ?? []).length
  if (total <= 4) return formatted
  const keepHead = Math.min(3, total - 4)
  let i = 0
  return formatted.replace(/\d/g, (d) => {
    i++
    return i <= keepHead || i > total - 2 ? d : '•'
  })
}

/** Número formatado na tela (respeita a opção “ocultar números”). */
export function fmtNumber(n?: string | null): string {
  const s = fmtNumberPlain(n)
  return masked && n ? maskNumber(s) : s
}

/** Número completo, sem ocultação (usado em exportações e no motor). */
export function fmtNumberPlain(n?: string | null): string {
  if (!n) return '—'
  if (n.startsWith('+55') && (n.length === 13 || n.length === 14)) {
    const ddd = n.slice(3, 5)
    const rest = n.slice(5)
    return `(${ddd}) ${rest.slice(0, -4)}-${rest.slice(-4)}`
  }
  return n
}

export function fmtDateTime(v?: string | null, withSeconds = true): string {
  if (!v) return '—'
  const s = v.replace('T', ' ')
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2})(?::(\d{2}))?)?/)
  if (!m) return v
  const date = `${m[3]}/${m[2]}/${m[1]}`
  if (!m[4]) return date
  return `${date} ${m[4]}:${m[5]}${withSeconds && m[6] ? ':' + m[6] : ''}`
}

export function fmtDate(v?: string | null): string {
  return fmtDateTime(v).slice(0, 10)
}

export function fmtDuration(s?: number | null): string {
  if (s === null || s === undefined) return '—'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

export function fmtInt(n?: number | null): string {
  if (n === null || n === undefined) return '—'
  return new Intl.NumberFormat('pt-BR').format(n)
}

export function fmtBytes(n?: number | null): string {
  if (!n) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v < 10 && i ? 1 : 0)} ${u[i]}`
}

export const TZ_LABEL: Record<string, string> = {
  confirmed: 'fuso confirmado',
  assumed: 'fuso presumido',
  unknown: 'fuso desconhecido',
}

export const RESOLUTION_LABEL: Record<string, string> = {
  exact: 'exata',
  probable: 'provável',
  ambiguous: 'ambígua',
  none: 'não resolvida',
  pendente: 'pendente',
}

export const WEEKDAYS = ['', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom']

export function shortHash(h?: string | null) {
  return h ? `${h.slice(0, 10)}…${h.slice(-6)}` : '—'
}

/** Codifica um filtro na URL (drill-down "abrir os registros"). */
export function encodeFilter(f: object): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(f))))
}

export function decodeFilter(s: string | null): any {
  if (!s) return null
  try {
    return JSON.parse(decodeURIComponent(escape(atob(s))))
  } catch {
    return null
  }
}
