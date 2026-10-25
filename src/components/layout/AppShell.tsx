import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Eye, EyeOff, LogOut, Menu, Mic, Plus, WifiOff, X } from 'lucide-react';
import { useAuth } from '@/app/AuthProvider';
import { useWorkspace } from '@/app/WorkspaceProvider';
import { useQuickAdd } from '@/features/transactions/QuickAdd';
import { useVoiceCapture } from '@/features/transactions/VoiceCapture';
import { NotificationsBell } from '@/features/notifications/NotificationsBell';
import { useOnline } from '@/hooks/useOnline';
import { cn } from '@/lib/cn';
import { env } from '@/lib/env';
import { IconButton } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Card';
import { Logo } from './Logo';
import { InstallBanner, InstallMenuItem } from '@/pwa/InstallPrompt';
import { MOBILE_NAV, NAV, NAV_ADMIN, NAV_SECONDARY } from './nav';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { runAutopilot } from '@/services/fii';
import { touchLastSeen } from '@/services/session';
import { invalidateFinance } from '@/lib/queryClient';

// "último acesso" do painel do proprietário: ao abrir e ao voltar do segundo plano
function useLastSeen() {
  useEffect(() => {
    let last = 0;
    const touch = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < 5 * 60_000) return;
      last = Date.now();
      void touchLastSeen().catch(() => {});
    };
    touch();
    document.addEventListener('visibilitychange', touch);
    return () => document.removeEventListener('visibilitychange', touch);
  }, []);
}

// piloto automático da renda: uma vez por espaço a cada abertura do app
const autopilotDone = new Set<string>();
function useRendaAutopilot(ws: string | undefined, canContribute: boolean) {
  useEffect(() => {
    if (!ws || !canContribute || autopilotDone.has(ws)) return;
    autopilotDone.add(ws);
    void runAutopilot(ws)
      .then((n) => {
        if (n) void invalidateFinance(ws);
      })
      .catch(() => {});
  }, [ws, canContribute]);
}

function SideLink({ to, label, icon: Icon, end, onClick }: { to: string; label: string; icon: typeof Plus; end?: boolean; onClick?: () => void }) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      className={({ isActive }) =>
        cn(
          'group relative flex h-10 items-center gap-3 rounded-xl px-3 text-[14px] font-semibold transition',
          isActive ? 'bg-surface-2 text-fg' : 'text-muted hover:bg-surface-2/60 hover:text-fg',
        )
      }
    >
      {({ isActive }) => (
        <>
          <span className={cn('absolute left-0 top-2 h-6 w-[3px] rounded-r-full bg-brand transition-opacity', isActive ? 'opacity-100' : 'opacity-0')} aria-hidden />
          <Icon className={cn('size-[18px]', isActive ? 'text-brand' : 'text-subtle group-hover:text-muted')} aria-hidden />
          {label}
        </>
      )}
    </NavLink>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { ctx } = useWorkspace();
  const { signOut } = useAuth();
  return (
    <div className="flex h-full flex-col gap-6 p-4">
      <div className="px-1 pt-1">
        <Logo />
      </div>
      <WorkspaceSwitcher />
      <nav aria-label="Principal" className="flex flex-col gap-0.5">
        {NAV.map((n) => (
          <SideLink key={n.to} {...n} onClick={onNavigate} />
        ))}
      </nav>
      <div className="mt-auto flex flex-col gap-0.5">
        {NAV_SECONDARY.map((n) => (
          <SideLink key={n.to} {...n} onClick={onNavigate} />
        ))}
        {ctx?.is_app_owner && <SideLink {...NAV_ADMIN} onClick={onNavigate} />}
        <InstallMenuItem className="flex h-10 items-center gap-3 rounded-xl px-3 text-[14px] font-semibold text-muted transition hover:bg-surface-2/60 hover:text-fg" />
        <button
          type="button"
          onClick={() => void signOut()}
          className="flex h-10 items-center gap-3 rounded-xl px-3 text-[14px] font-semibold text-muted transition hover:bg-surface-2/60 hover:text-fg"
        >
          <LogOut className="size-[18px] text-subtle" aria-hidden /> Sair
        </button>
        <p className="px-3 pt-3 text-[11px] text-subtle">
          v{env.version} · {env.commit.slice(0, 7)}
          {env.appEnv !== 'production' && <span className="ml-1 rounded bg-warning/15 px-1 text-warning">{env.appEnv}</span>}
        </p>
      </div>
    </div>
  );
}

function PageFallback() {
  return (
    <div className="space-y-4 p-1" aria-busy="true" aria-label="Carregando">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-32 w-full" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    </div>
  );
}

export function AppShell({ banner }: { banner?: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const quickAdd = useQuickAdd();
  const voice = useVoiceCapture();
  const { canContribute, hideValues, toggleHideValues, workspace } = useWorkspace();
  const online = useOnline();
  const location = useLocation();
  useRendaAutopilot(workspace?.id, canContribute);
  useLastSeen();

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[264px_1fr]">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2">
        Pular para o conteúdo
      </a>
      <aside className="sticky top-0 hidden h-dvh border-r border-line bg-surface/70 backdrop-blur lg:block">
        <Sidebar />
      </aside>

      {/* Menu completo no celular */}
      {menuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 animate-fade bg-black/50" onClick={() => setMenuOpen(false)} aria-hidden />
          <div className="pt-safe absolute inset-y-0 left-0 w-[82%] max-w-xs animate-rise overflow-y-auto border-r border-line bg-surface">
            <div className="absolute right-2 top-2">
              <IconButton label="Fechar menu" onClick={() => setMenuOpen(false)}>
                <X className="size-5" />
              </IconButton>
            </div>
            <Sidebar onNavigate={() => setMenuOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-col">
        <header className="pt-safe sticky top-0 z-30 border-b border-line bg-bg/80 backdrop-blur-md">
          <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4 sm:px-6">
            <IconButton label="Abrir menu" className="-ml-2 lg:hidden" onClick={() => setMenuOpen(true)}>
              <Menu className="size-5" />
            </IconButton>
            <div className="lg:hidden">
              <Logo compact />
            </div>
            <div className="min-w-0 flex-1 truncate text-sm font-semibold text-muted lg:hidden">{workspace?.name}</div>
            <div className="hidden flex-1 lg:block" />
            {!online && (
              <span className="flex items-center gap-1.5 rounded-full bg-warning/12 px-2.5 py-1 text-xs font-semibold text-warning" role="status">
                <WifiOff className="size-3.5" aria-hidden /> Offline
              </span>
            )}
            {canContribute && (
              <button
                type="button"
                onClick={voice}
                aria-label="Falar um gasto"
                title="Falar um gasto"
                className="grid size-10 place-items-center rounded-xl bg-brand/12 text-brand transition hover:bg-brand/20 active:scale-95"
              >
                <Mic className="size-5" aria-hidden />
              </button>
            )}
            <IconButton label={hideValues ? 'Mostrar valores' : 'Ocultar valores'} onClick={toggleHideValues}>
              {hideValues ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
            </IconButton>
            <NotificationsBell />
            {canContribute && (
              <button
                type="button"
                onClick={() => quickAdd()}
                className="ml-1 hidden h-10 items-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-[color:var(--brand-fg)] shadow-[0_8px_20px_-10px_var(--brand)] transition hover:brightness-110 lg:inline-flex"
              >
                <Plus className="size-4" aria-hidden /> Novo lançamento
              </button>
            )}
          </div>
          {banner}
        </header>

        <main id="conteudo" className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-5 sm:px-6 lg:pb-12" key={workspace?.id}>
          <InstallBanner />
          <Suspense fallback={<PageFallback />}>
            <div key={location.pathname} className="animate-rise">
              <Outlet />
            </div>
          </Suspense>
        </main>
      </div>

      {/* Navegação inferior (celular) */}
      <nav aria-label="Navegação rápida" className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/90 backdrop-blur-md lg:hidden">
        <div className="mx-auto grid h-16 max-w-md grid-cols-5 items-center px-2">
          {MOBILE_NAV.slice(0, 2).map((n) => (
            <MobileLink key={n.to} {...n} />
          ))}
          <div className="flex justify-center">
            {canContribute ? (
              <button
                type="button"
                aria-label="Novo lançamento"
                onClick={() => quickAdd()}
                className="-mt-7 grid size-14 place-items-center rounded-2xl bg-brand text-[color:var(--brand-fg)] shadow-[0_12px_28px_-10px_var(--brand)] ring-4 ring-bg transition active:scale-95"
              >
                <Plus className="size-6" strokeWidth={2.5} aria-hidden />
              </button>
            ) : (
              <span />
            )}
          </div>
          {MOBILE_NAV.slice(2).map((n) => (
            <MobileLink key={n.to} {...n} />
          ))}
          <button type="button" onClick={() => setMenuOpen(true)} className="flex flex-col items-center gap-0.5 text-[11px] font-semibold text-subtle">
            <Menu className="size-5" aria-hidden />
            Mais
          </button>
        </div>
      </nav>
    </div>
  );
}

function MobileLink({ to, label, icon: Icon, end }: { to: string; label: string; icon: typeof Plus; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => cn('flex flex-col items-center gap-0.5 text-[11px] font-semibold transition', isActive ? 'text-brand' : 'text-subtle')}
    >
      <Icon className="size-5" aria-hidden />
      {label}
    </NavLink>
  );
}
