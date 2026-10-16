import { describe, expect, it } from 'vitest';
import { addDays, addMonths, diffDays, endOfMonth, formatDate, isValidISO, monthLabel, parseBRDate, relativeDay } from './dates';

describe('datas', () => {
  it('formata DD/MM/AAAA sem erro de fuso', () => {
    expect(formatDate('2026-01-01')).toBe('01/01/2026');
    expect(formatDate('2026-12-31')).toBe('31/12/2026');
    expect(formatDate(null)).toBe('—');
  });
  it('converte DD/MM/AAAA', () => {
    expect(parseBRDate('16/10/2026')).toBe('2026-10-16');
    expect(parseBRDate('31/02/2026')).toBeNull();
  });
  it('soma meses ajustando fim de mês', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
  });
  it('soma dias atravessando meses', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(diffDays('2026-03-01', '2026-02-27')).toBe(2);
  });
  it('valida e calcula limites', () => {
    expect(isValidISO('2026-02-29')).toBe(false);
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28');
    expect(monthLabel('2026-10-01')).toBe('outubro de 2026');
    expect(monthLabel('2026-10-01', { short: true })).toBe('out/26');
  });
  it('descreve dias relativos', () => {
    expect(relativeDay('2026-10-16', '2026-10-16')).toBe('hoje');
    expect(relativeDay('2026-10-17', '2026-10-16')).toBe('amanhã');
    expect(relativeDay('2026-10-20', '2026-10-16')).toBe('em 4 dias');
    expect(relativeDay('2026-10-14', '2026-10-16')).toBe('há 2 dias');
  });
});
