import { expect, test } from '@playwright/test';
import { createState, installMock } from './mockSupabase';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const day = (n: number) => { const t = new Date(); return iso(new Date(t.getFullYear(), t.getMonth(), t.getDate() + n)); };

test('economia: assinaturas, compras frequentes e tarifas, e vira recorrente', async ({ page }) => {
  const state = createState({ withData: true });
  const base = state.tables.transactions[1]!;
  const add = (description: string, amount_cents: number, occurred_on: string) =>
    state.tables.transactions.push({ ...base, id: `x-${state.tables.transactions.length}`, description, amount_cents, paid_cents: amount_cents, occurred_on, due_on: null, recurrence_id: null });
  for (let m = 5; m >= 0; m--) { add('Netflix', 5590, day(-30 * m - 1)); add('Spotify', 2190, day(-30 * m - 3)); }
  for (const d of [-2, -5, -9, -14, -18, -25]) add('iFood', 4500, day(d));
  add('Tarifa pacote de serviços', 4500, day(-10));
  await installMock(page, state);
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill('ana@example.com');
  await page.getByLabel('Senha').fill('Senha1234');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByText('Saldo consolidado hoje')).toBeVisible();
  await page.goto('/economia');

  await expect(page.getByRole('region', { name: 'Economia possível' }).getByText('Dá para economizar cerca de')).toBeVisible();
  await expect(page.getByText('6 compras em iFood em 30 dias')).toBeVisible();
  await expect(page.getByText(/em tarifas, juros e encargos em 90 dias/)).toBeVisible();
  const subs = page.getByRole('list', { name: 'Cobranças mensais' });
  await expect(subs.getByText('Netflix')).toBeVisible();
  await page.screenshot({ path: `e2e-screens/economia-${test.info().project.name}.png`, fullPage: true });

  await subs.getByRole('listitem').filter({ hasText: 'Spotify' }).getByRole('button', { name: 'Tornar recorrente' }).click();
  await expect(page.getByText(/Spotify agora é recorrente/)).toBeVisible();
  expect(state.tables.recurrences.find((r) => r.description === 'Spotify')).toMatchObject({ amount_cents: 2190, frequency: 'monthly' });

  // ocultar um aviso
  await page.getByRole('button', { name: 'Ocultar este aviso' }).first().click();
  await expect(page.getByRole('button', { name: /Mostrar avisos ocultos \(1\)/ })).toBeVisible();
});
