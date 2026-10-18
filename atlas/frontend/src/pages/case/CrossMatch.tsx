import { useMutation, useQuery } from '@tanstack/react-query'
import { CheckCircle2, GitMerge, XCircle } from 'lucide-react'
import { useState } from 'react'
import { reciprocalMatch, validate } from '../../engine/crossmatch'
import { useCase } from '../../app/layout'
import { Badge, Criteria, DrillLink, ErrorBox, Field, Loading, Notice, PageHeader } from '../../components/ui'
import { EVENT_TYPE_LABEL, fmtDateTime, fmtInt, fmtNumber } from '../../lib/format'

const CLS: Record<string, [string, any]> = { exata: ['exata', 'green'], provavel: ['provável', 'blue'], ambigua: ['ambígua', 'amber'], ausente: ['ausente', 'red'] }

export default function CrossMatch() {
  const { c, meta } = useCase()
  const files = (meta?.files ?? []).filter((f: any) => f.kind === 'cdr')
  const [sel, setSel] = useState<number[]>([])
  const [tol, setTol] = useState(60)
  const [dtol, setDtol] = useState(5)
  const [cls, setCls] = useState('')
  const v = useQuery({ queryKey: ['xvalidate', c.id, sel], queryFn: () => validate(sel) as Promise<any> })
  const m = useMutation({ mutationFn: () => reciprocalMatch(sel.length ? { file_ids: sel } : {}, tol, dtol) as Promise<any> })
  return (
    <div>
      <PageHeader
        icon={<GitMerge className="h-5 w-5" />}
        title="Cruzamento multifonte"
        subtitle="Relaciona registros de arquivos diferentes (inclusive de operadoras diferentes). Ex.: a chamada A→B aparece na bilhetagem de A (originada) e na de B (recebida). Antes de cruzar, valide identificadores, fusos, períodos, duplicidades e proveniência."
      />
      <div className="card mb-4 grid gap-4 p-4 md:grid-cols-[1fr_auto_auto_auto] md:items-end">
        <Field label="Arquivos (vazio = todos os da análise)">
          <select multiple className="h-24 w-full" value={sel.map(String)} onChange={(e) => setSel(Array.from(e.target.selectedOptions).map((o) => +o.value))}>
            {files.map((f: any) => (
              <option key={f.id} value={f.id}>
                #{f.id} {f.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Tolerância de horário (s)">
          <input type="number" min={0} className="w-28" value={tol} onChange={(e) => setTol(+e.target.value)} />
        </Field>
        <Field label="Tolerância de duração (s)">
          <input type="number" min={0} className="w-28" value={dtol} onChange={(e) => setDtol(+e.target.value)} />
        </Field>
        <button className="btn-primary" onClick={() => m.mutate()}>
          Cruzar registros
        </button>
      </div>
      <section className="card mb-4 p-4">
        <div className="label mb-3">1. Validação prévia</div>
        {v.isLoading ? (
          <Loading />
        ) : v.error ? (
          <ErrorBox error={v.error} />
        ) : (
          <ul className="grid gap-2 md:grid-cols-2">
            {v.data.checks.map((ch: any) => (
              <li key={ch.check} className="flex items-start gap-2 text-sm">
                {ch.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber" />}
                <span>
                  <b>{ch.check}:</b> <span className="text-muted">{ch.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="card p-4">
        <div className="label mb-3">2. Correspondência de registros recíprocos</div>
        {m.isPending && <Loading />}
        {m.error && <ErrorBox error={m.error} />}
        {!m.data && !m.isPending && <Notice>Defina as tolerâncias e clique em “Cruzar registros”.</Notice>}
        {m.data && (
          <>
            <div className="mb-3 flex flex-wrap gap-2">
              <button className={`chip !py-1 ${!cls ? 'border-accent text-white' : 'border-line text-muted'}`} onClick={() => setCls('')}>
                todas
              </button>
              {Object.entries(CLS).map(([k, [l, tone]]) => (
                <button key={k} onClick={() => setCls(k)} className="rounded-md">
                  <Badge tone={cls === k ? tone : 'gray'}>
                    {l}: {fmtInt(m.data.totals[k] ?? 0)}
                  </Badge>
                </button>
              ))}
            </div>
            <div className="scroll-x max-h-[520px] overflow-y-auto">
              <table>
                <thead>
                  <tr>
                    <th>Registro</th>
                    <th>Data/hora</th>
                    <th>Alvo → interlocutor</th>
                    <th>Tipo</th>
                    <th className="text-right">Duração</th>
                    <th>Classe</th>
                    <th className="text-right">Δ tempo (s)</th>
                    <th className="text-right">Δ duração (s)</th>
                    <th>Correspondentes</th>
                  </tr>
                </thead>
                <tbody>
                  {m.data.items
                    .filter((r: any) => !cls || r.match_class === cls)
                    .map((r: any) => (
                      <tr key={r.id}>
                        <td className="font-mono text-xs">
                          #{r.id} <span className="text-faint">arq. #{r.file_id}</span>
                        </td>
                        <td className="text-xs whitespace-nowrap">{fmtDateTime(r.ts_local)}</td>
                        <td className="font-mono text-xs">
                          {fmtNumber(r.target_number)} → {fmtNumber(r.other_number)}
                        </td>
                        <td className="text-xs">{EVENT_TYPE_LABEL[r.event_type]}</td>
                        <td className="text-right text-xs">{r.duration_s ?? '—'}</td>
                        <td>
                          <Badge tone={CLS[r.match_class][1]}>{CLS[r.match_class][0]}</Badge>
                        </td>
                        <td className="text-right text-xs">{r.best_delta !== null ? Math.round(r.best_delta) : '—'}</td>
                        <td className="text-right text-xs">{r.best_dur_diff ?? '—'}</td>
                        <td>
                          {r.ids?.length ? (
                            <DrillLink caseId={c.id} filter={{ event_ids: [r.id, ...r.ids] }}>
                              {r.ids.length} registro(s)
                            </DrillLink>
                          ) : (
                            <span className="text-faint">nenhum</span>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <Criteria criteria={m.data.criteria} />
          </>
        )}
      </section>
    </div>
  )
}
