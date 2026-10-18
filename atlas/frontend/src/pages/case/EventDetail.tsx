import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, FileSearch, Pencil } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { eventDetail } from '../../engine/analytics'
import { correctEvent, correctionsFor } from '../../engine/corrections'
import { useCase } from '../../app/layout'
import { Badge, DrillLink, ErrorBox, Field, Loading, Modal, Notice, PageHeader } from '../../components/ui'
import { EVENT_TYPE_LABEL, fmtDateTime, fmtDuration, fmtNumber, RESOLUTION_LABEL, TZ_LABEL } from '../../lib/format'

const FIELDS: [string, string][] = [
  ['event_type', 'Tipo de evento'],
  ['direction', 'Sentido (out/in/unknown)'],
  ['a_number', 'Número de origem'],
  ['b_number', 'Número de destino'],
  ['target_number', 'Número alvo'],
  ['other_number', 'Interlocutor'],
  ['duration_s', 'Duração (s)'],
  ['ts_local', 'Data/hora (AAAA-MM-DDTHH:MM:SS)'],
  ['status', 'Status'],
]

export default function EventDetail() {
  const { c, canWrite } = useCase()
  const { eventId } = useParams()
  const navigate = useNavigate()
  const q = useQuery({ queryKey: ['event', eventId], queryFn: async () => ({ ...(await eventDetail(+eventId!)), corrections: correctionsFor(+eventId!) }) as any })
  const [corr, setCorr] = useState<{ field: string; value: string; reason: string } | null>(null)
  const [err, setErr] = useState<unknown>(null)
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  const { event: e, file, cell, candidates, corrections } = q.data
  const row = (label: string, value: React.ReactNode) => (
    <div className="grid grid-cols-[170px_1fr] gap-2 border-b border-line/50 py-1.5 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="break-all">{value ?? <span className="text-faint">indisponível</span>}</dd>
    </div>
  )
  return (
    <div>
      <button className="btn-ghost mb-4 !py-1 text-xs" onClick={() => navigate(-1)}>
        <ArrowLeft className="h-4 w-4" /> Voltar
      </button>
      <PageHeader
        icon={<FileSearch className="h-5 w-5" />}
        title={`Registro #${e.id}`}
        subtitle={`${EVENT_TYPE_LABEL[e.event_type] ?? e.event_type} · ${fmtDateTime(e.ts_local)} (${TZ_LABEL[e.tz_status]}${e.tz_name ? ` · ${e.tz_name}` : ''})`}
        actions={
          canWrite && (
            <button className="btn-ghost" onClick={() => setCorr({ field: 'duration_s', value: '', reason: '' })}>
              <Pencil className="h-4 w-4" /> Registrar correção
            </button>
          )
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {e.is_duplicate && (
          <Badge tone="gray">
            duplicado do registro{' '}
            <DrillLink caseId={c.id} filter={{ event_ids: [e.duplicate_of], include_duplicates: true, include_out_of_scope: true }}>
              #{e.duplicate_of}
            </DrillLink>
          </Badge>
        )}
        {e.out_of_scope && <Badge tone="amber">fora do período autorizado</Badge>}
        {e.revision > 0 && <Badge tone="violet">revisão {e.revision}</Badge>}
        {e.confidence < 1 && <Badge tone="amber">confiança {Math.round(e.confidence * 100)}%</Badge>}
      </div>
      {e.warnings?.length > 0 && (
        <div className="mb-4 space-y-1">
          {e.warnings.map((w: string, i: number) => (
            <Notice key={i} tone="amber">
              {w}
            </Notice>
          ))}
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="section-title mb-3 text-accent">Valores normalizados</h2>
          <dl>
            {row('Alvo', fmtNumber(e.target_number))}
            {row('Interlocutor', fmtNumber(e.other_number))}
            {row('Origem (A)', e.a_number ? `${fmtNumber(e.a_number)}  ←  “${e.a_raw ?? ''}”` : null)}
            {row('Destino (B)', e.b_number ? `${fmtNumber(e.b_number)}  ←  “${e.b_raw ?? ''}”` : null)}
            {row('Sentido', e.direction)}
            {row('Data/hora no documento', fmtDateTime(e.ts_local))}
            {row('Data/hora UTC', e.ts_utc ? fmtDateTime(e.ts_utc.slice(0, 19)) + ' UTC' : null)}
            {row('Texto original de data/hora', e.ts_original)}
            {row('Duração', e.duration_s !== null ? `${fmtDuration(e.duration_s)} (${e.duration_s} s)` : null)}
            {row('Status', e.status)}
            {row('Operadora declarada', e.operator)}
            {row('Tecnologia', e.tech)}
            {row('MCC / MNC', e.mcc || e.mnc ? `${e.mcc ?? '?'} / ${e.mnc ?? '?'}` : null)}
            {row('LAC / TAC', e.lac || e.tac ? `${e.lac ?? '—'} / ${e.tac ?? '—'}` : null)}
            {row('CI / ECI / NCI', e.cell_id || e.eci || e.nci ? `${e.cell_id ?? '—'} / ${e.eci ?? '—'} / ${e.nci ?? '—'}` : null)}
            {row('CGI', e.cgi)}
            {row('ERB informada', e.erb_raw)}
            {row('Chave de célula', e.cell_key)}
            {row('Coordenadas no documento', e.lat !== null ? `${e.lat}, ${e.lon}${e.azimuth !== null ? ` · azimute ${e.azimuth}°` : ''}` : null)}
            {row('IMEI / IMSI', e.imei || e.imsi ? `${e.imei ?? '—'} / ${e.imsi ?? '—'}` : null)}
            {row('IP / volume', e.ip ? `${e.ip}${e.bytes_up !== null ? ` · ↑${e.bytes_up} ↓${e.bytes_down}` : ''}` : null)}
          </dl>
        </section>
        <div className="space-y-6">
          <section className="card p-5">
            <h2 className="section-title mb-3 text-teal">Origem verificável</h2>
            <dl>
              {row('Arquivo', `#${file.id} ${file.name}`)}
              {row('Formato', file.format)}
              {row('SHA-256 do arquivo', <span className="font-mono text-xs">{file.sha256}</span>)}
              {row('Linha / página', `${e.row_number ?? '—'}${e.page ? ` / página ${e.page}` : ''}`)}
              {row('Importação', `#${e.import_id}`)}
            </dl>
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-muted">Valores originais da linha (como recebidos)</summary>
              <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-ink-2 p-3 font-mono text-xs whitespace-pre-wrap">{JSON.stringify(e.raw, null, 2)}</pre>
            </details>
          </section>
          <section className="card p-5">
            <h2 className="section-title mb-3 text-amber">Resolução de ERB</h2>
            {e.resolution_status ? (
              <>
                <div className="mb-2 flex gap-2">
                  <Badge tone={e.resolution_status === 'exact' ? 'green' : e.resolution_status === 'none' ? 'red' : 'amber'}>{RESOLUTION_LABEL[e.resolution_status]}</Badge>
                  <Badge>{e.resolution_rule}</Badge>
                  {e.resolution_manual && <Badge tone="violet">manual</Badge>}
                </div>
                {e.resolution_note && <p className="mb-2 text-sm text-muted">{e.resolution_note}</p>}
                {cell && (
                  <dl>
                    {row('Estação', `${cell.site_name ?? ''} ${cell.site_code ? `(${cell.site_code})` : ''}`)}
                    {row('Coordenadas da estação', cell.lat !== null ? `${cell.lat}, ${cell.lon}` : 'sem coordenada válida no cadastro')}
                    {row('Azimute / abertura', cell.azimuth !== null ? `${cell.azimuth}° / ${cell.beamwidth ?? '—'}°` : null)}
                    {row('Versão do cadastro', `#${cell.version_id}`)}
                  </dl>
                )}
                {candidates.length > 0 && !cell && (
                  <div className="mt-2 text-sm">
                    <div className="label">Candidatos</div>
                    {candidates.map((x: any) => (
                      <div key={x.id} className="font-mono text-xs text-muted">
                        #{x.id} {x.cell_key} · {x.site_name} · {x.lat}, {x.lon} (versão {x.version_id})
                      </div>
                    ))}
                  </div>
                )}
                <p className="mt-3 text-xs text-faint">A ERB registrada não comprova a posição exata do aparelho ou da pessoa.</p>
              </>
            ) : (
              <p className="text-sm text-muted">Resolução ainda não executada.</p>
            )}
          </section>
          {corrections.length > 0 && (
            <section className="card p-5">
              <h2 className="section-title mb-3 text-violet">Histórico de correções</h2>
              {corrections.map((x: any) => (
                <div key={x.id} className="border-b border-line/50 py-2 text-sm">
                  <div>
                    Revisão {x.revision}: <b>{x.field}</b> “{x.old ?? '∅'}” → “{x.new ?? '∅'}”
                  </div>
                  <div className="text-xs text-faint">
                    {fmtDateTime(x.at.slice(0, 19))} · {x.reason}
                  </div>
                </div>
              ))}
              <p className="mt-2 text-xs text-faint">Arquivos já exportados não são alterados por correções posteriores; as correções valem só nesta sessão.</p>
            </section>
          )}
        </div>
      </div>
      <Modal open={!!corr} onClose={() => setCorr(null)} title="Registrar correção">
        {corr && (
          <div className="space-y-3">
            <Notice>O valor anterior é preservado no histórico e o valor original da linha não é alterado.</Notice>
            <Field label="Campo">
              <select className="w-full" value={corr.field} onChange={(ev) => setCorr({ ...corr, field: ev.target.value })}>
                {FIELDS.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Novo valor" hint={`Atual: ${e[corr.field] ?? '∅'}`}>
              {corr.field === 'event_type' ? (
                <select className="w-full" value={corr.value} onChange={(ev) => setCorr({ ...corr, value: ev.target.value })}>
                  <option value="">—</option>
                  {Object.entries(EVENT_TYPE_LABEL).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              ) : (
                <input className="w-full" value={corr.value} onChange={(ev) => setCorr({ ...corr, value: ev.target.value })} />
              )}
            </Field>
            <Field label="Justificativa">
              <textarea className="w-full" rows={2} value={corr.reason} onChange={(ev) => setCorr({ ...corr, reason: ev.target.value })} />
            </Field>
            {err ? <ErrorBox error={err} /> : null}
            <button
              className="btn-primary w-full"
              onClick={async () => {
                try {
                  await correctEvent(e.id, corr.field, corr.value || null, corr.reason)
                  toast.success('Correção aplicada nesta sessão')
                  setCorr(null)
                } catch (x) {
                  setErr(x)
                }
              }}
            >
              Salvar correção
            </button>
          </div>
        )}
      </Modal>
    </div>
  )
}
