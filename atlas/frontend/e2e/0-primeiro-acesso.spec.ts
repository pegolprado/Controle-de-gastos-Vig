import { test } from '@playwright/test'

// Cria o administrador pela tela de primeiro acesso quando o sistema ainda não tem usuários.
test('primeiro acesso cria o administrador', async ({ page, request }) => {
  const st = await (await request.get('/api/setup')).json()
  test.skip(!st.needed, 'sistema já configurado')
  await page.goto('/login')
  await page.waitForURL(/primeiro-acesso/)
  const inputs = page.locator('form input')
  await inputs.nth(0).fill(process.env.MARX_SETUP_TOKEN ?? 'configuracao-teste-123')
  await inputs.nth(1).fill('Admin E2E')
  await inputs.nth(2).fill(process.env.MARX_E2E_EMAIL ?? 'admin@marx.local')
  await inputs.nth(3).fill(process.env.MARX_E2E_PASSWORD ?? 'Teste!Marx2026')
  await inputs.nth(4).fill(process.env.MARX_E2E_PASSWORD ?? 'Teste!Marx2026')
  await page.click('form button.btn-primary')
  await page.waitForURL(/\/login$/)
})
