import { expect, test, type Page } from '@playwright/test';
import { createState, installMock, type MockState } from './mockSupabase';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const day = (n: number) => { const t = new Date(); return iso(new Date(t.getFullYear(), t.getMonth(), t.getDate() + n)); };

function withSalary(state: MockState) {
  const acc = state.tables.accounts[0]!;
  // salário mensal: a próxima ocorrência ainda não gerada cai daqui a ~12 dias
  const t = new Date();
  const start = iso(new Date(t.getFullYear(), t.getMonth() - 1, t.getDate() + 12));
  state.tables.recurrences.push({
    id: 'rec-sal', workspace_id: acc.workspace_id, kind: 'income', description: 'Salário', amount_cents: 850000, category_id: null, account_id: acc.id, card_id: null,
    payment_method: 'pix', tags: [], notes: null, frequency: 'monthly', interval_count: 1, start_date: start, end_date: null, occurrences_generated: 1, status: 'active',
  });
  return acc;
}

async function login(page: Page) {
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill('ana@example.com');
  await page.getByLabel('Senha').fill('Senha1234');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByText('Saldo consolidado hoje')).toBeVisible();
}

test('previsão: chega ao salário e responde "posso gastar?"', async ({ page }) => {
  const state = createState({ withData: true });
  withSalary(state);
  await installMock(page, state);
  await login(page);
  await expect(page.getByText(/Você chega ao salário/)).toBeVisible();
  await page.getByRole('link', { name: 'Previsão do saldo: ver detalhes' }).click();
  await expect(page).toHaveURL(/\/previsao$/);
  const summary = page.getByRole('region', { name: 'Resumo da previsão' });
  await expect(summary.getByText(/Tudo em dia/)).toBeVisible();
  await expect(summary.getByText(/No dia do salário/)).toBeVisible();
  await expect(page.locator('figure[aria-label="Saldo previsto dia a dia"]')).toBeVisible();
  const ask = page.getByRole('region', { name: 'Posso gastar?' });
  await ask.getByLabel('Quanto quer gastar hoje?').fill('100,00');
  await expect(ask.getByRole('status')).toContainText('Pode sim.');
  await ask.getByLabel('Quanto quer gastar hoje?').fill('900000,00');
  await expect(ask.getByRole('status')).toContainText('Melhor esperar.');
  await page.screenshot({ path: `e2e-screens/previsao-${test.info().project.name}.png`, fullPage: true });
});

test('previsão avisa quando o saldo vai ficar negativo antes do salário', async ({ page }) => {
  const state = createState({ withData: true });
  const acc = withSalary(state);
  const base = state.tables.transactions[0]!;
  state.tables.transactions.push({ ...base, id: 'big-bill', kind: 'expense', status: 'pending', description: 'Reforma', amount_cents: 2_000_000, paid_cents: 0, category_id: null, account_id: acc.id, occurred_on: day(3), due_on: day(3) });
  await installMock(page, state);
  await login(page);
  await expect(page.getByText(/Pode ficar/)).toBeVisible();
  await page.goto('/previsao');
  await expect(page.getByRole('region', { name: 'Resumo da previsão' }).getByText(/negativo/)).toBeVisible();
  await expect(page.getByRole('list', { name: 'Movimentos previstos' }).getByText('Reforma')).toBeVisible();
});

test('sem salário cadastrado: explica, não confunde provento com salário e mostra a conta', async ({ page }) => {
  const state = createState({ withData: true });
  const acc = state.tables.accounts[0]!;
  const base = state.tables.transactions[0]!;
  state.tables.transactions.push({ ...base, id: 'jcp', kind: 'income', status: 'pending', description: 'JCP PETR4', amount_cents: 114, paid_cents: 0, category_id: null, account_id: acc.id, occurred_on: day(20), due_on: day(20) });
  await installMock(page, state);
  await login(page);
  await expect(page.getByText(/Salário não encontrado/)).toBeVisible();
  await page.goto('/previsao');
  const summary = page.getByRole('region', { name: 'Resumo da previsão' });
  await expect(summary.getByText('Não encontrei seu salário')).toBeVisible();
  await summary.getByText('Por que esse número?').click();
  await expect(summary.getByText('Saldo hoje')).toBeVisible();
  await expect(summary.getByText('Entradas previstas')).toBeVisible();
  await summary.getByRole('button', { name: 'Cadastrar salário' }).click();
  await expect(page.getByRole('dialog', { name: 'Novo lançamento' }).getByRole('radio', { name: 'Receita' })).toHaveAttribute('aria-checked', 'true');
});
