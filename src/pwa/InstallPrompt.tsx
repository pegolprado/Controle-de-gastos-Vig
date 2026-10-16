import { useEffect, useState } from 'react';
import { Download, Share, SquarePlus, X } from 'lucide-react';
import { Button, IconButton } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'fos.install.dismissed';
const DISMISS_DAYS = 14;

function isStandalone() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIOS() {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function recentlyDismissed() {
  try {
    const t = Number(localStorage.getItem(DISMISS_KEY) || 0);
    return Date.now() - t < DISMISS_DAYS * 86_400_000;
  } catch {
    return false;
  }
}

// O evento pode disparar antes do React montar: guardamos globalmente.
let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    listeners.forEach((l) => l());
  });
}

/** Estado de instalação do PWA: pode instalar com um toque, precisa de instruções (iOS) ou já está instalado. */
export function useInstall() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((x) => x + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  const installed = typeof window !== 'undefined' && isStandalone();
  const mode: 'installed' | 'prompt' | 'ios' | 'none' = installed ? 'installed' : deferred ? 'prompt' : isIOS() ? 'ios' : 'none';
  async function install(): Promise<boolean> {
    if (!deferred) return false;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    deferred = null;
    listeners.forEach((l) => l());
    return outcome === 'accepted';
  }
  return { mode, install };
}

export function IOSInstructions({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Instalar no iPhone" size="sm">
      <ol className="flex flex-col gap-4 text-[15px]">
        <li className="flex items-start gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand/15 font-semibold text-brand">1</span>
          <span>
            Abra este endereço no <strong>Safari</strong>.
          </span>
        </li>
        <li className="flex items-start gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand/15 font-semibold text-brand">2</span>
          <span>
            Toque em <Share className="inline size-4 align-[-2px]" aria-label="Compartilhar" /> <strong>Compartilhar</strong>, na barra inferior.
          </span>
        </li>
        <li className="flex items-start gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand/15 font-semibold text-brand">3</span>
          <span>
            Role e toque em <SquarePlus className="inline size-4 align-[-2px]" aria-hidden /> <strong>Adicionar à Tela de Início</strong> e depois em <strong>Adicionar</strong>.
          </span>
        </li>
      </ol>
      <p className="mt-5 text-sm text-muted">O ícone aparece na tela inicial e o app abre em tela cheia, como qualquer aplicativo.</p>
    </Modal>
  );
}

/** Faixa discreta convidando a instalar (some se instalado ou dispensado por 14 dias). */
export function InstallBanner() {
  const { mode, install } = useInstall();
  const [hidden, setHidden] = useState(recentlyDismissed);
  const [iosOpen, setIosOpen] = useState(false);
  if (hidden || mode === 'installed' || mode === 'none') return null;
  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    setHidden(true);
  };
  return (
    <>
      <div className="mb-5 flex items-center gap-3 rounded-2xl border border-brand/25 bg-brand/[0.07] p-3 pl-4" role="region" aria-label="Instalar aplicativo">
        <Download className="size-5 shrink-0 text-brand" aria-hidden />
        <p className="min-w-0 flex-1 text-sm">
          <strong>Instale o app</strong> <span className="text-muted">para abrir direto da tela inicial, em tela cheia.</span>
        </p>
        <Button size="sm" variant="primary" onClick={() => (mode === 'ios' ? setIosOpen(true) : void install())}>
          Instalar
        </Button>
        <IconButton size="sm" label="Agora não" onClick={dismiss}>
          <X className="size-4" />
        </IconButton>
      </div>
      <IOSInstructions open={iosOpen} onClose={() => setIosOpen(false)} />
    </>
  );
}

/** Botão compacto para telas de entrada e ajustes. */
export function InstallButton({ className }: { className?: string }) {
  const { mode, install } = useInstall();
  const [iosOpen, setIosOpen] = useState(false);
  if (mode === 'installed' || mode === 'none') return null;
  return (
    <>
      <Button variant="secondary" block className={className} icon={<Download className="size-4" />} onClick={() => (mode === 'ios' ? setIosOpen(true) : void install())}>
        Instalar o app no celular
      </Button>
      <IOSInstructions open={iosOpen} onClose={() => setIosOpen(false)} />
    </>
  );
}
