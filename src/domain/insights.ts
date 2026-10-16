import { formatBRL, percentChange } from '@/lib/money';
import type { CategoryTotal, MonthlyRow } from '@/lib/types';

export interface Insight {
  id: string;
  tone: 'positive' | 'negative' | 'neutral';
  title: string;
  detail: string;
}

const MIN_CATEGORY_CENTS = 5_000; // ignora variações em categorias com menos de R$ 50

/**
 * Gera insights explicáveis a partir de dados reais. Cada insight informa
 * exatamente quais números o originaram. Sem dados suficientes → lista vazia.
 */
export function buildInsights(
  current: CategoryTotal[],
  previous: CategoryTotal[],
  months: MonthlyRow[],
): Insight[] {
  const insights: Insight[] = [];
  const prevMap = new Map(previous.map((c) => [c.category_id ?? 'none', c]));

  const changes = current
    .map((c) => {
      const prev = prevMap.get(c.category_id ?? 'none');
      if (!prev || prev.total_cents < MIN_CATEGORY_CENTS || c.total_cents < MIN_CATEGORY_CENTS) return null;
      const pct = percentChange(c.total_cents, prev.total_cents);
      return pct === null ? null : { c, prev, pct };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null && Math.abs(x.pct) >= 10)
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
    .slice(0, 3);

  for (const { c, prev, pct } of changes) {
    const up = pct > 0;
    insights.push({
      id: `cat-${c.category_id}`,
      tone: up ? 'negative' : 'positive',
      title: `Seus gastos com ${c.name.toLowerCase()} ${up ? 'aumentaram' : 'diminuíram'} ${Math.round(Math.abs(pct))}%`,
      detail: `${formatBRL(c.total_cents)} neste período contra ${formatBRL(prev.total_cents)} no período anterior.`,
    });
  }

  const withData = months.filter((m) => m.income_cents > 0 || m.expense_cents > 0);
  if (withData.length >= 3) {
    const last = withData.slice(-3);
    const savings = last.map((m) => m.income_cents - m.expense_cents);
    const allPositive = savings.every((s) => s > 0);
    const allNegative = savings.every((s) => s < 0);
    if (allPositive) {
      insights.push({
        id: 'streak-positive',
        tone: 'positive',
        title: 'Três meses seguidos com saldo positivo',
        detail: `Você guardou em média ${formatBRL(Math.round(savings.reduce((a, b) => a + b, 0) / 3))} por mês.`,
      });
    } else if (allNegative) {
      insights.push({
        id: 'streak-negative',
        tone: 'negative',
        title: 'Despesas acima das receitas nos últimos três meses',
        detail: `Déficit médio de ${formatBRL(Math.round(Math.abs(savings.reduce((a, b) => a + b, 0)) / 3))} por mês.`,
      });
    }
    const totalExpense = last.reduce((a, m) => a + m.expense_cents, 0);
    const fixed = last.reduce((a, m) => a + m.fixed_expense_cents, 0);
    if (totalExpense > 0) {
      const share = (fixed / totalExpense) * 100;
      if (share >= 60) {
        insights.push({
          id: 'fixed-share',
          tone: 'neutral',
          title: `${Math.round(share)}% das despesas são fixas`,
          detail: 'Renegociar contratos fixos (planos, assinaturas, tarifas) tende a gerar economia recorrente.',
        });
      }
    }
  }

  if (current.length >= 3) {
    const total = current.reduce((a, c) => a + c.total_cents, 0);
    const top = current[0];
    if (total > 0 && top.total_cents / total >= 0.4 && top.total_cents >= MIN_CATEGORY_CENTS) {
      insights.push({
        id: 'top-category',
        tone: 'neutral',
        title: `${top.name} concentra ${Math.round((top.total_cents / total) * 100)}% dos gastos`,
        detail: `${formatBRL(top.total_cents)} de ${formatBRL(total)} no período.`,
      });
    }
  }
  return insights;
}
