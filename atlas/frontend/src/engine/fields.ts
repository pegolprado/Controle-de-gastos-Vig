/**
 * Catálogo de campos padronizados. Os sinônimos apenas SUGEREM o mapeamento; o
 * analista confirma ou corrige. Identificadores tecnicamente diferentes (CI, ECI,
 * NCI, CGI, LAC, TAC) têm campos próprios e nunca são equiparados automaticamente.
 */
import { CDR_FIELDS, ERB_FIELDS } from './fieldsData'
import { normHeader } from './text'

export { CDR_FIELDS, ERB_FIELDS }
export type Kind = 'cdr' | 'erb_registry'

const ALL_SYNONYMS = new Set(
  [CDR_FIELDS, ERB_FIELDS].flatMap((cat) => Object.values(cat).flatMap((f) => f.syn.map(normHeader))),
)

export function catalog(kind: Kind) {
  return kind === 'cdr' ? CDR_FIELDS : ERB_FIELDS
}

export function suggestMapping(columns: string[], kind: Kind = 'cdr'): Record<string, string> {
  const cat = catalog(kind)
  const normed = new Map(columns.map((c) => [c, normHeader(c)]))
  const mapping: Record<string, string> = {}
  const used = new Set<string>()
  for (const [field, spec] of Object.entries(cat)) {
    const syns = spec.syn.map(normHeader)
    for (const [col, n] of normed) {
      if (used.has(col)) continue
      if (syns.includes(n)) {
        mapping[field] = col
        used.add(col)
        break
      }
    }
  }
  for (const [field, spec] of Object.entries(cat)) {
    if (mapping[field]) continue
    const syns = spec.syn.filter((s) => s.length > 3 && s.includes(' ')).map(normHeader).sort((a, b) => b.length - a.length)
    for (const [col, n] of normed) {
      if (used.has(col)) continue
      const padded = ` ${n} `
      if (syns.some((s) => padded.includes(` ${s} `))) {
        mapping[field] = col
        used.add(col)
        break
      }
    }
  }
  return mapping
}

export function headerScore(cells: string[]): number {
  const nonEmpty = cells.filter((c) => c.trim())
  if (nonEmpty.length < 2) return 0
  const hits = nonEmpty.filter((c) => ALL_SYNONYMS.has(normHeader(c))).length
  const texty = nonEmpty.filter((c) => !/\d/.test(c)).length
  return hits * 3 + texty / nonEmpty.length
}
