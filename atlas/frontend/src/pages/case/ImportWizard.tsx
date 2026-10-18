import clsx from 'clsx'
import { ArrowLeft, ArrowRight, CheckCircle2, Play, RefreshCw, Wand2, XCircle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { analyze as analyzeFile, cancelImport, createImport, preview as previewImport, runImport, saveDraft, saveProfile } from '../../engine/importer'
import { useSession } from '../../engine/session'
import { useCase } from '../../app/layout'
import { Badge, ErrorBox, Field, Loading, Notice, PageHeader, Progress } from '../../components/ui'
import { EVENT_TYPE_LABEL, fmtBytes, fmtInt, fmtNumber, shortHash } from '../../lib/format'

const STEPS = ['Arquivo', 'Leitura', 'Mapeamento', 'Datas e regras', 'Validação', 'Processamento']
const CDR_GROUPS: [string, string[]][] = [
  ['Números', ['target_number', 'a_number', 'b_number', 'other_number', 'direction']],
  ['Evento', ['event_type', 'datetime', 'date', 'time', 'timezone', 'duration', 'status']],
  ['Rede / célula', ['tech', 'mcc', 'mnc', 'lac', 'tac', 'cell_id', 'eci', 'nci', 'cgi', 'erb_raw', 'lat', 'lon', 'azimuth']],
  ['Aparelho e dados', ['imei', 'imsi', 'ip', 'bytes_up', 'bytes_down']],
]
const ERB_GROUPS: [string, string[]][] = [
  ['Identificação', ['operator', 'tech', 'mcc', 'mnc', 'lac', 'tac', 'cell_id', 'eci', 'nci', 'cgi']],
  ['Estação', ['site_code', 'site_name', 'address', 'sector']],
  ['Geometria', ['lat', 'lon', 'azimuth', 'beamwidth', 'height_m']],
]
const TZS = ['America/Sao_Paulo', 'America/Manaus', 'America/Cuiaba', 'America/Belem', 'America/Fortaleza', 'America/Recife', 'America/Rio_Branco', 'America/Noronha', 'UTC']

export default function ImportWizard() {
  const { meta } = useCase()
  const { fileId } = useParams()
  const [sp] = useSearchParams()
  const file = useSession((s) => s.files.find((f) => String(f.id) === fileId))
  const [kind, setKind] = useState(sp.get('tipo') === 'erb_registry' ? 'erb_registry' : 'cdr')
  const [step, setStep] = useState(0)
  const [read, setRead] = useState<any>({})
  const [analysis, setAnalysis] = useState<any>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [opts, setOpts] = useState<any>({ tz_mode: 'assumed', tz_name: 'America/Sao_Paulo', duration_unit: 's' })
  const [profileName, setProfileName] = useState('')
  const [importId, setImportId] = useState<number | null>(null)
  const [preview, setPreview] = useState<any>(null)

  const analyze = async (r = read, k = kind) => {
    setAnalyzing(true)
    setErr(null)
    try {
      const a: any = await analyzeFile(+fileId!, k as any, r)
      setAnalysis(a)
      setMapping(a.suggested_mapping)
      const o: any = { ...opts, operator: opts.operator ?? file?.operator_declared ?? a.operator_detection.operator ?? '' }
      for (const f of ['date', 'time', 'datetime']) if (a.formats[f]?.format) o[`${f}_format`] = a.formats[f].format
      if (a.target_hint?.length === 1 && !o.target_number) o.target_number = a.target_hint[0]
      if (a.profile?.options) Object.assign(o, a.profile.options)
      setOpts(o)
      setImportId(null)
      setPreview(null)
    } catch (e) {
      setErr(e)
    } finally {
      setAnalyzing(false)
    }
  }
  useEffect(() => {
    if (fileId) analyze({}, kind)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId])

  const validate = async () => {
    setErr(null)
    setPreview(null)
    const options = { ...opts, read }
    try {
      let id = importId
      if (id) saveDraft(id, mapping, options)
      else {
        id = createImport(+fileId!, kind as any, mapping, options).id
        setImportId(id)
      }
      if (profileName.trim()) saveProfile(columns, profileName.trim(), kind as any, mapping, options)
      setPreview(await previewImport(id))
    } catch (e) {
      setErr(e)
    }
  }
  const run = async () => {
    setErr(null)
    try {
      setStep(5)
      await runImport(importId!)
      toast.success('Processamento concluído')
    } catch (e) {
      setErr(e)
    }
  }
  const job = useSession((s) => s.imports.find((i) => i.id === importId))
  const imp = { data: job?.status === 'done' ? job : undefined }

  const groups = kind === 'cdr' ? CDR_GROUPS : ERB_GROUPS
  const fields: Record<string, string> = analysis?.fields ?? {}
  const sample: any[] = analysis?.sample ?? []
  const columns: string[] = analysis?.columns ?? []
  const typeValues: string[] = analysis?.event_type_values ?? []
  const used = useMemo(() => new Set(Object.values(mapping).filter(Boolean)), [mapping])

  if (!file) return <ErrorBox error="Arquivo não encontrado nesta análise (os arquivos ficam só na memória da aba; recarregar a página apaga tudo)." />
  const det = analysis?.operator_detection
  const setO = (k: string, v: any) => setOpts((o: any) => ({ ...o, [k]: v }))

  return (
    <div>
      <PageHeader
        icon={<Wand2 className="h-5 w-5" />}
        title="Assistente de importação"
        subtitle={
          <>
            <span className="font-mono">#{file.id}</span> {file.original_name} · {fmtBytes(file.size_bytes)} · SHA-256 <span className="font-mono">{shortHash(file.sha256)}</span>
          </>
        }
      />
      <ol className="mb-6 grid grid-cols-3 gap-2 md:grid-cols-6">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button
              disabled={i > step && !(i <= 4 && analysis)}
              onClick={() => i < 5 && setStep(i)}
              className={clsx('w-full rounded-lg border px-2 py-2 text-left text-xs', i === step ? 'border-accent bg-accent/15 text-white' : i < step ? 'border-ok/40 text-ok' : 'border-line text-faint')}
            >
              <span className="font-mono">{i + 1}.</span> {s}
            </button>
          </li>
        ))}
      </ol>
      {err ? <div className="mb-4"><ErrorBox error={err} /></div> : null}
      {analyzing && <Loading label="Analisando estrutura do arquivo…" />}

      {step === 0 && analysis && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card space-y-3 p-5">
            <Field label="O que este arquivo contém?">
              <select
                className="w-full"
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value)
                  analyze(read, e.target.value)
                }}
              >
                <option value="cdr">Registros de eventos (bilhetagem / extrato com ERB por evento)</option>
                <option value="erb_registry">Cadastro técnico de ERB (células, coordenadas, azimutes)</option>
              </select>
            </Field>
            <Notice tone="amber">Eventos de uso da rede e cadastros técnicos de estações têm significados diferentes e são armazenados separadamente.</Notice>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-muted">Formato detectado</dt>
              <dd className="font-mono uppercase">{analysis.table.fmt}</dd>
              <dt className="text-muted">Codificação</dt>
              <dd className="font-mono">{analysis.table.encoding ?? '—'}</dd>
              <dt className="text-muted">Separador</dt>
              <dd className="font-mono">{analysis.table.delimiter === '\t' ? 'TAB' : (analysis.table.delimiter ?? '—')}</dd>
              <dt className="text-muted">Linha de cabeçalho</dt>
              <dd>{analysis.table.header_row >= 0 ? analysis.table.header_row + 1 : 'não identificada'}</dd>
              {analysis.table.sheet && (
                <>
                  <dt className="text-muted">Planilha</dt>
                  <dd>{analysis.table.sheet}</dd>
                </>
              )}
              {analysis.table.pages && (
                <>
                  <dt className="text-muted">Páginas (PDF)</dt>
                  <dd>
                    {analysis.table.pages} {analysis.table.ocr_used && <Badge tone="amber">OCR · confiança {Math.round((analysis.table.ocr_confidence ?? 0) * 100)}%</Badge>}
                  </dd>
                </>
              )}
              <dt className="text-muted">Colunas</dt>
              <dd>{columns.length}</dd>
            </dl>
            {analysis.table.warnings?.map((w: string) => (
              <Notice key={w} tone="amber">
                {w}
              </Notice>
            ))}
          </div>
          <div className="card space-y-3 p-5">
            <div className="label">Identificação da operadora</div>
            {det?.operator ? (
              <div className="flex items-center gap-3">
                <span className="text-2xl font-bold text-white">{det.operator}</span>
                <Badge tone={det.confidence >= 0.6 ? 'green' : 'amber'}>confiança {Math.round(det.confidence * 100)}%</Badge>
              </div>
            ) : (
              <div className="text-muted">Sem indícios suficientes.</div>
            )}
            <ul className="list-inside list-disc text-xs text-faint">
              {det?.evidence?.map((e: string) => <li key={e}>{e}</li>)}
            </ul>
            <Field label="Operadora (confirme ou corrija)">
              <select className="w-full" value={opts.operator ?? ''} onChange={(e) => setO('operator', e.target.value)}>
                <option value="">não informada</option>
                {['TIM', 'VIVO', 'CLARO', 'OI', 'ALGAR', 'OUTRA'].map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </Field>
            {analysis.profile && <Notice tone="green">Estrutura reconhecida: mapeamento “{analysis.profile.name}” desta sessão aplicado. Revise antes de processar.</Notice>}
            {analysis.table.preamble?.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted">Texto antes do cabeçalho (metadados do documento)</summary>
                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-faint">{analysis.table.preamble.join('\n')}</pre>
              </details>
            )}
          </div>
        </div>
      )}

      {step === 1 && analysis && (
        <div className="space-y-4">
          <div className="card grid gap-4 p-5 md:grid-cols-3 xl:grid-cols-6">
            <Field label="Codificação">
              <select className="w-full" value={read.encoding ?? ''} onChange={(e) => setRead({ ...read, encoding: e.target.value || undefined })}>
                <option value="">automática ({analysis.table.encoding ?? '—'})</option>
                {['utf-8', 'utf-8-sig', 'cp1252', 'latin-1', 'utf-16'].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </Field>
            <Field label="Separador">
              <select className="w-full" value={read.delimiter ?? ''} onChange={(e) => setRead({ ...read, delimiter: e.target.value || undefined })}>
                <option value="">automático</option>
                <option value=";">ponto e vírgula</option>
                <option value=",">vírgula</option>
                <option value={'\t'}>tabulação</option>
                <option value="|">barra vertical</option>
              </select>
            </Field>
            <Field label="Linha do cabeçalho" hint="0 = sem cabeçalho">
              <input type="number" min={0} className="w-full" value={read.header_row === undefined ? '' : read.header_row + 1} placeholder={String(analysis.table.header_row + 1)} onChange={(e) => setRead({ ...read, header_row: e.target.value === '' ? undefined : +e.target.value - 1 })} />
            </Field>
            {analysis.table.sheets?.length > 1 && (
              <Field label="Planilha">
                <select className="w-full" value={read.sheet ?? analysis.table.sheet} onChange={(e) => setRead({ ...read, sheet: e.target.value })}>
                  {analysis.table.sheets.map((s: string) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </Field>
            )}
            {(analysis.table.fmt === 'fixed' || read.fixed_widths) && (
              <Field label="Início das colunas (largura fixa)" hint="posições separadas por vírgula, a partir de 0">
                <input className="w-full font-mono" defaultValue={(analysis.table.fixed_widths ?? []).join(',')} onBlur={(e) => setRead({ ...read, fixed_widths: e.target.value.split(',').map((x) => +x.trim()).filter((x) => !isNaN(x)) })} />
              </Field>
            )}
            {analysis.table.fmt === 'pdf' && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={read.ocr !== false} onChange={(e) => setRead({ ...read, ocr: e.target.checked })} /> OCR em páginas digitalizadas
              </label>
            )}
            <div className="flex items-end">
              <button className="btn-ghost w-full" onClick={() => analyze(read)}>
                <RefreshCw className="h-4 w-4" /> Reanalisar
              </button>
            </div>
          </div>
          <SampleTable columns={columns} sample={sample} />
        </div>
      )}

      {step === 2 && analysis && (
        <div className="space-y-4">
          <Notice>
            Associe as colunas recebidas aos campos padronizados. Sugestões vêm de sinônimos de cabeçalho e de mapeamentos salvos — confira. Identificadores tecnicamente diferentes (CI, ECI, NCI, CGI, LAC, TAC) nunca são equiparados.
          </Notice>
          <div className="grid gap-4 xl:grid-cols-2">
            {groups.map(([g, keys]) => (
              <div key={g} className="card p-4">
                <div className="label mb-3">{g}</div>
                <div className="space-y-2">
                  {keys
                    .filter((k) => fields[k])
                    .map((k) => (
                      <div key={k} className="grid items-center gap-2 sm:grid-cols-[180px_1fr_1fr]">
                        <span className="text-sm">{fields[k]}</span>
                        <select value={mapping[k] ?? ''} onChange={(e) => setMapping({ ...mapping, [k]: e.target.value })} className={mapping[k] ? 'border-accent/60' : ''}>
                          <option value="">— não mapeado —</option>
                          {columns.map((col) => (
                            <option key={col} value={col} disabled={used.has(col) && mapping[k] !== col}>
                              {col}
                            </option>
                          ))}
                        </select>
                        <span className="truncate font-mono text-xs text-faint">{mapping[k] ? sample.slice(0, 3).map((r) => r[mapping[k]]).filter(Boolean).join(' · ') : ''}</span>
                      </div>
                    ))}
                </div>
              </div>
            ))}
          </div>
          <div className="card p-4">
            <Field label="Reaproveitar este mapeamento nesta sessão (opcional)" hint="Aplicado automaticamente a outros arquivos com os mesmos cabeçalhos enquanto a aba estiver aberta; nada é gravado.">
              <input className="w-full" placeholder="ex.: TIM — extrato de chamadas (modelo 2026)" value={profileName} onChange={(e) => setProfileName(e.target.value)} />
            </Field>
          </div>
        </div>
      )}

      {step === 3 && analysis && (
        <div className="grid gap-4 lg:grid-cols-2">
          {kind === 'cdr' ? (
            <>
              <div className="card space-y-3 p-5">
                <div className="label">Datas e horários</div>
                {(['datetime', 'date', 'time'] as const)
                  .filter((f) => mapping[f])
                  .map((f) => (
                    <Field key={f} label={`Formato de ${f === 'datetime' ? 'data e hora' : f === 'date' ? 'data' : 'horário'}`} hint={analysis.formats[f] ? `detectado em ${Math.round(analysis.formats[f].rate * 100)}% da amostra${analysis.formats[f].ambiguous ? ' — AMBÍGUO (dia/mês): confirme' : ''}` : undefined}>
                      <input className="w-full font-mono" value={opts[`${f}_format`] ?? ''} placeholder="automático" onChange={(e) => setO(`${f}_format`, e.target.value || undefined)} />
                    </Field>
                  ))}
                <Field label="Fuso horário dos registros">
                  <select className="w-full" value={opts.tz_mode} onChange={(e) => setO('tz_mode', e.target.value)}>
                    <option value="confirmed">Confirmado no documento</option>
                    <option value="assumed">Presumido pelo analista</option>
                    <option value="unknown">Desconhecido</option>
                  </select>
                </Field>
                <Field label="Fuso (IANA)" hint="Horários com deslocamento explícito (ex.: -03:00) são sempre tratados como confirmados.">
                  <select className="w-full" value={opts.tz_name} onChange={(e) => setO('tz_name', e.target.value)}>
                    {TZS.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Unidade da duração (quando numérica)">
                  <select className="w-full" value={opts.duration_unit} onChange={(e) => setO('duration_unit', e.target.value)}>
                    <option value="s">segundos</option>
                    <option value="min">minutos</option>
                    <option value="ms">milissegundos</option>
                  </select>
                </Field>
              </div>
              <div className="card space-y-3 p-5">
                <div className="label">Números e tipos</div>
                <Field label="Número alvo deste arquivo" hint="Usado para definir origem/destino quando o arquivo traz só o interlocutor.">
                  <select className="w-full" value={opts.target_number ?? ''} onChange={(e) => setO('target_number', e.target.value || undefined)}>
                    <option value="">identificar pelos números do registro</option>
                    {(meta?.targets ?? []).map((t: any) => (
                      <option key={t.number} value={t.number}>
                        {fmtNumber(t.number)} {t.label ? `— ${t.label}` : ''}
                      </option>
                    ))}
                  </select>
                </Field>
                {!mapping.event_type && (
                  <Field label="Tipo dos registros (sem coluna de tipo)" hint="Declare apenas se o documento informar; caso contrário ficam como “outro”.">
                    <select className="w-full" value={opts.default_event_type ?? ''} onChange={(e) => setO('default_event_type', e.target.value || undefined)}>
                      <option value="">não declarar</option>
                      <option value="voz">Chamadas de voz</option>
                      <option value="sms">SMS</option>
                      <option value="dados">Sessões de dados</option>
                    </select>
                  </Field>
                )}
                {typeValues.length > 0 && (
                  <div>
                    <span className="label">Valores de tipo encontrados → tipo padronizado</span>
                    <div className="space-y-1.5">
                      {typeValues.map((v) => (
                        <div key={v} className="grid grid-cols-2 items-center gap-2">
                          <span className="truncate font-mono text-xs">{v}</span>
                          <select value={opts.value_map?.[v] ?? ''} onChange={(e) => setO('value_map', { ...(opts.value_map ?? {}), [v]: e.target.value || undefined })}>
                            <option value="">automático</option>
                            {Object.entries(EVENT_TYPE_LABEL).map(([k, l]) => (
                              <option key={k} value={k}>
                                {l}
                              </option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-3 gap-2">
                  <Field label="MCC declarado">
                    <input className="w-full" value={opts.default_mcc ?? ''} onChange={(e) => setO('default_mcc', e.target.value || undefined)} />
                  </Field>
                  <Field label="MNC declarado">
                    <input className="w-full" value={opts.default_mnc ?? ''} onChange={(e) => setO('default_mnc', e.target.value || undefined)} />
                  </Field>
                  <Field label="Tecnologia">
                    <select className="w-full" value={opts.default_tech ?? ''} onChange={(e) => setO('default_tech', e.target.value || undefined)}>
                      <option value="">—</option>
                      {['2G', '3G', '4G', '5G'].map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </Field>
                </div>
                <p className="text-xs text-faint">Preencha MCC/MNC/tecnologia somente quando o documento os declarar (ex.: no cabeçalho). Valores declarados ficam sinalizados em cada registro.</p>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={!!opts.hex_ids} onChange={(e) => setO('hex_ids', e.target.checked)} /> Identificadores (LAC/TAC/CI/ECI) em hexadecimal
                </label>
              </div>
            </>
          ) : (
            <div className="card space-y-3 p-5 lg:col-span-2">
              <div className="grid gap-3 md:grid-cols-3">
                <Field label="Nome da versão do cadastro">
                  <input className="w-full" value={opts.version_name ?? ''} placeholder={file.original_name} onChange={(e) => setO('version_name', e.target.value)} />
                </Field>
                <Field label="Data de referência do cadastro" hint="Permite saber qual versão foi usada em cada análise.">
                  <input type="date" className="w-full" value={opts.reference_date ?? ''} onChange={(e) => setO('reference_date', e.target.value || undefined)} />
                </Field>
                <Field label="Tecnologia padrão (se não houver coluna)">
                  <select className="w-full" value={opts.default_tech ?? ''} onChange={(e) => setO('default_tech', e.target.value || undefined)}>
                    <option value="">—</option>
                    {['2G', '3G', '4G', '5G'].map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!opts.hex_ids} onChange={(e) => setO('hex_ids', e.target.checked)} /> Identificadores em hexadecimal
              </label>
              <Notice>Novas importações criam uma nova versão do cadastro; versões anteriores não são apagadas.</Notice>
            </div>
          )}
        </div>
      )}

      {step === 4 && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" onClick={validate}>
              <CheckCircle2 className="h-4 w-4" /> Validar e gerar prévia
            </button>
            {preview && !preview.required_problems.length && (
              <button className="btn-primary !bg-ok/90 hover:!bg-ok" onClick={run}>
                <Play className="h-4 w-4" /> Confirmar e processar o arquivo inteiro
              </button>
            )}
          </div>
          {preview && (
            <>
              {preview.required_problems.map((p: string) => (
                <Notice key={p} tone="red">
                  {p}
                </Notice>
              ))}
              <div className="grid gap-4 md:grid-cols-3">
                <div className="card p-4">
                  <div className="label">Linhas verificadas na prévia</div>
                  <div className="text-2xl font-bold">{fmtInt(preview.checked)}</div>
                </div>
                <div className="card p-4 md:col-span-2">
                  <div className="label">Ocorrências de validação</div>
                  {preview.issue_counts.length === 0 ? (
                    <div className="text-sm text-ok">Nenhum problema encontrado na amostra.</div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {preview.issue_counts.map((i: any) => (
                        <Badge key={i.code + i.severity} tone={i.severity === 'error' ? 'red' : 'amber'}>
                          {i.code}: {i.count}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {preview.event_types && (
                    <div className="mt-2 text-xs text-muted">
                      Tipos: {Object.entries(preview.event_types).map(([k, v]) => `${EVENT_TYPE_LABEL[k] ?? k}: ${v}`).join(' · ')}
                    </div>
                  )}
                </div>
              </div>
              {preview.issues.length > 0 && (
                <div className="card max-h-60 overflow-auto">
                  <table>
                    <thead>
                      <tr>
                        <th>Linha</th>
                        <th>Gravidade</th>
                        <th>Campo</th>
                        <th>Mensagem</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.issues.map((i: any, n: number) => (
                        <tr key={n}>
                          <td className="font-mono text-xs">
                            {i.row}
                            {i.page ? ` (p.${i.page})` : ''}
                          </td>
                          <td>
                            <Badge tone={i.severity === 'error' ? 'red' : 'amber'}>{i.severity === 'error' ? 'erro' : 'aviso'}</Badge>
                          </td>
                          <td className="font-mono text-xs">{i.field}</td>
                          <td className="text-xs">{i.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="label">Registros normalizados (amostra)</div>
              <NormalizedTable rows={preview.rows} kind={kind} />
            </>
          )}
        </div>
      )}

      {step === 5 && job && (
        <div className="card space-y-4 p-6">
          <div className="flex items-center justify-between">
            <div className="font-mono text-sm">
              Importação #{job.id} · <b>{({ done: 'concluída', running: 'processando', failed: 'falhou', cancelled: 'cancelada', draft: 'rascunho' } as Record<string, string>)[job.status] ?? job.status}</b>
            </div>
            {job.status === 'running' && (
              <button className="btn-danger !py-1 text-xs" onClick={() => cancelImport(job.id)}>
                <XCircle className="h-4 w-4" /> Cancelar
              </button>
            )}
          </div>
          <Progress value={job.status === 'done' ? 1 : job.progress} tone={job.status === 'failed' ? 'red' : job.status === 'done' ? 'green' : 'blue'} />
          <div className="text-sm text-muted">{job.message}</div>
          {job.status === 'failed' && <ErrorBox error={job.message} />}
          {imp.data && (
            <>
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {[
                  ['lidas', imp.data.rows_total],
                  ['aceitas', imp.data.rows_ok],
                  ['rejeitadas', imp.data.rows_error],
                  ['com aviso', imp.data.rows_warning],
                  ['duplicadas', imp.data.rows_duplicate],
                  ['fora do período', imp.data.rows_out_of_scope],
                ].map(([l, v]) => (
                  <div key={l as string} className="rounded-lg border border-line p-3 text-center">
                    <div className="text-xl font-bold tabular-nums">{fmtInt(v as number)}</div>
                    <div className="text-xs text-faint">{l}</div>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Link to={`../importacoes?i=${importId}`} relative="path" className="btn-ghost">
                  Ver ocorrências por linha
                </Link>
                <Link to={kind === 'cdr' ? '../eventos' : '../erb/cadastro'} relative="path" className="btn-primary">
                  {kind === 'cdr' ? 'Abrir registros importados' : 'Abrir cadastro'} <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </>
          )}
        </div>
      )}

      {step < 5 && analysis && (
        <div className="mt-6 flex justify-between">
          <button className="btn-ghost" disabled={step === 0} onClick={() => setStep(step - 1)}>
            <ArrowLeft className="h-4 w-4" /> Voltar
          </button>
          {step < 4 && (
            <button
              className="btn-primary"
              onClick={() => {
                setStep(step + 1)
                if (step + 1 === 4) validate()
              }}
            >
              Avançar <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function SampleTable({ columns, sample }: { columns: string[]; sample: any[] }) {
  return (
    <div className="card max-h-[420px] overflow-auto">
      <table>
        <thead>
          <tr>
            <th>linha</th>
            {columns.map((c) => (
              <th key={c} className="!normal-case">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sample.map((r, i) => (
            <tr key={i}>
              <td className="font-mono text-xs text-faint">
                {r._row}
                {r._page ? `/p${r._page}` : ''}
              </td>
              {columns.map((c) => (
                <td key={c} className="font-mono text-xs whitespace-nowrap">
                  {r[c]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function NormalizedTable({ rows, kind }: { rows: any[]; kind: string }) {
  const cols =
    kind === 'cdr'
      ? ['row_number', 'ts_local', 'tz_status', 'event_type', 'target_number', 'a_number', 'b_number', 'duration_s', 'cell_key', 'out_of_scope', 'warnings']
      : ['row_number', 'operator', 'tech', 'mcc', 'mnc', 'lac', 'tac', 'cell_id', 'eci', 'site_name', 'lat', 'lon', 'azimuth', 'validation_status']
  return (
    <div className="card max-h-[420px] overflow-auto">
      <table>
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {cols.map((c) => (
                <td key={c} className="font-mono text-xs whitespace-nowrap">
                  {Array.isArray(r[c]) ? r[c].join('; ') : r[c] === null || r[c] === undefined ? <span className="text-faint">—</span> : String(r[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
