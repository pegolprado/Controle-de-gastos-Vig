import { Component, type ReactNode } from 'react';
import { isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { reportError } from '@/lib/errors';
import { Button } from '@/components/ui/Button';

function Fallback({ message }: { message: string }) {
  const chunkError = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(message);
  return (
    <div className="grid min-h-[60dvh] place-items-center p-6 text-center">
      <div className="max-w-sm space-y-3">
        <h1 className="font-display text-xl font-semibold">{chunkError ? 'Há uma nova versão do app' : 'Algo deu errado'}</h1>
        <p className="text-sm text-muted">
          {chunkError
            ? 'Esta tela foi atualizada no servidor. Recarregue para continuar — seus dados estão salvos.'
            : 'O erro foi registrado. Seus dados salvos não foram afetados.'}
        </p>
        <Button variant="primary" onClick={() => location.reload()}>
          Recarregar
        </Button>
      </div>
    </div>
  );
}

export function RouteError() {
  const err = useRouteError();
  const message = isRouteErrorResponse(err) ? `${err.status} ${err.statusText}` : err instanceof Error ? err.message : String(err);
  if (!(isRouteErrorResponse(err) && err.status === 404)) reportError(err);
  return <Fallback message={message} />;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    reportError(error);
  }
  render() {
    return this.state.error ? <Fallback message={this.state.error.message} /> : this.props.children;
  }
}
