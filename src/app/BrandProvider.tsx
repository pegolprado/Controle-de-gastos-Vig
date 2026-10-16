import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchAppSettings } from '@/services/session';
import type { AppSettings } from '@/lib/types';
import { isConfigured } from '@/lib/env';

const DEFAULTS: AppSettings = {
  app_name: 'FINANCE OS',
  tagline: 'Seu dinheiro, em ordem.',
  logo_url: null,
  primary_color: '#10b981',
  signup_mode: 'open',
  features: { shared_workspaces: true, attachments: true, exports: true, support_access: true },
  limits: {},
  min_client_version: null,
  maintenance_message: null,
  updated_at: '',
};

/** Cor de texto legível (WCAG) sobre a cor da marca escolhida pelo administrador. */
function readableOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.4 ? '#03140d' : '#ffffff';
}

const BrandContext = createContext<AppSettings>(DEFAULTS);

export function BrandProvider({ children }: { children: ReactNode }) {
  const { data } = useQuery({
    queryKey: ['app-settings'],
    queryFn: fetchAppSettings,
    enabled: isConfigured,
    staleTime: 5 * 60_000,
    refetchInterval: 15 * 60_000,
  });
  const settings = data ?? DEFAULTS;

  useEffect(() => {
    document.title = settings.app_name;
    const color = settings.primary_color;
    if (/^#[0-9a-f]{6}$/i.test(color)) {
      document.documentElement.style.setProperty('--brand', color);
      document.documentElement.style.setProperty('--brand-fg', readableOn(color));
      try {
        localStorage.setItem('fos.brand', color);
      } catch {
        /* ignore */
      }
    }
  }, [settings.app_name, settings.primary_color]);

  return <BrandContext.Provider value={settings}>{children}</BrandContext.Provider>;
}

export const useBrand = () => useContext(BrandContext);
