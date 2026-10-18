import { Download, FileSpreadsheet, FileText } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { useAuth } from '../app/auth'
import { type ExportFormat, exportTable, type TableExport } from '../engine/exporter'

/**
 * Botões de exportação de um resultado (Excel, PDF, CSV). O arquivo é gerado no navegador
 * e entregue como download; nada é enviado ao servidor nem guardado.
 */
export function ExportButtons({ build, disabled, label = 'Exportar' }: { build: () => TableExport | Promise<TableExport>; disabled?: boolean; label?: string }) {
  const { me } = useAuth()
  const [busy, setBusy] = useState<ExportFormat | null>(null)
  if (!me?.can_export) return <span className="text-xs text-faint">Exportação desativada para seu usuário</span>
  const run = async (fmt: ExportFormat) => {
    setBusy(fmt)
    try {
      const t = await build()
      const r = await exportTable(t, fmt, { name: me.name, email: me.email })
      toast.success(`Arquivo gerado: ${r.name}`, { description: `SHA-256: ${r.hash}`, duration: 12000 })
    } catch (e: any) {
      toast.error(`Falha ao exportar: ${e?.message ?? e}`)
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label={label}>
      <button className="btn-ghost !py-1.5 text-xs" disabled={disabled || !!busy} onClick={() => run('xlsx')}>
        <FileSpreadsheet className="h-3.5 w-3.5" /> {busy === 'xlsx' ? 'Gerando…' : 'Excel'}
      </button>
      <button className="btn-ghost !py-1.5 text-xs" disabled={disabled || !!busy} onClick={() => run('pdf')}>
        <FileText className="h-3.5 w-3.5" /> {busy === 'pdf' ? 'Gerando…' : 'PDF'}
      </button>
      <button className="btn-ghost !py-1.5 text-xs" disabled={disabled || !!busy} onClick={() => run('csv')}>
        <Download className="h-3.5 w-3.5" /> {busy === 'csv' ? 'Gerando…' : 'CSV'}
      </button>
    </div>
  )
}
