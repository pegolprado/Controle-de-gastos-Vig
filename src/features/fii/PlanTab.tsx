import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, CalendarClock, Gem, Pencil, ShieldCheck, Sparkles, TrendingDown, TrendingUp, type LucideIcon } from 'lucide-react';
import { useWsId } from '@/app/WorkspaceProvider';
import { wsKey } from '@/hooks/useFinance';
import { Button } from '@/components/ui/Button';
import { Card, Skeleton } from '@/components/ui/Card';
import { Field, Input } from '@/components/ui/Field';
import { Money } from '@/components/ui/Money';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { cn } from '@/lib/cn';
import { formatBRL, formatPercent } from '@/lib/money';
import { errorMessage } from '@/lib/errors';
import { queryClient } from '@/lib/queryClient';
import type { RendaSettings } from '@/lib/types';
import type { Holding } from '@/domain/fii';
import { allocation, pickBuys, PLAN_CLASSES, PRESETS, readPlan, signals, splitContribution, type NextRecord, type PlanClass, type PlanSettings, type SignalKind } from '@/domain/plan';
import { saveRendaSettings } from '@/services/fii';
import { PushToggle } from '@/pwa/PushToggle';
import { unitLabel } from './shared';

const SLOT: Record<PlanClass, number> = { rf: 1, acoes: 2, exterior: 3, fii: 4 };
const color = (k: PlanClass) => `var(--viz-${SLOT[k]})`;
const SIGNAL_ICON: Record<SignalKind, LucideIcon> = { datacom: CalendarClock, below_pm: TrendingDown, yield: TrendingUp, magic: Gem, concentration: AlertTriangle };
const CONTRIB_KEY = 'fmv.renda.aporte';

export function PlanTab({ holdings, next, settings, canEdit, today, loading }: {
  holdings: Holding[];
  next: Map<string, NextRecord>;
  settings: RendaSettings | null;
  canEdit: boolean;
  today: string;
  loading: boolean;
}) {
  const plan = useMemo(() => readPlan(settings?.plan), [settings?.plan]);
  const [editing, setEditing] = useState(false);
  const { rows, total } = useMemo(() => allocation(holdings, plan), [holdings, plan]);
  const sig = useMemo(() => signals(holdings, next, today), [holdings, next, today]);
  const [contribution, setContribution] = useState(() => {
    try {
      return Number(localStorage.getItem(CONTRIB_KEY)) || 50_000;
    } catch {
      return 50_000;
    }
  });
  const changeContribution = (v: number) => {
    setContribution(v);
    try {
      localStorage.setItem(CONTRIB_KEY, String(v));
    } catch {
      /* ignore */
    }
  };
  const split = splitContribution(rows, total, contribution);
  const fiiBuys = pickBuys(holdings, 'fii', split.fii, sig);
  const stockBuys = pickBuys(holdings, 'stock', split.acoes, sig);

  if (loading) return <Skeleton className="mt-4 h-64" />;

  return (
    <div className="mt-4 flex flex-col gap-4">
      <Card className="p-5" role="region" aria-label="Divisão da carteira">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold">Plano para investir</h2>
            <p className="text-[13px] text-subtle">Como sua carteira está dividida hoje e a divisão que você quer ter.</p>
          </div>
          {canEdit && !editing && (
            <Button size="sm" variant="subtle" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>Ajustar meta</Button>
          )}
        </div>
        {editing ? (
          <PlanEditor plan={plan} onClose={() => setEditing(false)} />
        ) : (
          <div className="mt-4 grid items-center gap-6 md:grid-cols-[220px_1fr]">
            <AllocDonut rows={rows} total={total} />
            <ul className="flex flex-col gap-3" aria-label="Classes">
              {rows.map((r) => (
                <li key={r.key}>
                  <div className="flex items-center gap-2 text-[14px]">
                    <span className="size-2.5 shrink-0 rounded-full" style={{ background: color(r.key) }} aria-hidden />
                    <span className="flex-1 font-semibold">{r.label}</span>
                    <span className="font-num text-muted">{formatPercent(r.pct, 0)}</span>
                    <span className="text-[12px] text-subtle">meta {r.target}%</span>
                  </div>
                  <div className="relative mt-1.5 h-2 rounded-full bg-surface-2" aria-hidden>
                    <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, r.pct)}%`, background: color(r.key) }} />
                    <span className="absolute -inset-y-1 w-0.5 rounded bg-fg/70" style={{ left: `${r.target}%` }} />
                  </div>
                  <p className="mt-1 text-[12px] text-subtle">
                    <Money cents={r.cents} />
                    {total > 0 && Math.abs(r.gap) >= 1_000 && <> · {r.gap > 0 ? <>faltam <Money cents={r.gap} /> para a meta</> : <>acima da meta em <Money cents={-r.gap} /></>}</>}
                    {(r.key === 'rf' || r.key === 'exterior') && r.cents === 0 && ' · informe em Ajustar meta'}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card className="p-5" role="region" aria-label="Onde aportar">
        <h2 className="text-[15px] font-semibold">Onde colocar o aporte deste mês</h2>
        <p className="text-[13px] text-subtle">O valor vai primeiro para o que está mais abaixo da meta. Dentro de FII e ações, só sugerimos ativos que você já acompanha.</p>
        <Field label="Quanto vai investir este mês?" className="mt-4 max-w-[240px]">
          {(id) => <MoneyInput id={id} value={contribution} onChange={changeContribution} />}
        </Field>
        <ul className="mt-4 divide-y divide-line rounded-2xl border border-line" aria-label="Sugestão de aporte">
          {PLAN_CLASSES.filter((c) => split[c.key] > 0).map((c) => {
            const buys = c.key === 'fii' ? fiiBuys : c.key === 'acoes' ? stockBuys : [];
            return (
              <li key={c.key} className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="size-2.5 rounded-full" style={{ background: color(c.key) }} aria-hidden />
                  <span className="flex-1 font-semibold">{c.label}</span>
                  <Money cents={split[c.key]} className="font-num font-semibold" />
                </div>
                {buys.length > 0 ? (
                  <ul className="mt-1.5 space-y-1 pl-4 text-[13px] text-muted">
                    {buys.map((b) => (
                      <li key={b.ticker}>
                        Comprar <strong className="text-fg">{b.quantity} {unitLabel(c.key === 'fii' ? 'fii' : 'stock', b.quantity)} de {b.ticker}</strong> (≈ {formatBRL(b.cents)}) · {b.why}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 pl-4 text-[13px] text-subtle">
                    {c.key === 'rf' ? 'Tesouro Selic ou CDB com liquidez diária: começa pela reserva de emergência.' : c.key === 'exterior' ? 'ETF de índice do exterior ou BDRs, pela sua corretora.' : 'Valor menor que uma cota dos seus ativos: junte com o próximo aporte ou adicione um ativo novo.'}
                  </p>
                )}
              </li>
            );
          })}
          {contribution <= 0 && <li className="px-4 py-3 text-[13px] text-subtle">Informe um valor para ver a sugestão.</li>}
        </ul>
      </Card>

      <Card className="p-5" role="region" aria-label="Oportunidades">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold"><Sparkles className="size-4 text-brand" aria-hidden /> Oportunidades e alertas da sua carteira</h2>
        <p className="text-[13px] text-subtle">Atualizado com as cotações e anúncios da B3.</p>
        {sig.length === 0 ? (
          <p className="mt-4 flex items-start gap-2 rounded-xl bg-surface-2 px-3 py-2.5 text-[14px] text-muted">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-positive" aria-hidden /> Nada fora do comum agora. Avisamos quando aparecer data com próxima ou preço abaixo do seu médio.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-line" aria-label="Sinais">
            {sig.map((s) => {
              const Icon = SIGNAL_ICON[s.kind];
              return (
                <li key={`${s.kind}${s.ticker}`} className="flex gap-3 py-3">
                  <span className={cn('grid size-9 shrink-0 place-items-center rounded-xl', s.kind === 'concentration' ? 'bg-warning/12 text-warning' : 'bg-brand/12 text-brand')}>
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <div>
                    <p className="font-semibold">{s.title}</p>
                    <p className="text-[13px] text-muted">{s.detail}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-3 border-t border-line pt-3">
          <PushToggle />
          <p className="mt-1 text-[12px] text-subtle">Com os avisos ligados, o celular avisa no dia da data com e quando um ativo cai 5% abaixo do seu preço médio.</p>
        </div>
      </Card>

      <p className="text-[12px] leading-relaxed text-subtle">
        As sugestões seguem regras simples (sua meta de divisão, rendimento pela cotação, preço médio e datas da B3) e não são recomendação de investimento. Rendimento passado não garante rendimento futuro: antes de comprar, confira o relatório do fundo ou da empresa.
      </p>
    </div>
  );
}

function AllocDonut({ rows, total }: { rows: ReturnType<typeof allocation>['rows']; total: number }) {
  const R = 100;
  const r = 64;
  let angle = -Math.PI / 2;
  const pt = (rad: number, a: number) => `${(rad * Math.cos(a)).toFixed(3)} ${(rad * Math.sin(a)).toFixed(3)}`;
  const parts = rows.filter((x) => x.cents > 0);
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[220px]">
      <svg viewBox="-110 -110 220 220" className="size-full" role="img" aria-label={`Divisão atual: ${rows.map((x) => `${x.label} ${Math.round(x.pct)}%`).join(', ')}`}>
        {parts.length === 0 && <circle r={(R + r) / 2} fill="none" stroke="var(--surface-2)" strokeWidth={R - r} />}
        {parts.length === 1 && <circle r={(R + r) / 2} fill="none" stroke={color(parts[0]!.key)} strokeWidth={R - r} />}
        {parts.length > 1 &&
          parts.map((x) => {
            const a0 = angle;
            const a1 = angle + (x.cents / total) * Math.PI * 2;
            angle = a1;
            const large = a1 - a0 > Math.PI ? 1 : 0;
            return <path key={x.key} d={`M ${pt(R, a0)} A ${R} ${R} 0 ${large} 1 ${pt(R, a1)} L ${pt(r, a1)} A ${r} ${r} 0 ${large} 0 ${pt(r, a0)} Z`} fill={color(x.key)} stroke="var(--surface)" strokeWidth={2} />;
          })}
      </svg>
      <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
        <div>
          <p className="text-[12px] font-semibold text-muted">Total</p>
          <Money cents={total} className="font-num block text-lg font-bold" />
        </div>
      </div>
    </div>
  );
}

function PlanEditor({ plan, onClose }: { plan: PlanSettings; onClose: () => void }) {
  const ws = useWsId();
  const [targets, setTargets] = useState(plan.targets);
  const [rf, setRf] = useState(plan.manual.rf ?? 0);
  const [ext, setExt] = useState(plan.manual.exterior ?? 0);
  const [saving, setSaving] = useState(false);
  const sum = targets.rf + targets.acoes + targets.exterior + targets.fii;
  async function save() {
    setSaving(true);
    try {
      await saveRendaSettings(ws, { plan: { targets, manual: { rf, exterior: ext } } });
      await queryClient.invalidateQueries({ queryKey: wsKey(ws, 'renda-settings') });
      toast.success('Plano salvo.');
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="mt-4 flex flex-col gap-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Modelos">
        {PRESETS.map((p) => (
          <button key={p.name} type="button" onClick={() => setTargets(p.targets)} className={cn('rounded-xl border px-3 py-2 text-left text-[13px] transition', JSON.stringify(targets) === JSON.stringify(p.targets) ? 'border-brand/50 bg-brand/10' : 'border-line hover:border-line-strong')}>
            <span className="block font-semibold">{p.name}</span>
            <span className="text-subtle">{p.text}</span>
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {PLAN_CLASSES.map((c) => (
          <Field key={c.key} label={`${c.label} (%)`} hint={c.hint}>
            {(id, d) => (
              <Input id={id} aria-describedby={d} inputMode="numeric" value={String(targets[c.key])} onChange={(e) => setTargets((t) => ({ ...t, [c.key]: Math.min(100, Number(e.target.value.replace(/\D/g, '')) || 0) }))} />
            )}
          </Field>
        ))}
      </div>
      <p className={cn('text-[13px] font-semibold', sum === 100 ? 'text-positive' : 'text-negative')} aria-live="polite">Total: {sum}% {sum !== 100 && '(precisa somar 100%)'}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Quanto você tem em renda fixa" hint="Tesouro, CDB, poupança… (fora do app)">{(id, d) => <MoneyInput id={id} aria-describedby={d} value={rf} onChange={setRf} />}</Field>
        <Field label="Quanto você tem no exterior" hint="ETFs, BDRs, conta fora (fora do app)">{(id, d) => <MoneyInput id={id} aria-describedby={d} value={ext} onChange={setExt} />}</Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button variant="primary" loading={saving} disabled={sum !== 100} onClick={() => void save()}>Salvar plano</Button>
      </div>
    </div>
  );
}
