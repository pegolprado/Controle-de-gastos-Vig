import { ArrowRight, FlaskConical, Lock } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuth } from '../app/auth'
import { apath } from '../app/layout'
import { MODULES } from '../app/modules'
import { Progress } from '../components/ui'
import { loadDemo } from '../engine/demo'
import { getState, setState, useSession } from '../engine/session'
import { fmtInt } from '../lib/format'

export default function Dashboard() {
  const { me } = useAuth()
  const navigate = useNavigate()
  const s = useSession((x) => x)
  const [demo, setDemo] = useState<{ label: string; p: number } | null>(null)
  const done = s.imports.filter((i) => i.status === 'done')
  const events = done.filter((i) => i.kind === 'cdr').reduce((n, i) => n + i.rows_ok - i.rows_duplicate, 0)
  const cells = done.filter((i) => i.kind === 'erb_registry').reduce((n, i) => n + i.rows_ok, 0)
  const pendingAlerts = s.alerts.filter((a) => a.review_status === 'pendente').length
  const meta: Record<string, string> = {
    cases: s.files.length || s.targets.length ? s.meta.title : 'nenhum dado carregado nesta aba',
    import: `${fmtInt(done.length)} de ${fmtInt(s.files.length)} arquivos processados`,
    cdr: `${fmtInt(events)} registros normalizados`,
    erb: `${fmtInt(cells)} células em cadastros técnicos`,
    links: `${fmtInt(s.targets.length)} alvos informados`,
    timeline: `${fmtInt(events)} eventos em linha do tempo`,
    geo: `${fmtInt(cells)} células com cadastro`,
    stats: 'cálculos executados no seu navegador',
    reports: 'PDF, Excel e CSV',
    quality: `${fmtInt(pendingAlerts)} alertas aguardando revisão`,
    files: `${fmtInt(s.files.length)} arquivos na memória desta aba`,
    audit: 'nada é gravado no servidor',
  }
  const runDemo = async () => {
    if (getState().files.length && !confirm('A demonstração substitui os dados carregados nesta aba. Continuar?')) return
    try {
      await loadDemo((label, p) => {
        setDemo({ label, p })
        setState({ busy: p < 1 ? { label: `Demonstração: ${label}`, progress: p } : null })
      })
      toast.success('Análise de demonstração pronta.')
      navigate(apath())
    } catch (e: any) {
      setState({ busy: null })
      toast.error(`Falha ao gerar a demonstração: ${e?.message ?? e}`)
    } finally {
      setDemo(null)
    }
  }
  return (
    <div>
      <div className="mt-2 mb-10 text-center">
        <div className="font-mono text-xs tracking-[0.35em] text-faint">WORKSPACE INVESTIGATIVO</div>
        <div className="mt-2 font-mono text-[11px] tracking-[0.3em] text-gold">ANÁLISE • CONEXÕES • INTELIGÊNCIA</div>
        <p className="mt-3 text-sm text-muted">Olá, {me?.name}. Carregue os arquivos, consulte, exporte em Excel ou PDF — ao sair, tudo é apagado.</p>
        <p className="mx-auto mt-2 flex max-w-xl items-center justify-center gap-1.5 text-xs text-faint">
          <Lock className="h-3 w-3 text-teal" /> Os arquivos não saem do seu computador: leitura, cálculos e exportação acontecem nesta aba do navegador.
        </p>
      </div>
      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
        {MODULES.map((m) => {
          const to = m.inCase ? apath(m.path) : m.path
          return (
            <Link key={m.key} to={to} className="group card card-hover flex flex-col items-center border-accent/50 px-6 py-8 text-center">
              <div className="mb-5 grid h-14 w-14 place-items-center rounded-xl border border-line-2 bg-panel-2 text-accent transition-colors group-hover:border-accent/60 [&>svg]:h-6 [&>svg]:w-6">{m.icon}</div>
              <h2 className="text-3xl leading-tight font-bold text-white">{m.title}</h2>
              <p className="mt-4 text-sm leading-relaxed font-medium text-muted">{m.description}</p>
              <p className="mt-3 text-xs text-faint">{meta[m.key]}</p>
              <span className="mt-5 inline-flex items-center gap-2 font-mono text-sm text-faint group-hover:text-accent">
                Acessar <ArrowRight className="h-4 w-4" />
              </span>
            </Link>
          )
        })}
      </div>
      {s.files.length === 0 && (
        <div className="card mt-10 flex flex-col items-center gap-3 p-6 text-center">
          <FlaskConical className="h-6 w-6 text-amber" />
          <div className="font-mono font-bold text-white">Quer conhecer a plataforma antes de usar dados reais?</div>
          <p className="max-w-2xl text-sm text-muted">
            Gere uma análise de DEMONSTRAÇÃO com três bilhetagens sintéticas em layouts diferentes, cadastro de ERB com inconsistências propositais, alertas e duplicidades. Tudo é gerado no seu navegador e apagado ao sair.
          </p>
          {demo ? (
            <div className="w-full max-w-md">
              <Progress value={demo.p} />
              <div className="mt-1 text-xs text-faint">{demo.label}</div>
            </div>
          ) : (
            <button className="btn-ghost" onClick={runDemo}>
              Gerar análise de demonstração
            </button>
          )}
        </div>
      )}
    </div>
  )
}
