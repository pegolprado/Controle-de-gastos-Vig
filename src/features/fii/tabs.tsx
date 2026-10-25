import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CalendarPlus, ClipboardCopy, Download, Snowflake, Target } from 'lucide-react';
import { useWsId } from '@/app/WorkspaceProvider';
import { useLookups, wsKey } from '@/hooks/useFinance';
import { Button } from '@/components/ui/Button';
import { Badge, Card, EmptyState, Progress, Skeleton } from '@/components/ui/Card';
import { Field, Select, Switch } from '@/components/ui/Field';
import { Money } from '@/components/ui/Money';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { cn } from '@/lib/cn';
import { centsToCSV, downloadFile, toCSV } from '@/lib/csv';
import { addMonths, formatDate, startOfMonth } from '@/lib/dates';
import { formatBRL, formatPercent } from '@/lib/money';
import { errorMessage } from '@/lib/errors';
import { invalidateFinance, queryClient } from '@/lib/queryClient';
import type { RendaSettings } from '@/lib/types';
import { goalPlan, incomeDescription, snowball, IR_GROUP_LABEL, irReport, monthStatus, type FiiPayment, type IrGroup } from '@/domain/fii';
import { runAutopilot, saveRendaSettings } from '@/services/fii';
import { PushToggle } from '@/pwa/PushToggle';
import { fmtRate, unitLabel } from './shared';

// ---------------------------------------------------------------- Agenda + piloto automático

export function AgendaTab({
  agenda,
  upcoming,
  today,
  loading,
  settings,
  canEdit,
  canContribute,
  isLaunched,
  onLaunch,
}: {
  agenda: FiiPayment[];
  upcoming: FiiPayment[];
  today: string;
  loading: boolean;
  settings: RendaSettings | null;
  canEdit: boolean;
  canContribute: boolean;
  isLaunched: (p: FiiPayment) => boolean;
  onLaunch: (p: FiiPayment[]) => void;
}) {
  return (
    <div className="mt-4 flex flex-col gap-4">
      <AutopilotCard settings={settings} canEdit={canEdit} />
      <Card>
        {loading ? (
          <Skeleton className="m-5 h-24" />
        ) : agenda.length === 0 ? (
          <EmptyState title="Nenhum pagamento previsto" description="Os fundos costumam anunciar os rendimentos no fim de cada mês. Volte depois ou toque em Atualizar." />
        ) : (
          <>
            <ul className="divide-y divide-line">
              {agenda.map((p) => {
                const st = monthStatus(p.dist.payment_date < startOfMonth(addMonths(today, 1)) ? 'upcoming' : 'next', p, today)!;
                return (
                  <li key={`${p.ticker}${p.dist.payment_date}${p.dist.kind}${p.dist.isin}`} className="flex items-center gap-3 px-5 py-3.5">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">
                        {incomeDescription(p)} <span className="text-[13px] font-normal text-subtle">· {p.quantity} {unitLabel(p.asset_type, p.quantity)} × {fmtRate(p.dist.rate)}</span>
                      </p>
                      <p className="text-[13px] text-subtle">
                        {p.projected ? 'Previsto para' : 'Pagamento'} {formatDate(p.dist.payment_date)}
                        {p.dist.record_date && ` · data com ${p.projected ? '~' : ''}${formatDate(p.dist.record_date)}`}
                        {p.projected && ' · ainda não anunciado'}
                        {!p.projected && isLaunched(p) && ' · na Agenda'}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Money cents={p.amount_cents} className={cn('font-num font-semibold', p.projected ? 'text-info' : 'text-warning')} />
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </div>
                  </li>
                );
              })}
            </ul>
            {canContribute && !settings?.auto_launch && upcoming.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4">
                <p className="text-[13px] text-muted">Lance como receitas a receber para aparecerem na Agenda e no saldo previsto.</p>
                <Button
                  size="sm"
                  variant="subtle"
                  icon={<CalendarPlus className="size-4" />}
                  disabled={upcoming.every(isLaunched)}
                  onClick={() => onLaunch(upcoming.filter((p) => !isLaunched(p)))}
                >
                  {upcoming.every(isLaunched) ? 'Tudo lançado' : 'Lançar como receitas'}
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

function AutopilotCard({ settings, canEdit }: { settings: RendaSettings | null; canEdit: boolean }) {
  const ws = useWsId();
  const { accounts } = useLookups();
  const active = accounts.filter((a) => !a.archived);
  const [saving, setSaving] = useState(false);
  const accountId = settings?.account_id ?? active[0]?.id ?? '';

  async function save(patch: Partial<RendaSettings>) {
    setSaving(true);
    try {
      await saveRendaSettings(ws, { account_id: accountId || null, ...patch });
      await queryClient.invalidateQueries({ queryKey: wsKey(ws, 'renda-settings') });
      if (patch.auto_launch ?? settings?.auto_launch) {
        const n = await runAutopilot(ws);
        if (n) void invalidateFinance(ws);
        toast.success(n ? `Piloto automático ligado: ${n} ${n === 1 ? 'provento lançado' : 'proventos lançados'}.` : 'Piloto automático ligado.');
      }
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3 p-5">
      <Switch
        checked={!!settings?.auto_launch}
        disabled={!canEdit || saving || !active.length}
        onChange={(v) => void save({ auto_launch: v })}
        label="Piloto automático"
        description={
          active.length
            ? 'Quando um provento é anunciado, ele entra na Agenda como receita; no dia do pagamento, vira recebido no saldo. Sem você tocar em nada.'
            : 'Cadastre a conta da corretora em Contas para ligar o piloto automático.'
        }
      />
      {settings?.auto_launch && active.length > 0 && (
        <Field label="Conta que recebe (corretora)">
          {(id) => (
            <Select id={id} value={accountId} disabled={!canEdit || saving} onChange={(e) => void save({ account_id: e.target.value })}>
              {active.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </Select>
          )}
        </Field>
      )}
      <div className="border-t border-line pt-3">
        <PushToggle />
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- Meta de renda passiva

export function GoalTab({
  settings,
  canEdit,
  items,
  loading,
}: {
  settings: RendaSettings | null;
  canEdit: boolean;
  items: Array<{ ticker: string; quantity: number; perShare: number; price: number | null; type: 'fii' | 'stock' }>;
  loading: boolean;
}) {
  const ws = useWsId();
  const [goal, setGoal] = useState(settings?.income_goal_cents ?? 0);
  const [saving, setSaving] = useState(false);
  const saved = settings?.income_goal_cents ?? 0;
  const plan = useMemo(() => goalPlan(saved, items), [saved, items]);
  const typeOf = new Map(items.map((i) => [i.ticker, i.type]));
  const valueCents = Math.round(items.reduce((s, i) => s + i.quantity * (i.price ?? 0) * 100, 0));

  async function saveGoal() {
    setSaving(true);
    try {
      await saveRendaSettings(ws, { income_goal_cents: goal || null });
      await queryClient.invalidateQueries({ queryKey: wsKey(ws, 'renda-settings') });
      toast.success(goal ? `Meta de ${formatBRL(goal)} por mês salva.` : 'Meta removida.');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-4 flex flex-col gap-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Quanto você quer receber por mês?" className="min-w-[200px] flex-1">
            {(id) => <MoneyInput id={id} value={goal} onChange={setGoal} />}
          </Field>
          {canEdit && (
            <Button variant="primary" icon={<Target className="size-4" />} onClick={() => void saveGoal()} loading={saving} disabled={goal === saved}>
              Salvar meta
            </Button>
          )}
        </div>
        {saved > 0 && (
          <div className="mt-5">
            {loading ? (
              <Skeleton className="h-16" />
            ) : (
              <>
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <p className="text-[13px] text-muted">Sua carteira rende hoje</p>
                    <p className="font-num text-2xl font-bold text-positive"><Money cents={plan.current_cents} /> <span className="text-sm font-medium text-subtle">/mês</span></p>
                  </div>
                  <p className="font-num text-xl font-semibold">{formatPercent(plan.pct)}</p>
                </div>
                <Progress value={plan.pct} tone="positive" className="mt-2 h-3" label="Progresso da meta" />
                <p className="mt-2 text-[14px] text-muted">
                  {plan.missing_cents > 0 ? (
                    <>Faltam <strong className="text-fg"><Money cents={plan.missing_cents} /></strong> por mês para chegar a <Money cents={saved} />.</>
                  ) : (
                    <strong className="text-positive">Meta atingida! 🎉</strong>
                  )}
                </p>
              </>
            )}
          </div>
        )}
      </Card>

      {!loading && <Snowball valueCents={valueCents} incomeCents={plan.current_cents} goalCents={saved} />}

      {saved > 0 && plan.missing_cents > 0 && plan.rows.length > 0 && (
        <Card>
          <div className="px-5 pt-5">
            <h2 className="text-[15px] font-semibold">Para bater a meta só com um ativo, você precisaria de…</h2>
            <p className="mt-0.5 text-[13px] text-subtle">Ordenado pelo que mais rende por real investido hoje. Use para comparar; pode dividir entre vários.</p>
          </div>
          <ul className="mt-2 divide-y divide-line">
            {plan.rows.map((r) => (
              <li key={r.ticker} className="flex items-center gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {r.ticker}
                    {r.yieldPct !== null && <span className="ml-2 text-[13px] font-normal text-positive">rende {formatPercent(r.yieldPct, 2)} ao mês</span>}
                  </p>
                  <p className="text-[13px] text-subtle">
                    {fmtRate(r.perShare)}/mês por {unitLabel(typeOf.get(r.ticker), 1)}
                    {r.price !== null && ` · cotação ${fmtRate(r.price)}`}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-num font-semibold">+{r.sharesNeeded.toLocaleString('pt-BR')} {unitLabel(typeOf.get(r.ticker), r.sharesNeeded)}</p>
                  {r.cost_cents !== null && <p className="text-[13px] text-subtle">≈ <Money cents={r.cost_cents} /></p>}
                </div>
              </li>
            ))}
          </ul>
          <p className="px-5 pb-4 pt-2 text-[12px] text-subtle">
            FII: último rendimento; ações: média dos últimos 12 meses (JCP líquido). Rendimentos passados não garantem os futuros. Não é recomendação de investimento.
          </p>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Imposto de renda

export function IrTab({
  items,
  today,
}: {
  items: Array<{ ticker: string; name: string | null; assetType: 'fii' | 'stock'; payments: FiiPayment[] }>;
  today: string;
}) {
  const thisYear = Number(today.slice(0, 4));
  // de janeiro a maio, o mais útil é o ano anterior (declaração)
  const [year, setYear] = useState(Number(today.slice(5, 7)) <= 5 ? thisYear - 1 : thisYear);
  const rows = useMemo(() => irReport(year, items, today), [year, items, today]);
  const groups = (['fii', 'dividendos', 'jcp'] as IrGroup[]).map((g) => ({ g, rows: rows.filter((r) => r.group === g) })).filter((x) => x.rows.length);
  const total = rows.reduce((s, r) => s + r.total_cents, 0);

  const text = groups
    .map(({ g, rows: rs }) => `${IR_GROUP_LABEL[g].title} — ${IR_GROUP_LABEL[g].where}\n` + rs.map((r) => `${r.ticker}${r.name ? ` (${r.name})` : ''}: ${formatBRL(r.total_cents)}`).join('\n'))
    .join('\n\n');

  return (
    <div className="mt-4 flex flex-col gap-4">
      <Card className="flex flex-wrap items-end justify-between gap-3 p-5">
        <Field label="Ano-calendário">
          {(id) => (
            <Select id={id} value={String(year)} onChange={(e) => setYear(Number(e.target.value))}>
              {[thisYear, thisYear - 1, thisYear - 2].map((y) => (
                <option key={y} value={y}>{y}{y === thisYear ? ' (até hoje)' : ''}</option>
              ))}
            </Select>
          )}
        </Field>
        <div className="flex gap-2">
          <Button
            size="sm"
            icon={<ClipboardCopy className="size-4" />}
            disabled={!rows.length}
            onClick={() => void navigator.clipboard?.writeText(text).then(() => toast.success('Copiado. Cole onde quiser.'), () => toast.error('Não foi possível copiar.'))}
          >
            Copiar
          </Button>
          <Button
            size="sm"
            icon={<Download className="size-4" />}
            disabled={!rows.length}
            onClick={() =>
              downloadFile(
                toCSV(
                  rows.map((r) => ({ grupo: IR_GROUP_LABEL[r.group].title, onde: IR_GROUP_LABEL[r.group].where, ativo: r.ticker, nome: r.name ?? '', pagamentos: r.count, total: centsToCSV(r.total_cents) })),
                  [
                    { key: 'grupo', label: 'Grupo' },
                    { key: 'onde', label: 'Onde declarar' },
                    { key: 'ativo', label: 'Ativo' },
                    { key: 'nome', label: 'Nome' },
                    { key: 'pagamentos', label: 'Pagamentos' },
                    { key: 'total', label: 'Total (R$)' },
                  ],
                ),
                `proventos-ir-${year}.csv`,
                'text/csv;charset=utf-8',
              )
            }
          >
            CSV
          </Button>
        </div>
      </Card>

      {!rows.length ? (
        <Card>
          <EmptyState title={`Nenhum provento recebido em ${year}`} description="Os valores aparecem aqui conforme os pagamentos caem na sua conta." />
        </Card>
      ) : (
        groups.map(({ g, rows: rs }) => (
          <Card key={g}>
            <div className="px-5 pt-5">
              <h2 className="text-[15px] font-semibold">{IR_GROUP_LABEL[g].title}</h2>
              <p className="mt-0.5 text-[13px] text-subtle">{IR_GROUP_LABEL[g].where}</p>
            </div>
            <ul className="mt-2 divide-y divide-line">
              {rs.map((r) => (
                <li key={r.ticker} className="flex items-center justify-between gap-3 px-5 py-3">
                  <span>
                    <strong>{r.ticker}</strong> <span className="text-[13px] text-subtle">{r.name ?? ''} · {r.count} {r.count === 1 ? 'pagamento' : 'pagamentos'}</span>
                  </span>
                  <Money cents={r.total_cents} className="font-num font-semibold" />
                </li>
              ))}
            </ul>
            <p className="flex justify-between border-t border-line px-5 py-3 text-[14px] font-semibold">
              <span>Total</span>
              <Money cents={rs.reduce((s, r) => s + r.total_cents, 0)} />
            </p>
          </Card>
        ))
      )}
      {rows.length > 0 && (
        <p className="text-[12px] leading-relaxed text-subtle">
          Total no ano: <strong className="text-fg">{formatBRL(total)}</strong>. Calculado com as datas das suas compras e vendas e os anúncios da B3. O CNPJ de cada fundo ou empresa está no informe de rendimentos da sua corretora; confira os valores com ele antes de declarar.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- bola de neve

const CONTRIB_KEY = 'fmv.renda.aporte';
const yearsLabel = (m: number) => {
  const y = Math.floor(m / 12);
  const r = m % 12;
  return [y && `${y} ${y === 1 ? 'ano' : 'anos'}`, r && `${r} ${r === 1 ? 'mês' : 'meses'}`].filter(Boolean).join(' e ') || 'já';
};

/** Simulador: reinvestindo a renda e aportando todo mês, quanto a carteira passa a render. */
function Snowball({ valueCents, incomeCents, goalCents }: { valueCents: number; incomeCents: number; goalCents: number }) {
  const [contribution, setContribution] = useState(() => {
    try {
      return Number(localStorage.getItem(CONTRIB_KEY)) || 50_000;
    } catch {
      return 50_000;
    }
  });
  const sim = useMemo(
    () => snowball({ value_cents: valueCents, income_cents: incomeCents, contribution_cents: contribution, goal_cents: goalCents }),
    [valueCents, incomeCents, contribution, goalCents],
  );
  if (valueCents <= 0 || incomeCents <= 0) return null;
  const change = (v: number) => {
    setContribution(v);
    try {
      localStorage.setItem(CONTRIB_KEY, String(v));
    } catch {
      /* ignore */
    }
  };
  return (
    <Card className="p-5" role="region" aria-label="Bola de neve">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-info/12 text-info">
          <Snowflake className="size-5" aria-hidden />
        </span>
        <div>
          <h2 className="text-[15px] font-semibold">Bola de neve</h2>
          <p className="text-[13px] text-subtle">Reinvestindo todos os proventos e aportando todo mês, quanto a carteira passa a render.</p>
        </div>
      </div>
      <Field label="Aporte por mês" className="mt-4 max-w-[220px]">
        {(id) => <MoneyInput id={id} value={contribution} onChange={change} />}
      </Field>
      {goalCents > incomeCents && (
        <p className="mt-3 rounded-xl bg-positive/10 px-3 py-2.5 text-[14px]">
          {sim.goal_month !== null ? (
            <>Meta de <Money cents={goalCents} />/mês em <strong className="text-positive">{yearsLabel(sim.goal_month)}</strong>.</>
          ) : (
            <>Com esse aporte, a meta passa de 50 anos. Tente aumentar o aporte.</>
          )}
        </p>
      )}
      <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Projeção">
        {sim.points.map((p) => (
          <li key={p.month} className="rounded-xl border border-line px-3 py-2.5">
            <p className="text-[12px] font-semibold text-subtle">Em {yearsLabel(p.month)}</p>
            <p className="font-num text-[17px] font-semibold text-positive"><Money cents={p.income_cents} /><span className="text-[12px] font-normal text-subtle">/mês</span></p>
            <p className="text-[12px] text-subtle">patrimônio <Money cents={p.value_cents} /></p>
            <p className="text-[12px] text-subtle">do seu bolso <Money cents={p.contributed_cents} /></p>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[12px] text-subtle">
        Mantém o rendimento de hoje ({formatPercent((incomeCents / valueCents) * 100, 2)} ao mês sobre o patrimônio), sem valorização das cotas, inflação ou impostos. É uma estimativa, não recomendação.
      </p>
    </Card>
  );
}
