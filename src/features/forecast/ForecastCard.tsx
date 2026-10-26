import { Link } from 'react-router-dom';
import { AlertTriangle, ChevronRight, LineChart } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/dates';
import { formatBRL } from '@/lib/money';
import { canSpend } from '@/domain/forecast';
import { useForecast } from './useForecast';

/** Resumo da previsão no Painel: chega bem ao salário? Quanto dá para gastar hoje? */
export function ForecastCard() {
  const { data: f } = useForecast();
  if (!f || f.days.length === 0) return null;
  const negative = f.negativeDays[0];
  const free = canSpend(f, 0);
  const payday = f.payday ? f.days.find((d) => d.date === f.payday!.date) : undefined;
  return (
    <Card className={cn('group relative mt-4 p-4 transition hover:border-line-strong sm:p-5', negative && 'border-negative/40')}>
      <Link to="/previsao" className="absolute inset-0 rounded-[inherit]" aria-label="Previsão do saldo: ver detalhes" />
      <div className="flex items-start gap-3">
        <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl', negative ? 'bg-negative/12 text-negative' : 'bg-brand/12 text-brand')}>
          {negative ? <AlertTriangle className="size-5" aria-label="Atenção" /> : <LineChart className="size-5" aria-hidden />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center justify-between gap-2 text-[13px] font-semibold text-muted">
            Previsão do saldo
            <ChevronRight className="size-4 shrink-0 text-subtle transition group-hover:translate-x-0.5" aria-hidden />
          </p>
          <p className="mt-0.5 text-[15px]">
            {negative ? (
              <>Pode ficar <strong className="text-negative">negativo em {formatDate(negative)}</strong> ({formatBRL(f.low.balance)} no pior dia).</>
            ) : payday ? (
              <>Você chega ao salário ({formatDate(f.payday!.date)}) com cerca de <strong>{formatBRL(payday.balance)}</strong>.</>
            ) : (
              <>Em 30 dias, saldo previsto de <strong>{formatBRL(f.end)}</strong>.</>
            )}
          </p>
          {!f.payday ? (
            <p className="text-[13px] text-subtle">Salário não encontrado: cadastre como receita recorrente para a previsão ficar certa.</p>
          ) : (
            !negative && <p className="text-[13px] text-subtle">Dá para gastar até {formatBRL(free.safe)} hoje sem ficar no vermelho.</p>
          )}
        </div>
      </div>
    </Card>
  );
}
