import { useQuery } from '@tanstack/react-query'
import { FileStack, ShieldCheck, Trash2, Upload, Wand2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useCase } from '../../app/layout'
import { Badge, Empty, Field, Notice, PageHeader } from '../../components/ui'
import { q as sql } from '../../engine/db'
import { addFiles, removeFile } from '../../engine/importer'
import { sha256 } from '../../engine/readers'
import { type SessionFile, setState, useSession } from '../../engine/session'
import { fmtBytes, fmtDateTime, fmtInt, shortHash } from '../../lib/format'

const STATUS_TONE: Record<string, any> = { processado: 'green', recebido: 'blue', em_processamento: 'amber', expandido: 'gray', rejeitado: 'red', nao_suportado: 'red' }

export default function Files() {
  const { c, canWrite } = useCase()
  const navigate = useNavigate()
  const files = useSession((s) => s.files)
  const imports = useSession((s) => s.imports)
  const counts = useQuery({
    queryKey: ['files-events', c.id],
    queryFn: async () => Object.fromEntries((await sql(`SELECT file_id, count(*)::INTEGER AS n FROM events WHERE NOT is_duplicate GROUP BY 1`)).map((r) => [r.file_id, r.n])),
  })
  const [kind, setKind] = useState('cdr')
  const [operator, setOperator] = useState('')
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const send = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true)
    try {
      const r = await addFiles(files, kind as SessionFile['kind'], operator || null, (label) => setState({ busy: { label, progress: 0 } }))
      r.forEach((f) => f.meta?.duplicate_of && toast.warning(`${f.original_name}: conteúdo idêntico ao arquivo #${f.meta.duplicate_of} (mesmo SHA-256)`))
      toast.success(`${r.length} arquivo(s) carregado(s) na memória desta aba`)
      const tab = r.filter((f) => !['zip'].includes(f.detected_format) && f.status === 'recebido')
      if (tab.length === 1) navigate(`../importar/${tab[0].id}?tipo=${kind}`, { relative: 'path' })
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setState({ busy: null })
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }
  return (
    <div>
      <PageHeader
        icon={<FileStack className="h-5 w-5" />}
        title="Arquivos da análise"
        subtitle="Os arquivos são lidos diretamente do seu computador, nesta aba: nada é enviado a servidores nem gravado. O SHA-256 de cada original é calculado localmente e os registros normalizados mantêm o vínculo com a linha/página de origem."
      />
      {canWrite && (
        <div
          className={`card mb-6 border-dashed p-6 ${drag ? 'border-accent bg-accent/5' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setDrag(true)
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDrag(false)
            send(e.dataTransfer.files)
          }}
        >
          <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
            <Field label="Tipo de documento">
              <select className="w-full" value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="cdr">Bilhetagem / extrato de registros (CDR, ERB por evento)</option>
                <option value="erb_registry">Cadastro técnico de ERB (células e coordenadas)</option>
                <option value="other">Documento complementar</option>
              </select>
            </Field>
            <Field label="Operadora informada (opcional)">
              <select className="w-full" value={operator} onChange={(e) => setOperator(e.target.value)}>
                <option value="">detectar / informar depois</option>
                {['TIM', 'VIVO', 'CLARO', 'OI', 'ALGAR', 'OUTRA'].map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </Field>
            <div>
              <input ref={input} type="file" multiple className="hidden" onChange={(e) => send(e.target.files)} accept=".csv,.txt,.tsv,.xls,.xlsx,.xml,.json,.zip,.pdf,.html,.htm,.dat,.prn" />
              <button className="btn-primary w-full" disabled={busy} onClick={() => input.current?.click()}>
                <Upload className="h-4 w-4" /> {busy ? 'Lendo…' : 'Selecionar arquivos'}
              </button>
            </div>
          </div>
          <p className="mt-3 text-center text-xs text-faint">ou arraste os arquivos para cá · CSV, TXT (delimitado ou largura fixa), XLS, XLSX, XML, JSON, HTML, PDF (texto ou digitalizado, com OCR) e ZIP</p>
        </div>
      )}
      {files.length === 0 ? (
        <Empty title="Nenhum arquivo">Selecione as bilhetagens e os cadastros de ERB recebidos das operadoras. Eles não sairão do seu computador.</Empty>
      ) : (
        <>
          <Notice>A identificação de operadora é um indício com nível de confiança; confirme no assistente de importação. Um mesmo layout pode variar conforme o tipo de requisição e o sistema de origem.</Notice>
          <div className="card scroll-x mt-4">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Arquivo</th>
                  <th>Tipo</th>
                  <th>Formato</th>
                  <th>Operadora</th>
                  <th>Tamanho</th>
                  <th>SHA-256</th>
                  <th>Carregado</th>
                  <th>Situação</th>
                  <th className="text-right">Registros</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {files.map((f) => (
                  <tr key={f.id} className={f.parent_id ? 'text-muted' : ''}>
                    <td className="font-mono text-xs">{f.id}</td>
                    <td className="max-w-xs break-all">
                      {f.parent_id ? '↳ ' : ''}
                      {f.original_name}
                      {f.meta?.duplicate_of && <div className="text-xs text-amber">idêntico ao #{f.meta.duplicate_of}</div>}
                      {f.meta?.error && <div className="text-xs text-danger">{f.meta.error}</div>}
                    </td>
                    <td className="text-xs">{f.kind === 'erb_registry' ? 'cadastro ERB' : f.kind === 'cdr' ? 'bilhetagem' : 'complementar'}</td>
                    <td className="font-mono text-xs uppercase">{f.detected_format}</td>
                    <td className="text-xs">
                      {f.operator_declared ?? '—'}
                      {f.operator_detected && (
                        <div className="text-faint">
                          detectado: {f.operator_detected} ({Math.round((f.operator_confidence ?? 0) * 100)}%)
                        </div>
                      )}
                    </td>
                    <td className="text-xs whitespace-nowrap">{fmtBytes(f.size_bytes)}</td>
                    <td className="font-mono text-[11px] text-faint" title={f.sha256}>
                      {shortHash(f.sha256)}
                    </td>
                    <td className="text-xs whitespace-nowrap">{fmtDateTime(f.received_at, false)}</td>
                    <td>
                      <Badge tone={STATUS_TONE[f.status] ?? 'gray'}>{f.status.replace('_', ' ')}</Badge>
                    </td>
                    <td className="text-right tabular-nums">{fmtInt(counts.data?.[f.id] ?? 0)}</td>
                    <td>
                      <div className="flex gap-1">
                        {canWrite && !['zip'].includes(f.detected_format) && f.status !== 'nao_suportado' && f.status !== 'rejeitado' && (
                          <Link to={`../importar/${f.id}?tipo=${f.kind}`} relative="path" className="btn-ghost !px-2 !py-1 text-xs" title="Configurar importação">
                            <Wand2 className="h-3.5 w-3.5" /> {imports.some((i) => i.file_id === f.id && i.status === 'done') ? 'Reimportar' : 'Importar'}
                          </Link>
                        )}
                        <button
                          className="btn-ghost !px-2 !py-1"
                          title="Verificar integridade (recalcula o SHA-256)"
                          onClick={async () => {
                            const h = await sha256(f.blob)
                            if (h === f.sha256) toast.success('Íntegro: SHA-256 confere com o calculado no carregamento')
                            else toast.error('ALTERADO: o SHA-256 atual não confere!')
                          }}
                        >
                          <ShieldCheck className="h-3.5 w-3.5" />
                        </button>
                        {canWrite && !f.parent_id && (
                          <button
                            className="btn-ghost !px-2 !py-1 hover:!text-danger"
                            title="Remover arquivo e seus registros da análise"
                            onClick={async () => {
                              if (!confirm(`Remover ${f.original_name} e os registros dele desta análise?`)) return
                              try {
                                await removeFile(f.id)
                              } catch (e: any) {
                                toast.error(e.message)
                              }
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
