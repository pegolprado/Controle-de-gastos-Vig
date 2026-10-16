import { addMonths, makeDate, parseISO, startOfMonth, type ISODate } from '@/lib/dates';

export interface CardCycle {
  referenceMonth: ISODate;
  closingDate: ISODate;
  dueDate: ISODate;
}

/**
 * Espelho exato de public.card_cycle (o servidor é a fonte da verdade; esta
 * versão serve para pré-visualizar no formulário em qual fatura a compra cai).
 * Compras feitas a partir do dia de fechamento entram na fatura seguinte.
 */
export function cardCycle(closingDay: number, dueDay: number, purchase: ISODate): CardCycle {
  const { y, m } = parseISO(purchase);
  const closeThis = makeDate(y, m, closingDay);
  const closeMonth = purchase < closeThis ? startOfMonth(purchase) : addMonths(startOfMonth(purchase), 1);
  const cm = parseISO(closeMonth);
  const closingDate = makeDate(cm.y, cm.m, closingDay);
  const dueMonth = dueDay > closingDay ? closeMonth : addMonths(closeMonth, 1);
  const dm = parseISO(dueMonth);
  return { referenceMonth: dueMonth, closingDate, dueDate: makeDate(dm.y, dm.m, dueDay) };
}

/** Melhor dia de compra = dia do fechamento (maior prazo até o vencimento). */
export function bestPurchaseDay(closingDay: number): number {
  return closingDay;
}
