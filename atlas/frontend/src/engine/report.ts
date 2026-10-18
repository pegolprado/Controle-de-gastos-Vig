/**
 * Relatório técnico rastreável, montado e gerado no navegador (PDF, Excel, CSV).
 *
 * É um retrato do momento da geração: dados, critérios, mapeamentos, SHA-256 dos
 * arquivos de entrada, versão do sistema e das regras. O arquivo é entregue como
 * download; nada é guardado no servidor nem no navegador.
 */
import { fmtDate, fmtDateTime, fmtDuration, fmtNumberPlain } from '../lib/format'
import * as A from './analytics'
import { q } from './db'
import { addSheet, BRAND, COLORS, download, type ExportFormat, newPdf, pageDecor, pdfText, reportCode, safeName, TABLE_STYLE, type Who } from './exporter'
import { APP_VERSION, EVENT_TYPES, RULES_VERSION } from './normalize'
import { getState } from './session'

export const LIMITATIONS = [
  'Os resultados refletem exclusivamente os registros contidos nos arquivos fornecidos e carregados; ausência de registro não significa ausência de comunicação.',
  'A ERB/célula registrada em um evento não comprova a posição exata do aparelho ou da pessoa. Coordenadas indicadas são da estação, e setores são representações esquemáticas, não cobertura real comprovada.',
  'Frequência de comunicação, contatos em comum e coincidências temporais são observações estatísticas e não constituem, isoladamente, prova de vínculo pessoal, de presença física conjunta ou de participação em fato ilícito.',
  'Horários são exibidos conforme o documento de origem. Eventos com fuso horário não confirmado estão sinalizados e devem ser interpretados com cautela em comparações entre fontes.',
  'Registros duplicados e fora do período autorizado foram excluídos das estatísticas, salvo indicação em contrário nos critérios.',
  'Hashes SHA-256 verificam a integridade dos arquivos carregados, mas não comprovam, por si sós, a autenticidade da origem.',
]

export type ReportType = 'cdr' | 'erb' | 'links' | 'full'
export const REPORT_TYPES: Record<ReportType, string> = { cdr: 'Bilhetagem', erb: 'ERB', links: 'Vínculos', full: 'Completo' }

export const SECTIONS: Record<ReportType, string[]> = {
  cdr: ['escopo', 'fontes', 'metodologia', 'estatisticas', 'graficos', 'contatos', 'eventos', 'limitacoes', 'rastreabilidade'],
  erb: ['escopo', 'fontes', 'cadastro', 'resolucao', 'celulas', 'mapa', 'sequencia', 'inconsistencias', 'limitacoes', 'rastreabilidade'],
  links: ['escopo', 'fontes', 'vinculos', 'grafo', 'contatos_comuns', 'limitacoes', 'rastreabilidade'],
  full: [],
}
SECTIONS.full = [...new Set([...SECTIONS.cdr, ...SECTIONS.erb, ...SECTIONS.links].filter((x) => x !== 'limitacoes' && x !== 'rastreabilidade')), 'limitacoes', 'rastreabilidade']

export const SECTION_NAMES: Record<string, string> = {
  escopo: 'Identificação e escopo', fontes: 'Arquivos utilizados', metodologia: 'Metodologia de importação',
  estatisticas: 'Estatísticas principais', graficos: 'Distribuição temporal', contatos: 'Contatos mais frequentes',
  eventos: 'Tabela de eventos', cadastro: 'Cadastro técnico de ERB', resolucao: 'Critérios de correspondência de ERB',
  celulas: 'Eventos por célula', mapa: 'Representação esquemática das estações', sequencia: 'Sequência temporal de células',
  inconsistencias: 'Inconsistências', vinculos: 'Relacionamentos documentados', grafo: 'Grafo de contatos',
  contatos_comuns: 'Contatos em comum', limitacoes: 'Limitações dos dados', rastreabilidade: 'Rastreabilidade',
}

const ERB_RULES = [
  'R1 id_completo – tecnologia compatível + MCC + MNC + área (LAC/TAC) + CI/ECI/NCI → exata',
  'R2 cgi_exato – CGI/ECGI/NCGI normalizado idêntico ao do cadastro → exata',
  'R3 id_sem_area – CI/ECI/NCI sem área (ou sem MCC/MNC) → provável',
  'R4 codigo_estacao – código/nome da estação → provável (nível de estação)',
  'Vários candidatos com coordenadas diferentes → ambígua. Nenhum → “ERB não resolvida”. Coordenadas nunca são estimadas. CI (2G/3G), ECI (4G) e NCI (5G) nunca se equiparam.',
]

export type ReportOptions = { title: string; type: ReportType; sections?: string[]; maxEvents?: number; center?: string | null; depth?: number; minEvents?: number }

export async function collect(f: A.EventFilter, o: ReportOptions, who: Who) {
  const st = getState()
  const sections = o.sections?.length ? o.sections : SECTIONS[o.type]
  const maxEvents = o.maxEvents ?? 2000
  const data: Record<string, any> = { sections, title: o.title, type: o.type, code: reportCode() }
  data.analysis = { ...st.meta, is_demo: st.isDemo }
  data.targets = st.targets.map((t) => ({ number: t.number_normalized, original: t.number_original, operator: t.operator, label: t.label, internal_id: t.internal_id, period: [t.period_start, t.period_end] }))
  const summ = await A.summary(f)
  data.summary = summ
  const usedIds = new Set<number>(summ.sources.map((s: any) => s.id))
  const wantErb = o.type === 'erb' || o.type === 'full'
  data.files = st.files
    .filter((x) => usedIds.has(x.id) || (wantErb && x.kind === 'erb_registry'))
    .map((x) => ({ id: x.id, name: x.original_name, sha256: x.sha256, size: x.size_bytes, format: x.detected_format, kind: x.kind, operator: x.operator_declared || x.operator_detected, received_at: x.received_at }))
  const fileIds = new Set(data.files.map((x: any) => x.id))
  data.imports = st.imports
    .filter((i) => i.status === 'done' && fileIds.has(i.file_id))
    .map((i) => ({ id: i.id, file_id: i.file_id, kind: i.kind, mapping: i.mapping, options: Object.fromEntries(Object.entries(i.options).filter(([k]) => !k.startsWith('_'))), rows_total: i.rows_total, rows_ok: i.rows_ok, rows_error: i.rows_error, rows_duplicate: i.rows_duplicate, rows_out_of_scope: i.rows_out_of_scope, rules_version: i.rules_version }))
  if (o.type === 'cdr' || o.type === 'full') {
    data.contacts = await A.contacts(f, 100)
    if (sections.includes('eventos')) {
      data.events = await A.allEvents(f, maxEvents)
      data.events_truncated = summ.totals.events > maxEvents
    }
  }
  if (wantErb) {
    data.cells = await A.cells(f, 300)
    data.registry_versions = await q(`SELECT id, name, operator, reference_date, rows FROM erb_versions ORDER BY id`)
    data.resolution_run = st.resolutionRuns[0] ?? null
    data.geo = await A.geoPoints(f)
    data.sequence = await A.cellSequence(f, 500)
    data.registry_status = (await A.registry(null, null, null, 1, 1)).status_counts
  }
  if (o.type === 'links' || o.type === 'full') {
    data.graph = await A.linkGraph(f, o.center ?? null, o.depth ?? 2, o.minEvents ?? 1, false, 400)
    const nums = A.normList(f.targets?.length ? f.targets : f.numbers)
    data.common = await A.commonContacts(nums.length ? nums : data.targets.map((t: any) => t.number), f)
  }
  data.criteria = A.criteria(f)
  data.limitations = LIMITATIONS
  data.generated = { at: new Date().toISOString().slice(0, 19), by: who.name, by_email: who.email, app_version: APP_VERSION, rules_version: RULES_VERSION }
  return data
}

const tz = (s: string) => ({ confirmed: 'conf.', assumed: 'pres.', unknown: 'desc.' })[s] ?? ''
const coord = (v: number | null) => (v === null || v === undefined ? '—' : v.toFixed(5))

// ================================================================== PDF

export async function renderPdf(data: Record<string, any>): Promise<ArrayBuffer> {
  const { doc, autoTable } = await newPdf(false)
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const L = 12
  const CW = W - 2 * L
  const an = data.analysis
  const gen = data.generated
  const tot = data.summary.totals
  let y = 0

  const ensure = (h: number) => {
    if (y + h > H - 15) {
      doc.addPage()
      y = 18
    }
  }
  const P = (t: string, size = 8.5, color: readonly number[] = COLORS.navy, style = 'normal') => {
    doc.setFont('helvetica', style)
    doc.setFontSize(size)
    doc.setTextColor(...(color as [number, number, number]))
    const lines = doc.splitTextToSize(pdfText(t), CW)
    for (const ln of lines) {
      ensure(size * 0.45)
      doc.text(ln, L, y)
      y += size * 0.42
    }
    y += 1
  }
  const small = (t: string) => P(t, 7, COLORS.grey)
  const table = (head: string[] | null, body: any[][], opts: Record<string, any> = {}) => {
    autoTable(doc, {
      ...TABLE_STYLE,
      startY: y,
      head: head ? [head.map(pdfText)] : undefined,
      body: body.map((r) => r.map((c) => pdfText(c ?? '—'))),
      ...opts,
    })
    y = (doc as any).lastAutoTable.finalY + 3
  }
  const kv = (rows: [string, any][]) => table(null, rows, { columnStyles: { 0: { fontStyle: 'bold', cellWidth: 55 } }, styles: { ...TABLE_STYLE.styles, fontSize: 8 } })

  // ---------------- capa
  ;(doc as any).__marxCover = true
  doc.setFillColor(...COLORS.cover)
  doc.rect(0, 0, W, H, 'F')
  try {
    const img = await loadImage('/report-logo.jpg')
    doc.addImage(img, 'JPEG', (W - 95) / 2, 22, 95, 95)
  } catch {
    doc.setTextColor(...COLORS.gold)
    doc.setFontSize(30)
    doc.text('MARX', W / 2, 70, { align: 'center' })
  }
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.text(doc.splitTextToSize(pdfText(data.title), CW - 20), W / 2, 135, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  doc.setTextColor(200, 205, 215)
  doc.text(pdfText(an.title || 'Análise'), W / 2, 150, { align: 'center' })
  if (an.reference) doc.text(pdfText(`Referência: ${an.reference}`), W / 2, 157, { align: 'center' })
  const cover: [string, string][] = [
    ['Relatório', data.code],
    ['Tipo', REPORT_TYPES[data.type as ReportType]],
    ['Unidade', an.unit || '—'],
    ['Responsável pela análise', gen.by],
    ['Data de geração', `${fmtDateTime(gen.at)} UTC`],
    ['Versão do sistema / regras', `${gen.app_version} / ${gen.rules_version}`],
    ['Armazenamento', 'processado no navegador; nenhum dado foi guardado no servidor'],
  ]
  if (an.is_demo) cover.push(['Natureza dos dados', 'DEMONSTRAÇÃO — dados sintéticos, sem valor investigativo'])
  autoTable(doc, {
    startY: 172,
    body: cover.map((r) => r.map(pdfText)),
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 9, textColor: [230, 233, 240], cellPadding: 1.6 },
    columnStyles: { 0: { fontStyle: 'bold', textColor: COLORS.gold as any, cellWidth: 60 } },
    margin: { left: 25, right: 25 },
  })

  // ---------------- sumário
  doc.addPage()
  y = 22
  P('Sumário', 14, COLORS.blue, 'bold')
  const secs: string[] = data.sections
  secs.forEach((s, i) => P(`${i + 1}. ${SECTION_NAMES[s] ?? s}`))
  y += 4
  const num = Object.fromEntries(secs.map((s, i) => [s, i + 1]))
  const Hd = (s: string) => {
    ensure(14)
    y += 2
    P(`${num[s]}. ${SECTION_NAMES[s]}`, 13, COLORS.blue, 'bold')
  }
  const H2 = (t: string) => {
    ensure(10)
    P(t, 10, COLORS.navy, 'bold')
  }

  for (const s of secs) {
    if (s === 'escopo') {
      Hd(s)
      kv([
        ['Análise', `${an.title}${an.reference ? ` — ${an.reference}` : ''}`],
        ['Período autorizado', `${fmtDate(an.period_start)} a ${fmtDate(an.period_end)}`],
        ['Descrição', an.description || '—'],
      ])
      H2('Números analisados')
      table(['Número', 'Original', 'Identificação', 'Operadora informada', 'Período'],
        data.targets.map((t: any) => [fmtNumberPlain(t.number), t.original, t.label || t.internal_id || '—', t.operator || '—', `${fmtDate(t.period[0])} a ${fmtDate(t.period[1])}`]))
      small(`Critérios: ${JSON.stringify(data.criteria.filters) === '{}' ? 'sem filtros adicionais' : JSON.stringify(data.criteria.filters)}`)
    } else if (s === 'fontes') {
      Hd(s)
      table(['#', 'Arquivo', 'Tipo', 'Operadora', 'Formato', 'SHA-256'],
        data.files.map((x: any) => [x.id, x.name, x.kind === 'erb_registry' ? 'cadastro ERB' : 'bilhetagem', x.operator || '—', x.format, x.sha256]),
        { columnStyles: { 5: { font: 'courier', fontSize: 6, cellWidth: 62 } } })
    } else if (s === 'metodologia') {
      Hd(s)
      P('Cada arquivo foi lido diretamente do computador do usuário, sem alteração (SHA-256 calculado no carregamento) e sem envio a servidores. As colunas foram associadas aos campos padronizados conforme o mapeamento abaixo, confirmado pelo analista. Valores originais acompanham os normalizados em cada registro.')
      for (const i of data.imports.filter((i: any) => i.kind === 'cdr')) {
        H2(`Importação #${i.id} (arquivo #${i.file_id})`)
        small('Mapeamento: ' + Object.entries(i.mapping).filter(([, v]) => v).map(([k, v]) => `${k} <- “${v}”`).join(', '))
        const op = i.options
        small(`Fuso: ${op.tz_mode ?? 'unknown'} (${op.tz_name || 'não informado'}) · formato de data: ${op.date_format || op.datetime_format || 'automático'} · linhas: ${i.rows_total} lidas, ${i.rows_ok} aceitas, ${i.rows_error} rejeitadas, ${i.rows_duplicate} duplicadas, ${i.rows_out_of_scope} fora do período · regras ${i.rules_version}`)
      }
    } else if (s === 'estatisticas') {
      Hd(s)
      kv([
        ['Eventos considerados', tot.events], ['Chamadas de voz', `${tot.calls} (sem duração: ${tot.zero_duration_calls})`],
        ['SMS', tot.sms], ['Sessões de dados', tot.data_sessions], ['Originados / recebidos', `${tot.outgoing} / ${tot.incoming}`],
        ['Duração total das chamadas', fmtDuration(tot.call_seconds)], ['Duração média / mediana (chamadas > 0 s)', `${fmtDuration(tot.call_avg)} / ${fmtDuration(tot.call_median)}`],
        ['Dias com atividade', tot.active_days], ['Contatos distintos', tot.distinct_contacts], ['Células distintas', tot.distinct_cells],
        ['IMEIs distintos', tot.distinct_imeis], ['Primeiro / último evento', `${fmtDateTime(tot.first_event)} / ${fmtDateTime(tot.last_event)}`],
        ['Eventos com fuso não confirmado', tot.tz_not_confirmed],
        ['Excluídos: duplicados / fora do período', `${data.summary.excluded.duplicates} / ${data.summary.excluded.out_of_scope}`],
      ])
      small(data.summary.criteria.duration_rule)
      table(['Tipo de evento', 'Quantidade'], data.summary.by_type.map((r: any) => [r.label, r.n]), { tableWidth: 110 })
    } else if (s === 'graficos') {
      Hd(s)
      const WD = ['', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom']
      bars(doc, 'Eventos por hora do dia (horário do documento)', data.summary.by_hour.map((r: any) => [String(r.hour).padStart(2, '0'), r.n]), COLORS.blue)
      bars(doc, 'Eventos por dia da semana', data.summary.by_weekday.map((r: any) => [WD[r.weekday], r.n]), COLORS.blue)
      const days = data.summary.by_day
      if (days.length) bars(doc, `Eventos por dia — ${fmtDate(days[0].day)} a ${fmtDate(days[days.length - 1].day)}`, days.map((r: any) => ['', r.n]), [20, 184, 166])
    } else if (s === 'contatos' && data.contacts) {
      Hd(s)
      table(['Alvo', 'Interlocutor', 'Eventos', 'Dias', 'Orig.', 'Rec.', 'Chamadas', 'SMS', 'Duração', 'Primeiro', 'Último'],
        data.contacts.items.slice(0, 60).map((r: any) => [fmtNumberPlain(r.target_number), fmtNumberPlain(r.other_number), r.events, r.days, r.outgoing, r.incoming, r.calls, r.sms, fmtDuration(r.call_seconds), fmtDateTime(r.first_event), fmtDateTime(r.last_event)]),
        { styles: { ...TABLE_STYLE.styles, fontSize: 6.5 } })
      small(data.contacts.criteria.note)
    } else if (s === 'eventos' && data.events) {
      Hd(s)
      if (data.events_truncated) small(`Exibidos os primeiros ${data.events.length} eventos de ${tot.events}. A relação completa acompanha a exportação em Excel/CSV.`)
      table(['ID', 'Data/hora', 'Fuso', 'Tipo', 'Origem', 'Destino', 'Dur.', 'Célula', 'Fonte'],
        data.events.map((e: any) => [e.id, fmtDateTime(e.ts_local), tz(e.tz_status), EVENT_TYPES[e.event_type] ?? e.event_type, fmtNumberPlain(e.a_number), fmtNumberPlain(e.b_number), fmtDuration(e.duration_s), e.cell_key || '—', `#${e.file_id} l.${e.row_number ?? '?'}${e.page ? ` p.${e.page}` : ''}`]),
        { styles: { ...TABLE_STYLE.styles, fontSize: 6.2 } })
    } else if (s === 'cadastro' && data.registry_versions) {
      Hd(s)
      if (!data.registry_versions.length) P('Nenhum cadastro técnico de ERB foi carregado nesta análise.')
      else table(['Versão', 'Nome', 'Operadora', 'Data de referência', 'Linhas'], data.registry_versions.map((v: any) => [v.id, v.name, v.operator || '—', fmtDate(v.reference_date), v.rows]))
      if (data.registry_status?.length) small('Situação das linhas do cadastro: ' + data.registry_status.map((r: any) => `${r.validation_status}: ${r.n}`).join(', '))
    } else if (s === 'resolucao' && data.cells) {
      Hd(s)
      ERB_RULES.forEach((r) => small(r))
      const run = data.resolution_run
      if (run) P(`Última execução: ${fmtDateTime(run.created_at)} · assinaturas de célula avaliadas: ${run.result?.signatures ?? '—'} · eventos por resultado: ` + Object.entries(run.result?.by_status_events ?? {}).map(([k, v]) => `${k}: ${v}`).join(', '))
      else P('A resolução de ERB não foi executada nesta análise.')
    } else if (s === 'celulas' && data.cells?.items.length) {
      Hd(s)
      table(['Célula (chave)', 'Eventos', 'Números', 'Resolução', 'Estação', 'Lat', 'Lon', 'Az.', 'Primeiro', 'Último'],
        data.cells.items.slice(0, 80).map((c: any) => [c.cell_key, c.events, c.numbers, c.resolution_status || 'pendente', c.site_name || c.site_code || '—', coord(c.lat), coord(c.lon), c.azimuth ?? '—', fmtDateTime(c.first_event), fmtDateTime(c.last_event)]),
        { styles: { ...TABLE_STYLE.styles, fontSize: 6 } })
      small(data.cells.criteria.limit_note)
    } else if (s === 'mapa' && data.geo) {
      Hd(s)
      const pts = [...data.geo.registry_points, ...data.geo.document_points]
      if (!pts.length) P('Não há coordenadas válidas resolvidas para os eventos selecionados.')
      else {
        schematicMap(doc, pts, L + (CW - 150) / 2, ensureBlock(160), 150)
        small(`Representação esquemática sem escala cartográfica: ${pts.length} pontos; área do círculo proporcional à quantidade de eventos; cunhas indicam o azimute declarado do setor (abertura padrão de 65° quando não informada). ${data.geo.criteria.limit_note}`)
      }
    } else if (s === 'sequencia' && data.sequence?.items.length) {
      Hd(s)
      table(['Data/hora', 'Número', 'Tipo', 'Célula', 'Estação', 'Intervalo', 'Fonte coord.'],
        data.sequence.items.slice(0, 200).map((r: any) => [fmtDateTime(r.ts_local), fmtNumberPlain(r.target_number), EVENT_TYPES[r.event_type] ?? r.event_type, r.cell_key || '—', r.site_name || '—', r.interval_s === null ? '—' : fmtDuration(r.interval_s), r.coord_source || 'sem coordenada']),
        { styles: { ...TABLE_STYLE.styles, fontSize: 6.3 } })
      small(data.sequence.criteria.note)
    } else if (s === 'inconsistencias' && data.cells) {
      Hd(s)
      P(`Eventos por resultado de resolução: ${data.cells.resolution.map((r: any) => `${r.status}: ${r.n}`).join(', ') || '—'}. Eventos sem identificador de célula: ${data.cells.events_without_cell}.`)
      const un = data.cells.items.filter((c: any) => ['none', 'ambiguous', null, undefined].includes(c.resolution_status))
      if (un.length) table(['Célula', 'Eventos', 'Situação', 'Motivo'], un.slice(0, 60).map((c: any) => [c.cell_key, c.events, c.resolution_status || 'pendente', c.resolution_note || '—']))
    } else if (s === 'vinculos' && data.graph) {
      Hd(s)
      table(['Número 1', 'Número 2', 'Eventos', 'Dias', '1->2', '2->1', 'Recíproca', 'Duração', 'Primeiro', 'Último', 'Arquivos'],
        data.graph.edges.slice(0, 80).map((e: any) => [fmtNumberPlain(e.n1), fmtNumberPlain(e.n2), e.events, e.days, e.n1_to_n2, e.n2_to_n1, e.reciprocal ? 'sim' : 'não', fmtDuration(e.call_seconds), fmtDateTime(e.first_event), fmtDateTime(e.last_event), (e.file_ids ?? []).map((x: number) => `#${x}`).join(', ')]),
        { styles: { ...TABLE_STYLE.styles, fontSize: 6.2 } })
      small(data.graph.criteria.note)
    } else if (s === 'grafo' && data.graph) {
      Hd(s)
      if (!data.graph.nodes.length) P('Sem vínculos para os critérios selecionados.')
      else {
        schematicGraph(doc, data.graph, L + (CW - 160) / 2, ensureBlock(165), 160)
        small('Azul: números alvo; âmbar: contatos em comum a dois ou mais alvos; linhas verde-água: comunicação nos dois sentidos; espessura proporcional à quantidade de eventos.')
      }
    } else if (s === 'contatos_comuns' && data.common) {
      Hd(s)
      const nums: string[] = data.common.numbers
      const rows = data.common.shared.slice(0, 60).map((r: any) => [fmtNumberPlain(r.contact), ...nums.map((n) => r.per_number[n]?.n ?? 0), r.total])
      if (!rows.length) P('Nenhum contato em comum entre os números analisados no período e filtros selecionados.')
      else table(['Contato', ...nums.map((n) => fmtNumberPlain(n)), 'Total'], rows)
    } else if (s === 'limitacoes') {
      Hd(s)
      data.limitations.forEach((l: string) => P(`• ${l}`))
    } else if (s === 'rastreabilidade') {
      Hd(s)
      kv([
        ['Identificador do relatório', data.code], ['Data de geração (UTC)', gen.at], ['Responsável', `${gen.by} <${gen.by_email}>`],
        ['Versão do sistema', gen.app_version], ['Versão das regras analíticas', gen.rules_version],
        ['Filtros e parâmetros', JSON.stringify(data.criteria.filters)], ['Duplicidades', data.criteria.duplicates], ['Fora do período', data.criteria.out_of_scope],
        ['Armazenamento', 'Nenhum dado desta análise foi gravado no servidor ou no navegador; os resultados existem apenas neste arquivo.'],
        ['Hash do relatório', 'SHA-256 do arquivo final exibido na tela no momento do download (não pode constar no próprio arquivo).'],
      ])
      table(['Arquivo de entrada', 'SHA-256'], data.files.map((x: any) => [`#${x.id} ${x.name}`, x.sha256]), { columnStyles: { 1: { font: 'courier', fontSize: 6.5 } } })
    }
  }
  pageDecor(doc, `${an.title || 'Análise'} · ${data.code}`, `Gerado em ${fmtDateTime(gen.at)} UTC por ${gen.by} · v${gen.app_version} · regras ${gen.rules_version}`, an.is_demo)
  return doc.output('arraybuffer')

  function ensureBlock(h: number) {
    ensure(h)
    const top = y
    y += h
    return top
  }

  function bars(d: any, title: string, series: [string, number][], color: readonly number[]) {
    if (!series.length) return
    const top = ensureBlock(52)
    d.setFont('helvetica', 'bold')
    d.setFontSize(8)
    d.setTextColor(...COLORS.navy)
    d.text(pdfText(title), L, top + 3)
    const x0 = L + 10
    const w = CW - 12
    const h = 38
    const base = top + 6 + h
    const max = Math.max(...series.map((s) => s[1]), 1)
    d.setDrawColor(...COLORS.line)
    d.setLineWidth(0.1)
    for (const frac of [0.5, 1]) d.line(x0, base - h * frac, x0 + w, base - h * frac)
    d.setFont('helvetica', 'normal')
    d.setFontSize(6)
    d.setTextColor(...COLORS.grey)
    d.text(String(max), x0 - 1.5, base - h + 1, { align: 'right' })
    d.text('0', x0 - 1.5, base + 1, { align: 'right' })
    const bw = w / series.length
    series.forEach(([lab, n], i) => {
      const bh = (n / max) * h
      d.setFillColor(...(color as [number, number, number]))
      if (bh > 0) d.rect(x0 + i * bw + Math.min(0.4, bw * 0.1), base - bh, Math.max(bw - Math.min(0.8, bw * 0.2), 0.3), bh, 'F')
      if (lab && series.length <= 31) d.text(pdfText(lab), x0 + i * bw + bw / 2, base + 3, { align: 'center' })
    })
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image()
    img.onload = () => res(img)
    img.onerror = rej
    img.src = src
  })
}

function schematicMap(d: any, pts: any[], x: number, y: number, size: number) {
  const lats = pts.map((p) => p.lat)
  const lons = pts.map((p) => p.lon)
  const la0 = Math.min(...lats)
  const la1 = Math.max(...lats)
  const lo0 = Math.min(...lons)
  const lo1 = Math.max(...lons)
  const k = Math.cos((((la0 + la1) / 2) * Math.PI) / 180)
  const span = Math.max(la1 - la0, (lo1 - lo0) * k, 0.002)
  const maxe = Math.max(...pts.map((p) => p.events), 1)
  d.setFillColor(...COLORS.zebra)
  d.setDrawColor(...COLORS.line)
  d.rect(x, y, size, size, 'FD')
  const xy = (lat: number, lon: number) => [x + 6 + (((lon - lo0) * k) / span) * (size - 12), y + size - 6 - ((lat - la0) / span) * (size - 12)]
  for (const p of pts) {
    const [px, py] = xy(p.lat, p.lon)
    const r = 0.8 + 3.2 * Math.sqrt(p.events / maxe)
    if (p.azimuth !== null && p.azimuth !== undefined) {
      const bw = p.beamwidth || 65
      const R = r * 2.4
      const pts2: [number, number][] = []
      for (let a = p.azimuth - bw / 2; a <= p.azimuth + bw / 2; a += bw / 8) {
        const rad = (a * Math.PI) / 180
        pts2.push([px + R * Math.sin(rad), py - R * Math.cos(rad)])
      }
      d.saveGraphicsState()
      d.setGState(new d.GState({ opacity: 0.22 }))
      d.setFillColor(...COLORS.blue)
      const segs = [[pts2[0][0] - px, pts2[0][1] - py], ...pts2.slice(1).map((q, i) => [q[0] - pts2[i][0], q[1] - pts2[i][1]]), [px - pts2[pts2.length - 1][0], py - pts2[pts2.length - 1][1]]]
      d.lines(segs, px, py, [1, 1], 'F', true)
      d.restoreGraphicsState()
    }
    d.saveGraphicsState()
    d.setGState(new d.GState({ opacity: 0.75 }))
    d.setFillColor(20, 184, 166)
    d.setDrawColor(...COLORS.navy)
    d.setLineWidth(0.1)
    d.circle(px, py, r, 'FD')
    d.restoreGraphicsState()
  }
  d.setDrawColor(...COLORS.navy)
  d.setLineWidth(0.3)
  d.line(x + size - 8, y + 16, x + size - 8, y + 8)
  d.setFont('helvetica', 'bold')
  d.setFontSize(7)
  d.setTextColor(...COLORS.navy)
  d.text('N', x + size - 8, y + 6.5, { align: 'center' })
}

function schematicGraph(d: any, g: any, x: number, y: number, size: number) {
  const nodes = [...g.nodes].sort((a: any, b: any) => Number(b.is_target) - Number(a.is_target) || b.events - a.events).slice(0, 60)
  const ids = new Set(nodes.map((n: any) => n.id))
  const cx = x + size / 2
  const cy = y + size / 2
  const tg = nodes.filter((n: any) => n.is_target)
  const ot = nodes.filter((n: any) => !n.is_target)
  const pos = new Map<string, [number, number]>()
  tg.forEach((n: any, i: number) => {
    const ang = (2 * Math.PI * i) / Math.max(tg.length, 1)
    const rr = tg.length === 1 ? 0 : size * 0.16
    pos.set(n.id, [cx + rr * Math.cos(ang), cy + rr * Math.sin(ang)])
  })
  ot.forEach((n: any, i: number) => {
    const ang = (2 * Math.PI * i) / Math.max(ot.length, 1)
    pos.set(n.id, [cx + size * 0.4 * Math.cos(ang), cy + size * 0.4 * Math.sin(ang)])
  })
  const maxe = Math.max(...g.edges.map((e: any) => e.events), 1)
  for (const e of g.edges) {
    if (!ids.has(e.n1) || !ids.has(e.n2)) continue
    const [x1, y1] = pos.get(e.n1)!
    const [x2, y2] = pos.get(e.n2)!
    d.setDrawColor(...(e.reciprocal ? [20, 184, 166] : [154, 167, 189]))
    d.setLineWidth(0.15 + (0.9 * e.events) / maxe)
    d.line(x1, y1, x2, y2)
  }
  d.setFont('helvetica', 'normal')
  d.setFontSize(5)
  for (const n of nodes) {
    const [px, py] = pos.get(n.id)!
    if (n.is_target) d.setFillColor(...COLORS.blue)
    else if (n.common_to_targets > 1) d.setFillColor(245, 158, 11)
    else d.setFillColor(203, 213, 225)
    d.setDrawColor(...COLORS.navy)
    d.setLineWidth(0.15)
    d.circle(px, py, n.is_target ? 2.2 : 1.3, 'FD')
    d.setTextColor(...COLORS.navy)
    d.text(pdfText(fmtNumberPlain(n.id) + (n.label ? ` (${n.label})` : '')), px + 2.4, py - 1)
  }
}

// ================================================================== Excel

export async function renderXlsx(data: Record<string, any>): Promise<ArrayBuffer> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = data.generated.by
  wb.created = new Date()
  const an = data.analysis
  const gen = data.generated
  const ws = wb.addWorksheet('Resumo')
  ws.columns = [{ width: 36 }, { width: 90 }]
  const meta: [string, any][] = [
    ['Sistema', BRAND], ['Relatório', data.code], ['Título', data.title], ['Análise', `${an.title}${an.reference ? ` — ${an.reference}` : ''}`],
    ['Gerado em (UTC)', gen.at], ['Responsável', `${gen.by} <${gen.by_email}>`], ['Versão sistema/regras', `${gen.app_version} / ${gen.rules_version}`],
    ['Filtros', JSON.stringify(data.criteria.filters)], ['Duplicidades', data.criteria.duplicates], ['Fora do período', data.criteria.out_of_scope],
    ['Armazenamento', 'processado no navegador; nenhum dado foi guardado'],
  ]
  if (an.is_demo) meta.unshift(['ATENÇÃO', 'DEMONSTRAÇÃO — dados sintéticos'])
  meta.forEach((m) => ws.addRow(m))
  ws.addRow([])
  for (const [k, v] of Object.entries(data.summary.totals)) ws.addRow([k, v as any])
  ws.getColumn(1).font = { bold: true }
  const sheet = (name: string, header: string[], rows: any[][]) => addSheet(wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] }), header, rows)
  sheet('Fontes', ['ID', 'Arquivo', 'Tipo', 'Operadora', 'Formato', 'Tamanho', 'SHA-256', 'Carregado em'], data.files.map((x: any) => [x.id, x.name, x.kind, x.operator, x.format, x.size, x.sha256, x.received_at]))
  if (data.contacts)
    sheet('Contatos', ['Alvo', 'Interlocutor', 'Eventos', 'Dias', 'Originados', 'Recebidos', 'Chamadas', 'SMS', 'Duração (s)', 'Primeiro', 'Último', 'Recíproco'],
      data.contacts.items.map((r: any) => [r.target_number, r.other_number, r.events, r.days, r.outgoing, r.incoming, r.calls, r.sms, r.call_seconds, r.first_event, r.last_event, r.reciprocal ? 'sim' : 'não']))
  if (data.events) sheet('Eventos', EVENT_EXPORT_COLS, data.events.map((e: any) => EVENT_EXPORT_COLS.map((c) => (Array.isArray(e[c]) ? e[c].join('; ') : e[c]))))
  if (data.graph)
    sheet('Vínculos', ['Número 1', 'Número 2', 'Eventos', 'Dias', '1→2', '2→1', 'Recíproca', 'Duração (s)', 'Primeiro', 'Último', 'Arquivos'],
      data.graph.edges.map((e: any) => [e.n1, e.n2, e.events, e.days, e.n1_to_n2, e.n2_to_n1, e.reciprocal ? 'sim' : 'não', e.call_seconds, e.first_event, e.last_event, (e.file_ids ?? []).join(', ')]))
  if (data.cells)
    sheet('ERB', ['Célula', 'Eventos', 'Números', 'Resolução', 'Regra', 'Estação', 'Código', 'Lat', 'Lon', 'Azimute', 'Primeiro', 'Último', 'Observação'],
      data.cells.items.map((c: any) => [c.cell_key, c.events, c.numbers, c.resolution_status, c.resolution_rule, c.site_name, c.site_code, c.lat, c.lon, c.azimuth, c.first_event, c.last_event, c.resolution_note]))
  sheet('Critérios e limites', ['Item', 'Descrição'], [['Filtros', JSON.stringify(data.criteria.filters)], ['Regras', data.criteria.rules_version], ...data.limitations.map((x: string) => ['Limitação', x])])
  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>
}

export const EVENT_EXPORT_COLS = ['id', 'ts_local', 'tz_status', 'tz_name', 'event_type', 'direction', 'target_number', 'other_number', 'a_number', 'b_number', 'duration_s',
  'operator', 'tech', 'mcc', 'mnc', 'lac', 'tac', 'cell_id', 'eci', 'nci', 'cgi', 'erb_raw', 'cell_key', 'resolution_status', 'cell_lat', 'cell_lon',
  'imei', 'ip', 'file_id', 'row_number', 'page', 'ts_original']

// ================================================================== CSV

export function renderCsv(data: Record<string, any>): string {
  const esc = (v: any) => {
    const s = v === null || v === undefined ? '' : Array.isArray(v) ? v.join(', ') : String(v)
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const out: string[] = [
    esc(`# ${BRAND} · relatório ${data.code} · ${data.analysis.title} · gerado ${data.generated.at} UTC · regras ${data.generated.rules_version}${data.analysis.is_demo ? ' · DEMONSTRAÇÃO' : ''}`),
    esc(`# Filtros: ${JSON.stringify(data.criteria.filters)}`),
  ]
  const push = (cols: string[], rows: any[][]) => {
    out.push(cols.join(';'))
    for (const r of rows) out.push(r.map(esc).join(';'))
  }
  if (data.events) {
    const cols = ['id', 'ts_local', 'tz_status', 'event_type', 'target_number', 'other_number', 'a_number', 'b_number', 'duration_s', 'operator', 'cell_key', 'resolution_status', 'cell_lat', 'cell_lon', 'imei', 'ip', 'file_id', 'row_number', 'page']
    push(cols, data.events.map((e: any) => cols.map((c) => e[c])))
  } else if (data.graph) {
    push(['n1', 'n2', 'events', 'days', 'n1_to_n2', 'n2_to_n1', 'reciprocal', 'call_seconds', 'first_event', 'last_event'], data.graph.edges.map((e: any) => [e.n1, e.n2, e.events, e.days, e.n1_to_n2, e.n2_to_n1, e.reciprocal, e.call_seconds, e.first_event, e.last_event]))
  } else if (data.cells) {
    push(['cell_key', 'events', 'numbers', 'resolution_status', 'site_name', 'lat', 'lon', 'azimuth'], data.cells.items.map((c: any) => [c.cell_key, c.events, c.numbers, c.resolution_status, c.site_name, c.lat, c.lon, c.azimuth]))
  }
  return '﻿' + out.join('\r\n')
}

/** Gera o relatório, entrega o download e devolve nome, código e SHA-256 do arquivo (mostrados na tela, não guardados). */
export async function generateReport(f: A.EventFilter, o: ReportOptions, fmt: ExportFormat, who: Who) {
  const data = await collect(f, o, who)
  const body = fmt === 'pdf' ? await renderPdf(data) : fmt === 'xlsx' ? await renderXlsx(data) : renderCsv(data)
  const name = `${safeName(o.title || 'relatorio')}_${data.code}.${fmt}`
  const hash = await download(body, name, fmt)
  return { name, code: data.code, hash, sha_inputs: data.files.map((x: any) => ({ name: x.name, sha256: x.sha256 })) }
}
