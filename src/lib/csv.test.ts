import { describe, expect, it } from 'vitest';
import { centsToCSV, toCSV } from './csv';

describe('CSV', () => {
  it('usa ; e BOM, escapa aspas e neutraliza fórmulas', () => {
    const csv = toCSV(
      [{ d: 'Mercado; feira', v: centsToCSV(123456) }, { d: '=HYPERLINK("x")', v: centsToCSV(-500) }],
      [{ key: 'd', label: 'Descrição' }, { key: 'v', label: 'Valor' }],
    );
    expect(csv.startsWith('﻿Descrição;Valor')).toBe(true);
    expect(csv).toContain('"Mercado; feira";1234,56');
    expect(csv).toContain(`"'=HYPERLINK(""x"")";'-5,00`);
  });
});
