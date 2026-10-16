import { expect, test, type Page } from '@playwright/test';
import { createState, installMock, type MockState } from './mockSupabase';

async function login(page: Page) {
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill('ana@example.com');
  await page.getByLabel('Senha').fill('Senha1234');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByText('Saldo consolidado hoje')).toBeVisible();
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe('autenticação', () => {
  test('rota privada redireciona para o login', async ({ page }) => {
    await installMock(page, createState());
    await page.goto('/lancamentos');
    await expect(page).toHaveURL(/\/entrar$/);
    await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  });

  test('senha errada mostra erro amigável e não entra', async ({ page }) => {
    await installMock(page, createState());
    await page.goto('/entrar');
    await page.getByLabel('E-mail').fill('ana@example.com');
    await page.getByLabel('Senha').fill('errada');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.getByRole('alert')).toContainText('E-mail ou senha incorretos');
    await expect(page).toHaveURL(/\/entrar$/);
  });

  test('login, sessão persistida após recarregar e logout', async ({ page }) => {
    await installMock(page, createState({ withData: true }));
    await login(page);
    await page.reload();
    await expect(page.getByText('Saldo consolidado hoje')).toBeVisible();
    if ((page.viewportSize()?.width ?? 0) < 1024) await page.getByRole('button', { name: 'Abrir menu' }).click();
    await page.getByRole('button', { name: 'Sair' }).first().click();
    await expect(page).toHaveURL(/\/entrar/);
  });

  test('cadastro exige senha forte e consentimento', async ({ page }) => {
    await installMock(page, createState());
    await page.goto('/cadastro');
    const submit = page.getByRole('button', { name: 'Criar conta' });
    await page.getByLabel('E-mail').fill('novo@example.com');
    await page.getByLabel('Senha').fill('123');
    await expect(submit).toBeDisabled();
    await page.getByLabel('Senha').fill('Forte1234');
    await expect(submit).toBeDisabled();
    await page.getByRole('checkbox').check();
    await expect(submit).toBeEnabled();
  });

  test('recuperação de senha não revela se o e-mail existe', async ({ page }) => {
    await installMock(page, createState());
    await page.goto('/recuperar');
    await page.getByLabel('E-mail').fill('qualquer@example.com');
    await page.getByRole('button', { name: 'Enviar link' }).click();
    await expect(page.getByRole('status')).toContainText('Se houver uma conta');
  });
});

test.describe('painel e lançamentos', () => {
  let s: MockState;
  test.beforeEach(async ({ page }) => {
    s = createState({ withData: true });
    await installMock(page, s);
    await login(page);
  });

  test('painel mostra saldos e indicadores reais do usuário', async ({ page }) => {
    // saldo: 2.500 + 150 + 8.500 − 2.300 − 684,90 − 32,90 = 8.132,20
    await expect(page.getByText('R$ 8.132,20')).toBeVisible();
    await expect(page.getByText('Receitas do mês')).toBeVisible();
    await expect(page.getByText('Vencem em breve')).toBeVisible();
    await expect(page.getByText('Internet').first()).toBeVisible();
    await noHorizontalScroll(page);
    await page.screenshot({ path: `e2e-screens/dashboard-${test.info().project.name}.png`, fullPage: true });
  });

  test('cria despesa: cliques repetidos não duplicam', async ({ page }) => {
    const before = s.tables.transactions.length;
    await page.getByRole('button', { name: /Novo lançamento/ }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Valor').fill('4590');
    await dialog.getByLabel('Descrição').fill('Farmácia');
    await page.screenshot({ path: `e2e-screens/form-${test.info().project.name}.png` });
    const save = dialog.getByRole('button', { name: 'Salvar', exact: true });
    await save.dblclick();
    await expect(page.getByText('Despesa registrada.')).toBeVisible();
    expect(s.tables.transactions.length).toBe(before + 1);
    const created = s.tables.transactions.at(-1)!;
    expect(created.amount_cents).toBe(4590);
    expect(created.client_request_id).toBeTruthy();
  });

  test('falha de rede: não finge que salvou e o reenvio não duplica', async ({ page }) => {
    const before = s.tables.transactions.length;
    s.failNextInsert = true;
    await page.getByRole('button', { name: /Novo lançamento/ }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Valor').fill('1000');
    await dialog.getByLabel('Descrição').fill('Padaria');
    await dialog.getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect(page.getByText(/servidor|conexão/i).first()).toBeVisible();
    await expect(dialog).toBeVisible(); // formulário mantido, nada perdido
    expect(s.tables.transactions.length).toBe(before);
    await dialog.getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect(page.getByText('Despesa registrada.')).toBeVisible();
    expect(s.tables.transactions.length).toBe(before + 1);
  });

  test('extrato com busca e detalhe do lançamento', async ({ page }) => {
    await page.goto('/lancamentos');
    await expect(page.getByText('Mercado Pão de Açúcar')).toBeVisible();
    await page.getByLabel('Pesquisar lançamentos').fill('uber');
    await expect(page.getByText('Mercado Pão de Açúcar')).toBeHidden();
    await page.getByText('Uber').first().click();
    await expect(page.getByRole('dialog')).toContainText('R$ 32,90');
    await noHorizontalScroll(page);
  });

  test('excluir exige confirmação', async ({ page }) => {
    await page.goto('/lancamentos');
    await page.getByText('Uber').first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Excluir' }).click();
    await expect(page.getByRole('heading', { name: 'Excluir lançamento?' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancelar' }).last().click();
    expect(s.tables.transactions.some((t) => t.description === 'Uber')).toBe(true);
  });

  for (const path of ['/contas', '/cartoes', '/compromissos', '/orcamentos', '/metas', '/recorrencias', '/relatorios', '/espaco', '/ajustes', '/categorias']) {
    test(`tela ${path} carrega sem erro e sem rolagem horizontal`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(path);
      await expect(page.locator('h1').first()).toBeVisible();
      await page.waitForLoadState('networkidle');
      await noHorizontalScroll(page);
      expect(errors).toEqual([]);
      await page.screenshot({ path: `e2e-screens${path}-${test.info().project.name}.png`, fullPage: true });
    });
  }
});

test('painel administrativo só para o proprietário do app', async ({ page }) => {
  await installMock(page, createState({ withData: true }));
  await login(page);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/$/); // redirecionado
});

test('proprietário acessa o painel administrativo', async ({ page }) => {
  await installMock(page, createState({ withData: true, isOwner: true }));
  await login(page);
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Administração' })).toBeVisible();
  await expect(page.getByText('42', { exact: true })).toBeVisible();
  await page.screenshot({ path: `e2e-screens/admin-${test.info().project.name}.png`, fullPage: true });
});

test.describe('PWA', () => {
  test('manifesto, ícones e version.json publicados', async ({ request }) => {
    const manifest = await (await request.get('/manifest.webmanifest')).json();
    expect(manifest.name).toBe('FINANCE OS');
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons.length).toBeGreaterThanOrEqual(3);
    const version = await (await request.get('/version.json')).json();
    expect(version.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect((await request.get('/sw.js')).ok()).toBe(true);
    expect((await request.get('/pwa-512.png')).ok()).toBe(true);
  });
});
