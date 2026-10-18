import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, FlaskConical } from 'lucide-react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { api } from '../api/client'
import { useAuth } from '../app/auth'
import { MODULES } from '../app/modules'
import { ErrorBox, Loading } from '../components/ui'
import { fmtInt } from '../lib/format'
import { useCurrentCase } from './Catalog'

export default function Dashboard() {
  const { me } = useAuth()
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api('/dashboard') })
  const [current] = useCurrentCase()
  const qc = useQueryClient()
  const seed = useMutation({
    mutationFn: () => api('/demo/seed', { method: 'POST' }),
    onSuccess: () => {
      toast.success('Gerando caso de demonstração… ele aparecerá na Central de Casos em alguns segundos.')
      setTimeout(() => qc.invalidateQueries(), 4000)
    },
    onError: (e: any) => toast.error(e.message),
  })
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  const t = q.data.totals
  const meta: Record<string, string> = {
    cases: `${fmtInt(t.cases)} ${t.cases === 1 ? 'caso acessível' : 'casos acessíveis'} · ${fmtInt(t.cases_open)} em andamento`,
    import: `${fmtInt(t.files_processed)} de ${fmtInt(t.files)} arquivos processados · ${fmtInt(t.imports_pending)} importações pendentes`,
    cdr: `${fmtInt(t.events)} registros normalizados`,
    erb: `${fmtInt(t.erb_cells)} células em cadastros técnicos`,
    links: `${fmtInt(t.targets)} alvos cadastrados`,
    timeline: `${fmtInt(t.events)} eventos em linha do tempo`,
    geo: `${fmtInt(t.erb_cells)} células com cadastro`,
    stats: `${fmtInt(t.jobs_active)} tarefas em execução`,
    reports: `${fmtInt(t.reports)} relatórios emitidos`,
    quality: `${fmtInt(t.alerts_pending)} alertas aguardando revisão`,
    files: `${fmtInt(t.files)} arquivos preservados`,
    audit: 'trilha encadeada por hash',
  }
  return (
    <div>
      <div className="mt-2 mb-10 text-center">
        <div className="font-mono text-xs tracking-[0.35em] text-faint">WORKSPACE INVESTIGATIVO</div>
        <p className="mt-3 text-sm text-muted">
          Olá, {me?.name}.{' '}
          {current ? (
            <>
              Caso em foco: <Link className="font-mono text-accent" to={`/casos/${current.id}`}>{current.code}</Link> — {current.title}
            </>
          ) : (
            'Selecione um caso para abrir os módulos analíticos.'
          )}
        </p>
      </div>
      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
        {MODULES.map((m) => {
          const to = m.inCase ? (current ? `/casos/${current.id}/${m.path}` : `/casos?abrir=${m.path}`) : m.path
          return (
            <Link key={m.key} to={to} className="group card card-hover flex flex-col items-center border-accent/50 px-6 py-8 text-center">
              <div className="mb-5 grid h-14 w-14 place-items-center rounded-xl border border-line-2 bg-panel-2 text-accent transition-colors group-hover:border-accent/60 [&>svg]:h-6 [&>svg]:w-6">{m.icon}</div>
              <h2 className="text-3xl leading-tight font-bold text-white">{m.title}</h2>
              <p className="mt-4 text-sm leading-relaxed font-medium text-muted">{m.description}</p>
              <p className="mt-3 text-xs text-faint">{meta[m.key]}</p>
              <span className="mt-5 inline-flex items-center gap-2 font-mono text-sm text-faint group-hover:text-accent">
                {m.inCase && !current ? 'Escolher caso' : 'Acessar'} <ArrowRight className="h-4 w-4" />
              </span>
            </Link>
          )
        })}
      </div>
      {t.cases === 0 && me && ['admin', 'analyst'].includes(me.role) && (
        <div className="card mt-10 flex flex-col items-center gap-3 p-6 text-center">
          <FlaskConical className="h-6 w-6 text-amber" />
          <div className="font-mono font-bold text-white">Quer conhecer a plataforma antes de importar dados reais?</div>
          <p className="max-w-2xl text-sm text-muted">Gere um caso de DEMONSTRAÇÃO com três bilhetagens sintéticas em layouts diferentes, cadastro de ERB com inconsistências propositais, alertas e duplicidades. Ele fica separado dos casos reais e pode ser apagado a qualquer momento.</p>
          <button className="btn-ghost" disabled={seed.isPending} onClick={() => seed.mutate()}>
            Gerar caso de demonstração
          </button>
        </div>
      )}
    </div>
  )
}
