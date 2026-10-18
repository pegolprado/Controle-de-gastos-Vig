/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

function gitSha(): string {
  const fromCi = process.env.GITHUB_SHA || process.env.CF_PAGES_COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA;
  if (fromCi) return fromCi.slice(0, 12);
  try {
    return execSync('git rev-parse --short=12 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'local';
  }
}

const build = {
  version: pkg.version,
  commit: gitSha(),
  builtAt: new Date().toISOString(),
};

/** Publica /version.json (sem cache) para o app detectar novas versões. */
function versionManifest(): Plugin {
  return {
    name: 'finance-os-version',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify(build, null, 2) });
    },
  };
}

const base = process.env.VITE_BASE || '/';

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(build.version),
    __APP_COMMIT__: JSON.stringify(build.commit),
    __APP_BUILT_AT__: JSON.stringify(build.builtAt),
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  plugins: [
    react(),
    tailwindcss(),
    versionManifest(),
    VitePWA({
      // 'prompt': a nova versão só assume o controle quando o usuário confirma
      // (ou automaticamente quando não há formulário aberto). Nada é perdido.
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.png', 'favicon-32.png', 'apple-touch-icon.png', 'logo-mark.png'],
      manifest: {
        id: base,
        name: 'Finance MV',
        short_name: 'Finance MV',
        description: 'Controle financeiro pessoal e familiar.',
        lang: 'pt-BR',
        dir: 'ltr',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#070b14',
        theme_color: '#070b14',
        categories: ['finance', 'productivity'],
        icons: [
          { src: `${base}pwa-192.png`, sizes: '192x192', type: 'image/png' },
          { src: `${base}pwa-512.png`, sizes: '512x512', type: 'image/png' },
          { src: `${base}pwa-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Nova despesa', url: `${base}?novo=expense`, icons: [{ src: `${base}pwa-192.png`, sizes: '192x192' }] },
          { name: 'Lançamentos', url: `${base}lancamentos`, icons: [{ src: `${base}pwa-192.png`, sizes: '192x192' }] },
        ],
      },
      workbox: {
        // Somente o "casco" da aplicação é cacheado. Dados financeiros NUNCA
        // são cacheados pelo service worker (Supabase fica fora do cache).
        // O manifesto (nome e ícone do app instalado) fica FORA do cache — o
        // plugin sempre o inclui, então scripts/postbuild.mjs o remove do sw.js.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // avisos no celular (Web Push): recebe e abre a notificação
        importScripts: [`${base}push-sw.js`],
        // o gerador de PDF é pesado e raro: baixado sob demanda, não no pré-cache
        globIgnores: ['**/jspdf*.js', '**/html2canvas*.js', '**/index.es-*.js', '**/purify*.js', '**/jspdf.plugin*.js'],
        navigateFallback: `${base}index.html`,
        navigateFallbackDenylist: [/\/version\.json$/],
        cleanupOutdatedCaches: true,
        clientsClaim: false,
        skipWaiting: false,
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin === self.location.origin && /\/assets\/(jspdf|html2canvas|index\.es|purify).*\.js$/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'fos-lazy-assets', expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 30 } },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@supabase')) return 'supabase';
          if (id.includes('react-router') || id.includes('react-dom') || id.includes('/react/') || id.includes('scheduler')) return 'react';
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
});
