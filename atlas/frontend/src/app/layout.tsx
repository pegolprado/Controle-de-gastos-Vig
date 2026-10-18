import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Activity, FolderKanban, LayoutGrid, LogOut, Menu, Settings, Shield, Users, Wrench, X } from 'lucide-react'
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api/client'
import { DemoBanner, ErrorBox, Field, Loading, Modal } from '../components/ui'
import { ROLE_LABEL, useAuth } from './auth'

function NavItem({ to, icon, children, onClick, end }: { to: string; icon: ReactNode; children: ReactNode; onClick?: () => void; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      className={({ isActive }) =>
        clsx('flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors', isActive ? 'bg-accent/15 text-white' : 'text-muted hover:bg-white/[0.04] hover:text-text')
      }
    >
      <span className="[&>svg]:h-4 [&>svg]:w-4">{icon}</span>
      {children}
    </NavLink>
  )
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { me, logout } = useAuth()
  const recent = useQuery({ queryKey: ['cases'], queryFn: () => api<any[]>('/cases'), enabled: !!me })
  return (
    <div className="flex h-full flex-col gap-1 p-4">
      <Link to="/" onClick={onNavigate} className="mb-5 flex items-center gap-3 px-2">
        <img src="/icon-192.png" alt="" className="h-11 w-11 rounded-xl" />
        <div>
          <div className="text-lg leading-tight font-bold tracking-wide text-white">
            MAR<span className="text-gold">X</span>
          </div>
          <div className="font-mono text-[10px] tracking-[0.25em] text-gold">INTELLIGENCE PRO</div>
        </div>
      </Link>
      <NavItem to="/" end icon={<LayoutGrid />} onClick={onNavigate}>
        Workspace
      </NavItem>
      <NavItem to="/ferramentas" icon={<Wrench />} onClick={onNavigate}>
        Catálogo de ferramentas
      </NavItem>
      <NavItem to="/casos" end icon={<FolderKanban />} onClick={onNavigate}>
        Central de casos
      </NavItem>
      <NavItem to="/auditoria" icon={<Activity />} onClick={onNavigate}>
        Auditoria
      </NavItem>
      {me?.role === 'admin' && (
        <>
          <div className="mt-4 mb-1 px-3 font-mono text-[10px] tracking-widest text-faint uppercase">Administração</div>
          <NavItem to="/admin/usuarios" icon={<Users />} onClick={onNavigate}>
            Usuários e permissões
          </NavItem>
          <NavItem to="/admin/operacao" icon={<Shield />} onClick={onNavigate}>
            Monitoramento operacional
          </NavItem>
        </>
      )}
      {recent.data && recent.data.length > 0 && (
        <>
          <div className="mt-4 mb-1 px-3 font-mono text-[10px] tracking-widest text-faint uppercase">Casos recentes</div>
          {recent.data.slice(0, 5).map((c) => (
            <NavLink
              key={c.id}
              to={`/casos/${c.id}`}
              onClick={onNavigate}
              className={({ isActive }) => clsx('truncate rounded-lg px-3 py-1.5 text-xs', isActive ? 'text-white' : 'text-muted hover:text-text')}
            >
              <span className="font-mono text-faint">{c.code}</span> {c.title}
            </NavLink>
          ))}
        </>
      )}
      <div className="mt-auto space-y-1 border-t border-line pt-4">
        <NavItem to="/configuracoes" icon={<Settings />} onClick={onNavigate}>
          Configurações
        </NavItem>
        <div className="px-3 py-2 text-xs">
          <div className="truncate text-text">{me?.name}</div>
          <div className="truncate text-faint">
            {me?.email} · {ROLE_LABEL[me?.role ?? ''] ?? me?.role}
          </div>
        </div>
        <button onClick={logout} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted hover:bg-white/[0.04] hover:text-text">
          <LogOut className="h-4 w-4" /> Sair
        </button>
      </div>
    </div>
  )
}

export function Shell() {
  const [open, setOpen] = useState(false)
  const loc = useLocation()
  useEffect(() => setOpen(false), [loc.pathname])
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 overflow-y-auto border-r border-line bg-ink/80 lg:block">
        <Sidebar />
      </aside>
      <button
        className="fixed top-4 left-4 z-[900] grid h-12 w-12 place-items-center rounded-full border border-line-2 bg-panel/90 text-text shadow-lg backdrop-blur lg:hidden"
        onClick={() => setOpen(true)}
        aria-label="Abrir menu"
      >
        <Menu className="h-5 w-5" />
      </button>
      {open && (
        <div className="fixed inset-0 z-[950] bg-black/60 lg:hidden" onClick={() => setOpen(false)}>
          <aside className="h-full w-72 overflow-y-auto border-r border-line bg-ink" onClick={(e) => e.stopPropagation()}>
            <button className="absolute top-4 left-60 rounded-lg p-1 text-muted" onClick={() => setOpen(false)} aria-label="Fechar menu">
              <X className="h-5 w-5" />
            </button>
            <Sidebar onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
      <main className="min-w-0 flex-1 px-4 pt-20 pb-16 sm:px-6 lg:px-10 lg:pt-8">
        <div className="mx-auto max-w-7xl">
          <Outlet />
        </div>
      </main>
    </div>
  )
}

// ------------------------------------------------------------------ caso

export type CaseData = {
  id: number
  code: string
  title: string
  my_role: 'analyst' | 'reviewer' | 'viewer'
  can_export: boolean
  is_demo: boolean
  status: string
  period_start: string | null
  period_end: string | null
  require_justification: boolean
  stats: Record<string, number>
  [k: string]: any
}

type CaseCtx = { c: CaseData; canWrite: boolean; canReview: boolean; meta?: any }
const CaseContext = createContext<CaseCtx | null>(null)
export function useCase() {
  const v = useContext(CaseContext)
  if (!v) throw new Error('useCase fora de um caso')
  return v
}

const CASE_NAV = [
  ['', 'Visão geral'],
  ['alvos', 'Alvos'],
  ['arquivos', 'Arquivos'],
  ['importacoes', 'Importações'],
  ['qualidade', 'Qualidade'],
  ['eventos', 'Eventos'],
  ['contatos', 'Contatos'],
  ['comparar', 'Comparar'],
  ['vinculos', 'Vínculos'],
  ['erb', 'ERB'],
  ['mapa', 'Mapa'],
  ['linha-do-tempo', 'Linha do tempo'],
  ['estatistica', 'Estatística'],
  ['cruzamento', 'Cruzamento'],
  ['alertas', 'Alertas'],
  ['relatorios', 'Relatórios'],
  ['assistente', 'Assistente'],
  ['membros', 'Membros'],
] as const

function JustificationGate({ caseId, onDone }: { caseId: string; onDone: () => void }) {
  const [text, setText] = useState('')
  const [err, setErr] = useState<unknown>(null)
  const navigate = useNavigate()
  return (
    <Modal open title="Justificativa de acesso exigida" onClose={() => navigate('/casos')}>
      <p className="mb-3 text-sm text-muted">Este caso exige o registro de uma justificativa antes do acesso. Ela fica na trilha de auditoria e vale por 12 horas.</p>
      <Field label="Justificativa">
        <textarea className="w-full" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      {err ? <div className="mt-2"><ErrorBox error={err} /></div> : null}
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-ghost" onClick={() => navigate('/casos')}>
          Voltar
        </button>
        <button
          className="btn-primary"
          disabled={text.trim().length < 10}
          onClick={async () => {
            try {
              await api(`/cases/${caseId}/justification`, { body: { justification: text } })
              onDone()
            } catch (e) {
              setErr(e)
            }
          }}
        >
          Registrar e acessar
        </button>
      </div>
    </Modal>
  )
}

export function CaseLayout() {
  const { caseId } = useParams()
  const q = useQuery({ queryKey: ['case', caseId], queryFn: () => api<CaseData>(`/cases/${caseId}`), retry: false })
  const meta = useQuery({ queryKey: ['meta', caseId], queryFn: () => api(`/cases/${caseId}/meta`), enabled: !!q.data })
  if (q.isLoading) return <Loading />
  if (q.error) {
    const status = (q.error as any).status
    if (status === 428) return <JustificationGate caseId={caseId!} onDone={() => q.refetch()} />
    return <ErrorBox error={q.error} />
  }
  const c = q.data!
  const ctx: CaseCtx = { c, canWrite: c.my_role === 'analyst' && !['arquivado', 'encerrado'].includes(c.status), canReview: c.my_role !== 'viewer', meta: meta.data }
  return (
    <CaseContext.Provider value={ctx}>
      <DemoBanner show={c.is_demo} />
      <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <Link to="/casos" className="text-faint hover:text-text">
          Casos
        </Link>
        <span className="text-faint">/</span>
        <Link to={`/casos/${c.id}`} className="font-mono text-accent">
          {c.code}
        </Link>
        <span className="truncate text-text">{c.title}</span>
        <span className="ml-auto text-xs text-faint">
          seu papel: <b className="text-muted">{ROLE_LABEL[c.my_role]}</b>
          {c.can_export ? ' · exportação permitida' : ''}
        </span>
      </div>
      <nav className="scroll-x -mx-1 mb-6 flex gap-1 border-b border-line pb-px" aria-label="Módulos do caso">
        {CASE_NAV.map(([path, label]) => (
          <NavLink
            key={path}
            end={path === ''}
            to={`/casos/${c.id}${path ? '/' + path : ''}`}
            className={({ isActive }) =>
              clsx('shrink-0 border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors', isActive ? 'border-accent text-white' : 'border-transparent text-muted hover:text-text')
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </CaseContext.Provider>
  )
}
