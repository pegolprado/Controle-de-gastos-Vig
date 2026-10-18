import { expect, type Page, test } from '@playwright/test'

const EMAIL = process.env.MARX_E2E_EMAIL ?? 'admin@marx.local'
const PASSWORD = process.env.MARX_E2E_PASSWORD ?? 'Teste!Marx2026'

async function login(page: Page) {
  await page.goto('/login')
  await page.fill('input[type=email]', EMAIL)
  await page.fill('input[type=password]', PASSWORD)
  await page.click('form button.btn-primary')
  await expect(page.getByText('WORKSPACE INVESTIGATIVO')).toBeVisible()
}

const tab = (page: Page, label: string) => page.click(`nav[aria-label="Módulos da análise"] >> text="${label}"`)

test('fluxo completo: demonstração, telas, exportação e apagamento ao sair', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('dialog', (d) => d.accept())
  await login(page)

  await page.click('text=Gerar análise de demonstração')
  await expect(page.getByText('Registros considerados')).toBeVisible()

  for (const t of ['Alvos', 'Arquivos', 'Importações', 'Qualidade', 'Eventos', 'Contatos', 'Comparar', 'Vínculos', 'ERB', 'Mapa', 'Linha do tempo', 'Estatística', 'Cruzamento', 'Alertas', 'Exportar', 'Assistente']) {
    await tab(page, t)
    await page.waitForTimeout(1200)
    await expect(page.locator('[role=alert]'), `erro na tela ${t}`).toHaveCount(0)
  }

  await tab(page, 'Eventos')
  const [xlsx] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Excel")')])
  expect(xlsx.suggestedFilename()).toMatch(/\.xlsx$/)

  await tab(page, 'Exportar')
  await page.selectOption('select >> nth=0', 'full')
  const [pdf] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Gerar e baixar")')])
  expect(pdf.suggestedFilename()).toMatch(/\.pdf$/)
  await expect(page.getByText('SHA-256 do arquivo')).toBeVisible()

  // nada persistido no navegador
  const storage = await page.evaluate(async () => ({ ls: localStorage.length, ss: sessionStorage.length, idb: (await indexedDB.databases()).length }))
  expect(storage).toEqual({ ls: 0, ss: 0, idb: 0 })

  await page.click('text=Sair e apagar')
  await page.waitForURL(/login/)
  await login(page)
  await page.goto('/analise/arquivos')
  await expect(page.getByText('Nenhum arquivo')).toBeVisible()
  expect(errors).toEqual([])
})

test('carregar arquivo do computador e importar pelo assistente', async ({ page }) => {
  await login(page)
  await page.click('text=Análise atual')
  await tab(page, 'Arquivos')
  const lines = ['Origem;Destino;Data;Hora;Duração;Tipo;LAC;CI']
  for (let i = 0; i < 2000; i++) {
    const other = `(61) 9${String(1000 + (i % 37)).padStart(4, '0')}-${String(i).padStart(4, '0')}`
    const out = i % 2 === 0
    lines.push(`${out ? '(61) 99876-5432' : other};${out ? other : '(61) 99876-5432'};${String(1 + (i % 28)).padStart(2, '0')}/04/2026;${String(i % 24).padStart(2, '0')}:10:00;${i % 300};${out ? 'Originada' : 'Recebida'};1100;${20000 + (i % 9)}`)
  }
  await page.setInputFiles('input[type=file]', { name: 'extrato.csv', mimeType: 'text/csv', buffer: Buffer.from(lines.join('\n'), 'utf-8') })
  await page.waitForURL(/importar/)
  for (let i = 0; i < 4; i++) {
    await page.click('button:has-text("Avançar")')
    await page.waitForTimeout(500)
  }
  await page.click('button:has-text("Confirmar e processar")')
  await expect(page.getByText('Abrir registros importados')).toBeVisible()
  await expect(page.getByText('2.000').first()).toBeVisible()
})
