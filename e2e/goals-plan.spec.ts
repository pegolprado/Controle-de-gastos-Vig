import { expect, test } from '@playwright/test';
import { createState, installMock } from './mockSupabase';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const months = (n: number) => { const t = new Date(); return iso(new Date(t.getFullYear(), t.getMonth() + n, t.getDate())); };

test('metas inteligentes: plano mensal pela sobra, prazo realista e reserva sugerida', async ({ page }) => {
  const state = createState({ withData: true });
  const ws = state.tables.accounts[0]!.workspace_id;
  state.tables.goal_progress.push(
    { id: 'g1', workspace_id: ws, name: 'Carro novo', target_cents: 6_000_000, saved_cents: 500_000, deadline: months(3), color: '#0ea5e9', icon: 'car', archived: false, created_at: '' },
    { id: 'g2', workspace_id: ws, name: 'Viagem', target_cents: 600_000, saved_cents: 0, deadline: null, color: '#ec4899', icon: 'travel', archived: false, created_at: '' },
  );
  await installMock(page, state);
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill('ana@example.com');
  await page.getByLabel('Senha').fill('Senha1234');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByText('Saldo consolidado hoje')).toBeVisible();
  await page.goto('/metas');

  const plan = page.getByRole('region', { name: 'Seu plano' });
  await expect(plan.getByText('Sobra média por mês')).toBeVisible();
  await expect(plan.getByText('Suas metas pedem')).toBeVisible();
  await expect(page.getByText(/Não cabe na sua sobra\. Prazo realista:/)).toBeVisible();
  await expect(page.getByText(/30% da sua sobra\), chega em/)).toBeVisible();
  await page.screenshot({ path: `e2e-screens/metas-${test.info().project.name}.png`, fullPage: true });

  await page.getByRole('button', { name: 'Nova meta' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nova meta' });
  await dialog.getByRole('radio', { name: 'Reserva de emergência' }).click();
  await expect(dialog.getByLabel('Nome')).toHaveValue('Reserva de emergência');
  await dialog.getByRole('button', { name: /Sugestão: 6 meses dos seus gastos/ }).click();
  await expect(dialog.getByLabel('Valor desejado')).not.toHaveValue('0,00');
  await dialog.getByLabel('Prazo').fill(months(24));
  await expect(dialog).toContainText(/Guarde R\$ [\d.,]+\/mês por 2[34] meses/);
});
