import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
      else navigate(data.session ? safeNext : '/entrar', { replace: true });
    }, 300);
    return () => clearTimeout(t);
  }, [error, navigate, params]);

  return (
    <div className="grid min-h-dvh place-items-center p-6 text-center">
      {error ? (
        <div className="max-w-sm space-y-3">
          <p className="font-semibold">Não foi possível validar o link.</p>
          <p className="text-sm text-muted">{error}</p>
          <a href="/entrar" className="font-semibold text-brand">Ir para o login</a>
        </div>
      ) : (
        <Loader2 className="size-6 animate-spin text-brand" aria-label="Validando" />
      )}
    </div>
  );
}
