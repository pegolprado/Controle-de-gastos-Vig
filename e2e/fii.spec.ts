import { expect, test, type Page } from '@playwright/test';
import { createState, installMock, type MockState } from './mockSupabase';

async function setup(page: Page): Promise<MockState> {
  await page.clock.setFixedTime(new Date(2026, 9, 17, 12, 0, 0)); // 17/10/2026, como no relato do usuário
  const state = createState({ withData: true });
  await installMock(page, state);
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill('ana@example.com');
  await page.getByLabel('Senha').fill('Senha1234');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByText('Saldo consolidado hoje')).toBeVisible();
  await page.goto('/renda-fii');
  return state;
}

async function add(page: Page, ticker: string, qty: string, type: 'fii' | 'stock' = 'fii') {
  await page.getByRole('button', { name: /^Adicionar/ }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Adicionar à carteira' });
  if (type === 'stock') await dialog.getByRole('radio', { name: 'Ação' }).click();
  await dialog.getByLabel(type === 'fii' ? 'Código do fundo' : 'Código da ação').fill(ticker);
  await dialog.getByLabel(type === 'fii' ? 'Quantidade de cotas' : 'Quantidade de ações').fill(qty);
  await dialog.getByRole('button', { name: 'Salvar' }).click();
  return dialog;
}

test('Renda: FII e ações, mês vigente, compras com data e lançamento de receitas', async ({ page }) => {
  const state = await setup(page);
  await expect(page.getByText('Nenhum ativo na carteira')).toBeVisible();

  await add(page, 'hsml', '24');
  await expect(page.getByRole('dialog', { name: 'Adicionar à carteira' })).toBeHidden();
  await add(page, 'BRCO11', '22');
  await expect(page.getByRole('dialog', { name: 'Adicionar à carteira' })).toBeHidden();
  await add(page, 'XPML11', '10');
  await expect(page.getByRole('dialog', { name: 'Adicionar à carteira' })).toBeHidden();
  await add(page, 'petr4', '100', 'stock');
  await expect(page.getByRole('dialog', { name: 'Adicionar à carteira' })).toBeHidden();
  const wrong = await add(page, 'XXXX11', '5');
  await expect(wrong.getByRole('alert')).toContainText('Não encontramos XXXX11');
  await wrong.getByRole('button', { name: 'Cancelar' }).click();

  // posição criada com a operação "já tinha antes" (quantidade vem das operações)
  expect(state.tables.fii_trades).toHaveLength(4);
  expect(state.tables.fii_positions.find((p) => p.ticker === 'PETR4')).toMatchObject({ asset_type: 'stock', quantity: 100 });

  // ordem do mês: a cair (BRCO 19/10, PETR4 21/10, XPML ~23/10) e depois os recebidos (HSML 07/10)
  await expect.poll(() => page.locator('p.font-display').allInnerTexts()).toEqual(['BRCO11', 'PETR4', 'XPML11', 'HSML11']);
  await expect(page.getByText('R$ 20,02').first()).toBeVisible();
  await expect(page.getByText('Daqui a 2 dias', { exact: true })).toBeVisible();
  await expect(page.getByText('R$ 57,29').first()).toBeVisible(); // JCP líquido: 100 × 0,674 × 85%
  await expect(page.getByText('Daqui a 4 dias', { exact: true })).toBeVisible();
  await expect(page.getByText('Daqui a 6 dias', { exact: true })).toBeVisible(); // XPML previsto
  await expect(page.getByText('previsto', { exact: true })).toBeVisible();
  await expect(page.locator('span').getByText('Recebido', { exact: true })).toBeVisible();
  await expect(page.getByText('Caiu em 07/10/2026')).toBeVisible();
  await expect(page.getByText(/Cotação R\$ 59,85/)).toBeVisible();

  // compra depois da data com: entra na quantidade, mas não no provento já pago
  const hsml = page.locator('div.overflow-hidden', { has: page.getByText('HSML11', { exact: true }) });
  await hsml.getByRole('button', { name: 'Mais detalhes' }).click();
  await expect(hsml.getByText('Antes de começar')).toBeVisible();
  await hsml.getByRole('button', { name: 'Registrar compra/venda' }).click();
  const trade = page.getByRole('dialog', { name: 'Registrar operação · HSML11' });
  await trade.getByLabel('Quantidade de cotas').fill('6');
  await trade.getByLabel('Data').fill('2026-10-10');
  await trade.getByRole('button', { name: 'Salvar' }).click();
  await expect(trade).toBeHidden();
  await expect(hsml.getByText(/30 cotas/).first()).toBeVisible();
  await expect(hsml.getByText('R$ 18,00').first()).toBeVisible(); // 24 cotas na data com
  await page.screenshot({ path: `e2e-screens/fii-${test.info().project.name}.png`, fullPage: true });

  // agenda: lançar à mão os anunciados (BRCO e o JCP da PETR4)
  await page.getByRole('radio', { name: 'Agenda', exact: true }).click();
  await expect(page.getByText(/ainda não anunciado/)).toBeVisible();
  await page.getByRole('button', { name: 'Lançar como receitas' }).click();
  const launch = page.getByRole('dialog', { name: 'Lançar como receita' });
  await launch.getByRole('button', { name: /^Lançar/ }).click();
  await expect(page.getByText('2 receitas lançadas em Compromissos → A receber.')).toBeVisible();
  expect(state.tables.transactions.find((t) => t.description === 'JCP PETR4')).toMatchObject({ kind: 'income', status: 'pending', amount_cents: 5729, tags: ['acoes'] });
  expect(state.tables.transactions.find((t) => t.description === 'Rendimento BRCO11')).toMatchObject({ amount_cents: 2002, tags: ['fii'] });

  // piloto automático
  await page.getByRole('switch', { name: 'Piloto automático' }).click();
  await expect(page.getByText('Piloto automático ligado.')).toBeVisible();
  expect(state.tables.renda_settings[0]).toMatchObject({ auto_launch: true });
  await expect(page.getByRole('switch', { name: 'Avisos no celular' })).toBeVisible();

  // meta de renda passiva
  await page.getByRole('radio', { name: 'Meta', exact: true }).click();
  await page.getByLabel('Quanto você quer receber por mês?').fill('100000');
  await page.getByRole('button', { name: 'Salvar meta' }).click();
  await expect(page.getByText(/Faltam/)).toBeVisible();
  await expect(page.getByText('Para bater a meta só com um ativo, você precisaria de…')).toBeVisible();

  // IR
  await page.getByRole('radio', { name: 'IR', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Rendimentos de FII' })).toBeVisible();
});
