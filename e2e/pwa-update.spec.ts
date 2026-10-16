import { expect, test } from '@playwright/test';
import { createState, installMock } from './mockSupabase';

/**
 * Atualização centralizada: quando o servidor publica uma versão mais nova
 * (version.json), o app exibe o aviso — e NÃO recarrega no meio de um formulário.
 */
test('aviso de nova versão respeita formulário aberto', async ({ page }) => {
  await installMock(page, createState({ withData: true }));
  await page.route('**/version.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: '99.0.0', commit: 'abc', builtAt: new Date().toISOString() }) }));
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill('ana@example.com');
  await page.getByLabel('Senha').fill('Senha1234');
  await page.getByRole('button', { name: 'Entrar' }).click();
  const banner = page.getByText('Nova versão disponível (99.0.0)');
  await expect(banner).toBeVisible();

  await page.getByRole('button', { name: /Novo lançamento/ }).first().click();
  await page.getByRole('dialog').getByLabel('Descrição').fill('Rascunho importante');
  await expect(page.getByText('Termine o lançamento em andamento')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Atualizar' })).toBeDisabled();
  await expect(page.getByRole('dialog').getByLabel('Descrição')).toHaveValue('Rascunho importante');
});
