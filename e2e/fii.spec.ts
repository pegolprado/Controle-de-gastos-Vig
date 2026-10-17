import { expect, test } from '@playwright/test';
import { createState, installMock } from './mockSupabase';

test('Renda FII: código + quantidade mostram quanto e quando recebo, e lançam a receita', async ({ page }) => {
  const state = createState({ withData: true });
  await installMock(page, state);
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill('ana@example.com');
  await page.getByLabel('Senha').fill('Senha1234');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByText('Saldo consolidado hoje')).toBeVisible();

  await page.goto('/renda-fii');
  await expect(page.getByText('Nenhum fundo na carteira')).toBeVisible();

  const add = async (ticker: string, qty: string) => {
    await page.getByRole('button', { name: 'Adicionar fundo' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Adicionar fundo' });
    await dialog.getByLabel('Código do fundo').fill(ticker);
    await dialog.getByLabel('Quantidade de cotas').fill(qty);
    await dialog.getByRole('button', { name: 'Salvar' }).click();
    return dialog;
  };

  await add('hsml', '24');
  await expect(page.getByText('HSML11 adicionado à carteira.')).toBeVisible();
  await add('BRCO11', '22');
  await add('XPML11', '10');
  await expect(page.getByRole('dialog', { name: 'Adicionar fundo' })).toBeHidden();
  const wrong = await add('XXXX11', '5');
  await expect(wrong.getByRole('alert')).toContainText('Não encontramos XXXX11');
  await wrong.getByRole('button', { name: 'Cancelar' }).click();

  // como no exemplo: HSML11 R$ 18,00 recebido; BRCO11 R$ 20,02 daqui a 2 dias
  await expect(page.getByText('R$ 18,00').first()).toBeVisible();
  await expect(page.getByText('Recebido', { exact: true })).toBeVisible();
  await expect(page.getByText('R$ 20,02').first()).toBeVisible();
  await expect(page.getByText('Daqui a 2 dias')).toBeVisible();
  await expect(page.getByText('Rendimento: R$ 0,91')).toBeVisible();
  // XPML11 ainda não anunciou: previsão pelo histórico, com contagem de dias
  await expect(page.getByText(/^(daqui a \d+ dias|amanhã|hoje|aguardando anúncio)$/i).first()).toBeVisible();
  await expect(page.getByText('previsto', { exact: true })).toBeVisible();
  await expect(page.getByText('Previsto: R$ 0,92')).toBeVisible();
  await expect(page.getByText(/Deve cair em/)).toBeVisible();
  // o que cai antes vem primeiro: BRCO11 (daqui a 2 dias) antes de HSML11 (já recebido, sem previsão suficiente)
  const tickers = await page.locator('p.font-display').allInnerTexts();
  expect(tickers[0]).toBe('BRCO11');

  await page.getByRole('button', { name: 'Mais detalhes' }).first().click();
  await expect(page.getByText('Data com', { exact: true })).toBeVisible();
  await page.screenshot({ path: `e2e-screens/fii-${test.info().project.name}.png`, fullPage: true });

  await page.getByRole('radio', { name: 'Próximos pagamentos' }).click();
  await expect(page.getByText(/ainda não anunciado/)).toBeVisible();
  await page.getByRole('button', { name: 'Lançar como receitas' }).click();
  const launch = page.getByRole('dialog', { name: 'Lançar como receita' });
  await launch.getByRole('button', { name: /Lançar/ }).click();
  await expect(page.getByText('1 receita lançada em Compromissos → A receber.')).toBeVisible();
  const tx = state.tables.transactions.find((t) => (t.tags as string[]).includes('fii'));
  expect(tx).toMatchObject({ kind: 'income', status: 'pending', amount_cents: 2002, description: 'Rendimento BRCO11' });
  await expect(page.getByRole('button', { name: 'Tudo lançado' })).toBeVisible();
});
