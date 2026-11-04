import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Copy, ShieldCheck, ShieldOff, Smartphone } from 'lucide-react';
import { useAuth } from '@/app/AuthProvider';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Card';
import { Field, Input } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { useConfirm } from '@/components/ui/Confirm';
import { errorMessage } from '@/lib/errors';
import { enrollTotp, listTotp, removeTotp, verifyTotp } from '@/services/mfa';

/** Ativar/desativar a verificação em duas etapas (app autenticador). */
export function TwoFactorCard() {
  const { refreshMfa } = useAuth();
  const confirm = useConfirm();
  const factors = useQuery({ queryKey: ['mfa-factors'], queryFn: listTotp });
  const [setup, setSetup] = useState(false);
  const active = factors.data?.[0];
  const off = useMutation({
    mutationFn: () => removeTotp(active!.id),
    onSuccess: async () => {
      toast.success('Verificação em duas etapas desativada.');
      await refreshMfa();
      void factors.refetch();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="rounded-2xl border border-line p-4" role="region" aria-label="Verificação em duas etapas">
      <div className="flex items-start gap-3">
        <span className={active ? 'text-positive' : 'text-warning'}>{active ? <ShieldCheck className="size-5" aria-hidden /> : <ShieldOff className="size-5" aria-hidden />}</span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            Verificação em duas etapas
            {active ? <Badge tone="positive">Ativada</Badge> : <Badge tone="warning">Desativada</Badge>}
          </p>
          <p className="mt-0.5 text-[13px] text-muted">
            {active
              ? 'Ao entrar, além da senha, pedimos o código do app autenticador. Mesmo que alguém descubra sua senha, não acessa seus dados.'
              : 'Proteja sua conta: além da senha, peça um código do celular (Google Authenticator, Microsoft Authenticator, Authy…).'}
          </p>
        </div>
      </div>
      <div className="mt-3">
        {active ? (
          <Button
            size="sm"
            variant="ghost"
            loading={off.isPending}
            onClick={async () => {
              if (await confirm({ title: 'Desativar a verificação em duas etapas?', description: 'Sua conta volta a ser protegida só pela senha.', confirmLabel: 'Desativar' })) off.mutate();
            }}
          >
            Desativar
          </Button>
        ) : (
          <Button size="sm" variant="primary" icon={<Smartphone className="size-4" />} onClick={() => setSetup(true)} disabled={factors.isLoading}>
            Ativar
          </Button>
        )}
      </div>
      {setup && (
        <SetupDialog
          onClose={() => setSetup(false)}
          onDone={async () => {
            setSetup(false);
            await refreshMfa();
            void factors.refetch();
          }}
        />
      )}
    </div>
  );
}

function SetupDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const enroll = useQuery({ queryKey: ['mfa-enroll'], queryFn: enrollTotp, staleTime: Infinity, gcTime: 0, retry: false });
  const [code, setCode] = useState('');
  const verify = useMutation({
    mutationFn: () => verifyTotp(enroll.data!.id, code),
    onSuccess: () => {
      toast.success('Pronto! A verificação em duas etapas está ativada.');
      onDone();
    },
    onError: () => {
      toast.error('Código incorreto. Confira a hora do celular e tente o código atual.');
      setCode('');
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Ativar verificação em duas etapas"
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" loading={verify.isPending} disabled={code.length !== 6 || !enroll.data} onClick={() => verify.mutate()}>Ativar</Button>
        </div>
      }
    >
      <ol className="flex flex-col gap-4 text-[14px]">
        <li>
          <p className="font-semibold">1. Instale um app autenticador</p>
          <p className="text-muted">Google Authenticator, Microsoft Authenticator ou Authy (grátis na loja do celular).</p>
        </li>
        <li>
          <p className="font-semibold">2. Leia o QR code com o app</p>
          {enroll.error ? (
            <p className="text-negative">{errorMessage(enroll.error)}</p>
          ) : enroll.data ? (
            <div className="mt-2 flex flex-col items-center gap-2">
              <img src={enroll.data.qr} alt="QR code para o app autenticador" className="size-44 rounded-xl bg-white p-2" />
              <p className="text-[12px] text-subtle">No mesmo celular? Copie a chave e cole no app:</p>
              <button
                type="button"
                onClick={() => void navigator.clipboard?.writeText(enroll.data!.secret).then(() => toast.success('Chave copiada.'))}
                className="flex items-center gap-1.5 rounded-lg bg-surface-2 px-2.5 py-1.5 font-mono text-[12px]"
                aria-label="Copiar chave secreta"
              >
                {enroll.data.secret} <Copy className="size-3.5" aria-hidden />
              </button>
            </div>
          ) : (
            <p className="text-muted">Gerando…</p>
          )}
        </li>
        <li>
          <p className="font-semibold">3. Digite o código que aparece no app</p>
          <Field label="Código de 6 dígitos" className="mt-2">
            {(id) => (
              <Input id={id} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" className="text-center font-num text-xl tracking-[0.35em]" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
            )}
          </Field>
        </li>
      </ol>
    </Modal>
  );
}
