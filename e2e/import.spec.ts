import { expect, test, type Page } from '@playwright/test';
import { createState, installMock } from './mockSupabase';

const br = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toLocaleDateString('pt-BR');
};

async function openImport(page: Page) {
  await page.goto('/lancamentos');
  await page.getByRole('button', { name: 'Importar' }).click();
  return page.getByRole('dialog', { name: 'Importar extrato' });
}

test('importa extrato CSV: sugere categoria, marca parecidos e não duplica ao reimportar', async ({ page }) => {
  const state = createState({ withData: true });
  await installMock(page, state);
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill('ana@example.com');
  await page.getByLabel('Senha').fill('Senha1234');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByText('Saldo consolidado hoje')).toBeVisible();

  // "Uber" de 2 dias atrás já foi lançado à mão (mesma data e valor) → parecido, desmarcado
  const csv = [
    'Data;Descrição;Valor',
    `${br(-5)};SALDO ANTERIOR;1.000,00`,
    `${br(-2)};Uber;-32,90`,
    `${br(-1)};Uber;-25,00`,
    `${br(-1)};Pix recebido João;150,00`,
  ].join('\n');
  const file = { name: 'extrato.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') };

  let dialog = await openImport(page);
  await dialog.getByLabel('Arquivo do extrato').setInputFiles(file);
  await expect(dialog.getByText('3 lançamentos encontrados')).toBeVisible();
  await dialog.getByRole('button', { name: 'Revisar lançamentos' }).click();
  await expect(dialog.getByText('2 novos')).toBeVisible();
  await expect(dialog.getByText('1 parecido com lançamento já cadastrado (desmarcado)')).toBeVisible();
  await expect(dialog.getByText(`${br(-1)} · Transporte`, { exact: true })).toBeVisible(); // categoria aprendida do "Uber" existente
  await dialog.getByRole('button', { name: 'Importar 2 lançamentos' }).click();
  await expect(page.getByText('2 lançamentos importados.')).toBeVisible();
  await expect(dialog).toBeHidden();
  const imported = state.tables.transactions.filter((t) => (t.tags as string[]).includes('importado'));
  expect(imported.map((t) => [t.kind, t.status, t.amount_cents])).toEqual([
    ['expense', 'paid', 2500],
    ['income', 'received', 15000],
  ]);

  // reimportar o mesmo arquivo: nada novo
  dialog = await openImport(page);
  await dialog.getByLabel('Arquivo do extrato').setInputFiles(file);
  await dialog.getByRole('button', { name: 'Revisar lançamentos' }).click();
  await expect(dialog.getByText('0 novos')).toBeVisible();
  await expect(dialog.getByText('2 já importados')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Importar 0 lançamentos' })).toBeDisabled();
});
