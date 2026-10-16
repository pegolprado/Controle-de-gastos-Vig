import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileDown, FileSpreadsheet } from 'lucide-react';
import { useBrand } from '@/app/BrandProvider';
import { useWorkspace, useWsId } from '@/app/WorkspaceProvider';
import { useLookups, useOpenInvoices, wsKey } from '@/hooks/useFinance';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, ErrorState, Skeleton } from '@/components/ui/Card';
import { Field, Input, Select } from '@/components/ui/Field';
import { Money } from '@/components/ui/Money';
import { Segmented } from '@/components/ui/Segmented';
import { CategoryBars } from '@/components/charts/CategoryBars';
import { LazyArea, LazyBars, SERIES_COLORS } from '@/components/charts/LazyCharts';
import { addMonths, capitalize, endOfMonth, formatDate, monthLabel, startOfMonth, todayISO } from '@/lib/dates';
import { formatBRL, formatPercent } from '@/lib/money';
import { centsToCSV, downloadFile, toCSV } from '@/lib/csv';
import { errorMessage } from '@/lib/errors';
import { buildInsights } from '@/domain/insights';
import { listMembers } from '@/services/workspace';
import { reportCategories, reportMonthly, topExpenses, upcomingCommitments } from '@/services/reports';

export default function ReportsPage() {
  const ws = useWsId();
  const brand = useBrand();
  const { workspace } = useWorkspace();
  const { accounts, cards, accountMap } = useLookups();
  const [params] = useSearchParams();
  const today = todayISO();
  const [from, setFrom] = useState(params.get('de') ?? addMonths(startOfMonth(today), -5));
  const [to, setTo] = useState(startOfMonth(today));
  const [accountId, setAccountId] = useState('');
  const [cardId, setCardId] = useState('');
  const [userId, setUserId] = useState('');
  const [catKind, setCatKind] = useState<'expense' | 'income'>('expense');
  const f = { accountId: accountId || null, cardId: cardId || null, userId: userId || null };
  const toEnd = endOfMonth(to);

  const members = useQuery({ queryKey: wsKey(ws, 'members'), queryFn: () => listMembers(ws), enabled: workspace?.kind === 'shared' });
  const monthly = useQuery({ queryKey: wsKey(ws, 'r-monthly', from, to, f), queryFn: () => reportMonthly(ws, from, to, f) });
  const cats = useQuery({ queryKey: wsKey(ws, 'r-cats', from, toEnd, catKind, f), queryFn: () => reportCategories(ws, from, toEnd, catKind, f) });
  const lengthMonths = Math.max(1, (monthly.data ?? []).length);
  const prevFrom = addMonths(from, -lengthMonths);
  const prevCats = useQuery({ queryKey: wsKey(ws, 'r-cats', prevFrom, 'prev', f), queryFn: () => reportCategories(ws, prevFrom, endOfMonth(addMonths(from, -1)), 'expense', f) });
  const expCats = useQuery({ queryKey: wsKey(ws, 'r-cats', from, toEnd, 'expense', f), queryFn: () => reportCategories(ws, from, toEnd, 'expense', f) });
  const top = useQuery({ queryKey: wsKey(ws, 'r-top', from, toEnd, f), queryFn: () => topExpenses(ws, from, toEnd, f, 10) });
  const future = useQuery({ queryKey: wsKey(ws, 'r-future', today), queryFn: () => upcomingCommitments(ws, today, addMonths(today, 6)) });
  const invoices = useOpenInvoices();

  const rows = useMemo(() => monthly.data ?? [], [monthly.data]);
  const totals = rows.reduce((a, r) => ({ inc: a.inc + r.income_cents, exp: a.exp + r.expense_cents, fixed: a.fixed + r.fixed_expense_cents, variable: a.variable + r.variable_expense_cents }), { inc: 0, exp: 0, fixed: 0, variable: 0 });
  const insights = useMemo(() => buildInsights(expCats.data ?? [], prevCats.data ?? [], rows), [expCats.data, prevCats.data, rows]);

  const projection = useMemo(() => {
    const map = new Map<string, { month: string; in: number; out: number }>();
    for (let i = 0; i < 6; i++) {
      const m = addMonths(startOfMonth(today), i);
      map.set(m, { month: m, in: 0, out: 0 });
    }
    for (const t of future.data ?? []) {
      const m = map.get(startOfMonth(t.due_on!));
      if (!m) continue;
      const rest = t.amount_cents - t.settled_principal_cents;
      if (t.kind === 'income') m.in += rest;
      else m.out += rest;
    }
    for (const i of invoices.data ?? []) {
      const m = map.get(startOfMonth(i.due_date));
      if (m && i.remaining_cents > 0) m.out += i.remaining_cents;
    }
    return [...map.values()];
  }, [future.data, invoices.data, today]);

  let acc = 0;
  const cumulative = rows.map((r) => {
    acc += r.income_cents - r.expense_cents;
    return { label: monthLabel(r.month, { short: true }), net: acc };
  });

  function exportCSV() {
    const csv = toCSV(
      rows.map((r) => ({
        mes: capitalize(monthLabel(r.month)),
        receitas: centsToCSV(r.income_cents),
        despesas: centsToCSV(r.expense_cents),
        resultado: centsToCSV(r.income_cents - r.expense_cents),
        fixas: centsToCSV(r.fixed_expense_cents),
        variaveis: centsToCSV(r.variable_expense_cents),
        recebido: centsToCSV(r.income_realized_cents),
        pago: centsToCSV(r.expense_realized_cents),
      })),
      [
        { key: 'mes', label: 'Mês' }, { key: 'receitas', label: 'Receitas (R$)' }, { key: 'despesas', label: 'Despesas (R$)' },
        { key: 'resultado', label: 'Resultado (R$)' }, { key: 'fixas', label: 'Despesas fixas (R$)' }, { key: 'variaveis', label: 'Despesas variáveis (R$)' },
        { key: 'recebido', label: 'Efetivamente recebido (R$)' }, { key: 'pago', label: 'Efetivamente pago (R$)' },
      ],
    );
    downloadFile(csv, `relatorio-${from.slice(0, 7)}-a-${to.slice(0, 7)}.csv`, 'text/csv;charset=utf-8');
  }

  async function exportPDF() {
    try {
      const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
      const doc = new jsPDF({ unit: 'pt', format: 'a4' });
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.text(`${brand.app_name} — Relatório financeiro`, 40, 48);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.text(`${workspace?.name ?? ''} · ${capitalize(monthLabel(from))} a ${monthLabel(to)} · gerado em ${formatDate(today)}`, 40, 66);
      if (accountId || cardId) doc.text(`Filtro: ${accountId ? accountMap.get(accountId)?.name : cards.find((c) => c.id === cardId)?.name}`, 40, 80);
      doc.setFontSize(11);
      doc.text(`Receitas: ${formatBRL(totals.inc)}   Despesas: ${formatBRL(totals.exp)}   Resultado: ${formatBRL(totals.inc - totals.exp)}`, 40, 100);
      autoTable(doc, {
        startY: 116,
        head: [['Mês', 'Receitas', 'Despesas', 'Resultado', 'Fixas', 'Variáveis']],
        body: rows.map((r) => [capitalize(monthLabel(r.month)), formatBRL(r.income_cents), formatBRL(r.expense_cents), formatBRL(r.income_cents - r.expense_cents), formatBRL(r.fixed_expense_cents), formatBRL(r.variable_expense_cents)]),
        styles: { fontSize: 9 },
        headStyles: { fillColor: [12, 18, 32] },
        columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
      });
      const y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 24;
      autoTable(doc, {
        startY: y,
        head: [['Categoria (despesas)', 'Total', '% do total']],
        body: (expCats.data ?? []).map((c) => [c.name, formatBRL(c.total_cents), formatPercent(totals.exp ? (c.total_cents / totals.exp) * 100 : 0, 1)]),
        styles: { fontSize: 9 },
        headStyles: { fillColor: [12, 18, 32] },
        columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
      });
      const y2 = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 24;
      autoTable(doc, {
        startY: y2,
        head: [['Maiores gastos', 'Data', 'Valor']],
        body: (top.data ?? []).map((t) => [t.description, formatDate(t.occurred_on), formatBRL(t.amount_cents)]),
        styles: { fontSize: 9 },
        headStyles: { fillColor: [12, 18, 32] },
        columnStyles: { 2: { halign: 'right' } },
      });
      doc.save(`relatorio-${from.slice(0, 7)}-a-${to.slice(0, 7)}.pdf`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const loading = monthly.isLoading;
  return (
    <>
      <PageHeader
        title="Relatórios"
        subtitle="Somente dados que você tem permissão para consultar."
        actions={brand.features.exports !== false && (
          <>
            <Button size="sm" icon={<FileSpreadsheet className="size-4" />} onClick={exportCSV} disabled={!rows.length}>CSV</Button>
            <Button size="sm" icon={<FileDown className="size-4" />} onClick={() => void exportPDF()} disabled={!rows.length}>PDF</Button>
          </>
        )}
      />
      <Card className="mb-5 grid grid-cols-2 gap-3 p-4 lg:grid-cols-5">
        <Field label="De">{(id) => <Input id={id} type="month" value={from.slice(0, 7)} onChange={(e) => e.target.value && setFrom(`${e.target.value}-01`)} />}</Field>
        <Field label="Até">{(id) => <Input id={id} type="month" value={to.slice(0, 7)} onChange={(e) => e.target.value && setTo(`${e.target.value}-01`)} />}</Field>
        <Field label="Conta">{(id) => <Select id={id} value={accountId} onChange={(e) => { setAccountId(e.target.value); setCardId(''); }}><option value="">Todas</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>}</Field>
        <Field label="Cartão">{(id) => <Select id={id} value={cardId} onChange={(e) => { setCardId(e.target.value); setAccountId(''); }}><option value="">Todos</option>{cards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
        {workspace?.kind === 'shared' ? (
          <Field label="Registrado por">{(id) => <Select id={id} value={userId} onChange={(e) => setUserId(e.target.value)}><option value="">Todos</option>{(members.data ?? []).filter((m) => !m.is_support).map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name || m.email}</option>)}</Select>}</Field>
        ) : <div className="hidden lg:block" />}
      </Card>

      {monthly.error && <ErrorState error={monthly.error} onRetry={() => void monthly.refetch()} />}

      <section className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Receitas', v: totals.inc, tone: 'income' as const },
          { label: 'Despesas', v: totals.exp, tone: 'expense' as const },
          { label: 'Resultado', v: totals.inc - totals.exp, tone: (totals.inc - totals.exp >= 0 ? 'income' : 'expense') as 'income' | 'expense' },
          { label: 'Média mensal de despesas', v: Math.round(totals.exp / lengthMonths), tone: 'neutral' as const },
        ].map((s) => (
          <Card key={s.label} className="p-4">
            <p className="text-[13px] font-semibold text-muted">{s.label}</p>
            {loading ? <Skeleton className="mt-1 h-7 w-28" /> : <Money cents={s.v} tone={s.tone} className="font-num text-xl font-semibold" />}
          </Card>
        ))}
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Receitas × despesas" subtitle="Por mês de competência" />
          <div className="p-3 sm:p-5">{loading ? <Skeleton className="h-60" /> : <LazyBars caption="Receitas e despesas" data={rows.map((r) => ({ label: monthLabel(r.month, { short: true }), income: r.income_cents, expense: r.expense_cents }))} series={[{ key: 'income', name: 'Receitas', color: SERIES_COLORS.income }, { key: 'expense', name: 'Despesas', color: SERIES_COLORS.expense }]} />}</div>
        </Card>
        <Card>
          <CardHeader title="Evolução patrimonial simplificada" subtitle="Resultado acumulado no período (receitas − despesas)" />
          <div className="p-3 sm:p-5">{loading ? <Skeleton className="h-60" /> : <LazyArea caption="Resultado acumulado" data={cumulative} series={[{ key: 'net', name: 'Acumulado', color: SERIES_COLORS.net }]} height={240} />}</div>
        </Card>
        <Card>
          <CardHeader title="Despesas fixas × variáveis" subtitle="Fixas = categorias marcadas como fixas ou recorrências" />
          <div className="p-3 sm:p-5">
            {loading ? <Skeleton className="h-60" /> : (
              <>
                <LazyBars caption="Despesas fixas e variáveis" data={rows.map((r) => ({ label: monthLabel(r.month, { short: true }), fixed: r.fixed_expense_cents, variable: r.variable_expense_cents }))} series={[{ key: 'fixed', name: 'Fixas', color: SERIES_COLORS.info }, { key: 'variable', name: 'Variáveis', color: '#eb6834' }]} height={200} />
                <p className="mt-2 text-[13px] text-subtle">Fixas: <Money cents={totals.fixed} className="font-semibold text-muted" /> ({formatPercent(totals.exp ? (totals.fixed / totals.exp) * 100 : 0)}) · Variáveis: <Money cents={totals.variable} className="font-semibold text-muted" /></p>
              </>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="Por categoria" action={<Segmented label="Tipo" size="sm" value={catKind} onChange={setCatKind} options={[{ value: 'expense', label: 'Despesas' }, { value: 'income', label: 'Receitas' }]} />} />
          <div className="p-5">{cats.isLoading ? <Skeleton className="h-52" /> : (cats.data ?? []).length ? <CategoryBars data={cats.data!} limit={8} /> : <p className="py-8 text-center text-sm text-subtle">Sem dados no período.</p>}</div>
        </Card>
        <Card>
          <CardHeader title="Maiores gastos" />
          <ol className="p-3 pt-2">
            {top.isLoading ? <Skeleton className="m-2 h-40" /> : (top.data ?? []).length === 0 ? <p className="py-8 text-center text-sm text-subtle">Sem despesas no período.</p> : top.data!.map((t, i) => (
              <li key={t.id} className="flex items-center gap-3 rounded-lg px-2 py-2">
                <span className="font-num w-5 text-sm text-subtle">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{t.description}</span>
                  <span className="text-[12px] text-subtle">{formatDate(t.occurred_on)}</span>
                </span>
                <Money cents={t.amount_cents} className="text-sm font-semibold" />
              </li>
            ))}
          </ol>
        </Card>
        <Card>
          <CardHeader title="Projeção de compromissos" subtitle="Próximos 6 meses: contas pendentes, recebimentos e faturas já lançadas" />
          <div className="p-3 sm:p-5">
            {future.isLoading ? <Skeleton className="h-52" /> : (
              <LazyBars caption="Compromissos futuros" height={200} data={projection.map((p) => ({ label: monthLabel(p.month, { short: true }), in: p.in, out: p.out }))} series={[{ key: 'in', name: 'A receber', color: SERIES_COLORS.income }, { key: 'out', name: 'A pagar', color: SERIES_COLORS.expense }]} />
            )}
            <p className="mt-2 text-[12px] text-subtle">Recorrências entram conforme são geradas (até 45 dias à frente). Valores futuros são estimativas com base no que já foi lançado.</p>
          </div>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Insights do período" subtitle="Comparação com o período anterior de mesma duração" />
          <div className="p-5">
            {insights.length === 0 ? <p className="text-sm text-subtle">Ainda não existem informações suficientes para comparações confiáveis.</p> : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {insights.map((i) => <li key={i.id} className="rounded-xl border border-line p-3.5"><p className="text-sm font-semibold">{i.title}</p><p className="text-[13px] text-muted">{i.detail}</p></li>)}
              </ul>
            )}
          </div>
        </Card>
      </div>

      <Card className="mt-5 overflow-x-auto">
        <CardHeader title="Tabela mensal" />
        <table className="mt-3 w-full min-w-[640px] text-sm">
          <thead className="border-y border-line bg-surface-2/50 text-left text-[12px] uppercase tracking-wider text-subtle">
            <tr><th className="px-5 py-2.5 font-semibold">Mês</th><th className="px-3 text-right font-semibold">Receitas</th><th className="px-3 text-right font-semibold">Despesas</th><th className="px-3 text-right font-semibold">Resultado</th><th className="px-3 text-right font-semibold">Recebido</th><th className="px-5 text-right font-semibold">Pago</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.month}>
                <td className="px-5 py-2.5 capitalize">{monthLabel(r.month)}</td>
                <td className="px-3 text-right"><Money cents={r.income_cents} /></td>
                <td className="px-3 text-right"><Money cents={r.expense_cents} /></td>
                <td className="px-3 text-right font-semibold"><Money cents={r.income_cents - r.expense_cents} tone="auto" /></td>
                <td className="px-3 text-right text-muted"><Money cents={r.income_realized_cents} /></td>
                <td className="px-5 text-right text-muted"><Money cents={r.expense_realized_cents} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
