import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useAuth } from '@/app/AuthProvider';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { errorMessage } from '@/lib/errors';
import { listTotp, verifyTotp } from '@/services/mfa';
import { AuthLayout } from './AuthLayout';

/** Segunda etapa do login: código de 6 dígitos do app autenticador. */
export function MfaChallenge() {
  const { refreshMfa, signOut } = useAuth();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || code.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      const [factor] = await listTotp();
      if (!factor) throw new Error('Nenhum app autenticador ativo nesta conta.');
      await verifyTotp(factor.id, code);
      await refreshMfa();
    } catch (err) {
      const msg = errorMessage(err);
      setError(/invalid|inválid|code/i.test(msg) ? 'Código incorreto ou expirado. Confira o app e tente de novo.' : msg);
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Verificação em duas etapas" subtitle="Abra seu app autenticador e digite o código de 6 dígitos do Finance MV.">
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label="Código do app autenticador">
          {(id) => (
            <Input
              id={id}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              className="text-center font-num text-2xl tracking-[0.4em]"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              data-autofocus
              autoFocus
            />
          )}
        </Field>
        {error && <p role="alert" className="rounded-xl border border-negative/25 bg-negative/8 px-3 py-2 text-sm text-negative">{error}</p>}
        <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={code.length !== 6} icon={<ShieldCheck className="size-4" />}>
          Confirmar
        </Button>
        <button type="button" onClick={() => void signOut()} className="text-center text-sm font-semibold text-muted hover:text-fg">
          Sair e entrar com outra conta
        </button>
        <p className="text-center text-[12px] text-subtle">Perdeu o celular? Fale com o administrador do app para desativar a verificação.</p>
      </form>
    </AuthLayout>
  );
}
