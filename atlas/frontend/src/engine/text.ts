/** Utilidades de texto compartilhadas pelos leitores e pela normalização. */

export function stripAccents(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '')
}

/** 'Duração (s)' -> 'duracao s'; usado para comparar cabeçalhos com sinônimos. */
export function normHeader(s: unknown): string {
  let t = stripAccents(String(s ?? '')).toLowerCase()
  t = t.replace(/[_\-/\\.:()[\]#]+/g, ' ')
  return t.replace(/\s+/g, ' ').trim()
}

/** Converte valor de planilha em texto sem perder informação (12.0 -> '12'). */
export function cellToStr(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'boolean') return v ? '1' : '0'
  if (typeof v === 'number') {
    if (Number.isInteger(v) && Math.abs(v) < 1e15) return String(v)
    return String(v)
  }
  if (v instanceof Date) {
    // planilhas guardam data/hora "de parede": usamos os componentes UTC do valor lido
    const iso = v.toISOString()
    return iso.slice(11, 19) === '00:00:00' ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${iso.slice(11, 19)}`
  }
  if (typeof v === 'object') {
    const o = v as any
    if ('result' in o) return cellToStr(o.result) // fórmula
    if ('richText' in o) return o.richText.map((x: any) => x.text).join('').trim()
    if ('text' in o) return String(o.text).trim()
    return JSON.stringify(v)
  }
  return String(v).trim()
}

/** Escapa um valor para SQL (DuckDB) — os dados vêm só do próprio usuário, mas mantemos a disciplina. */
export function lit(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL'
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  return `'${String(v).replace(/'/g, "''")}'`
}

export function litList(arr: unknown[]): string {
  return `(${arr.map(lit).join(', ')})`
}

/** Cede o controle ao navegador (mantém a tela responsiva durante processamentos longos). */
export function yieldToUi(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0))
}
