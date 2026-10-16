import { describe, expect, it } from 'vitest';
import { centsFromDigits, formatBRL, parseBRL, percentChange, splitInstallments, sumCents } from './money';

describe('formatBRL', () => {
  it('formata no padrão brasileiro', () => {
    expect(formatBRL(123456)).toBe('R$ 1.234,56');
    expect(formatBRL(0)).toBe('R$ 0,00');
    expect(formatBRL(5)).toBe('R$ 0,05');
    expect(formatBRL(-9990)).toBe('−R$ 99,90');
    expect(formatBRL(100, { signed: true })).toBe('+R$ 1,00');
    expect(formatBRL(100000000000)).toBe('R$ 1.000.000.000,00');
  });
});

describe('parseBRL', () => {
  it.each([
    ['1.234,56', 123456],
    ['1234,5', 123450],
    ['R$ 10', 1000],
    ['12.5', 1250],
    ['1.234', 123400],
    ['0,01', 1],
    ['-5,00', -500],
    ['1.000.000,00', 100000000],
  ])('%s → %i', (input, cents) => {
    expect(parseBRL(input)).toBe(cents);
  });
  it('rejeita texto inválido', () => {
    expect(parseBRL('abc')).toBeNull();
    expect(parseBRL('')).toBeNull();
    expect(parseBRL('1,2,3a')).toBeNull();
  });
});

describe('centsFromDigits (máscara)', () => {
  it('trata dígitos como centavos', () => {
    expect(centsFromDigits('1')).toBe(1);
    expect(centsFromDigits('12345')).toBe(12345);
    expect(centsFromDigits('R$ 1.234,56')).toBe(123456);
    expect(centsFromDigits('')).toBe(0);
  });
});

describe('splitInstallments', () => {
  it('soma exatamente o total sem ponto flutuante', () => {
    const parts = splitInstallments(100001, 3);
    expect(parts).toEqual([33335, 33333, 33333]);
    expect(sumCents(parts)).toBe(100001);
  });
  it('funciona para 0,10 em 3x', () => {
    expect(splitInstallments(10, 3)).toEqual([4, 3, 3]);
  });
  it('evita o erro clássico 0.1 + 0.2', () => {
    expect(sumCents([10, 20])).toBe(30);
  });
  it('valida parâmetros', () => {
    expect(() => splitInstallments(10.5, 2)).toThrow();
    expect(() => splitInstallments(100, 0)).toThrow();
  });
});

describe('percentChange', () => {
  it('calcula variação e protege divisão por zero', () => {
    expect(percentChange(112, 100)).toBeCloseTo(12);
    expect(percentChange(50, 100)).toBeCloseTo(-50);
    expect(percentChange(10, 0)).toBeNull();
  });
});
