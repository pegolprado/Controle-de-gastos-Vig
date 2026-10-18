import { expect, test, type Page } from '@playwright/test';
import { createState, installMock } from './mockSupabase';

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

async function login(page: Page) {
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill('ana@example.com');
  await page.getByLabel('Senha').fill('Senha1234');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByText('Saldo consolidado hoje')).toBeVisible();
}

test('resumo do mês aparece nos primeiros dias do mês seguinte e pode ser dispensado', async ({ page }) => {
  const now = new Date();
  // os dados de exemplo estão no mês atual; o navegador "vive" no dia 2 do mês seguinte
  await page.clock.setFixedTime(new Date(now.getFullYear(), now.getMonth() + 1, 2, 12, 0, 0));
  await installMock(page, createState({ withData: true }));
  await login(page);
  const recap = page.getByRole('region', { name: `Resumo de ${MONTHS[now.getMonth()]}` });
  await expect(recap).toBeVisible();
  await expect(recap.getByText('Entrou')).toBeVisible();
  await expect(recap.getByText('Onde mais gastou')).toBeVisible();
  await expect(recap.getByText('Moradia')).toBeVisible();
  await recap.getByRole('button', { name: 'Fechar resumo' }).click();
  await expect(recap).toBeHidden();
  await page.reload();
  await expect(page.getByText('Saldo consolidado hoje')).toBeVisible();
  await expect(page.getByRole('region', { name: /^Resumo de / , exact: false }).filter({ hasText: 'Onde mais gastou' })).toHaveCount(0);
});

test('categoria automática ao lançar à mão (aprende com o histórico)', async ({ page }) => {
  await installMock(page, createState({ withData: true }));
  await login(page);
  await page.getByRole('button', { name: /Novo lançamento/ }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Descrição').fill('Uber');
  await expect(dialog.getByLabel('Categoria')).toHaveValue(/.+/);
  await expect(dialog.getByLabel('Categoria').locator('option:checked')).toHaveText(/Transporte/);
  await expect(dialog.getByText('Sugerida pelo histórico (pode trocar)')).toBeVisible();
  // quem escolhe manda: trocar a categoria desliga a sugestão
  await dialog.getByLabel('Categoria').selectOption({ label: 'Lazer' });
  await dialog.getByLabel('Descrição').fill('Uber para o cinema');
  await expect(dialog.getByLabel('Categoria').locator('option:checked')).toHaveText(/Lazer/);
});
