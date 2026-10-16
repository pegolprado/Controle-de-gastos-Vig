-- Importação de extrato: lote com on conflict do nothing (RLS de insert) e saldo calculado
begin;
do $$
declare
  u uuid; ws uuid; acc uuid; k1 uuid := gen_random_uuid(); k2 uuid := gen_random_uuid(); n int; bal bigint;
begin
  u := tests.create_user('import@example.com');
  select id into ws from public.workspaces where owner_id = u;
  perform tests.login(u);
  insert into public.accounts (workspace_id, name, type, initial_balance_cents) values (ws, 'Banco', 'checking', 10000) returning id into acc;

  insert into public.transactions (workspace_id, kind, status, description, amount_cents, occurred_on, account_id, tags, client_request_id)
  values (ws, 'expense', 'paid', 'Uber', 2500, current_date, acc, '{importado}', k1),
         (ws, 'income', 'received', 'Pix recebido', 15000, current_date, acc, '{importado}', k2)
  on conflict (workspace_id, client_request_id) do nothing;
  get diagnostics n = row_count;
  perform tests.assert_eq(n, 2, 'primeira importação cria 2 lançamentos');

  -- reimportação do mesmo extrato: nada novo, sem erro
  insert into public.transactions (workspace_id, kind, status, description, amount_cents, occurred_on, account_id, tags, client_request_id)
  values (ws, 'expense', 'paid', 'Uber', 2500, current_date, acc, '{importado}', k1),
         (ws, 'income', 'received', 'Pix recebido', 15000, current_date, acc, '{importado}', k2)
  on conflict (workspace_id, client_request_id) do nothing;
  get diagnostics n = row_count;
  perform tests.assert_eq(n, 0, 'reimportação ignora duplicados');

  select current_balance_cents into bal from public.account_balances where account_id = acc;
  perform tests.assert_eq(bal, 22500::bigint, 'saldo considera os importados uma única vez');

  -- outro usuário não consegue importar para este espaço
  perform tests.login(tests.create_user('intruso-import@example.com'));
  perform tests.assert_fails(format($q$insert into public.transactions (workspace_id, kind, status, description, amount_cents, occurred_on, account_id, client_request_id)
    values (%L, 'expense', 'paid', 'x', 100, current_date, %L, gen_random_uuid()) on conflict (workspace_id, client_request_id) do nothing$q$, ws, acc), 'importar em espaço alheio');
  raise notice 'importação em lote ok';
end $$;
rollback;
