import { expect, test, type Page } from '@playwright/test';
import { createState, installMock } from './mockSupabase';

/** Microfone de mentira: ao começar a ouvir, "escuta" a frase combinada. */
async function fakeSpeech(page: Page, phrase: string) {
  await page.addInitScript((said) => {
    class FakeRecognition {
      lang = '';
      interimResults = false;
      continuous = false;
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        setTimeout(() => {
          const alt = Object.assign([{ transcript: said }], { isFinal: true });
          this.onresult?.({ results: [alt] });
          this.onend?.();
        }, 150);
      }
      stop() {
        this.onend?.();
      }
    }
    const w = window as unknown as Record<string, unknown>;
    w.SpeechRecognition = FakeRecognition;
    w.webkitSpeechRecognition = FakeRecognition;
  }, phrase);
}

async function login(page: Page) {
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill('ana@example.com');
  await page.getByLabel('Senha').fill('Senha1234');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByText('Saldo consolidado hoje')).toBeVisible();
}

test('falar um gasto: duas despesas numa frase, salvas no lugar certo, com desfazer', async ({ page }) => {
  await fakeSpeech(page, 'gastei 100 reais com gasolina e 35 com mercado');
  const state = createState({ withData: true });
  await installMock(page, state);
  await login(page);
  await page.goto('/lancamentos');
  await page.getByRole('button', { name: 'Falar um gasto' }).click();
  const dialog = page.getByRole('dialog', { name: 'Falar um gasto' });
  const list = dialog.getByRole('list', { name: 'Lançamentos salvos' });
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(list.getByText('Gasolina')).toBeVisible();
  await expect(list.getByText(/Transporte · Nubank · hoje/)).toBeVisible();
  await expect(list.getByText(/Alimentação · Nubank · hoje/)).toBeVisible();
  const gas = state.tables.transactions.find((t) => t.description === 'Gasolina');
  expect(gas).toMatchObject({ kind: 'expense', status: 'paid', amount_cents: 10_000 });
  expect(state.tables.transactions.find((t) => t.description === 'Mercado')).toMatchObject({ amount_cents: 3500 });
  await dialog.screenshot({ path: `e2e-screens/voz-${test.info().project.name}.png` });

  await list.getByRole('button', { name: 'Desfazer Mercado' }).click();
  await expect.poll(() => state.tables.transactions.some((t) => t.description === 'Mercado')).toBe(false);
  await dialog.getByRole('button', { name: 'Pronto' }).click();
  await expect(dialog).toBeHidden();
});

test('sem reconhecimento de voz: escreve e salva', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w.webkitSpeechRecognition;
    delete w.SpeechRecognition;
  });
  const state = createState({ withData: true });
  await installMock(page, state);
  await login(page);
  await page.getByRole('button', { name: 'Falar um gasto' }).click();
  const dialog = page.getByRole('dialog', { name: 'Falar um gasto' });
  await expect(dialog.getByText(/não tem reconhecimento de voz/)).toBeVisible();
  await dialog.getByLabel('O que você gastou').fill('uber 18,90 ontem');
  await dialog.getByRole('button', { name: 'Salvar' }).click();
  await expect(dialog.getByRole('list', { name: 'Lançamentos salvos' }).getByText('Uber')).toBeVisible();
  expect(state.tables.transactions.filter((t) => t.description === 'Uber').length).toBeGreaterThan(1);
});
