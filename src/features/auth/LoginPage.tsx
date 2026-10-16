import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { AuthLayout } from './AuthLayout';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (err) {
      setError(errorMessage(err));
      return;
    }
    toast.success('Bem-vindo de volta!');
    navigate(from, { replace: true });
  }

  return (
    <AuthLayout
      title="Entrar"
      subtitle="Acesse seu painel financeiro."
      footer={
        <>
          Ainda não tem conta?{' '}
          <Link to="/cadastro" state={location.state} className="font-semibold text-brand hover:underline">
            Criar conta
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label="E-mail">
          {(id) => <Input id={id} type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        <Field label="Senha">
          {(id) => <Input id={id} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        {error && (
          <p role="alert" className="rounded-xl border border-negative/25 bg-negative/8 px-3 py-2 text-sm text-negative">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" block loading={loading} disabled={!email || !password}>
          Entrar
        </Button>
        <Link to="/recuperar" className="text-center text-sm font-semibold text-muted hover:text-fg">
          Esqueci minha senha
        </Link>
      </form>
    </AuthLayout>
  );
}
