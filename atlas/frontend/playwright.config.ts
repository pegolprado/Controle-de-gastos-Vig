import { defineConfig } from '@playwright/test'

// Teste ponta a ponta no navegador real. Requer a API rodando (porta 8000) com o usuário
// de teste criado — veja docs/TESTES.md. MARX_URL aponta para outro endereço se preciso.
export default defineConfig({
  testDir: 'e2e',
  timeout: 300_000,
  expect: { timeout: 60_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.MARX_URL ?? 'http://localhost:5173',
    ignoreHTTPSErrors: true,
    acceptDownloads: true,
    viewport: { width: 1400, height: 900 },
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  webServer: process.env.MARX_URL ? undefined : { command: 'npm run dev -- --port 5173 --strictPort', url: 'http://localhost:5173', reuseExistingServer: true, timeout: 120_000 },
})
