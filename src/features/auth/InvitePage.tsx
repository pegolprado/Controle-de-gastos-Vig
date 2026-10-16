import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Users } from 'lucide-react';
import { useAuth } from '@/app/AuthProvider';
import { acceptInvite, peekInvite } from '@/services/workspace';
import { ROLE_DESCRIPTION, ROLE_LABEL } from '@/domain/labels';
import { errorMessage } from '@/lib/errors';
import { queryClient } from '@/lib/queryClient';
import { formatDateTime } from '@/lib/dates';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Card';
import { AuthLayout } from './AuthLayout';

const REASONS: Record<string, string> = {
  not_found: 'Este convite não existe.',
  revoked: 'Este convite foi cancelado por quem o enviou.',
  accepted: 'Este convite já foi utilizado.',
  expired: 'Este convite expirou. Peça um novo link.',
};

export default function InvitePage() {
  const { token = '' } = useParams();
  const { session } = useAuth();
  const navigate = useNavigate();
  const [done, setDone] = useState(false);
  const peek = useQuery({ queryKey: ['invite', token], queryFn: () => peekInvite(token), retry: false });
  const accept = useMutation({
    mutationFn: () => acceptInvite(token),
    onSuccess: async (r) => {
      setDone(true);
      if (r.workspace_id) localStorage.setItem('fos.ws', r.workspace_id);
      await queryClient.invalidateQueries({ queryKey: ['session-context'] });
      toast.success('Convite aceito!');
      navigate('/', { replace: true });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const info = peek.data;
  const from = `/convite/${token}`;
  return (
    <AuthLayout title={info?.workspace_name ? `Convite para “${info.workspace_name}”` : 'Convite'} subtitle={info?.valid ? 'Você foi convidado para usar o app.' : undefined}>
      {peek.isLoading ? (
        <Skeleton className="h-32" />
      ) : !info?.valid ? (
        <p className="rounded-2xl border border-negative/25 bg-negative/5 p-5 text-sm">{REASONS[info?.reason ?? 'not_found'] ?? errorMessage(peek.error)}</p>
      ) : (
        <div className="flex flex-col gap-5">
          {info.workspace_name && info.role && (
            <div className="flex gap-3 rounded-2xl border border-line bg-surface p-4">
              <Users className="mt-0.5 size-5 text-brand" aria-hidden />
              <div className="text-sm">
                <p className="font-semibold">Permissão: {ROLE_LABEL[info.role]}</p>
                <p className="text-muted">{ROLE_DESCRIPTION[info.role]}</p>
              </div>
            </div>
          )}
          {info.email_hint && <p className="text-sm text-muted">Convite emitido para {info.email_hint}.</p>}
          {info.expires_at && <p className="text-[13px] text-subtle">Válido até {formatDateTime(info.expires_at)}.</p>}
          {session ? (
            <Button variant="primary" size="lg" block loading={accept.isPending || done} onClick={() => accept.mutate()}>
              Aceitar convite
            </Button>
          ) : (
            <div className="grid gap-2">
              <Link to="/cadastro" state={{ from }}>
                <Button variant="primary" size="lg" block>
                  Criar conta e aceitar
                </Button>
              </Link>
              <Link to="/entrar" state={{ from }}>
                <Button variant="secondary" size="lg" block>
                  Já tenho conta
                </Button>
              </Link>
            </div>
          )}
        </div>
      )}
    </AuthLayout>
  );
}
