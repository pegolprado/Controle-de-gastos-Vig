import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Database } from 'lucide-react'
import { useState } from 'react'
import { registry } from '../../engine/analytics'
import { useCase } from '../../app/layout'
import { Badge, DrillLink, Empty, ErrorBox, Loading, PageHeader, Pagination } from '../../components/ui'
import { fmtDate, fmtInt } from '../../lib/format'

export default function Registry() {
  const { c } = useCase()
  const [qtext, setQ] = useState('')
  const [version, setVersion] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const params = new URLSearchParams({ page: String(page), size: '50' })
  if (qtext) params.set('q', qtext)
  if (version) params.set('version_id', version)
  if (status) params.set('status', status)
  const q = useQuery({ queryKey: ['registry', c.id, params.toString()], queryFn: () => registry(qtext || null, version ? +version : null, status || null, page, 50) as Promise<any>, placeholderData: keepPreviousData })
  return (
    <div>
      <PageHeader
        icon={<Database className="h-5 w-5" />}
        title="Cadastro técnico de células"
        subtitle="Linhas dos cadastros de ERB importados, por versão. Cada cadastro carregado cria uma versão, sem apagar as anteriores; cada resolução registra a versão usada."
      />
      {q.data && (
        <div className="mb-4 grid gap-3 md:grid-cols-3">
          {q.data.versions.map((v: any) => (
            <div key={v.id} className="card p-4 text-sm">
              <div className="font-mono text-xs text-accent">versão #{v.id}</div>
              <div className="font-medium text-white">{v.name}</div>
              <div className="text-xs text-muted">
                {v.operator ?? 'operadora no arquivo'} · referência {v.reference_date ? fmtDate(v.reference_date) : 'não informada'} · {fmtInt(v.rows)} células
              </div>
              {v.sha256 && <div className="mt-1 font-mono text-[10px] text-faint">{v.original_name} · {v.sha256.slice(0, 16)}…</div>}
            </div>
          ))}
        </div>
      )}
      <div className="card mb-4 flex flex-wrap gap-3 p-4">
        <input className="min-w-64 flex-1" placeholder="Buscar por chave, CI/ECI, CGI, estação ou endereço…" value={qtext} onChange={(e) => (setQ(e.target.value), setPage(1))} />
        <select value={version} onChange={(e) => (setVersion(e.target.value), setPage(1))}>
          <option value="">todas as versões</option>
          {(q.data?.versions ?? []).map((v: any) => (
            <option key={v.id} value={v.id}>
              #{v.id} {v.name}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))}>
          <option value="">todas as situações</option>
          {['ok', 'verificar', 'conflito', 'coordenada_invalida', 'sem_coordenada'].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : q.data.total === 0 ? (
        <Empty title="Cadastro vazio">Importe um cadastro técnico em “Arquivos”, escolhendo o tipo “Cadastro técnico de ERB”.</Empty>
      ) : (
        <div className="card scroll-x p-3">
          <table>
            <thead>
              <tr>
                <th>Chave</th>
                <th>Operadora</th>
                <th>Tec.</th>
                <th>MCC/MNC</th>
                <th>LAC/TAC</th>
                <th>CI/ECI/NCI</th>
                <th>Estação</th>
                <th>Coordenadas</th>
                <th>Az./abertura</th>
                <th>Versão</th>
                <th>Validação</th>
                <th className="text-right">Eventos</th>
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((x: any) => (
                <tr key={x.id}>
                  <td className="font-mono text-[11px] break-all">{x.cell_key}</td>
                  <td className="text-xs">{x.operator ?? '—'}</td>
                  <td className="text-xs">{x.tech ?? '—'}</td>
                  <td className="font-mono text-xs">
                    {x.mcc ?? '?'}/{x.mnc ?? '?'}
                  </td>
                  <td className="font-mono text-xs">{x.lac ?? x.tac ?? '—'}</td>
                  <td className="font-mono text-xs">{x.cell_id ?? x.eci ?? x.nci ?? '—'}</td>
                  <td className="text-xs">
                    {x.site_name}
                    {x.site_code && <div className="font-mono text-faint">{x.site_code}</div>}
                  </td>
                  <td className="font-mono text-xs">{x.lat !== null ? `${x.lat.toFixed(5)}, ${x.lon.toFixed(5)}` : '—'}</td>
                  <td className="text-xs">
                    {x.azimuth ?? '—'}° / {x.beamwidth ?? '—'}°
                  </td>
                  <td className="text-xs">#{x.version_id}</td>
                  <td>
                    <Badge tone={x.validation_status === 'ok' ? 'green' : x.validation_status === 'conflito' ? 'red' : 'amber'}>{x.validation_status}</Badge>
                  </td>
                  <td className="text-right tabular-nums">{x.events ? <DrillLink caseId={c.id} filter={{ cell_keys: [x.cell_key] }}>{fmtInt(x.events)}</DrillLink> : 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={page} size={50} total={q.data.total} onPage={setPage} />
        </div>
      )}
    </div>
  )
}
