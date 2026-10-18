import { useQuery } from '@tanstack/react-query'
import { FolderKanban, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../app/auth'
import { Badge, Empty, ErrorBox, Loading, Notice, PageHeader } from '../components/ui'
import { fmtDate, fmtInt } from '../lib/format'
import { useCurrentCase } from './Catalog'

export const STATUS_LABEL: Record<string, string> = {
  aberto: 'Aberto',
  em_analise: 'Em análise',
  em_revisao: 'Em revisão',
  concluido: 'Concluído',
  arquivado: 'Arquivado',
  encerrado: 'Encerrado',
}

export default function Cases() {
  const { me } = useAuth()
  const q = useQuery({ queryKey: ['cases'], queryFn: () => api<any[]>('/cases') })
  const [sp] = useSearchParams()
  const abrir = sp.get('abrir')
  const [, setCurrent] = useCurrentCase()
  const navigate = useNavigate()
  const [text, setText] = useState('')
  const canCreate = me && ['admin', 'analyst'].includes(me.role)
  const rows = (q.data ?? []).filter((c) => !text || `${c.code} ${c.title} ${c.process_number ?? ''} ${c.unit ?? ''}`.toLowerCase().includes(text.toLowerCase()))
  return (
    <div>
      <PageHeader
        icon={<FolderKanban className="h-5 w-5" />}
        title="Central de casos"
        subtitle="Cada caso isola seus arquivos, registros, cadastros de ERB, análises, relatórios, histórico e usuários autorizados."
        actions={
          canCreate && (
            <Link to="/casos/novo" className="btn-primary">
              <Plus className="h-4 w-4" /> Novo caso
            </Link>
          )
        }
      />
      {abrir && <div className="mb-4"><Notice tone="amber">Escolha o caso para abrir o módulo selecionado.</Notice></div>}
      <input className="mb-4 w-full md:w-96" placeholder="Buscar por código, título, processo ou unidade…" value={text} onChange={(e) => setText(e.target.value)} />
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : rows.length === 0 ? (
        <Empty title="Nenhum caso acessível">{canCreate ? 'Crie um caso para começar ou gere um caso de demonstração no Workspace.' : 'Peça a um analista para incluí-lo como membro de um caso.'}</Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {rows.map((c) => (
            <button
              key={c.id}
              className="card card-hover p-5 text-left"
              onClick={() => {
                setCurrent({ id: c.id, code: c.code, title: c.title })
                navigate(`/casos/${c.id}${abrir ? '/' + abrir : ''}`)
              }}
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm text-accent">{c.code}</span>
                <Badge tone={c.status === 'aberto' || c.status === 'em_analise' ? 'blue' : 'gray'}>{STATUS_LABEL[c.status] ?? c.status}</Badge>
                {c.is_demo && <Badge tone="amber">DEMONSTRAÇÃO</Badge>}
                {c.require_justification && <Badge tone="red">exige justificativa</Badge>}
                <span className="ml-auto text-xs text-faint">papel: {c.my_role}</span>
              </div>
              <div className="text-lg font-bold text-white">{c.title}</div>
              <div className="mt-1 text-xs text-muted">
                {c.process_number && <>Processo {c.process_number} · </>}
                {c.unit && <>{c.unit} · </>}
                Período {c.period_start ? `${fmtDate(c.period_start)} a ${fmtDate(c.period_end)}` : 'não definido'}
              </div>
              <div className="mt-4 grid grid-cols-4 gap-2 text-center text-xs">
                {[
                  ['alvos', c.stats.targets],
                  ['arquivos', c.stats.files],
                  ['registros', c.stats.events],
                  ['alertas', c.stats.alerts_pending],
                ].map(([l, v]) => (
                  <div key={l as string} className="rounded-lg border border-line bg-ink-2 py-2">
                    <div className="text-base font-bold text-text tabular-nums">{fmtInt(v as number)}</div>
                    <div className="text-faint">{l}</div>
                  </div>
                ))}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
