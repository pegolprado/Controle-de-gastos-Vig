import { describe, expect, it } from 'vitest';
import { parseQuickEntry, parseReceiptText } from './quickEntry';

const T = '2026-10-25';

describe('lançamento em linguagem natural', () => {
  it('frases comuns', () => {
    expect(parseQuickEntry('Gastei 42 reais no mercado', [], T)).toMatchObject({ kind: 'expense', amount_cents: 4200, description: 'Mercado', categoryName: 'Mercado', occurred_on: T });
    expect(parseQuickEntry('uber 18,90 ontem', [], T)).toMatchObject({ amount_cents: 1890, description: 'Uber', categoryName: 'Aplicativos', occurred_on: '2026-10-24' });
    expect(parseQuickEntry('Recebi 3 mil de salário', [], T)).toMatchObject({ kind: 'income', amount_cents: 300_000, categoryName: 'Salário' });
    expect(parseQuickEntry('R$ 1.234,56 aluguel', [], T)).toMatchObject({ amount_cents: 123_456, description: 'Aluguel', categoryName: 'Aluguel' });
    expect(parseQuickEntry('paguei cinquenta reais de farmácia no pix', [], T)).toMatchObject({ amount_cents: 5000, payment_method: 'pix', categoryName: 'Farmácia', description: 'Farmácia' });
  });

  it('parcelas, cartão pelo nome e data', () => {
    const r = parseQuickEntry('Tênis 600 em 3x no Nubank dia 20', ['Nubank', 'Itaú'], T);
    expect(r).toMatchObject({ amount_cents: 60_000, installments: 3, sourceName: 'Nubank', description: 'Tênis', occurred_on: '2026-10-20', categoryName: 'Vestuário' });
    expect(parseQuickEntry('almoço 35,50 no crédito', [], T)).toMatchObject({ credit: true, amount_cents: 3550, categoryName: 'Restaurantes' });
    expect(parseQuickEntry('gasolina 200 12/10', [], T)).toMatchObject({ amount_cents: 20_000, occurred_on: '2026-10-12' });
    expect(parseQuickEntry('netflix 55,90 dia 28', [], T).occurred_on).toBe('2026-09-28');
  });

  it('sem valor: devolve null para o usuário completar', () => {
    expect(parseQuickEntry('padaria', [], T)).toMatchObject({ amount_cents: null, description: 'Padaria', categoryName: 'Mercado' });
  });
});

describe('comprovante', () => {
  it('acha total, data e loja', () => {
    const text = `SUPERMERCADO BOM PRECO LTDA\nCNPJ 12.345.678/0001-90\nRUA DAS FLORES 100\nARROZ 5KG   25,90\nFEIJAO   8,49\nSUBTOTAL 34,39\nDESCONTO 1,00\nVALOR A PAGAR R$ 33,39\nCARTAO DEBITO 33,39\n20/10/2026 18:42`;
    expect(parseReceiptText(text, T)).toEqual({ amount_cents: 3339, occurred_on: '2026-10-20', merchant: 'SUPERMERCADO BOM PRECO LTDA' });
  });
  it('comprovante de pix', () => {
    const text = `Comprovante de transferência\nPix enviado\nValor\nR$ 150,00\nData 22/10/2026\nPara\nJoão da Silva`;
    expect(parseReceiptText(text, T)).toMatchObject({ amount_cents: 15_000, occurred_on: '2026-10-22' });
  });
});
