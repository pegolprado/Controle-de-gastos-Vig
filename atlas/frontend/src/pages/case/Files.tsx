import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FileStack, ShieldCheck, Trash2, Upload, Wand2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { api, download } from '../../api/client'
import { useCase } from '../../app/layout'
import { Badge, Empty, ErrorBox, Field, Loading, Notice, PageHeader } from '../../components/ui'
import { fmtBytes, fmtDateTime, fmtInt, shortHash } from '../../lib/format'

const STATUS_TONE: Record<string, any> = { processado: 'green', recebido: 'blue', em_processamento: 'amber', expandido: 'gray', rejeitado: 'red', nao_suportado: 'red' }

export default function Files() {
  const { c, canWrite } = useCase()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const q = useQuery({ queryKey: ['files', c.id], queryFn: () => api<any[]>(`/cases/${c.id}/files`) })
  const [kind, setKind] = useState('cdr')
  const [operator, setOperator] = useState('')
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const send = async (files: FileList | null) => {
    if (!files?.length) return
    const fd = new FormData()
    Array.from(files).forEach((f) => fd.append('files', f))
    fd.append('kind', kind)
    if (operator) fd.append('operator', operator)
    setBusy(true)
    try {
      const r = await api<any[]>(`/cases/${c.id}/files`, { form: fd })
      r.forEach((f) => f.meta?.duplicate_of && toast.warning(`${f.original_name}: conteúdo idêntico ao arquivo #${f.meta.duplicate_of} (mesmo SHA-256)`))
      toast.success(`${r.length} arquivo(s) recebido(s) e preservado(s)`)
      qc.invalidateQueries({ queryKey: ['files', c.id] })
      qc.invalidateQueries({ queryKey: ['meta', c.id] })
      const tab = r.filter((f) => !['zip'].includes(f.detected_format) && f.status === 'recebido')
      if (tab.length === 1) navigate(`../importar/${tab[0].id}?tipo=${kind}`, { relative: 'path' })
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }
  return (
    <div>
      <PageHeader
        icon={<FileStack className="h-5 w-5" />}
        title="Arquivos do caso"
        subtitle="Cada arquivo recebido é gravado sem alterações em armazenamento privado, com SHA-256, data/hora e responsável. O processamento usa uma cópia de leitura; os registros normalizados mantêm o vínculo com a linha/página de origem."
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
                <Upload className="h-4 w-4" /> {busy ? 'Enviando…' : 'Selecionar arquivos'}
              </button>
            </div>
          </div>
          <p className="mt-3 text-center text-xs text-faint">ou arraste os arquivos para cá · CSV, TXT (delimitado ou largura fixa), XLS, XLSX, XML, JSON, HTML, PDF (texto ou digitalizado, com OCR) e ZIP</p>
        </div>
      )}
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : q.data!.length === 0 ? (
        <Empty title="Nenhum arquivo">Envie as bilhetagens e os cadastros de ERB recebidos das operadoras.</Empty>
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
                  <th>Recebido</th>
                  <th>Situação</th>
                  <th className="text-right">Registros</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {q.data!.map((f) => (
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
                    <td className="text-xs whitespace-nowrap">{fmtDateTime(f.uploaded_at?.slice(0, 19), false)}</td>
                    <td>
                      <Badge tone={STATUS_TONE[f.status] ?? 'gray'}>{f.status.replace('_', ' ')}</Badge>
                    </td>
                    <td className="text-right tabular-nums">{fmtInt(f.events)}</td>
                    <td>
                      <div className="flex gap-1">
                        {canWrite && !['zip'].includes(f.detected_format) && f.status !== 'nao_suportado' && f.status !== 'rejeitado' && (
                          <Link to={`../importar/${f.id}?tipo=${f.kind}`} relative="path" className="btn-ghost !px-2 !py-1 text-xs" title="Configurar importação">
                            <Wand2 className="h-3.5 w-3.5" /> {f.imports.length ? 'Reimportar' : 'Importar'}
                          </Link>
                        )}
                        <button
                          className="btn-ghost !px-2 !py-1"
                          title="Verificar integridade (recalcula o SHA-256)"
                          onClick={async () => {
                            const r = await api(`/cases/${c.id}/files/${f.id}/verify`)
                            if (r.intact) toast.success('Íntegro: SHA-256 confere com o registrado no recebimento')
                            else toast.error('ALTERADO: o SHA-256 atual não confere!')
                          }}
                        >
                          <ShieldCheck className="h-3.5 w-3.5" />
                        </button>
                        {c.can_export && (
                          <button className="btn-ghost !px-2 !py-1" title="Baixar original" onClick={() => download(`/cases/${c.id}/files/${f.id}/download`, undefined, f.original_name)}>
                            <Download className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {canWrite && !f.parent_id && (
                          <button
                            className="btn-ghost !px-2 !py-1 hover:!text-danger"
                            title="Excluir arquivo e seus registros"
                            onClick={async () => {
                              const reason = prompt('Motivo da exclusão (fica na auditoria):')
                              if (!reason || reason.length < 5) return
                              try {
                                await api(`/cases/${c.id}/files/${f.id}?reason=${encodeURIComponent(reason)}`, { method: 'DELETE' })
                                qc.invalidateQueries({ queryKey: ['files', c.id] })
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
