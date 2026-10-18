import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useBrand } from '@/app/BrandProvider';
import { Switch } from '@/components/ui/Field';
import { errorMessage } from '@/lib/errors';
import { currentPushSubscription, disablePush, enablePush, isIOS, pushSupported } from './push';

/** Liga/desliga os avisos no celular deste aparelho. */
export function PushToggle() {
  const brand = useBrand();
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const supported = pushSupported();
  const key = brand.vapid_public_key ?? null;

  useEffect(() => {
    void currentPushSubscription().then((s) => setOn(!!s));
  }, []);

  async function toggle(next: boolean) {
    setBusy(true);
    try {
      if (next) {
        if (!key) throw new Error('Os avisos ainda não foram ativados no servidor. Peça ao administrador para concluir a configuração.');
        await enablePush(key);
        toast.success('Pronto! Você vai receber os avisos neste aparelho.');
      } else {
        await disablePush();
        toast.success('Avisos desligados neste aparelho.');
      }
      setOn(next);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const description = !supported
    ? isIOS()
      ? 'No iPhone, instale o app na tela inicial (Compartilhar → Adicionar à Tela de Início) e abra por lá para ativar.'
      : 'Este navegador não suporta avisos. Use o Chrome ou o app instalado.'
    : 'Contas que vencem hoje/amanhã e proventos que caem hoje/amanhã, mesmo com o app fechado. Vale para este aparelho.';

  return <Switch checked={on} onChange={(v) => void toggle(v)} disabled={!supported || busy} label="Avisos no celular" description={description} />;
}
