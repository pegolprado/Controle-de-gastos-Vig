import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { MailCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { useBrand } from '@/app/BrandProvider';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { AuthLayout } from './AuthLayout';

export function passwordIssues(p: string): string[] {
  const issues: string[] = [];
  if (p.length < 8) issues.push('ao menos 8 caracteres');
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) issues.push('letras e números');
  return issues;
}

export default function SignupPage() {
  const brand = useBrand();
  const location = useLocation();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const issues = passwordIssues(password);
  const from = (location.state as { from?: string } | null)?.from;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    if (issues.length || !consent) return;
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { full_name: name.trim() },
        emailRedirectTo: `${window.location.origin}/auth/callback${from ? `?next=${encodeURIComponent(from)}` : ''}`,
      },
    });
    setLoading(false);
    if (err) {
      setError(errorMessage(err));
      return;
    }
    if (data.session) navigate(from ?? '/', { replace: true });
    else setSent(true);
  }

  if (sent) {
    return (
      <AuthLayout title="Confirme seu e-mail" subtitle={<>Enviamos um link para <strong className="text-fg">{email}</strong>. Abra-o para ativar sua conta.</>}>
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-line bg-surface p-6 text-center">
          <MailCheck className="size-10 text-brand" aria-hidden />
          <p className="text-sm text-muted">Não recebeu? Verifique o spam ou aguarde alguns minutos.</p>
          <Link to="/entrar" className="font-semibold text-brand">
            Voltar para o login
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Criar conta"
      subtitle={brand.signup_mode === 'invite_only' ? 'Cadastro por convite: sua conta será liberada ao aceitar um convite ou após aprovação.' : 'Comece em menos de um minuto.'}
      footer={
        <>
          Já tem conta?{' '}
          <Link to="/entrar" state={location.state} className="font-semibold text-brand hover:underline">
            Entrar
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label="Nome">
          {(id) => <Input id={id} autoComplete="name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field label="E-mail">
          {(id) => <Input id={id} type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        <Field label="Senha" hint={password && issues.length ? `Use ${issues.join(' e ')}.` : 'Mínimo de 8 caracteres, com letras e números.'} error={undefined}>
          {(id, d) => <Input id={id} aria-describedby={d} type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <label className="flex items-start gap-3 text-sm text-muted">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 size-4 accent-[var(--brand)]" />
          <span>
            Concordo com o tratamento dos meus dados para o funcionamento do app, conforme a{' '}
            <Link to="/privacidade" className="font-semibold text-fg underline underline-offset-2">
              Política de Privacidade
            </Link>{' '}
            (LGPD).
          </span>
        </label>
        {error && (
          <p role="alert" className="rounded-xl border border-negative/25 bg-negative/8 px-3 py-2 text-sm text-negative">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" block loading={loading} disabled={!email || issues.length > 0 || !consent}>
          Criar conta
        </Button>
      </form>
    </AuthLayout>
  );
}
