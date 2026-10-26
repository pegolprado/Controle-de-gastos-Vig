/**
 * Saúde financeira (0–100): uma nota simples e explicável, feita de quatro partes.
 * Cada parte diz quanto valeu e o que fazer para melhorar.
 */
export interface HealthPart {
  key: 'savings' | 'bills' | 'forecast' | 'reserve';
  label: string;
  points: number;
  max: number;
  detail: string;
  tip: string | null;
  to: string;
}

export interface HealthInput {
  /** sobra média e renda média por mês (null = sem histórico) */
  surplus: number | null;
  income: number | null;
  expense: number | null;
  overdue: number;
  /** a previsão fica negativa antes do salário/30 dias */
  forecastNegative: boolean | null;
  /** quanto já está guardado em reserva de emergência (meta) */
  reserveSaved: number | null;
  /** saldo de hoje nas contas do total */
  balance: number;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const brl = (c: number) => `R$ ${(c / 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;

export function healthScore(i: HealthInput): { score: number | null; label: string; parts: HealthPart[] } {
  const parts: HealthPart[] = [];

  if (i.surplus !== null && i.income) {
    const rate = i.surplus / i.income;
    const points = rate >= 0.2 ? 30 : rate >= 0.1 ? 22 : rate > 0 ? 12 : 0;
    parts.push({
      key: 'savings', label: 'Sobra do mês', points, max: 30,
      detail: rate > 0 ? `Sobram ${pct(rate)} do que entra` : 'Sai mais do que entra',
      tip: points < 30 ? (rate > 0 ? 'Chegar a 20% de sobra: veja onde economizar' : 'Equilibrar entradas e saídas: veja onde economizar') : null,
      to: '/economia',
    });
  }

  const billPoints = i.overdue === 0 ? 20 : i.overdue === 1 ? 12 : i.overdue === 2 ? 6 : 0;
  parts.push({
    key: 'bills', label: 'Contas em dia', points: billPoints, max: 20,
    detail: i.overdue ? `${i.overdue} ${i.overdue === 1 ? 'conta atrasada' : 'contas atrasadas'}` : 'Nenhuma conta atrasada',
    tip: i.overdue ? 'Quitar as contas atrasadas evita juros e multa' : null,
    to: '/compromissos?aba=vencidas',
  });

  if (i.forecastNegative !== null) {
    parts.push({
      key: 'forecast', label: 'Previsão', points: i.forecastNegative ? 5 : 25, max: 25,
      detail: i.forecastNegative ? 'O saldo pode ficar negativo' : 'Saldo positivo até o salário',
      tip: i.forecastNegative ? 'Veja quais contas vencem antes do salário' : null,
      to: '/previsao',
    });
  }

  if (i.expense) {
    const target = i.expense * 6;
    const have = i.reserveSaved ?? Math.max(0, i.balance - i.expense); // sem meta: o que sobra além de um mês de gastos
    const ratio = Math.min(1, have / target);
    parts.push({
      key: 'reserve', label: 'Reserva de emergência', points: Math.round(ratio * 25), max: 25,
      detail: `${pct(ratio)} de 6 meses de gastos (${brl(target)})`,
      tip: ratio < 1 ? (i.reserveSaved === null ? 'Crie uma meta de reserva de emergência' : 'Continue guardando na reserva') : null,
      to: '/metas',
    });
  }

  const max = parts.reduce((s, p) => s + p.max, 0);
  if (max < 40) return { score: null, label: 'Poucos dados', parts };
  const score = Math.round((parts.reduce((s, p) => s + p.points, 0) / max) * 100);
  const label = score >= 80 ? 'Ótima' : score >= 60 ? 'Boa' : score >= 40 ? 'Atenção' : 'Cuidado';
  return { score, label, parts };
}
