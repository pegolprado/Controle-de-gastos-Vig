import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, ShieldCheck, XCircle } from 'lucide-react'
import { Link } from 'react-router-dom'
import { cells as erbCells, summary } from '../../engine/analytics'
import { validate } from '../../engine/crossmatch'
import { useSession } from '../../engine/session'
import { useCase } from '../../app/layout'
import { Badge, DrillLink, ErrorBox, Loading, PageHeader, Stat } from '../../components/ui'
import { fmtDateTime, fmtInt, shortHash } from '../../lib/format'

export default function Quality() {
  const { c } = useCase()
  const v = useQuery({ queryKey: ['xvalidate', c.id], queryFn: () => validate([]) as Promise<any> })
  const s = useQuery({ queryKey: ['summary-all', c.id], queryFn: () => summary({ include_duplicates: true, include_out_of_scope: true }) })
  const imps = { data: useSession((x) => x.imports) }
  const cells = useQuery({ queryKey: ['erb-cells', c.id, {}], queryFn: () => erbCells({}) })
  if (v.isLoading || s.isLoading) return <Loading />
  if (v.error) return <ErrorBox error={v.error} />
  const t = s.data?.totals
  const errors = (imps.data ?? []).reduce((n, i) => n + (i.rows_error ?? 0), 0)
  const res = Object.fromEntries((cells.data?.resolution ?? []).map((r: any) => [r.status, r.n]))
  return (
    <div>
      <PageHeader icon={<ShieldCheck className="h-5 w-5" />} title="Validação e qualidade dos dados" subtitle="Antes de cruzar registros, confira fusos, normalização, duplicidades, escopo, proveniência e a resolução das células. Cada número abre os registros correspondentes." />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Linhas rejeitadas na importação" value={fmtInt(errors)} tone={errors ? 'red' : 'green'} hint={<Link className="text-accent" to="../importacoes" relative="path">ver ocorrências por linha</Link>} />
        <Stat label="Duplicados (excluídos)" value={<DrillLink caseId={c.id} filter={{ only_duplicates: true }}>{fmtInt(s.data?.excluded.duplicates)}</DrillLink>} hint="mesmo alvo, números, horário, duração, tipo, célula e IP" />
        <Stat label="Fora do período autorizado" value={<DrillLink caseId={c.id} filter={{ only_out_of_scope: true }}>{fmtInt(s.data?.excluded.out_of_scope)}</DrillLink>} tone={s.data?.excluded.out_of_scope ? 'amber' : undefined} hint="ficam fora das análises por padrão" />
        <Stat label="Fuso não confirmado" value={<DrillLink caseId={c.id} filter={{ tz_status: ['assumed', 'unknown'] }}>{fmtInt(t?.tz_not_confirmed)}</DrillLink>} tone={t?.tz_not_confirmed ? 'amber' : undefined} hint={`${fmtInt(t?.with_warnings)} registros com avisos de validação`} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="section-title mb-4 text-muted">Checagens para cruzamento</h2>
          <ul className="space-y-3">
            {v.data!.checks.map((ch: any) => (
              <li key={ch.check} className="flex items-start gap-3">
                {ch.ok ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-ok" /> : <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber" />}
                <div>
                  <div className="text-sm font-medium">{ch.check}</div>
                  <div className="text-xs text-muted">{ch.detail}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
        <section className="card p-5">
          <h2 className="section-title mb-4 text-muted">Resolução de ERB</h2>
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            {[
              ['exact', 'exata', 'green'],
              ['probable', 'provável', 'blue'],
              ['ambiguous', 'ambígua', 'amber'],
              ['none', 'não resolvida', 'red'],
            ].map(([k, l, tone]) => (
              <div key={k} className="rounded-lg border border-line p-3 text-center">
                <div className="text-xl font-bold">
                  <DrillLink caseId={c.id} filter={{ resolution: [k] }}>
                    {fmtInt(res[k] ?? 0)}
                  </DrillLink>
                </div>
                <Badge tone={tone as any}>{l}</Badge>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-faint">Registros sem identificador de célula: {fmtInt(cells.data?.events_without_cell)}. Correspondências ambíguas podem ser revisadas manualmente na Análise de ERB.</p>
        </section>
      </div>
      <section className="card scroll-x mt-6">
        <table>
          <thead>
            <tr>
              <th>Arquivo</th>
              <th>Operadora</th>
              <th>SHA-256</th>
              <th className="text-right">Registros</th>
              <th className="text-right">Fuso conf./pres./desc.</th>
              <th className="text-right">Duplic.</th>
              <th className="text-right">Avisos</th>
              <th className="text-right">Sem célula</th>
              <th>Período</th>
            </tr>
          </thead>
          <tbody>
            {v.data!.files.map((f: any) => (
              <tr key={f.file_id}>
                <td className="text-xs">
                  #{f.file_id} {f.original_name}
                </td>
                <td className="text-xs">{f.operator_declared ?? '—'}</td>
                <td className="font-mono text-[11px] text-faint">{shortHash(f.sha256)}</td>
                <td className="text-right tabular-nums">
                  <DrillLink caseId={c.id} filter={{ file_ids: [f.file_id] }}>
                    {fmtInt(f.events)}
                  </DrillLink>
                </td>
                <td className="text-right text-xs tabular-nums">
                  {fmtInt(f.tz_confirmed)} / {fmtInt(f.tz_assumed)} / {fmtInt(f.tz_unknown)}
                </td>
                <td className="text-right tabular-nums">{fmtInt(f.duplicates)}</td>
                <td className="text-right tabular-nums">{fmtInt(f.with_warnings)}</td>
                <td className="text-right tabular-nums">{fmtInt(f.without_cell)}</td>
                <td className="text-xs whitespace-nowrap">
                  {fmtDateTime(f.first_event, false)} → {fmtDateTime(f.last_event, false)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
