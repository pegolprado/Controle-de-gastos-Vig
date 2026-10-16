import { useEffect, useState, type ReactNode } from 'react';
import { Copy, Download, EllipsisVertical, MonitorDown, Share, SquarePlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button, IconButton } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'fmv.install.dismissed';
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

function isAndroid() {
  return /Android/i.test(navigator.userAgent);
}

/** Navegadores embutidos (WhatsApp, Instagram, Facebook…) não instalam PWA. */
function isInAppBrowser() {
  return /FBAN|FBAV|Instagram|WhatsApp|Line\/|; wv\)|GSA\//i.test(navigator.userAgent);
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
// instalado nesta sessão (a aba do navegador continua aberta, mas não faz sentido convidar de novo)
let installedNow = false;
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installedNow = true;
    listeners.forEach((l) => l());
  });
}

export type InstallMode = 'installed' | 'prompt' | 'ios' | 'android' | 'inapp' | 'desktop';

/**
 * Estado de instalação do PWA. 'prompt' instala com um toque; 'ios', 'android', 'inapp' e 'desktop'
 * mostram o passo a passo (o Chrome nem sempre oferece o prompt nativo, ex.: logo depois de limpar os dados).
 */
export function useInstall() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((x) => x + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  const mode: InstallMode = installedNow || isStandalone()
    ? 'installed'
    : deferred
      ? 'prompt'
      : isInAppBrowser()
        ? 'inapp'
        : isIOS()
          ? 'ios'
          : isAndroid()
            ? 'android'
            : 'desktop';
  async function install(): Promise<boolean> {
    if (!deferred) return false;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    deferred = null;
    if (outcome === 'accepted') installedNow = true;
    listeners.forEach((l) => l());
    return outcome === 'accepted';
  }
  return { mode, install };
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand/15 font-semibold text-brand">{n}</span>
      <span className="pt-1">{children}</span>
    </li>
  );
}

const TITLES: Record<Exclude<InstallMode, 'installed' | 'prompt'>, string> = {
  ios: 'Instalar no iPhone',
  android: 'Instalar no Android',
  inapp: 'Abra no navegador para instalar',
  desktop: 'Instalar no computador',
};

/** Passo a passo de instalação para cada tipo de aparelho. */
export function InstallInstructions({ mode, open, onClose }: { mode: InstallMode; open: boolean; onClose: () => void }) {
  if (mode === 'installed' || mode === 'prompt') return null;
  const copyLink = () => {
    void navigator.clipboard?.writeText(window.location.origin).then(
      () => toast.success('Link copiado. Cole no Chrome ou no Safari.'),
      () => toast.error('Não foi possível copiar. Copie o endereço manualmente.'),
    );
  };
  return (
    <Modal open={open} onClose={onClose} title={TITLES[mode]} size="sm">
      <ol className="flex flex-col gap-4 text-[15px]">
        {mode === 'ios' && (
          <>
            <Step n={1}>
              Abra este endereço no <strong>Safari</strong>.
            </Step>
            <Step n={2}>
              Toque em <Share className="inline size-4 align-[-2px]" aria-label="Compartilhar" /> <strong>Compartilhar</strong>, na barra inferior.
            </Step>
            <Step n={3}>
              Role e toque em <SquarePlus className="inline size-4 align-[-2px]" aria-hidden /> <strong>Adicionar à Tela de Início</strong> e depois em <strong>Adicionar</strong>.
            </Step>
          </>
        )}
        {mode === 'android' && (
          <>
            <Step n={1}>
              No Chrome, toque nos <EllipsisVertical className="inline size-4 align-[-2px]" aria-label="três pontinhos" /> <strong>três pontinhos</strong>, no canto de cima.
            </Step>
            <Step n={2}>
              Toque em <strong>Instalar app</strong> (ou <strong>Adicionar à tela inicial</strong> → <strong>Instalar</strong>).
            </Step>
            <Step n={3}>
              Confirme em <strong>Instalar</strong>. O ícone do Finance MV aparece na tela inicial.
            </Step>
          </>
        )}
        {mode === 'inapp' && (
          <>
            <Step n={1}>
              Você abriu o link dentro de outro app (WhatsApp, Instagram…), que não instala aplicativos.
            </Step>
            <Step n={2}>
              Toque nos <EllipsisVertical className="inline size-4 align-[-2px]" aria-label="três pontinhos" /> <strong>três pontinhos</strong> e escolha <strong>Abrir no Chrome</strong> (no iPhone, <strong>Abrir no Safari</strong>).
            </Step>
            <Step n={3}>Lá, toque em Entrar e depois em Instalar.</Step>
          </>
        )}
        {mode === 'desktop' && (
          <>
            <Step n={1}>
              Use o <strong>Chrome</strong> ou o <strong>Edge</strong>.
            </Step>
            <Step n={2}>
              Clique no ícone <MonitorDown className="inline size-4 align-[-2px]" aria-hidden /> <strong>Instalar</strong>, no fim da barra de endereço.
            </Step>
            <Step n={3}>
              Se o ícone não aparecer: menu ⋮ → <strong>Transmitir, salvar e compartilhar</strong> → <strong>Instalar página como app</strong>.
            </Step>
          </>
        )}
      </ol>
      {mode === 'inapp' ? (
        <Button variant="secondary" block className="mt-5" icon={<Copy className="size-4" />} onClick={copyLink}>
          Copiar link do app
        </Button>
      ) : (
        <p className="mt-5 text-sm text-muted">O app abre em tela cheia, como qualquer aplicativo, e se atualiza sozinho.</p>
      )}
    </Modal>
  );
}

/** Instala com o prompt nativo quando existe; senão abre o passo a passo. */
function useInstallAction() {
  const { mode, install } = useInstall();
  const [helpOpen, setHelpOpen] = useState(false);
  const run = () => (mode === 'prompt' ? void install() : setHelpOpen(true));
  const help = <InstallInstructions mode={mode} open={helpOpen} onClose={() => setHelpOpen(false)} />;
  return { mode, run, help };
}

/** Faixa discreta convidando a instalar no celular (some se instalado ou dispensado por 14 dias). */
export function InstallBanner() {
  const { mode, run, help } = useInstallAction();
  const [hidden, setHidden] = useState(recentlyDismissed);
  if (hidden || mode === 'installed' || mode === 'desktop') return null;
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
        <Button size="sm" variant="primary" onClick={run}>
          Instalar
        </Button>
        <IconButton size="sm" label="Agora não" onClick={dismiss}>
          <X className="size-4" />
        </IconButton>
      </div>
      {help}
    </>
  );
}

/** Botão compacto para telas de entrada e ajustes. */
export function InstallButton({ className }: { className?: string }) {
  const { mode, run, help } = useInstallAction();
  if (mode === 'installed' || mode === 'desktop') return null;
  return (
    <>
      <Button variant="secondary" block className={className} icon={<Download className="size-4" />} onClick={run}>
        Instalar o app no celular
      </Button>
      {help}
    </>
  );
}

/** Item do menu lateral: sempre disponível enquanto o app não estiver instalado (inclusive no computador). */
export function InstallMenuItem({ className }: { className?: string }) {
  const { mode, run, help } = useInstallAction();
  if (mode === 'installed') return null;
  return (
    <>
      <button type="button" onClick={run} className={className}>
        <Download className="size-[18px] text-brand" aria-hidden /> Instalar app
      </button>
      {help}
    </>
  );
}
