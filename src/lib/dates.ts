/**
 * Datas de calendário são tratadas como strings ISO "AAAA-MM-DD" (sem fuso),
 * exatamente como o PostgreSQL `date`. Isso evita o clássico erro de um dia
 * a menos causado por `new Date('2026-01-01')` (UTC).
 */
export type ISODate = string;

const pad = (n: number) => String(n).padStart(2, '0');

export function toISODate(d: Date): ISODate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayISO(): ISODate {
  return toISODate(new Date());
}

export function parseISO(iso: ISODate): { y: number; m: number; d: number } {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return { y, m, d };
}

/** "2026-10-16" → "16/10/2026" */
export function formatDate(iso: ISODate | null | undefined): string {
  if (!iso) return '—';
  const { y, m, d } = parseISO(iso);
  return `${pad(d)}/${pad(m)}/${y}`;
}

/** "16/10/2026" → "2026-10-16" (ou null se inválida) */
export function parseBRDate(text: string): ISODate | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim());
  if (!match) return null;
  const [, d, m, y] = match.map(Number) as unknown as [number, number, number, number];
  const iso = `${y}-${pad(m)}-${pad(d)}`;
  return isValidISO(iso) ? iso : null;
}

export function isValidISO(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const { y, m, d } = parseISO(iso);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

export function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

export function makeDate(y: number, m: number, d: number): ISODate {
  // normaliza mês fora do intervalo
  const yy = y + Math.floor((m - 1) / 12);
  const mm = ((((m - 1) % 12) + 12) % 12) + 1;
  return `${yy}-${pad(mm)}-${pad(Math.min(d, daysInMonth(yy, mm)))}`;
}

export function addDays(iso: ISODate, days: number): ISODate {
  const { y, m, d } = parseISO(iso);
  return toISODate(new Date(y, m - 1, d + days));
}

/** Soma meses ajustando para o último dia quando necessário (31/01 + 1 → 28/02). */
export function addMonths(iso: ISODate, months: number): ISODate {
  const { y, m, d } = parseISO(iso);
  return makeDate(y, m + months, d);
}

export function startOfMonth(iso: ISODate): ISODate {
  const { y, m } = parseISO(iso);
  return makeDate(y, m, 1);
}

export function endOfMonth(iso: ISODate): ISODate {
  const { y, m } = parseISO(iso);
  return makeDate(y, m, daysInMonth(y, m));
}

export function diffDays(a: ISODate, b: ISODate): number {
  const pa = parseISO(a);
  const pb = parseISO(b);
  return Math.round((Date.UTC(pa.y, pa.m - 1, pa.d) - Date.UTC(pb.y, pb.m - 1, pb.d)) / 86_400_000);
}

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export function monthLabel(iso: ISODate, opts: { short?: boolean; year?: boolean } = {}): string {
  const { y, m } = parseISO(iso);
  const name = (opts.short ? MONTHS_SHORT : MONTHS)[m - 1];
  return opts.year === false ? name : opts.short ? `${name}/${String(y).slice(2)}` : `${name} de ${y}`;
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Descrição relativa curta: "hoje", "amanhã", "em 3 dias", "há 2 dias". */
export function relativeDay(iso: ISODate, today: ISODate = todayISO()): string {
  const diff = diffDays(iso, today);
  if (diff === 0) return 'hoje';
  if (diff === 1) return 'amanhã';
  if (diff === -1) return 'ontem';
  if (diff > 1) return `em ${diff} dias`;
  return `há ${-diff} dias`;
}

export function formatDateTime(ts: string | null | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
