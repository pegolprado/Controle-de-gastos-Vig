import { FileText, Lock } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { useAuth } from '../../app/auth'
import { useCase } from '../../app/layout'
import { type EventFilter, FilterBar } from '../../components/FilterBar'
import { Badge, Field, Notice, PageHeader } from '../../components/ui'
import type { ExportFormat } from '../../engine/exporter'
import { generateReport, REPORT_TYPES, type ReportType, SECTION_NAMES, SECTIONS } from '../../engine/report'
import { setState as setSession } from '../../engine/session'

const defaultTitle = (t: ReportType) => (t === 'full' ? 'Relatório completo' : `Relatório de ${REPORT_TYPES[t]}`)

type Done = { name: string; code: string; hash: string; fmt: ExportFormat; at: string; sha_inputs: { name: string; sha256: string }[] }

export default function Reports() {
  const { c } = useCase()
  const { me } = useAuth()
  const [type, setType] = useState<ReportType>('cdr')
  const [fmt, setFmt] = useState<ExportFormat>('pdf')
  const [title, setTitle] = useState('')
  const [filter, setFilter] = useState<EventFilter>({})
  const [sections, setSections] = useState<string[] | null>(null)
  const [maxEvents, setMaxEvents] = useState(2000)
  const [busy, setBusy] = useState(false)
  // Lista apenas desta tela, para conferência do hash; some ao sair da página.
  const [done, setDone] = useState<Done[]>([])
  const secs = sections ?? SECTIONS[type]
  const generate = async () => {
    if (!me) return
    setBusy(true)
    setSession({ busy: { label: 'Gerando o arquivo no navegador', progress: 0 } })
    try {
      const r = await generateReport(filter as any, { title: title.trim() || defaultTitle(type), type, sections: secs, maxEvents }, fmt, { name: me.name, email: me.email })
      setDone((d) => [{ ...r, fmt, at: new Date().toLocaleString('pt-BR') }, ...d])
      toast.success(`Arquivo entregue: ${r.name}`)
    } catch (e: any) {
      toast.error(`Falha ao gerar: ${e?.message ?? e}`)
    } finally {
      setSession({ busy: null })
      setBusy(false)
    }
  }
  return (
    <div>
      <PageHeader
        icon={<FileText className="h-5 w-5" />}
        title="Exportar relatório"
        subtitle="Relatório técnico gerado no seu navegador em PDF, Excel ou CSV, com arquivos de entrada e seus SHA-256, filtros, mapeamentos, versão das regras e limitações. O arquivo vai direto para o seu computador; nenhuma cópia fica no sistema."
      />
      {c.is_demo && (
        <div className="mb-4">
          <Notice tone="amber">Os arquivos desta análise levam a marca DEMONSTRAÇÃO.</Notice>
        </div>
      )}
      {!me?.can_export ? (
        <Notice tone="amber">A exportação está desativada para o seu usuário. Fale com o administrador.</Notice>
      ) : (
        <section className="card mb-6 p-5">
          <div className="grid gap-4 md:grid-cols-4">
            <Field label="Tipo">
              <select
                className="w-full"
                value={type}
                onChange={(e) => {
                  setType(e.target.value as ReportType)
                  setSections(null)
                }}
              >
                {Object.entries(REPORT_TYPES).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Formato">
              <select className="w-full" value={fmt} onChange={(e) => setFmt(e.target.value as ExportFormat)}>
                <option value="pdf">PDF</option>
                <option value="xlsx">Excel (XLSX)</option>
                <option value="csv">CSV</option>
              </select>
            </Field>
            <Field label="Título (opcional)" className="md:col-span-2">
              <input className="w-full" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder={defaultTitle(type)} />
            </Field>
          </div>
          {fmt === 'pdf' && (
            <div className="mt-4">
              <span className="label">Seções</span>
              <div className="flex flex-wrap gap-2">
                {SECTIONS[type].map((k) => (
                  <label key={k} className="chip cursor-pointer border-line !py-1.5 text-muted">
                    <input type="checkbox" checked={secs.includes(k)} onChange={() => setSections(secs.includes(k) ? secs.filter((x) => x !== k) : SECTIONS[type].filter((x) => x === k || secs.includes(x)))} /> {SECTION_NAMES[k]}
                  </label>
                ))}
              </div>
            </div>
          )}
          {secs.includes('eventos') && (
            <Field label={fmt === 'pdf' ? 'Máximo de eventos na tabela do PDF' : 'Máximo de eventos exportados'} className="mt-3 w-72">
              <input type="number" min={0} max={fmt === 'pdf' ? 20000 : 1000000} className="w-full" value={maxEvents} onChange={(e) => setMaxEvents(Math.max(0, +e.target.value))} />
            </Field>
          )}
          <div className="mt-4">
            <span className="label">Filtros aplicados</span>
            <FilterBar value={filter} onChange={setFilter} />
          </div>
          <button className="btn-primary" disabled={busy} onClick={generate}>
            {busy ? 'Gerando…' : `Gerar e baixar ${fmt.toUpperCase()}`}
          </button>
        </section>
      )}
      {done.length > 0 && (
        <section className="card p-5">
          <h2 className="section-title mb-3 flex items-center gap-2 text-muted">
            <Lock className="h-4 w-4" /> Arquivos gerados agora (confira o hash e guarde-o junto ao arquivo)
          </h2>
          <div className="space-y-3">
            {done.map((r) => (
              <div key={r.code + r.fmt} className="rounded-lg border border-line p-3 text-sm">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="font-mono text-accent">{r.code}</span>
                  <Badge>{r.fmt.toUpperCase()}</Badge>
                  <span className="text-xs text-faint">{r.at}</span>
                </div>
                <div className="break-all text-muted">{r.name}</div>
                <div className="mt-1 font-mono text-[11px] break-all text-faint">SHA-256 do arquivo: {r.hash}</div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-faint">Esta lista existe só enquanto a tela estiver aberta. O sistema não guarda cópia dos arquivos nem dos hashes.</p>
        </section>
      )}
    </div>
  )
}
