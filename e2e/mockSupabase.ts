/**
 * Backend Supabase SIMULADO para testes de interface (Playwright).
 * Intercepta as chamadas HTTP do supabase-js no navegador. As regras reais de
 * negócio e segurança são testadas contra PostgreSQL de verdade em
 * `npm run test:db`; aqui validamos fluxos de tela, estados e layout.
 */
import type { Page, Route } from '@playwright/test';

export const MOCK_URL = 'http://mock-supabase.test';
const today = new Date();
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (n: number) => iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() + n));
const monthStart = (offset = 0) => iso(new Date(today.getFullYear(), today.getMonth() + offset, 1));

type Row = Record<string, unknown>;

export interface MockState {
  users: Record<string, { id: string; email: string; password: string; full_name: string }>;
  tables: Record<string, Row[]>;
  isOwner: boolean;
  failNextInsert: boolean;
  insertCalls: number;
}

let seq = 1;
const uid = () => `00000000-0000-4000-8000-${String(seq++).padStart(12, '0')}`;
const WS = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';

export function createState(opts: { withData?: boolean; isOwner?: boolean } = {}): MockState {
  const acc1 = { id: uid(), workspace_id: WS, name: 'Nubank', type: 'checking', institution: 'Nubank', initial_balance_cents: 250000, color: '#8b5cf6', include_in_total: true, archived: false, sort_order: 0, created_at: new Date().toISOString() };
  const acc2 = { id: uid(), workspace_id: WS, name: 'Carteira', type: 'cash', institution: null, initial_balance_cents: 15000, color: '#10b981', include_in_total: true, archived: false, sort_order: 1, created_at: new Date().toISOString() };
  const cats = [
    ['Alimentação', 'expense', '#f59e0b', 'utensils'], ['Moradia', 'expense', '#8b5cf6', 'home'], ['Transporte', 'expense', '#0ea5e9', 'car'],
    ['Lazer', 'expense', '#ec4899', 'party-popper'], ['Saúde', 'expense', '#ef4444', 'heart-pulse'], ['Salário', 'income', '#10b981', 'briefcase'],
  ].map(([name, kind, color, icon]) => ({ id: uid(), workspace_id: WS, parent_id: null, name, kind, color, icon, is_fixed: name === 'Moradia', archived: false }));
  const card = { id: uid(), workspace_id: WS, name: 'Roxinho', brand: 'Mastercard', last_digits: '4821', limit_cents: 800000, closing_day: 5, due_day: 12, color: '#7c3aed', default_payment_account_id: acc1.id, archived: false };
  const tx = (p: Row): Row => ({
    id: uid(), workspace_id: WS, kind: 'expense', status: 'paid', description: 'x', amount_cents: 1000, paid_cents: 1000, settled_principal_cents: 1000,
    occurred_on: iso(today), due_on: null, category_id: null, account_id: acc1.id, destination_account_id: null, card_id: null, invoice_id: null,
    payment_method: 'pix', tags: [], notes: null, attachment_path: null, installment_group_id: null, installment_number: null, installments_total: null,
    recurrence_id: null, recurrence_date: null, recurrence_detached: false, client_request_id: null, created_by: USER, updated_by: null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...p,
  });
  const transactions: Row[] = opts.withData
    ? [
        tx({ kind: 'income', status: 'received', description: 'Salário', amount_cents: 850000, paid_cents: 850000, category_id: cats[5].id, occurred_on: monthStart() }),
        tx({ description: 'Aluguel', amount_cents: 230000, paid_cents: 230000, category_id: cats[1].id, occurred_on: monthStart() }),
        tx({ description: 'Mercado Pão de Açúcar', amount_cents: 68490, paid_cents: 68490, category_id: cats[0].id, occurred_on: addDays(-1) }),
        tx({ description: 'Uber', amount_cents: 3290, paid_cents: 3290, category_id: cats[2].id, occurred_on: addDays(-2) }),
        tx({ description: 'Conta de luz', status: 'pending', amount_cents: 18740, paid_cents: 0, settled_principal_cents: 0, category_id: cats[1].id, occurred_on: iso(today), due_on: addDays(3) }),
        tx({ description: 'Internet', status: 'pending', amount_cents: 9990, paid_cents: 0, settled_principal_cents: 0, category_id: cats[1].id, occurred_on: addDays(-6), due_on: addDays(-2) }),
        tx({ description: 'Cinema', amount_cents: 7400, card_id: card.id, account_id: null, payment_method: 'credit_card', category_id: cats[3].id, occurred_on: addDays(-3), invoice_id: 'inv-1' }),
      ]
    : [];
  return {
    users: { 'ana@example.com': { id: USER, email: 'ana@example.com', password: 'Senha1234', full_name: 'Ana Souza' } },
    tables: {
      accounts: [acc1, acc2],
      categories: cats,
      credit_cards: opts.withData ? [card] : [],
      transactions,
      card_invoice_summary: opts.withData
        ? [{ id: 'inv-1', workspace_id: WS, card_id: card.id, reference_month: monthStart(1), closing_date: addDays(10), due_date: addDays(17), total_cents: 7400, items: 1, paid_cents: 0, remaining_cents: 7400, status: 'open' }]
        : [],
      card_limits: opts.withData ? [{ card_id: card.id, workspace_id: WS, limit_cents: 800000, used_cents: 7400, available_cents: 792600 }] : [],
      recurrences: [],
      notifications: [],
      goal_progress: [],
      app_releases: [],
      invites: [],
      tx_settlements: [],
      tx_due_changes: [],
      audit_log: [],
      fii_positions: [],
      fii_funds: [
        { code: 'HSML', name: 'FII HSI MALL', administrator: 'BRL TRUST', not_found: false, synced_at: new Date().toISOString() },
        { code: 'BRCO', name: 'FII BRESCO', administrator: 'OLIVEIRA TRUST', not_found: false, synced_at: new Date().toISOString() },
        { code: 'XPML', name: 'FII XP MALLS', administrator: 'XP INVESTIMENTOS', not_found: false, synced_at: new Date().toISOString() },
      ],
      fii_distributions: [
        { code: 'HSML', isin: 'BRHSMLCTF007', kind: 'RENDIMENTO', record_date: addDays(-17), payment_date: addDays(-10), approved_on: addDays(-17), rate: 0.75, related_to: 'Setembro/2026' },
        { code: 'HSML', isin: 'BRHSMLCTF007', kind: 'RENDIMENTO', record_date: addDays(-47), payment_date: addDays(-40), approved_on: addDays(-47), rate: 0.75, related_to: 'Agosto/2026' },
        { code: 'BRCO', isin: 'BRBRCOCTF007', kind: 'RENDIMENTO', record_date: addDays(-17), payment_date: addDays(2), approved_on: addDays(-17), rate: 0.91, related_to: 'SETEMBRO/2026' },
        // XPML: paga todo mês, mas o deste mês ainda não foi anunciado → previsão
        ...[-22, -52, -83].map((n) => ({ code: 'XPML', isin: 'BRXPMLCTF000', kind: 'RENDIMENTO', record_date: addDays(n - 7), payment_date: addDays(n), approved_on: addDays(n - 7), rate: 0.92, related_to: null })),
      ],
    },
    isOwner: Boolean(opts.isOwner),
    failNextInsert: false,
    insertCalls: 0,
  };
}

function balances(s: MockState) {
  return s.tables.accounts.map((a) => {
    let cur = Number(a.initial_balance_cents);
    let pend = 0;
    for (const t of s.tables.transactions) {
      if (t.status === 'cancelled') continue;
      const sign = t.kind === 'income' ? 1 : -1;
      if (t.account_id === a.id && (t.kind === 'income' || t.kind === 'expense')) {
        if (t.status === 'paid' || t.status === 'received') cur += sign * Number(t.amount_cents);
        else pend += sign * Number(t.amount_cents);
      }
      if (t.kind === 'transfer') {
        if (t.account_id === a.id) cur -= Number(t.amount_cents);
        if (t.destination_account_id === a.id) cur += Number(t.amount_cents);
      }
    }
    return { account_id: a.id, workspace_id: WS, current_balance_cents: cur, realized_balance_cents: cur, projected_balance_cents: cur + pend, pending_in_cents: Math.max(pend, 0), pending_out_cents: Math.max(-pend, 0) };
  });
}

function monthly(s: MockState, from: string, to: string) {
  const out = [];
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  for (let y = fy, m = fm; y < ty || (y === ty && m <= tm); m === 12 ? ((m = 1), y++) : m++) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    const rows = s.tables.transactions.filter((t) => String(t.occurred_on).startsWith(key) && t.status !== 'cancelled');
    const sum = (k: string) => rows.filter((t) => t.kind === k).reduce((a, t) => a + Number(t.amount_cents), 0);
    // meses anteriores fictícios para o gráfico ter histórico
    const base = key < monthStart().slice(0, 7) && rows.length === 0 && s.tables.transactions.length ? 1 : 0;
    out.push({ month: `${key}-01`, income_cents: sum('income') || base * 820000, expense_cents: sum('expense') || base * (560000 + m * 9000), income_realized_cents: sum('income'), expense_realized_cents: sum('expense'), fixed_expense_cents: Math.round((sum('expense') || base * 500000) * 0.55), variable_expense_cents: Math.round((sum('expense') || base * 500000) * 0.45) });
  }
  return out;
}

function categoriesReport(s: MockState, from: string, to: string, kind: string) {
  const map = new Map<string, { category_id: string; name: string; color: string; icon: string; total_cents: number; items: number }>();
  for (const t of s.tables.transactions) {
    if (t.kind !== kind || t.status === 'cancelled' || String(t.occurred_on) < from || String(t.occurred_on) > to) continue;
    const c = s.tables.categories.find((x) => x.id === t.category_id);
    const key = (c?.id as string) ?? 'none';
    const cur = map.get(key) ?? { category_id: key, name: (c?.name as string) ?? 'Sem categoria', color: (c?.color as string) ?? '#64748b', icon: (c?.icon as string) ?? 'circle-dashed', total_cents: 0, items: 0 };
    cur.total_cents += Number(t.amount_cents);
    cur.items++;
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => b.total_cents - a.total_cents);
}

function filterRows(rows: Row[], params: URLSearchParams) {
  let out = rows;
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'offset', 'or', 'and', 'on_conflict', 'columns'].includes(k)) continue;
    const m = /^(eq|neq|gte|lte|in|is|not)\.(.*)$/.exec(v);
    if (!m) continue;
    const [, op, val] = m;
    out = out.filter((r) => {
      const x = r[k];
      if (op === 'eq') return String(x) === val;
      if (op === 'neq') return String(x) !== val;
      if (op === 'gte') return String(x) >= val;
      if (op === 'lte') return String(x) <= val;
      if (op === 'in') return val.replace(/[()]/g, '').split(',').includes(String(x));
      if (op === 'is') return val === 'null' ? x == null : true;
      if (op === 'not') return val.startsWith('is.null') ? x != null : true;
      return true;
    });
  }
  const or = params.get('or');
  if (or?.includes('description.ilike')) {
    const term = /description\.ilike\.%(.*?)%/.exec(or)?.[1]?.toLowerCase() ?? '';
    out = out.filter((r) => String(r.description).toLowerCase().includes(decodeURIComponent(term)));
  }
  const order = params.get('order');
  if (order?.startsWith('occurred_on.desc')) out = [...out].sort((a, b) => String(b.occurred_on).localeCompare(String(a.occurred_on)));
  return out;
}

export async function installMock(page: Page, s: MockState) {
  const session = () => ({
    access_token: 'mock.jwt.token', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'mock-refresh',
    user: { id: USER, aud: 'authenticated', role: 'authenticated', email: 'ana@example.com', app_metadata: {}, user_metadata: { full_name: 'Ana Souza' }, created_at: new Date().toISOString(), last_sign_in_at: new Date().toISOString() },
  });
  const json = (route: Route, body: unknown, status = 200, headers: Record<string, string> = {}) =>
    route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', ...headers }, body: JSON.stringify(body) });

  await page.route(`${MOCK_URL}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });

    // ---------- auth
    if (path === '/auth/v1/token') {
      const body = req.postDataJSON() as { email?: string; password?: string };
      if (url.searchParams.get('grant_type') === 'refresh_token') return json(route, session());
      const u = s.users[body.email ?? ''];
      if (!u || u.password !== body.password) return json(route, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }, 400);
      return json(route, session());
    }
    if (path === '/auth/v1/signup') {
      const body = req.postDataJSON() as { email: string; password: string };
      if (s.users[body.email]) return json(route, { code: 422, error_code: 'user_already_exists', msg: 'User already registered' }, 422);
      s.users[body.email] = { id: USER, email: body.email, password: body.password, full_name: '' };
      return json(route, session());
    }
    if (path === '/auth/v1/user') return json(route, session().user);
    if (path === '/auth/v1/logout') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
    if (path === '/auth/v1/recover') return json(route, {});

    // ---------- rpc
    if (path.startsWith('/rest/v1/rpc/')) {
      const fn = path.split('/').pop();
      const a = (req.postDataJSON() ?? {}) as Record<string, string>;
      switch (fn) {
        case 'session_context':
          return json(route, {
            profile: { id: USER, email: 'ana@example.com', full_name: 'Ana Souza', avatar_url: null, status: 'active', created_at: new Date().toISOString() },
            status: 'active', is_app_owner: s.isOwner,
            workspaces: [{ id: WS, name: 'Pessoal', kind: 'personal', role: 'owner', is_support: false, expires_at: null, owner_id: USER }],
            preferences: { user_id: USER, theme: 'system', active_workspace_id: WS, hide_values: false, budget_alerts: true, due_alerts: true },
          });
        case 'fii_sync':
          return json(route, s.tables.fii_funds.some((f) => f.code === String(a.p_ticker).slice(0, 4)) ? 'cached' : 'not_found');
        case 'generate_recurrences':
        case 'refresh_notifications':
          return json(route, 0);
        case 'report_monthly':
          return json(route, monthly(s, a.p_from, a.p_to));
        case 'report_categories':
          return json(route, categoriesReport(s, a.p_from, a.p_to, a.p_kind));
        case 'budget_progress':
          return json(route, s.tables.transactions.length ? [{ budget_id: 'b1', category_id: s.tables.categories[0].id, name: 'Alimentação', color: '#f59e0b', icon: 'utensils', limit_cents: 100000, spent_cents: 68490, alert_thresholds: [50, 75, 90, 100] }] : []);
        case 'admin_stats':
          return json(route, { users_total: 42, users_active: 39, users_pending: 2, users_suspended: 1, signups_30d: 7, workspaces_shared: 9, transactions_30d: 1830, errors_24h: 0, db_size_mb: 24.5 });
        case 'admin_list_users':
          return json(route, [{ id: USER, email: 'ana@example.com', full_name: 'Ana Souza', status: 'active', status_reason: null, created_at: new Date().toISOString(), last_sign_in_at: new Date().toISOString(), is_app_owner: true, workspaces: 1 }]);
        case 'list_workspace_members':
          return json(route, [{ user_id: USER, email: 'ana@example.com', full_name: 'Ana Souza', role: 'owner', is_support: false, expires_at: null, created_at: new Date().toISOString() }]);
        default:
          return json(route, []);
      }
    }

    // ---------- tabelas
    if (path.startsWith('/rest/v1/')) {
      const table = path.replace('/rest/v1/', '');
      const accept = req.headers()['accept'] ?? '';
      const single = accept.includes('vnd.pgrst.object');
      if (table === 'app_settings') return json(route, single ? { app_name: 'Finance MV', tagline: 'Seu dinheiro, em ordem.', logo_url: null, primary_color: '#10b981', signup_mode: 'open', features: {}, limits: {}, min_client_version: null, maintenance_message: null, updated_at: '' } : []);
      if (table === 'account_balances') return json(route, balances(s));
      const rows = (s.tables[table] ??= []);
      if (req.method() === 'GET') {
        const list = filterRows(rows, url.searchParams);
        return json(route, single ? list[0] ?? null : list, single && !list[0] ? 406 : 200);
      }
      if (req.method() === 'POST') {
        s.insertCalls++;
        if (s.failNextInsert) {
          s.failNextInsert = false;
          return route.abort('internetdisconnected');
        }
        const body = req.postDataJSON() as Row | Row[];
        const items = (Array.isArray(body) ? body : [body]).map((b) => {
          const dup = b.client_request_id && rows.find((r) => r.client_request_id === b.client_request_id);
          if (dup) return null;
          const settled = b.status === 'paid' || b.status === 'received';
          const row = { created_at: new Date().toISOString(), updated_at: new Date().toISOString(), created_by: USER, tags: [], paid_cents: settled ? b.amount_cents : 0, settled_principal_cents: settled ? b.amount_cents : 0, archived: false, ...b, id: (b.id as string) ?? uid() } as Row;
          rows.push(row);
          return row;
        });
        if (/ignore-duplicates/.test(req.headers()['prefer'] ?? '')) return json(route, items.filter(Boolean), 201);
        if (items.includes(null)) return json(route, { code: '23505', message: 'duplicate key value violates unique constraint "transactions_workspace_id_client_request_id_key"', details: 'client_request_id' }, 409);
        return json(route, single ? items[0] : items, 201);
      }
      if (req.method() === 'PATCH') {
        const patch = req.postDataJSON() as Row;
        const list = filterRows(rows, url.searchParams);
        list.forEach((r) => Object.assign(r, patch));
        return json(route, single ? list[0] : list);
      }
      if (req.method() === 'DELETE') {
        const list = filterRows(rows, url.searchParams);
        s.tables[table] = rows.filter((r) => !list.includes(r));
        return json(route, list);
      }
    }
    if (path.startsWith('/storage/') || path.startsWith('/functions/')) return json(route, {});
    return json(route, {}, 404);
  });
}
