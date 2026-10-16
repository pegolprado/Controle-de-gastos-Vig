import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './AuthProvider';
import { fetchSessionContext, updatePreferences } from '@/services/session';
import { generateRecurrences } from '@/services/planning';
import { refreshNotifications } from '@/services/notifications';
import type { SessionContext, WorkspaceSummary } from '@/lib/types';
import { can } from '@/domain/labels';

interface WorkspaceState {
  ctx: SessionContext | undefined;
  loading: boolean;
  error: unknown;
  workspace: WorkspaceSummary | undefined;
  wsId: string | undefined;
  setWorkspace: (id: string) => void;
  canContribute: boolean;
  canEdit: boolean;
  canAdmin: boolean;
  isOwnerOfWs: boolean;
  hideValues: boolean;
  toggleHideValues: () => void;
  reload: () => Promise<unknown>;
}

const WorkspaceContext = createContext<WorkspaceState | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const qc = useQueryClient();
  const userId = session?.user.id;
  const query = useQuery({
    queryKey: ['session-context', userId],
    queryFn: fetchSessionContext,
    enabled: Boolean(userId),
    staleTime: 60_000,
  });
  const ctx = query.data;
  const [selected, setSelected] = useState<string | undefined>(() => {
    try {
      return localStorage.getItem('fos.ws') ?? undefined;
    } catch {
      return undefined;
    }
  });
  const [hideValues, setHideValues] = useState(false);

  useEffect(() => {
    if (ctx?.preferences) setHideValues(ctx.preferences.hide_values);
  }, [ctx?.preferences]);

  const workspace = useMemo(() => {
    const list = ctx?.workspaces ?? [];
    return (
      list.find((w) => w.id === selected) ??
      list.find((w) => w.id === ctx?.preferences?.active_workspace_id) ??
      list.find((w) => w.kind === 'personal') ??
      list[0]
    );
  }, [ctx, selected]);

  const wsId = workspace?.id;

  // Tarefas idempotentes ao abrir o espaço: gerar recorrências e alertas.
  useEffect(() => {
    if (!wsId || !workspace || workspace.is_support) return;
    let cancelled = false;
    (async () => {
      try {
        if (can(workspace.role, 'contribute')) {
          const created = await generateRecurrences(wsId);
          if (created > 0 && !cancelled) void qc.invalidateQueries({ queryKey: ['ws', wsId] });
        }
        await refreshNotifications(wsId);
        if (!cancelled) void qc.invalidateQueries({ queryKey: ['notifications'] });
      } catch {
        /* não essencial — falhas aqui não bloqueiam a interface */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wsId, workspace, qc]);

  const setWorkspace = useCallback(
    (id: string) => {
      setSelected(id);
      try {
        localStorage.setItem('fos.ws', id);
      } catch {
        /* ignore */
      }
      if (userId) void updatePreferences(userId, { active_workspace_id: id }).catch(() => undefined);
    },
    [userId],
  );

  const toggleHideValues = useCallback(() => {
    setHideValues((v) => {
      if (userId) void updatePreferences(userId, { hide_values: !v }).catch(() => undefined);
      return !v;
    });
  }, [userId]);

  useEffect(() => {
    document.documentElement.classList.toggle('blur-values', hideValues);
  }, [hideValues]);

  const role = workspace?.role;
  const value: WorkspaceState = {
    ctx,
    loading: query.isLoading,
    error: query.error,
    workspace,
    wsId,
    setWorkspace,
    canContribute: can(role, 'contribute'),
    canEdit: can(role, 'edit'),
    canAdmin: can(role, 'admin'),
    isOwnerOfWs: can(role, 'own'),
    hideValues,
    toggleHideValues,
    reload: query.refetch,
  };
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace fora do WorkspaceProvider');
  return ctx;
}

/** Atalho: id do espaço ativo (garantido nas rotas protegidas). */
export function useWsId(): string {
  const { wsId } = useWorkspace();
  return wsId ?? '';
}
