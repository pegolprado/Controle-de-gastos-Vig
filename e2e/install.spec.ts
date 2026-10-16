import { expect, test } from '@playwright/test';
import { createState, installMock } from './mockSupabase';

test('convite para instalar o app usa o prompt nativo do navegador', async ({ page }) => {
  await installMock(page, createState({ withData: true }));
  // simula o evento que o Chrome/Android dispara quando o PWA é instalável
  await page.addInitScript(() => {
    (window as unknown as { __prompted: number }).__prompted = 0;
    window.addEventListener('load', () => {
      const e = new Event('beforeinstallprompt') as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
      e.prompt = async () => {
        (window as unknown as { __prompted: number }).__prompted++;
      };
      e.userChoice = Promise.resolve({ outcome: 'accepted' });
      window.dispatchEvent(e);
    });
  });
  await page.goto('/entrar');
  await expect(page.getByRole('button', { name: 'Instalar o app no celular' })).toBeVisible();
  await page.getByLabel('E-mail').fill('ana@example.com');
  await page.getByLabel('Senha').fill('Senha1234');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  const banner = page.getByRole('region', { name: 'Instalar aplicativo' });
  await expect(banner).toBeVisible();
  await banner.getByRole('button', { name: 'Instalar' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __prompted: number }).__prompted)).toBe(1);
  await expect(banner).toBeHidden();
});

test('sem o prompt nativo: celular mostra o passo a passo; computador só no menu', async ({ page }, info) => {
  await installMock(page, createState({ withData: true }));
  await page.goto('/entrar');
  const loginButton = page.getByRole('button', { name: 'Instalar o app no celular' });
  if (info.project.name === 'mobile') {
    await loginButton.click();
    const help = page.getByRole('dialog', { name: 'Instalar no Android' });
    await expect(help).toBeVisible();
    await expect(help.getByText('Instalar app', { exact: true })).toBeVisible();
    await help.getByRole('button', { name: /fechar/i }).click();
  } else {
    await expect(loginButton).toBeHidden();
  }
  await page.getByLabel('E-mail').fill('ana@example.com');
  await page.getByLabel('Senha').fill('Senha1234');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  const banner = page.getByRole('region', { name: 'Instalar aplicativo' });
  if (info.project.name === 'mobile') {
    await expect(banner).toBeVisible();
    await page.getByRole('button', { name: 'Mais' }).click();
  } else {
    await expect(page.getByRole('heading', { name: 'Seu painel' })).toBeVisible();
    await expect(banner).toBeHidden();
  }
  await page.getByRole('button', { name: 'Instalar app' }).last().click();
  await expect(page.getByRole('dialog', { name: info.project.name === 'mobile' ? 'Instalar no Android' : 'Instalar no computador' })).toBeVisible();
});
