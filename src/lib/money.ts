/**
 * Dinheiro é sempre representado como INTEIRO em centavos.
 * Nunca use ponto flutuante para somar valores monetários.
 */
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brlCompact = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** 123456 → "R$ 1.234,56" (espaço comum, padrão visual brasileiro) */
export function formatBRL(cents: number | bigint | null | undefined, opts: { signed?: boolean } = {}): string {
  const value = Number(cents ?? 0);
  const text = brl.format(Math.abs(value) / 100).replace(/\u00a0/g, ' ');
  if (value < 0) return `−${text}`;
  if (opts.signed && value > 0) return `+${text}`;
  return text;
}

export function formatBRLCompact(cents: number): string {
  return brlCompact.format(cents / 100).replace(/\u00a0/g, ' ');
}

/**
 * Converte texto digitado ("1.234,56", "1234.5", "R$ 10") em centavos.
 * Retorna null quando não é um valor válido.
 */
export function parseBRL(input: string): number | null {
  const raw = input.replace(/[R$\s\u00a0]/g, '').trim();
  if (!raw) return null;
  const negative = raw.startsWith('-') || raw.startsWith('−');
  const unsigned = raw.replace(/^[-−]/, '');
  if (!/^[\d.,]+$/.test(unsigned)) return null;
  let intPart = unsigned;
  let fracPart = '';
  const lastComma = unsigned.lastIndexOf(',');
  const lastDot = unsigned.lastIndexOf('.');
  const sep = Math.max(lastComma, lastDot);
  if (sep >= 0) {
    const tail = unsigned.slice(sep + 1);
    // "1.234" (milhar) vs "12.5" (decimal): até 2 dígitos após o separador = decimal
    if (tail.length <= 2 && !(unsigned[sep] === '.' && lastComma === -1 && tail.length === 3)) {
      intPart = unsigned.slice(0, sep);
      fracPart = tail;
    }
  }
  intPart = intPart.replace(/[.,]/g, '');
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart)) return null;
  const cents = Number(intPart || '0') * 100 + Number((fracPart + '00').slice(0, 2));
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

/** Máscara estilo caixa eletrônico: os dígitos entram pela direita. */
export function centsFromDigits(digits: string): number {
  const only = digits.replace(/\D/g, '').replace(/^0+/, '').slice(0, 13);
  return Number(only || '0');
}

export function formatCentsInput(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Divide um total em N parcelas inteiras; centavos residuais na primeira (igual ao servidor). */
export function splitInstallments(totalCents: number, count: number): number[] {
  if (!Number.isInteger(totalCents) || !Number.isInteger(count) || count < 1) {
    throw new Error('Parâmetros inválidos para parcelamento');
  }
  const base = Math.floor(totalCents / count);
  const rest = totalCents - base * count;
  return Array.from({ length: count }, (_, i) => base + (i === 0 ? rest : 0));
}

export function sumCents(values: Array<number | null | undefined>): number {
  return values.reduce<number>((acc, v) => acc + Number(v ?? 0), 0);
}

/** Variação percentual com proteção contra divisão por zero. */
export function percentChange(current: number, previous: number): number | null {
  if (!previous) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function formatPercent(value: number | null, digits = 0): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: digits })}%`;
}
