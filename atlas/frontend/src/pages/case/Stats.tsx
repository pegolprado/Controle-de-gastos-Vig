import { useQuery } from '@tanstack/react-query'
import { BarChart3 } from 'lucide-react'
import { useState } from 'react'
import { patterns, summary } from '../../engine/analytics'
import { useCase } from '../../app/layout'
import { BarsChart } from '../../components/charts'
import { FilterBar } from '../../components/FilterBar'
import { Badge, Criteria, DrillLink, ErrorBox, Field, Loading, Notice, PageHeader, Stat } from '../../components/ui'
import { fmtDate, fmtDateTime, fmtDuration, fmtInt, fmtNumber, WEEKDAYS } from '../../lib/format'
import { useUrlFilter } from '../../lib/useUrlFilter'

export default function Stats() {
  const { c } = useCase()
  const [f, setF] = useUrlFilter()
  const [z, setZ] = useState(2.5)
  const s = useQuery({ queryKey: ['summary', c.id, f], queryFn: () => summary(f) as Promise<any> })
  const p = useQuery({ queryKey: ['patterns', c.id, f, z], queryFn: () => patterns(f, z) as Promise<any> })
  const t = s.data?.totals
  return (
    <div>
      <PageHeader
        icon={<BarChart3 className="h-5 w-5" />}
        title="Análise estatística e padrões"
        subtitle="Indicadores, distribuições e detecção de padrões com o método explicitado. Padrões indicam pontos para revisão humana, não conclusões."
      />
      <FilterBar value={f} onChange={setF} />
      {s.isLoading ? (
        <Loading />
      ) : s.error ? (
        <ErrorBox error={s.error} />
      ) : (
        <>
          <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Eventos" value={<DrillLink caseId={c.id} filter={f}>{fmtInt(t.events)}</DrillLink>} hint={`${fmtInt(t.active_days)} dias com atividade`} />
            <Stat label="Chamadas" value={fmtInt(t.calls)} hint={`${fmtInt(t.zero_duration_calls)} sem duração · originadas ${fmtInt(t.outgoing)} / recebidas ${fmtInt(t.incoming)}`} />
            <Stat label="Duração total / média / mediana" value={<span className="text-lg">{fmtDuration(t.call_seconds)}</span>} hint={`média ${fmtDuration(t.call_avg)} · mediana ${fmtDuration(t.call_median)} (chamadas > 0 s)`} />
            <Stat label="Intervalo entre eventos" value={<span className="text-lg">{fmtDuration(s.data.intervals_s.median_gap)}</span>} hint={`mediana · máximo ${fmtDuration(s.data.intervals_s.max_gap)}`} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <BarsChart title="Eventos por hora do dia" data={s.data.by_hour} x="hour" xFmt={(h) => `${h}h`} series={[{ key: 'n', name: 'Eventos' }]} />
            <BarsChart title="Eventos por dia da semana" data={s.data.by_weekday} x="weekday" xFmt={(d) => WEEKDAYS[d]} series={[{ key: 'n', name: 'Eventos' }]} />
          </div>
          <div className="mt-4">
            <BarsChart title="Evolução diária" data={s.data.by_day} x="day" xFmt={(d) => fmtDate(d).slice(0, 5)} series={[{ key: 'calls', name: 'Chamadas' }, { key: 'sms', name: 'SMS' }, { key: 'data', name: 'Dados' }]} />
          </div>
          <div className="card mt-4 grid gap-3 p-4 md:grid-cols-[1fr_auto]">
            <div className="text-sm text-muted">
              Tipos: {s.data.by_type.map((x: any) => `${x.label} ${fmtInt(x.n)}`).join(' · ')}. Fontes: {s.data.sources.map((x: any) => `#${x.id} ${x.original_name} (${fmtInt(x.n)})`).join(' · ')}.
            </div>
          </div>
          <Criteria criteria={s.data.criteria} />
        </>
      )}
      <h2 className="section-title mt-10 mb-4 text-violet">Detecção de padrões</h2>
      <div className="card mb-4 flex items-end gap-4 p-4">
        <Field label="Limiar de anomalia (|z|)">
          <input type="number" step={0.5} min={1} max={6} className="w-24" value={z} onChange={(e) => setZ(+e.target.value)} />
        </Field>
      </div>
      {p.isLoading ? (
        <Loading />
      ) : p.error ? (
        <ErrorBox error={p.error} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card p-4">
            <div className="label mb-2">Picos por hora (z ≥ 1,5)</div>
            <p className="mb-2 text-xs text-faint">
              média {p.data.stats.hour_mean}/hora · desvio {p.data.stats.hour_sd}
            </p>
            {p.data.hour_peaks.map((h: any) => (
              <div key={h.hour} className="flex justify-between border-b border-line/50 py-1 text-sm">
                <DrillLink caseId={c.id} filter={{ ...f, hour_from: h.hour, hour_to: h.hour }}>
                  {h.hour}h
                </DrillLink>
                <span>
                  {h.n} eventos <Badge tone="violet">z {h.z}</Badge>
                </span>
              </div>
            ))}
          </div>
          <div className="card p-4">
            <div className="label mb-2">Dias atípicos (|z| ≥ {z})</div>
            <p className="mb-2 text-xs text-faint">
              média {p.data.stats.day_mean}/dia · desvio {p.data.stats.day_sd}
            </p>
            {p.data.day_anomalies.length === 0 && <div className="text-sm text-muted">Nenhum.</div>}
            {p.data.day_anomalies.map((d: any) => (
              <div key={d.day} className="flex justify-between border-b border-line/50 py-1 text-sm">
                <DrillLink caseId={c.id} filter={{ ...f, date_from: `${d.day}T00:00:00`, date_to: `${d.day}T23:59:59` }}>
                  {fmtDate(d.day)}
                </DrillLink>
                <span>
                  {d.n} eventos <Badge tone={d.z > 0 ? 'amber' : 'blue'}>z {d.z}</Badge>
                </span>
              </div>
            ))}
          </div>
          <div className="card p-4">
            <div className="label mb-2">Variação semanal (eventos e contatos distintos)</div>
            <table>
              <thead>
                <tr>
                  <th>Semana</th>
                  <th className="text-right">Eventos</th>
                  <th className="text-right">Contatos</th>
                </tr>
              </thead>
              <tbody>
                {p.data.weekly.map((w: any) => (
                  <tr key={w.week}>
                    <td>{fmtDate(w.week)}</td>
                    <td className="text-right">{w.events}</td>
                    <td className="text-right">{w.contacts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card p-4">
            <div className="label mb-2">Intervalos incomuns entre eventos</div>
            {p.data.unusual_intervals.map((u: any) => (
              <div key={u.id} className="flex justify-between border-b border-line/50 py-1 text-sm">
                <span>
                  <span className="font-mono text-xs">{fmtNumber(u.target_number)}</span> antes de {fmtDateTime(u.ts_local, false)}
                </span>
                <Badge tone="amber">{fmtDuration(u.gap_s)}</Badge>
              </div>
            ))}
            {p.data.days_without_events.length > 0 && (
              <p className="mt-3 text-xs text-muted">
                Dias sem registros dentro do intervalo observado: {p.data.days_without_events.slice(0, 20).map(fmtDate).join(', ')}
                {p.data.days_without_events.length > 20 ? '…' : ''}
              </p>
            )}
          </div>
          <div className="lg:col-span-2">
            <Notice tone="amber">Estatísticas não classificam pessoas como suspeitas. Use os padrões para orientar a conferência dos registros de origem.</Notice>
            <Criteria criteria={p.data.criteria} />
          </div>
        </div>
      )}
    </div>
  )
}
