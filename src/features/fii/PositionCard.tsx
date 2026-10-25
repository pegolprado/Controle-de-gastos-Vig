import { useState } from 'react';
import { ArrowDownRight, ArrowUpRight, CalendarPlus, ChevronDown, Plus, Trash2 } from 'lucide-react';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge, Card } from '@/components/ui/Card';
import { Money } from '@/components/ui/Money';
import { cn } from '@/lib/cn';
import { capitalize, formatDate, formatDateTime } from '@/lib/dates';
import { formatPercent } from '@/lib/money';
import type { AssetQuote, FiiPosition, FiiTrade } from '@/lib/types';
import { kindLabel, magicNumber, monthlyPerShare, monthStatus, payStatus, yieldOnCost, type FiiPayment, type MonthMode } from '@/domain/fii';
import type { FiiSyncResult } from '@/services/fii';
import { fmtRate, unitLabel } from './shared';
import { MagicBar } from './StatDetails';

export interface PositionCardProps {
  position: FiiPosition;
  name?: string | null;
  syncedAt?: string;
  status?: FiiSyncResult;
  quote?: AssetQuote;
  trades: FiiTrade[];
  payments: FiiPayment[];
  undated: Array<{ kind: string; rate: number; record_date: string | null; amount_cents: number }>;
  mode: MonthMode;
  featured?: FiiPayment;
  last?: FiiPayment;
  today: string;
  launched: (p: FiiPayment) => boolean;
  canEdit: boolean;
  canLaunch: boolean;
  onTrade: () => void;
  onDeleteTrade: (t: FiiTrade) => void;
  onDelete: () => void;
  onLaunch: (p: FiiPayment) => void;
}

export function PositionCard(props: PositionCardProps) {
  const { position, quote, payments, undated, mode, featured, last, today, trades } = props;
  const [open, setOpen] = useState(false);
  const projected = !!featured?.projected;
  const st = monthStatus(mode, featured, today);
  const yoc = featured ? yieldOnCost(featured.dist.rate, position.avg_price_cents) : null;
  const isStock = position.asset_type === 'stock';
  const per = isStock ? 'por ação' : 'por cota';
  const magic = magicNumber(quote?.price ?? null, monthlyPerShare(position.asset_type ?? 'fii', payments, today));

  return (
    <Card className="overflow-hidden">
      <div className="flex items-start gap-4 p-5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="font-display text-2xl font-bold tracking-tight">{position.ticker}</p>
            {isStock && <Badge tone="info">Ação</Badge>}
          </div>
          <p className="truncate text-[13px] text-subtle">
            {props.name ?? (isStock ? 'Ação' : 'Fundo imobiliário')} · {position.quantity} {unitLabel(position.asset_type, position.quantity)}
          </p>
          {quote && (
            <p className="text-[13px] text-subtle">
              Cotação {fmtRate(quote.price)}
              {quote.change_pct !== null && (
                <span className={cn('ml-1 font-semibold', quote.change_pct >= 0 ? 'text-positive' : 'text-negative')}>
                  {quote.change_pct >= 0 ? <ArrowUpRight className="inline size-3" aria-hidden /> : <ArrowDownRight className="inline size-3" aria-hidden />}
                  {formatPercent(Math.abs(quote.change_pct), 2)}
                </span>
              )}
              {' · '}carteira <Money cents={Math.round(quote.price * position.quantity * 100)} />
            </p>
          )}
          {featured && (
            <p className="mt-2 text-[15px] text-muted">
              {projected ? 'Previsto' : kindLabel(featured.dist.kind)}: {fmtRate(featured.dist.rate)} <span className="text-[13px] text-subtle">{per}</span>
            </p>
          )}
          {featured && (
            <p className="text-[13px] text-subtle">
              {mode === 'received' || mode === 'none' ? 'Caiu em' : projected ? 'Deve cair em' : 'Cai em'}{' '}
              <strong className="font-semibold text-fg">{formatDate(featured.dist.payment_date)}</strong>
              {mode !== 'received' && mode !== 'none' && last && <> · último: <Money cents={last.amount_cents} /> em {formatDate(last.dist.payment_date)}</>}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          {featured && st ? (
            <>
              {projected && <span className="-mb-2 text-[11px] font-semibold uppercase tracking-wide text-info">previsto</span>}
              <Money cents={featured.amount_cents} className={cn('font-num text-2xl font-bold', mode === 'received' ? 'text-positive' : mode === 'next' || mode === 'none' ? 'text-muted' : projected ? 'text-info' : 'text-warning')} />
              <Badge tone={st.tone} className="px-3 py-1 text-[13px] uppercase tracking-wide">{capitalize(st.label.replace('Previsto · ', ''))}</Badge>
            </>
          ) : (
            <Badge tone="neutral">{props.status === 'not_found' ? 'Não encontrado na B3' : props.status === 'unavailable' ? 'B3 indisponível' : 'Sem anúncios'}</Badge>
          )}
        </div>
      </div>
      {undated.length > 0 && (
        <p className="border-t border-line px-5 py-2.5 text-[13px] text-muted">
          Aprovado, pagamento <strong className="text-fg">a definir</strong>: {undated.map((u) => `${kindLabel(u.kind)} R$ ${(u.amount_cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`).join(' · ')}
        </p>
      )}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-center gap-1.5 border-t border-line bg-surface-2/50 py-3 text-sm font-semibold text-muted transition hover:text-fg"
      >
        Mais detalhes <ChevronDown className={cn('size-4 transition', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div className="border-t border-line p-5 text-[14px]">
          {featured && (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
              <dt className="text-subtle">{projected ? 'Data com (prevista)' : 'Data com'}</dt>
              <dd className="text-right font-medium">{featured.dist.record_date ? formatDate(featured.dist.record_date) : '—'}</dd>
              <dt className="text-subtle">{projected ? 'Pagamento (previsto)' : 'Pagamento'}</dt>
              <dd className="text-right font-medium">{formatDate(featured.dist.payment_date)}</dd>
              {featured.dist.related_to && (
                <>
                  <dt className="text-subtle">Referência</dt>
                  <dd className="text-right font-medium">{capitalize(featured.dist.related_to.split('/').slice(0, 2).join('/').toLowerCase())}</dd>
                </>
              )}
              <dt className="text-subtle">Tipo</dt>
              <dd className="text-right font-medium">{kindLabel(featured.dist.kind)}{featured.dist.kind.startsWith('JRS') && ' (líquido de 15% de IR)'}</dd>
              <dt className="text-subtle">{isStock ? 'Ações com direito' : 'Cotas com direito'}</dt>
              <dd className="text-right font-medium">{featured.quantity}</dd>
              {position.avg_price_cents && (
                <>
                  <dt className="text-subtle">Preço médio</dt>
                  <dd className="text-right font-medium"><Money cents={position.avg_price_cents} /></dd>
                </>
              )}
              {yoc !== null && (
                <>
                  <dt className="text-subtle">Sobre o preço médio</dt>
                  <dd className="text-right font-medium">{formatPercent(yoc, 2)} {isStock ? 'neste provento' : 'ao mês'}</dd>
                </>
              )}
            </dl>
          )}

          {magic !== null && (
            <div className="mt-4 rounded-xl bg-brand/8 px-3 py-2.5">
              <MagicBar magic={magic} quantity={position.quantity} type={position.asset_type ?? 'fii'} />
              <p className="mt-1.5 text-[12px] text-subtle">Com essa quantidade, a renda de um mês compra mais {isStock ? 'uma ação' : 'uma cota'} sozinha.</p>
            </div>
          )}

          <h3 className="mt-5 text-[13px] font-semibold uppercase tracking-wide text-subtle">Compras e vendas</h3>
          <ul className="mt-2 divide-y divide-line">
            {trades.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-2">
                <span>
                  {t.trade_date ? formatDate(t.trade_date) : 'Antes de começar'}{' '}
                  <span className={cn('font-semibold', t.quantity > 0 ? 'text-positive' : 'text-negative')}>
                    {t.quantity > 0 ? '+' : '−'}{Math.abs(t.quantity)}
                  </span>
                  {t.price_cents && <span className="text-[13px] text-subtle"> · {fmtRate(t.price_cents / 100)}</span>}
                </span>
                {props.canEdit && trades.length > 1 && (
                  <IconButton size="sm" label="Excluir operação" onClick={() => props.onDeleteTrade(t)}>
                    <Trash2 className="size-4" />
                  </IconButton>
                )}
              </li>
            ))}
          </ul>

          {payments.length > 0 && (
            <>
              <h3 className="mt-5 text-[13px] font-semibold uppercase tracking-wide text-subtle">Histórico de proventos</h3>
              <ul className="mt-2 divide-y divide-line">
                {payments.slice(0, 13).map((p) => (
                  <li key={`${p.dist.payment_date}${p.dist.kind}${p.dist.isin}`} className="flex items-center justify-between gap-3 py-2">
                    <span>
                      {formatDate(p.dist.payment_date)} <span className="text-[13px] text-subtle">· {kindLabel(p.dist.kind)} {fmtRate(p.dist.rate)} × {p.quantity}</span>
                    </span>
                    <Money cents={p.amount_cents} className="font-num font-medium" />
                  </li>
                ))}
              </ul>
            </>
          )}
          {props.syncedAt && <p className="mt-3 text-[12px] text-subtle">Atualizado em {formatDateTime(props.syncedAt)}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            {props.canEdit && (
              <Button size="sm" variant="subtle" icon={<Plus className="size-4" />} onClick={props.onTrade}>
                Registrar compra/venda
              </Button>
            )}
            {props.canLaunch && featured && !projected && !payStatus(featured.dist.payment_date, today).paid && (
              <Button size="sm" variant="ghost" icon={<CalendarPlus className="size-4" />} disabled={props.launched(featured)} onClick={() => props.onLaunch(featured)}>
                {props.launched(featured) ? 'Lançado como receita' : 'Lançar como receita'}
              </Button>
            )}
            <div className="flex-1" />
            {props.canEdit && (
              <IconButton size="sm" label={`Remover ${position.ticker}`} onClick={props.onDelete}>
                <Trash2 className="size-4" />
              </IconButton>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
