import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';

/** Retorno dos links de e-mail (confirmação de cadastro). */
export default function CallbackPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(params.get('error_description'));

  useEffect(() => {
    if (error) return;
    const next = params.get('next');
    const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
    const t = setTimeout(async () => {
      const { data, error: err } = await supabase.auth.getSession();
      if (err) setError(errorMessage(err));
      // o e-mail já foi confirmado pelo servidor antes de chegar aqui; sem sessão significa que o
      // link abriu em outro navegador/app (a sessão só abre onde a conta foi criada): basta entrar
      else if (data.session) navigate(safeNext, { replace: true });
      else navigate('/entrar', { replace: true, state: { confirmed: true, from: safeNext } });
    }, 300);
    return () => clearTimeout(t);
  }, [error, navigate, params]);

  return (
    <div className="grid min-h-dvh place-items-center p-6 text-center">
      {error ? (
        <div className="max-w-sm space-y-3">
          <p className="font-semibold">Não foi possível validar o link.</p>
          <p className="text-sm text-muted">{error}</p>
          <Link to="/entrar" className="font-semibold text-brand">Ir para o login</Link>
        </div>
      ) : (
        <Loader2 className="size-6 animate-spin text-brand" aria-label="Validando" />
      )}
    </div>
  );
}
