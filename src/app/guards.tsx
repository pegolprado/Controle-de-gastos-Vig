import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Clock, Loader2, ShieldOff } from 'lucide-react';
import { useAuth } from './AuthProvider';
import { useWorkspace } from './WorkspaceProvider';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/Card';
import { AuthLayout } from '@/features/auth/AuthLayout';

export function FullScreenLoader() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <Loader2 className="size-6 animate-spin text-brand" aria-label="Carregando" />
    </div>
  );
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading, signOut } = useAuth();
  const ws = useWorkspace();
  const location = useLocation();
  if (loading) return <FullScreenLoader />;
  if (!session) return <Navigate to="/entrar" replace state={{ from: location.pathname + location.search }} />;
  if (ws.loading) return <FullScreenLoader />;
  if (ws.error) {
    return (
      <div className="grid min-h-dvh place-items-center p-6">
        <div className="w-full max-w-md">
          <ErrorState error={ws.error} onRetry={() => void ws.reload()} />
        </div>
      </div>
    );
  }
  const status = ws.ctx?.status;
  if (status === 'pending') {
    return (
      <AuthLayout title="Aguardando liberação" subtitle="Seu cadastro foi recebido. O acesso será liberado pelo administrador ou ao aceitar um convite.">
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-line bg-surface p-6 text-center">
          <Clock className="size-9 text-warning" aria-hidden />
          <p className="text-sm text-muted">Se você recebeu um link de convite, abra-o agora para ativar sua conta.</p>
          <Button variant="secondary" onClick={() => void signOut()}>
            Sair
          </Button>
        </div>
      </AuthLayout>
    );
  }
  if (status === 'suspended' || status === 'revoked') {
    return (
      <AuthLayout title="Acesso indisponível" subtitle="Sua conta está suspensa. Fale com o administrador do aplicativo.">
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-negative/25 bg-negative/5 p-6 text-center">
          <ShieldOff className="size-9 text-negative" aria-hidden />
          <Button variant="secondary" onClick={() => void signOut()}>
            Sair
          </Button>
        </div>
      </AuthLayout>
    );
  }
  if (!ws.workspace) return <FullScreenLoader />;
  return <>{children}</>;
}

export function PublicOnly({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullScreenLoader />;
  if (session) {
    const from = (location.state as { from?: string } | null)?.from ?? '/';
    return <Navigate to={from} replace />;
  }
  return <>{children}</>;
}

export function RequireAppOwner({ children }: { children: ReactNode }) {
  const { ctx } = useWorkspace();
  if (!ctx?.is_app_owner) return <Navigate to="/" replace />;
  return <>{children}</>;
}
