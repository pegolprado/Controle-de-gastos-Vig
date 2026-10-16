import { useEffect, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { RefreshCw, Sparkles } from 'lucide-react';
import { useBrand } from '@/app/BrandProvider';
import { env } from '@/lib/env';
import { hasDirtyForms, hasPendingWrites, onDirtyChange } from '@/lib/formGuard';
import { Button } from '@/components/ui/Button';
import { isOutdated } from './version';
import { BASE_URL } from '@/lib/appUrl';

const CHECK_INTERVAL = 30 * 60_000;

/**
 * Estratégia de atualização centralizada:
 * 1. O service worker novo é baixado em segundo plano (sem assumir o controle).
 * 2. Mostramos um aviso discreto; o usuário escolhe quando atualizar.
 * 3. Se a versão instalada estiver abaixo da mínima exigida pelo administrador,
 *    atualizamos automaticamente — mas SOMENTE quando não houver formulário
 *    aberto ou gravação em andamento.
 * 4. Verificação periódica + ao voltar para a aba, para nunca ficar preso em
 *    uma versão antiga em cache.
 */
export function UpdatePrompt() {
  const brand = useBrand();
  const [serverVersion, setServerVersion] = useState<string | null>(null);
  const [, rerender] = useState(0);
  useEffect(() => {
    const off = onDirtyChange(() => rerender((x) => x + 1));
    return () => {
      off();
    };
  }, []);
  const registration = useRef<ServiceWorkerRegistration | undefined>(undefined);
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      registration.current = reg;
    },
  });

  useEffect(() => {
    const check = async () => {
      if (!navigator.onLine) return;
      try {
        await registration.current?.update();
        const res = await fetch(`${BASE_URL}version.json`, { cache: 'no-store' });
        if (res.ok) setServerVersion(((await res.json()) as { version: string }).version);
      } catch {
        /* sem rede: tenta depois */
      }
    };
    const t = setInterval(check, CHECK_INTERVAL);
    const onVisible = () => document.visibilityState === 'visible' && void check();
    document.addEventListener('visibilitychange', onVisible);
    void check();
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const mandatory = Boolean(brand.min_client_version && isOutdated(env.version, brand.min_client_version));
  const available = needRefresh || (serverVersion !== null && isOutdated(env.version, serverVersion));

  // atualização obrigatória: aguarda um momento seguro (sem formulário/salvamento)
  useEffect(() => {
    if (!mandatory || !available) return;
    const tryUpdate = () => {
      if (!hasDirtyForms() && !hasPendingWrites()) void apply();
    };
    tryUpdate();
    const off = onDirtyChange(tryUpdate);
    return () => {
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mandatory, available]);

  async function apply() {
    if (hasDirtyForms() || hasPendingWrites()) return;
    if (needRefresh) {
      await updateServiceWorker(true);
    } else {
      // sem SW esperando (ex.: navegador sem SW): recarrega buscando do servidor
      location.reload();
    }
  }

  if (!available) return null;
  const blocked = hasDirtyForms() || hasPendingWrites();
  return (
    <div role="status" className="pb-safe fixed inset-x-3 bottom-20 z-40 mx-auto max-w-md animate-rise lg:bottom-6 lg:left-auto lg:right-6 lg:mx-0">
      <div className="flex items-center gap-3 rounded-2xl border border-brand/25 bg-elevated p-3 pl-4 shadow-float">
        <Sparkles className="size-5 shrink-0 text-brand" aria-hidden />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-semibold">Nova versão disponível{serverVersion ? ` (${serverVersion})` : ''}</p>
          <p className="text-[13px] text-subtle">
            {blocked ? 'Termine o lançamento em andamento; atualizaremos depois.' : mandatory ? 'Atualização necessária — aplicando…' : 'Atualize quando quiser. Nada será perdido.'}
          </p>
        </div>
        <Button size="sm" variant="primary" onClick={() => void apply()} disabled={blocked} icon={<RefreshCw className="size-4" aria-hidden />}>
          Atualizar
        </Button>
      </div>
    </div>
  );
}
