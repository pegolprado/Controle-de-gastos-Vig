import { Database } from 'lucide-react';

/** Exibido quando o build foi feito sem as variáveis do Supabase. */
export function NotConfigured() {
  return (
    <div className="grid min-h-dvh place-items-center p-6">
      <div className="max-w-lg rounded-3xl border border-line bg-surface p-8 shadow-card">
        <Database className="size-8 text-brand" aria-hidden />
        <h1 className="mt-4 font-display text-2xl font-semibold">Configuração pendente</h1>
        <p className="mt-2 text-muted">
          Defina <code className="rounded bg-surface-2 px-1">VITE_SUPABASE_URL</code> e <code className="rounded bg-surface-2 px-1">VITE_SUPABASE_ANON_KEY</code> no
          ambiente de build e publique novamente. Consulte <code>docs/DEPLOY.md</code>.
        </p>
      </div>
    </div>
  );
}
