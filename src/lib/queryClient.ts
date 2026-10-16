import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: true,
      // tentativas controladas: só para falhas de rede/servidor, nunca para 4xx
      retry: (count, err) => {
        const e = err as { code?: string; status?: number };
        if (e?.status && e.status >= 400 && e.status < 500) return false;
        if (e?.code && /^(42|23|P0|PGRST)/.test(e.code)) return false;
        return count < 2;
      },
      retryDelay: (n) => Math.min(1000 * 2 ** n, 8000),
    },
    mutations: {
      // mutações NÃO são repetidas automaticamente: a idempotência é garantida
      // pela client_request_id e o usuário decide reenviar.
      retry: false,
      networkMode: 'always',
    },
  },
});

/** Invalida tudo que depende de dados financeiros do espaço. */
export function invalidateFinance(ws: string | undefined) {
  if (!ws) return;
  return queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'ws' && q.queryKey[1] === ws });
}
