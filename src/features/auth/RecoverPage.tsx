import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { appUrl } from '@/lib/appUrl';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { AuthLayout } from './AuthLayout';
import { passwordIssues } from './SignupPage';

export function RecoverPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: appUrl('/redefinir-senha') });
    setLoading(false);
    if (error && !/rate/i.test(error.message)) {
      toast.error(errorMessage(error));
      return;
    }
    // resposta idêntica exista ou não a conta (evita enumeração de e-mails)
    setSent(true);
  }

  return (
    <AuthLayout title="Recuperar senha" subtitle="Enviaremos um link seguro para você criar uma nova senha." footer={<Link to="/entrar" className="font-semibold text-brand">Voltar para o login</Link>}>
      {sent ? (
        <p role="status" className="rounded-2xl border border-line bg-surface p-5 text-sm text-muted">
          Se houver uma conta para <strong className="text-fg">{email}</strong>, você receberá um e-mail com as instruções em instantes.
        </p>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label="E-mail">
            {(id) => <Input id={id} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}
          </Field>
          <Button type="submit" variant="primary" size="lg" block loading={loading} disabled={!email}>
            Enviar link
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const issues = passwordIssues(password);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (loading || issues.length || password !== confirm) return;
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      toast.error(errorMessage(error));
      return;
    }
    toast.success('Senha alterada com sucesso.');
    navigate('/', { replace: true });
  }

  return (
    <AuthLayout title="Nova senha" subtitle="Escolha uma senha forte que você não use em outros serviços.">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Nova senha" hint={password && issues.length ? `Use ${issues.join(' e ')}.` : undefined}>
          {(id, d) => <Input id={id} aria-describedby={d} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <Field label="Confirmar senha" error={confirm && confirm !== password ? 'As senhas não coincidem.' : undefined}>
          {(id) => <Input id={id} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
        </Field>
        <Button type="submit" variant="primary" size="lg" block loading={loading} disabled={issues.length > 0 || password !== confirm}>
          Salvar nova senha
        </Button>
      </form>
    </AuthLayout>
  );
}
