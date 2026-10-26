import { expect, test } from '@playwright/test';
import { createState, installMock } from './mockSupabase';

test('painel mostra a saúde financeira com dicas que levam à tela certa', async ({ page }) => {
  await installMock(page, createState({ withData: true }));
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill('ana@example.com');
  await page.getByLabel('Senha').fill('Senha1234');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  const card = page.getByRole('region', { name: 'Saúde financeira' });
  await expect(card).toBeVisible();
  await expect(card.getByText(/^(Ótima|Boa|Atenção|Cuidado)$/)).toBeVisible();
  await expect(card.getByRole('list', { name: 'Partes da nota' }).getByRole('listitem')).toHaveCount(4);
  await page.screenshot({ path: `e2e-screens/painel-${test.info().project.name}.png`, fullPage: true });
  const tip = card.getByRole('list', { name: 'Como melhorar' }).getByRole('link').first();
  if (await tip.count()) {
    await tip.click();
    await expect(page).toHaveURL(/\/(economia|compromissos|previsao|metas)/);
  }
});
