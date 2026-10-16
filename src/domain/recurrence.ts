import { addDays, addMonths, type ISODate } from '@/lib/dates';
import type { RecurrenceFreq } from '@/lib/types';

/** Espelho de public.recurrence_date: sempre calculado a partir da âncora. */
export function recurrenceDate(start: ISODate, freq: RecurrenceFreq, interval: number, n: number): ISODate {
  switch (freq) {
    case 'daily':
      return addDays(start, n * interval);
    case 'weekly':
      return addDays(start, n * interval * 7);
    case 'monthly':
      return addMonths(start, n * interval);
    case 'yearly':
      return addMonths(start, n * interval * 12);
  }
}

export function nextOccurrences(
  start: ISODate,
  freq: RecurrenceFreq,
  interval: number,
  fromIndex: number,
  count: number,
  endDate?: ISODate | null,
): ISODate[] {
  const out: ISODate[] = [];
  for (let i = fromIndex; out.length < count && i < fromIndex + 1000; i++) {
    const d = recurrenceDate(start, freq, interval, i);
    if (endDate && d > endDate) break;
    out.push(d);
  }
  return out;
}

export function describeRecurrence(freq: RecurrenceFreq, interval: number): string {
  if (interval === 1) {
    return { daily: 'Todo dia', weekly: 'Toda semana', monthly: 'Todo mês', yearly: 'Todo ano' }[freq];
  }
  const unit = { daily: 'dias', weekly: 'semanas', monthly: 'meses', yearly: 'anos' }[freq];
  return `A cada ${interval} ${unit}`;
}
