import clsx from 'clsx'
import { AlertTriangle, ChevronLeft, ChevronRight, Info, Loader2, X } from 'lucide-react'
import { type ReactNode, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { encodeFilter, fmtNumber } from '../lib/format'

export function PageHeader({ icon, title, subtitle, actions, badge }: { icon?: ReactNode; title: string; subtitle?: ReactNode; actions?: ReactNode; badge?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-col gap-4 border-b border-line pb-6 md:flex-row md:items-start md:justify-between">
      <div className="flex min-w-0 items-start gap-4">
        {icon && <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-accent/30 bg-accent/10 text-accent">{icon}</div>}
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-white md:text-3xl">{title}</h1>
          {subtitle && <div className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">{subtitle}</div>}
          {badge && <div className="mt-3">{badge}</div>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  )
}

const TONES = {
  blue: 'text-accent border-accent/40 bg-accent/10',
  teal: 'text-teal border-teal/40 bg-teal/10',
  amber: 'text-amber border-amber/40 bg-amber/10',
  red: 'text-danger border-danger/40 bg-danger/10',
  violet: 'text-violet border-violet/40 bg-violet/10',
  green: 'text-ok border-ok/40 bg-ok/10',
  gray: 'text-muted border-line-2 bg-white/[0.03]',
} as const
export type Tone = keyof typeof TONES

export function Badge({ tone = 'gray', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={clsx('chip', TONES[tone], className)}>{children}</span>
}

export function SectionHeader({ icon, title, tone = 'blue', count, unit = 'módulo', right }: { icon: ReactNode; title: string; tone?: Tone; count?: number; unit?: string; right?: ReactNode }) {
  const color = TONES[tone].split(' ')[0]
  return (
    <div className="mb-4 flex items-center justify-between gap-3 border-b border-line pb-3">
      <div className="flex items-center gap-3">
        <div className={clsx('grid h-10 w-10 place-items-center rounded-lg border', TONES[tone])}>{icon}</div>
        <h2 className={clsx('section-title', color)}>{title}</h2>
      </div>
      <div className="flex items-center gap-2">
        {right}
        {count !== undefined && (
          <Badge tone={tone}>
            {count} {count === 1 ? unit : unit + 's'}
          </Badge>
        )}
      </div>
    </div>
  )
}

export function ModuleCard({ title, description, to, tone = 'blue', meta, disabled }: { title: string; description: string; to: string; tone?: Tone; meta?: ReactNode; disabled?: boolean }) {
  const dot = { blue: 'bg-accent', teal: 'bg-teal', amber: 'bg-amber', red: 'bg-danger', violet: 'bg-violet', green: 'bg-ok', gray: 'bg-muted' }[tone]
  const inner = (
    <div className={clsx('card card-hover flex h-full flex-col p-6', disabled && 'opacity-60')}>
      <div className="mb-3 flex items-start gap-2.5">
        <span className={clsx('mt-2 h-2 w-2 shrink-0 rounded-full', dot)} />
        <h3 className="font-mono text-base font-bold text-white">{title}</h3>
      </div>
      <p className="text-justify text-sm leading-relaxed font-medium text-text/75 hyphens-auto" lang="pt-BR">
        {description}
      </p>
      {meta && <div className="mt-auto pt-4 text-xs text-faint">{meta}</div>}
    </div>
  )
  if (disabled) return inner
  return (
    <Link to={to} className="block h-full rounded-2xl">
      {inner}
    </Link>
  )
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone }) {
  return (
    <div className="card p-4">
      <div className="label">{label}</div>
      <div className={clsx('text-2xl font-bold tabular-nums', tone ? TONES[tone].split(' ')[0] : 'text-white')}>{value}</div>
      {hint && <div className="mt-1 text-xs text-faint">{hint}</div>}
    </div>
  )
}

export function Loading({ label = 'Carregando…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-10 text-sm text-muted" role="status">
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  )
}

export function Empty({ title = 'Nada por aqui ainda', children, icon }: { title?: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center justify-center gap-2 border-dashed px-6 py-12 text-center">
      {icon && <div className="text-faint">{icon}</div>}
      <div className="font-mono text-sm font-bold text-text">{title}</div>
      {children && <div className="max-w-lg text-sm text-muted">{children}</div>}
    </div>
  )
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : String(error)
  return (
    <div className="flex items-start gap-3 rounded-xl border border-danger/40 bg-danger/10 p-4 text-sm text-danger" role="alert">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex-1">{msg}</div>
      {onRetry && (
        <button className="btn-ghost !py-1 text-xs" onClick={onRetry}>
          Tentar de novo
        </button>
      )}
    </div>
  )
}

export function Notice({ children, tone = 'blue', title }: { children: ReactNode; tone?: Tone; title?: string }) {
  return (
    <div className={clsx('flex items-start gap-3 rounded-xl border p-3 text-sm', TONES[tone])}>
      <Info className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="text-text/90">
        {title && <div className="mb-0.5 font-semibold">{title}</div>}
        {children}
      </div>
    </div>
  )
}

/** Envolve estados de carregamento, erro e vazio de uma consulta. */
export function QueryState<T>({ q, empty, children }: { q: { isLoading: boolean; error: unknown; data?: T; refetch?: () => void }; empty?: (d: T) => boolean; children: (d: T) => ReactNode }) {
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} onRetry={q.refetch} />
  if (q.data === undefined) return null
  if (empty && empty(q.data)) return <Empty title="Nenhum resultado" >Ajuste os filtros ou carregue arquivos nesta análise.</Empty>
  return <>{children(q.data)}</>
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[1000] flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className={clsx('card mt-10 w-full p-5', wide ? 'max-w-5xl' : 'max-w-xl')} onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-mono text-base font-bold text-white">{title}</h2>
          <button className="rounded-lg p-1 text-muted hover:bg-white/5 hover:text-text" onClick={onClose} aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode }[] }) {
  return (
    <div className="mb-4 flex flex-wrap gap-1 rounded-xl border border-line bg-ink-2 p-1" role="tablist">
      {items.map((it) => (
        <button
          key={it.value}
          role="tab"
          aria-selected={value === it.value}
          onClick={() => onChange(it.value)}
          className={clsx('rounded-lg px-3 py-1.5 text-sm transition-colors', value === it.value ? 'bg-accent text-white' : 'text-muted hover:text-text')}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}

export function Field({ label, children, hint, className }: { label: string; children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <label className={clsx('block', className)}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-faint">{hint}</span>}
    </label>
  )
}

export function Pagination({ page, size, total, onPage }: { page: number; size: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size))
  return (
    <div className="flex items-center justify-between gap-2 pt-3 text-xs text-muted">
      <span>
        {total.toLocaleString('pt-BR')} registros · página {page} de {pages}
      </span>
      <div className="flex gap-1">
        <button className="btn-ghost !px-2 !py-1" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Página anterior">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button className="btn-ghost !px-2 !py-1" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Próxima página">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

/** Explicita filtros, regras e limites usados em um resultado. */
export function Criteria({ criteria }: { criteria?: Record<string, any> }) {
  if (!criteria) return null
  const { filters, rules_version, ...rest } = criteria
  const entries = Object.entries(rest).filter(([, v]) => v !== null && v !== undefined && v !== '')
  return (
    <details className="mt-4 rounded-xl border border-line bg-ink-2/60 p-3 text-xs text-muted">
      <summary className="cursor-pointer font-mono font-bold tracking-wider text-faint uppercase">Critérios, regras e limites deste resultado</summary>
      <dl className="mt-2 grid gap-1.5">
        <div>
          <dt className="inline font-semibold text-text/80">Filtros: </dt>
          <dd className="inline font-mono">{filters && Object.keys(filters).length ? JSON.stringify(filters) : 'nenhum filtro adicional'}</dd>
        </div>
        <div>
          <dt className="inline font-semibold text-text/80">Versão das regras: </dt>
          <dd className="inline font-mono">{rules_version}</dd>
        </div>
        {entries.map(([k, v]) => (
          <div key={k}>
            <dt className="inline font-semibold text-text/80">{k.replace(/_/g, ' ')}: </dt>
            <dd className="inline">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd>
          </div>
        ))}
      </dl>
    </details>
  )
}

/** Link "abrir os registros" que leva ao explorador com o filtro aplicado. */
export function DrillLink({ filter, children, className }: { caseId?: number | string; filter: object; children: ReactNode; className?: string }) {
  return (
    <Link className={clsx('text-accent hover:underline', className)} to={`/analise/eventos?f=${encodeFilter(filter)}`}>
      {children}
    </Link>
  )
}

export function Num({ n, caseId, label }: { n?: string | null; caseId?: number | string; label?: string | null }) {
  if (!n) return <span className="text-faint">—</span>
  const text = (
    <span className="font-mono text-[13px] whitespace-nowrap">
      {fmtNumber(n)}
      {label && <span className="ml-1 font-sans text-xs text-teal">({label})</span>}
    </span>
  )
  if (caseId === undefined) return text
  return (
    <DrillLink caseId={caseId} filter={{ numbers: [n] }} className="!text-text hover:!text-accent">
      {text}
    </DrillLink>
  )
}

export function Progress({ value, tone = 'blue' }: { value: number; tone?: Tone }) {
  const color = { blue: 'bg-accent', teal: 'bg-teal', amber: 'bg-amber', red: 'bg-danger', violet: 'bg-violet', green: 'bg-ok', gray: 'bg-muted' }[tone]
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className={clsx('h-full rounded-full transition-all', color)} style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }} />
    </div>
  )
}

export function DemoBanner({ show }: { show?: boolean }) {
  if (!show) return null
  return (
    <div className="mb-4 rounded-xl border border-amber/50 bg-amber/10 px-4 py-2 text-center font-mono text-xs font-bold tracking-widest text-amber uppercase">
      Demonstração — dados sintéticos, sem valor investigativo
    </div>
  )
}
