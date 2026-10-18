import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  EyeOff,
  FolderKanban,
  LayoutGrid,
  Lock,
  LogOut,
  Menu,
  Settings,
  Users,
  Wrench,
  X,
} from "lucide-react";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { DemoBanner } from "../components/ui";
import { meta as engineMetaFn } from "../engine/analytics";
import { useSession } from "../engine/session";
import { ROLE_LABEL, useAuth } from "./auth";
import { LockOverlay, lockScreen, toggleMask, usePrivacy } from "./privacy";

function NavItem({
  to,
  icon,
  children,
  onClick,
  end,
}: {
  to: string;
  icon: ReactNode;
  children: ReactNode;
  onClick?: () => void;
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      className={({ isActive }) =>
        clsx(
          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
          isActive
            ? "bg-accent/15 text-white"
            : "text-muted hover:bg-white/[0.04] hover:text-text",
        )
      }
    >
      <span className="[&>svg]:h-4 [&>svg]:w-4">{icon}</span>
      {children}
    </NavLink>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { me, logout } = useAuth();
  const hasData = useSession((s) => s.files.length > 0 || s.targets.length > 0);
  const { masked } = usePrivacy();
  return (
    <div className="flex h-full flex-col gap-1 p-4">
      <Link
        to="/"
        onClick={onNavigate}
        className="mb-5 flex items-center gap-3 px-2"
      >
        <img src="/icon-192.png" alt="" className="h-11 w-11 rounded-xl" />
        <div>
          <div className="text-lg leading-tight font-bold tracking-wide text-white">
            MAR<span className="text-gold">X</span>
          </div>
          <div className="font-mono text-[10px] tracking-[0.25em] text-gold">
            INTELLIGENCE PRO
          </div>
        </div>
      </Link>
      <NavItem to="/" end icon={<LayoutGrid />} onClick={onNavigate}>
        Workspace
      </NavItem>
      <NavItem to="/ferramentas" icon={<Wrench />} onClick={onNavigate}>
        Catálogo de ferramentas
      </NavItem>
      <NavItem to="/analise" icon={<FolderKanban />} onClick={onNavigate}>
        Análise atual
      </NavItem>
      {me?.role === "admin" && (
        <>
          <div className="mt-4 mb-1 px-3 font-mono text-[10px] tracking-widest text-faint uppercase">
            Administração
          </div>
          <NavItem to="/admin/usuarios" icon={<Users />} onClick={onNavigate}>
            Usuários
          </NavItem>
        </>
      )}
      <div className="mt-4 rounded-lg border border-teal/30 bg-teal/5 px-3 py-2 text-[11px] leading-relaxed text-muted">
        <div className="mb-1 flex items-center gap-1.5 font-mono text-[10px] tracking-widest text-teal uppercase">
          <Lock className="h-3 w-3" /> Nada é salvo
        </div>
        Arquivos e resultados ficam só na memória desta aba. Ao sair, fechar ou
        ficar inativo, tudo é apagado.
      </div>
      <div className="mt-auto space-y-1 border-t border-line pt-4">
        <button
          onClick={toggleMask}
          aria-pressed={masked}
          className={clsx(
            "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-white/[0.04]",
            masked ? "text-gold" : "text-muted hover:text-text",
          )}
          title="Esconde os dígitos do meio dos telefones na tela (útil ao compartilhar a tela). Exportações não são afetadas."
        >
          <EyeOff className="h-4 w-4" />{" "}
          {masked ? "Números ocultos" : "Ocultar números"}
        </button>
        <button
          onClick={lockScreen}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted hover:bg-white/[0.04] hover:text-text"
          title="Esconde a tela sem apagar a análise; para voltar, digite sua senha."
        >
          <Lock className="h-4 w-4" /> Bloquear tela
        </button>
        <NavItem to="/configuracoes" icon={<Settings />} onClick={onNavigate}>
          Configurações
        </NavItem>
        <div className="px-3 py-2 text-xs">
          <div className="truncate text-text">{me?.name}</div>
          <div className="truncate text-faint">
            {me?.email} · {ROLE_LABEL[me?.role ?? ""] ?? me?.role}
          </div>
        </div>
        <button
          onClick={() => {
            if (
              !hasData ||
              confirm(
                "Sair apaga todos os arquivos e resultados desta análise. Exporte antes o que precisar. Deseja sair?",
              )
            )
              void logout();
          }}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted hover:bg-white/[0.04] hover:text-text"
        >
          <LogOut className="h-4 w-4" /> Sair e apagar
        </button>
      </div>
    </div>
  );
}

export function Shell() {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const { locked, masked } = usePrivacy();
  useEffect(() => setOpen(false), [loc.pathname]);
  return (
    <>
      <LockOverlay />
      <div
        className={clsx("flex min-h-screen", locked && "invisible")}
        aria-hidden={locked || undefined}
      >
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
          <div
            className="fixed inset-0 z-[950] bg-black/60 lg:hidden"
            onClick={() => setOpen(false)}
          >
            <aside
              className="h-full w-72 overflow-y-auto border-r border-line bg-ink"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="absolute top-4 left-60 rounded-lg p-1 text-muted"
                onClick={() => setOpen(false)}
                aria-label="Fechar menu"
              >
                <X className="h-5 w-5" />
              </button>
              <Sidebar onNavigate={() => setOpen(false)} />
            </aside>
          </div>
        )}
        <main className="min-w-0 flex-1 px-4 pt-20 pb-16 sm:px-6 lg:px-10 lg:pt-8">
          {/* a troca de "ocultar números" redesenha as telas (filtros ficam na URL e os resultados em cache) */}
          <div
            className="mx-auto max-w-7xl"
            key={masked ? "oculto" : "visivel"}
          >
            <Outlet />
          </div>
        </main>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ análise (sessão em memória)

export type CaseData = {
  id: number;
  title: string;
  is_demo: boolean;
  can_export: boolean;
  period_start: string | null;
  period_end: string | null;
  [k: string]: any;
};

type CaseCtx = {
  c: CaseData;
  canWrite: boolean;
  canReview: boolean;
  meta?: any;
};
const CaseContext = createContext<CaseCtx | null>(null);

/** Contexto da análise aberta (única por aba; existe só na memória). */
export function useCase() {
  const v = useContext(CaseContext);
  if (!v) throw new Error("useCase fora da análise");
  return v;
}

export const ANALYSIS = "/analise";
export const apath = (p = "") =>
  p ? `${ANALYSIS}/${p.replace(/^\//, "")}` : ANALYSIS;

const NAV = [
  ["", "Visão geral"],
  ["alvos", "Alvos"],
  ["arquivos", "Arquivos"],
  ["importacoes", "Importações"],
  ["qualidade", "Qualidade"],
  ["eventos", "Eventos"],
  ["contatos", "Contatos"],
  ["comparar", "Comparar"],
  ["vinculos", "Vínculos"],
  ["erb", "ERB"],
  ["mapa", "Mapa"],
  ["linha-do-tempo", "Linha do tempo"],
  ["estatistica", "Estatística"],
  ["cruzamento", "Cruzamento"],
  ["alertas", "Alertas"],
  ["relatorios", "Exportar"],
  ["assistente", "Assistente"],
] as const;

/** Invalida as consultas sempre que os dados da sessão mudam (importação, remoção, resolução). */
function useDataVersionSync() {
  const qc = useQueryClient();
  const version = useSession((s) => s.version);
  useEffect(() => {
    qc.invalidateQueries({
      predicate: (q) => q.queryKey[0] !== "me" && q.queryKey[0] !== "settings",
    });
  }, [version, qc]);
}

export function CaseLayout() {
  const { me } = useAuth();
  useDataVersionSync();
  const st = useSession((s) => s.meta);
  const isDemo = useSession((s) => s.isDemo);
  const targets = useSession((s) => s.targets);
  const files = useSession((s) => s.files);
  const busy = useSession((s) => s.busy);
  const version = useSession((s) => s.version);
  const engineMeta = useQuery({
    queryKey: ["meta", version],
    queryFn: () => engineMetaFn(),
  });
  const meta = useMemo(
    () => ({
      targets: targets.map((t) => ({
        number: t.number_normalized,
        label: t.label || t.internal_id,
      })),
      files: files
        .filter((f) => f.kind === "cdr")
        .map((f) => ({ id: f.id, name: f.original_name })),
      operators: engineMeta.data?.operators ?? [],
      span: engineMeta.data?.span ?? [],
    }),
    [targets, files, engineMeta.data],
  );
  const c: CaseData = {
    ...st,
    id: 0,
    is_demo: isDemo,
    can_export: !!me?.can_export,
  };
  const ctx: CaseCtx = { c, canWrite: true, canReview: true, meta };
  return (
    <CaseContext.Provider value={ctx}>
      <DemoBanner show={isDemo} />
      <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <Link to={ANALYSIS} className="text-faint hover:text-text">
          Análise
        </Link>
        <span className="text-faint">/</span>
        <span className="truncate text-text">{st.title}</span>
        <span className="ml-auto flex items-center gap-1.5 text-xs text-faint">
          <Lock className="h-3 w-3 text-teal" /> somente nesta aba ·{" "}
          {me?.can_export
            ? "exportação permitida"
            : "exportação desativada para seu usuário"}
        </span>
      </div>
      {busy && (
        <div className="card mb-4 flex items-center gap-3 border-accent/40 p-3 text-sm">
          <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
          <span className="text-muted">{busy.label}</span>
          {busy.progress > 0 && (
            <span className="ml-auto font-mono text-xs text-faint">
              {Math.round(busy.progress * 100)}%
            </span>
          )}
        </div>
      )}
      <nav
        className="scroll-x -mx-1 mb-6 flex gap-1 border-b border-line pb-px"
        aria-label="Módulos da análise"
      >
        {NAV.map(([path, label]) => (
          <NavLink
            key={path}
            end={path === ""}
            to={apath(path)}
            className={({ isActive }) =>
              clsx(
                "shrink-0 border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors",
                isActive
                  ? "border-accent text-white"
                  : "border-transparent text-muted hover:text-text",
              )
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </CaseContext.Provider>
  );
}
