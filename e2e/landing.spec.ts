import { expect, test } from '@playwright/test';
import { createState, installMock } from './mockSupabase';

test('tela de entrada apresenta o app e mantém o formulário à mão', async ({ page }) => {
  await installMock(page, createState());
  await page.goto('/entrar');
  await expect(page.getByRole('heading', { name: 'Entrar', level: 1 })).toBeVisible();
  await expect(page.getByText(/piloto automático/).first()).toBeVisible();
  await expect(page.getByLabel('E-mail')).toBeInViewport();
  await expect(page.getByRole('list', { name: 'Recursos' }).getByText('Previsão do saldo')).toBeAttached();
  const name = test.info().project.name;
  await page.screenshot({ path: `e2e-screens/entrada-${name}-claro.png`, fullPage: true });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: `e2e-screens/entrada-${name}-escuro.png`, fullPage: true });
});
