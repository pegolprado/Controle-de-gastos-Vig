/**
 * Exportação gerada inteiramente no navegador (PDF, Excel e CSV).
 * O arquivo é entregue ao usuário como download e não é enviado nem guardado em lugar algum.
 */
import { sha256 } from './readers'

export type ExportFormat = 'pdf' | 'xlsx' | 'csv'
export type Column = { key: string; label: string; fmt?: (v: any, row: any) => string | number | null; width?: number }
export type TableExport = {
  title: string
  subtitle?: string
  columns: Column[]
  rows: any[]
  criteria?: Record<string, any>
  notes?: string[]
}
export type Who = { name: string; email: string }

export const MIME: Record<ExportFormat, string> = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv;charset=utf-8',
}

export const BRAND = 'MARX · INTELLIGENCE PRO'
export const COLORS = { navy: [11, 18, 32] as const, cover: [8, 9, 13] as const, gold: [226, 169, 59] as const, blue: [47, 111, 223] as const, grey: [91, 101, 120] as const, line: [201, 210, 227] as const, zebra: [243, 246, 251] as const }

/** As fontes padrão do PDF cobrem Latin-1/WinAnsi (acentos do português); símbolos fora disso são trocados. */
export function pdfText(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v)
    .replace(/→/g, '->')
    .replace(/←/g, '<-')
    .replace(/≥/g, '>=')
    .replace(/≤/g, '<=')
    .replace(/≠/g, '!=')
    .replace(/…/g, '...')
    // eslint-disable-next-line no-control-regex
    .replace(/[^\u0000-ÿ–—‘’“”•€]/g, '?')
}

export function reportCode(prefix = 'MARX') {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const rnd = crypto.getRandomValues(new Uint8Array(2))
  return `${prefix}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${[...rnd].map((b) => b.toString(16).padStart(2, '0')).join('')}`
}

export function safeName(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').slice(0, 80)
}

/** Entrega o arquivo ao usuário e devolve o SHA-256 do conteúdo gerado (exibido na tela; não é guardado). */
export async function download(data: BlobPart, name: string, fmt: ExportFormat): Promise<string> {
  const blob = new Blob([data], { type: MIME[fmt] })
  const hash = await sha256(blob)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
  return hash
}

function cellValue(c: Column, row: any): any {
  const v = c.fmt ? c.fmt(row[c.key], row) : row[c.key]
  if (Array.isArray(v)) return v.join('; ')
  if (v && typeof v === 'object') return JSON.stringify(v)
  return v ?? ''
}

export function filtersText(criteria?: Record<string, any>) {
  const f = criteria?.filters
  return f && Object.keys(f).length ? JSON.stringify(f) : 'sem filtros adicionais'
}

// ------------------------------------------------------------------ CSV

export function tableToCsv(t: TableExport, who: Who, code: string): string {
  const esc = (v: any) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [
    esc(`# ${BRAND} · ${t.title} · ${code} · gerado em ${new Date().toISOString().slice(0, 19)} UTC por ${who.name}`),
    esc(`# Critérios: ${filtersText(t.criteria)}`),
    t.columns.map((c) => esc(c.label)).join(';'),
    ...t.rows.map((r) => t.columns.map((c) => esc(cellValue(c, r))).join(';')),
  ]
  return '﻿' + lines.join('\r\n')
}

// ------------------------------------------------------------------ Excel

export async function tableToXlsx(t: TableExport, who: Who, code: string): Promise<ArrayBuffer> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = who.name
  wb.created = new Date()
  const ws = wb.addWorksheet('Resultado', { views: [{ state: 'frozen', ySplit: 1 }] })
  addSheet(ws, t.columns.map((c) => c.label), t.rows.map((r) => t.columns.map((c) => cellValue(c, r))))
  const info = wb.addWorksheet('Critérios')
  info.columns = [{ width: 32 }, { width: 100 }]
  const meta: [string, any][] = [
    ['Sistema', BRAND],
    ['Consulta', t.title],
    ['Detalhe', t.subtitle ?? ''],
    ['Identificador', code],
    ['Gerado em (UTC)', new Date().toISOString().slice(0, 19)],
    ['Responsável', `${who.name} <${who.email}>`],
    ['Linhas', t.rows.length],
    ['Critérios', filtersText(t.criteria)],
    ...Object.entries(t.criteria ?? {}).filter(([k]) => k !== 'filters').map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : v] as [string, any]),
    ...(t.notes ?? []).map((n) => ['Observação', n] as [string, any]),
  ]
  meta.forEach((m) => info.addRow(m))
  info.getColumn(1).font = { bold: true }
  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>
}

export function addSheet(ws: any, header: string[], rows: any[][]) {
  ws.addRow(header)
  const h = ws.getRow(1)
  h.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B1220' } }
  for (const r of rows) ws.addRow(r.map((v) => (v === null || v === undefined ? '' : v)))
  header.forEach((name, i) => {
    let w = name.length
    for (let j = 0; j < Math.min(rows.length, 200); j++) w = Math.max(w, String(rows[j][i] ?? '').length)
    ws.getColumn(i + 1).width = Math.min(w + 2, 60)
  })
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: Math.max(header.length, 1) } }
}

// ------------------------------------------------------------------ PDF

export async function newPdf(landscape = false) {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default
  const doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'mm', format: 'a4', compress: true })
  return { doc, autoTable }
}

export function pageDecor(doc: any, right: string, footer: string, demo = false) {
  const n = doc.getNumberOfPages()
  const w = doc.internal.pageSize.getWidth()
  const h = doc.internal.pageSize.getHeight()
  for (let i = 1; i <= n; i++) {
    doc.setPage(i)
    if (i === 1 && doc.__marxCover) continue
    doc.setFillColor(...COLORS.navy)
    doc.rect(0, 0, w, 12, 'F')
    doc.setTextColor(...COLORS.gold)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.text(pdfText(BRAND), 12, 7.8)
    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.text(pdfText(right), w - 12, 7.8, { align: 'right' })
    doc.setTextColor(...COLORS.grey)
    doc.setFontSize(7)
    doc.text(pdfText(footer), 12, h - 7)
    doc.text(`Página ${i} de ${n}`, w - 12, h - 7, { align: 'right' })
    if (demo) {
      doc.saveGraphicsState()
      doc.setGState(new doc.GState({ opacity: 0.1 }))
      doc.setTextColor(200, 60, 40)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(54)
      doc.text('DEMONSTRAÇÃO', w / 2, h / 2, { align: 'center', angle: 35 })
      doc.restoreGraphicsState()
    }
  }
}

export const TABLE_STYLE = {
  styles: { font: 'helvetica', fontSize: 7, cellPadding: 1.2, lineColor: COLORS.line as any, lineWidth: 0.1, overflow: 'linebreak' as const, valign: 'top' as const },
  headStyles: { fillColor: COLORS.navy as any, textColor: [255, 255, 255] as any, fontStyle: 'bold' as const },
  alternateRowStyles: { fillColor: COLORS.zebra as any },
  margin: { top: 17, bottom: 13, left: 12, right: 12 },
}

export async function tableToPdf(t: TableExport, who: Who, code: string, maxRows = 20000): Promise<ArrayBuffer> {
  const landscape = t.columns.length > 7
  const { doc, autoTable } = await newPdf(landscape)
  const w = doc.internal.pageSize.getWidth()
  doc.setTextColor(...COLORS.navy)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text(pdfText(t.title), 12, 22)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...COLORS.grey)
  const head = [t.subtitle, `Critérios: ${filtersText(t.criteria)}`, ...(t.notes ?? [])].filter(Boolean).map((s) => pdfText(s))
  const lines = doc.splitTextToSize(head.join('\n'), w - 24)
  doc.text(lines, 12, 28)
  const rows = t.rows.slice(0, maxRows)
  autoTable(doc, {
    ...TABLE_STYLE,
    startY: 30 + lines.length * 3.4,
    head: [t.columns.map((c) => pdfText(c.label))],
    body: rows.map((r) => t.columns.map((c) => pdfText(cellValue(c, r)))),
  })
  if (t.rows.length > maxRows) {
    const y = (doc as any).lastAutoTable.finalY + 5
    doc.setFontSize(8)
    doc.text(pdfText(`Exibidas ${maxRows} de ${t.rows.length} linhas. A relação completa está na exportação em Excel/CSV.`), 12, y)
  }
  pageDecor(doc, code, `Gerado em ${new Date().toLocaleString('pt-BR')} por ${who.name} · processamento local no navegador, nada foi armazenado`)
  return doc.output('arraybuffer')
}

/** Exporta uma tabela de resultado no formato pedido e devolve o nome e o SHA-256 do arquivo entregue. */
export async function exportTable(t: TableExport, fmt: ExportFormat, who: Who) {
  const code = reportCode()
  const name = `${safeName(t.title)}_${code}.${fmt}`
  const data = fmt === 'csv' ? tableToCsv(t, who, code) : fmt === 'xlsx' ? await tableToXlsx(t, who, code) : await tableToPdf(t, who, code)
  const hash = await download(data, name, fmt)
  return { name, hash, code }
}
