export type BudgetLevel = 'ok' | 'attention' | 'warning' | 'critical' | 'over';

export function budgetUsage(spentCents: number, limitCents: number) {
  const pct = limitCents > 0 ? (spentCents / limitCents) * 100 : 0;
  const remaining = limitCents - spentCents;
  let level: BudgetLevel = 'ok';
  if (pct > 100) level = 'over';
  else if (pct >= 90) level = 'critical';
  else if (pct >= 75) level = 'warning';
  else if (pct >= 50) level = 'attention';
  return { pct, remaining, level };
}

/** Projeção linear simples do gasto até o fim do mês (claramente uma estimativa). */
export function projectMonthEnd(spentCents: number, dayOfMonth: number, daysInMonth: number): number | null {
  if (dayOfMonth < 5 || spentCents <= 0) return null; // poucos dados para estimar
  return Math.round((spentCents / dayOfMonth) * daysInMonth);
}
