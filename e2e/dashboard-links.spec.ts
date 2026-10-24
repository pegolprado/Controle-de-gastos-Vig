import { expect, test } from '@playwright/test';
import { createState, installMock } from './mockSupabase';

test('quadros do Painel levam aos detalhes', async ({ page }) => {
  await installMock(page, createState({ withData: true }));
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill('ana@example.com');
  await page.getByLabel('Senha').fill('Senha1234');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByText('Saldo consolidado hoje')).toBeVisible();

  await page.getByRole('link', { name: 'A receber: ver detalhes' }).click();
  await expect(page).toHaveURL(/\/compromissos\?aba=receber/);
  await expect(page.getByRole('tab', { name: /A receber/ })).toHaveAttribute('aria-selected', 'true');
  await page.goBack();

  await page.getByRole('link', { name: 'Despesas do mês: ver detalhes' }).click();
  await expect(page).toHaveURL(/\/lancamentos\?.*de=\d{4}-\d{2}-01&ate=.*tipo=expense/);
  await page.goBack();

  await page.getByRole('link', { name: 'Resultado: ver detalhes' }).click();
  await expect(page).toHaveURL(/\/relatorios\?de=.*&ate=/);
  await page.goBack();

  await page.getByRole('link', { name: 'Faturas em aberto: ver detalhes' }).click();
  await expect(page).toHaveURL(/\/cartoes$/);
  await page.goBack();

  await page.getByRole('link', { name: 'Orçamento utilizado: ver orçamentos' }).click();
  await expect(page).toHaveURL(/\/orcamentos$/);
});
