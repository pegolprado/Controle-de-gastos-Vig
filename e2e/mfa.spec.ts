import { expect, test, type Page } from '@playwright/test';
import { createState, installMock, MOCK_TOTP } from './mockSupabase';

async function passwordLogin(page: Page) {
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill('ana@example.com');
  await page.getByLabel('Senha').fill('Senha1234');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
}

test('2FA: ativa com o app autenticador e passa a pedir o código ao entrar', async ({ page }) => {
  const state = createState({ withData: true });
  await installMock(page, state);
  await passwordLogin(page);
  await expect(page.getByText('Saldo consolidado hoje')).toBeVisible();

  // ativar em Ajustes
  await page.goto('/ajustes');
  const card = page.getByRole('region', { name: 'Verificação em duas etapas' });
  await expect(card.getByText('Desativada')).toBeVisible();
  await card.getByRole('button', { name: 'Ativar' }).click();
  const dialog = page.getByRole('dialog', { name: 'Ativar verificação em duas etapas' });
  await expect(dialog.getByRole('img', { name: 'QR code para o app autenticador' })).toBeVisible();
  await expect(dialog.getByText('JBSWY3DPEHPK3PXP')).toBeVisible();
  await dialog.getByLabel('Código de 6 dígitos').fill('000000');
  await dialog.getByRole('button', { name: 'Ativar' }).click();
  await expect(page.getByText(/Código incorreto/)).toBeVisible();
  await dialog.getByLabel('Código de 6 dígitos').fill(MOCK_TOTP);
  await dialog.getByRole('button', { name: 'Ativar' }).click();
  await expect(dialog).toBeHidden();
  await expect(card.getByText('Ativada')).toBeVisible();
  expect(state.mfa.factor).toMatchObject({ status: 'verified' });

  // sair e entrar de novo: senha sozinha não basta
  await page.evaluate(() => localStorage.clear());
  await passwordLogin(page);
  await expect(page.getByRole('heading', { name: 'Verificação em duas etapas' })).toBeVisible();
  await expect(page.getByText('Saldo consolidado hoje')).toBeHidden();
  await page.getByLabel('Código do app autenticador').fill('111111');
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByRole('alert')).toContainText('Código incorreto');
  await page.getByLabel('Código do app autenticador').fill(MOCK_TOTP);
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByText('Saldo consolidado hoje')).toBeVisible();
});
