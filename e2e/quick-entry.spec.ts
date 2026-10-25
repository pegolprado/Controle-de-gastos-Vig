import { expect, test, type Page } from '@playwright/test';
import { createState, installMock } from './mockSupabase';

async function openForm(page: Page) {
  const state = createState({ withData: true });
  await installMock(page, state);
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill('ana@example.com');
  await page.getByLabel('Senha').fill('Senha1234');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByText('Saldo consolidado hoje')).toBeVisible();
  await page.getByRole('button', { name: /Novo lançamento/ }).first().click();
  return { state, dialog: page.getByRole('dialog') };
}

test('lançamento em linguagem natural preenche o formulário', async ({ page }) => {
  const { state, dialog } = await openForm(page);
  const quick = dialog.getByLabel(/Escreva o lançamento/);
  await expect(quick).toBeFocused();
  await quick.fill('Gastei 42,50 reais no mercado');
  await quick.press('Enter');
  await expect(dialog.getByLabel('Descrição')).toHaveValue('Mercado');
  await expect(dialog.getByLabel('Categoria').locator('option:checked')).toHaveText(/Alimentação/);
  await dialog.getByRole('button', { name: /^Salvar|^Registrar/ }).click();
  await expect(dialog).toBeHidden();
  expect(state.tables.transactions.find((t) => t.description === 'Mercado')).toMatchObject({ kind: 'expense', amount_cents: 4250 });
});

test('compra parcelada no cartão por texto', async ({ page }) => {
  const { dialog } = await openForm(page);
  const quick = dialog.getByLabel(/Escreva o lançamento/);
  await quick.fill('jantar 600 em 3x no Roxinho');
  await quick.press('Enter');
  await expect(dialog.getByLabel('Descrição')).toHaveValue('Jantar');
  await expect(dialog.getByLabel('Parcelas')).toHaveValue('3');
  await expect(dialog.getByLabel('Cartão').locator('option:checked')).toHaveText(/Roxinho/);
  await expect(dialog.getByLabel('Categoria').locator('option:checked')).toHaveText(/Alimentação/);
});

test('comprovante: lê valor, data e loja pela foto (OCR no aparelho)', async ({ page, browser }) => {
  test.slow();
  // gera uma foto de cupom fiscal
  const shot = await browser.newPage({ viewport: { width: 420, height: 560 } });
  await shot.setContent(`<body style="margin:0;background:#fff;font:22px monospace;padding:24px;color:#111;line-height:1.5">
    <div style="font-weight:bold">PADARIA PAO QUENTE</div><div>CNPJ 12.345.678/0001-90</div><div>------------------------------</div>
    <div>PAO FRANCES      12,40</div><div>CAFE              8,50</div><div>------------------------------</div>
    <div style="font-weight:bold">VALOR A PAGAR R$ 20,90</div><div>20/10/2026 08:15</div></body>`);
  const image = await shot.screenshot();
  await shot.close();

  const { dialog } = await openForm(page);
  await dialog.locator('input[type=file][accept="image/*"]').first().setInputFiles({ name: 'cupom.png', mimeType: 'image/png', buffer: image });
  await expect(dialog.getByLabel('Descrição')).toHaveValue(/Padaria Pao Quente/i, { timeout: 60_000 });
  await expect(dialog.getByLabel('Valor')).toHaveValue(/20,90/);
  await expect(dialog.getByLabel('Data', { exact: true })).toHaveValue('2026-10-20');
});
