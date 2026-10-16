-- Isolamento entre usuários: conhecer IDs não dá acesso
begin;
do $$
declare
  a uuid; b uuid; ws_a uuid; ws_b uuid; acc_a uuid; acc_b uuid; tx_a uuid; cat_a uuid; n int;
begin
  a := tests.create_user('a@example.com');
  b := tests.create_user('b@example.com');
  select id into ws_a from public.workspaces where owner_id = a;
  select id into ws_b from public.workspaces where owner_id = b;
  select id into acc_a from public.accounts where workspace_id = ws_a;
  select id into acc_b from public.accounts where workspace_id = ws_b;
  select id into cat_a from public.categories where workspace_id = ws_a and kind = 'expense' limit 1;

  perform tests.login(a);
  insert into public.transactions (workspace_id, kind, description, amount_cents, occurred_on, account_id, category_id)
  values (ws_a, 'expense', 'Segredo de A', 12345, current_date, acc_a, cat_a) returning id into tx_a;
  perform tests.logout();

  perform tests.login(b);
  insert into public.transactions (workspace_id, kind, description, amount_cents, occurred_on, account_id)
  values (ws_b, 'income', 'Salário B', 500000, current_date, acc_b);
  perform tests.assert_eq((select count(*)::int from public.transactions where id = tx_a), 0, 'B não lê transação de A por ID');
  perform tests.assert_eq((select count(*)::int from public.accounts where id = acc_a), 0, 'B não lê conta de A');
  perform tests.assert_eq((select count(*)::int from public.account_balances where account_id = acc_a), 0, 'B não lê saldo de A');
  perform tests.assert_eq((select count(*)::int from public.workspaces where id = ws_a), 0, 'B não lê espaço de A');
  perform tests.assert_eq((select count(*)::int from public.categories where workspace_id = ws_a), 0, 'B não lê categorias de A');
  perform tests.assert_eq((select count(*)::int from public.profiles where id = a), 0, 'B não lê perfil de A');
  perform tests.assert_eq((select count(*)::int from public.audit_log where workspace_id = ws_a), 0, 'B não lê auditoria de A');

  update public.transactions set amount_cents = 1 where id = tx_a;
  get diagnostics n = row_count;
  perform tests.assert_eq(n, 0, 'B não altera transação de A');
  delete from public.transactions where id = tx_a;
  get diagnostics n = row_count;
  perform tests.assert_eq(n, 0, 'B não exclui transação de A');

  perform tests.assert_fails(format($q$insert into public.transactions (workspace_id, kind, description, amount_cents, occurred_on, account_id)
     values (%L, 'expense', 'invasão', 100, current_date, %L)$q$, ws_a, acc_a), 'B não insere no espaço de A');
  -- referência cruzada: B usa a conta de A dentro do próprio espaço
  perform tests.assert_fails(format($q$insert into public.transactions (workspace_id, kind, description, amount_cents, occurred_on, account_id)
     values (%L, 'expense', 'referência cruzada', 100, current_date, %L)$q$, ws_b, acc_a), 'conta de outro espaço');
  perform tests.assert_fails(format($q$insert into public.transactions (workspace_id, kind, description, amount_cents, occurred_on, account_id, destination_account_id)
     values (%L, 'transfer', 'transf cruzada', 100, current_date, %L, %L)$q$, ws_b, acc_b, acc_a), 'transferência para conta alheia');
  perform tests.assert_fails(format($q$insert into public.transactions (workspace_id, kind, description, amount_cents, occurred_on, account_id, category_id)
     values (%L, 'expense', 'cat cruzada', 100, current_date, %L, %L)$q$, ws_b, acc_b, cat_a), 'categoria de outro espaço');
  perform tests.assert_fails(format($q$update public.transactions set workspace_id = %L where workspace_id = %L$q$, ws_a, ws_b), 'mover para outro espaço');
  perform tests.assert_fails(format($q$select public.generate_recurrences(%L)$q$, ws_a), 'RPC em espaço alheio');
  perform tests.assert_fails(format($q$select * from public.list_workspace_members(%L)$q$, ws_a), 'listar membros alheios');
  perform tests.assert_fails(format($q$select public.create_invite(%L, null, 'viewer', 7)$q$, ws_a), 'convite em espaço alheio');
  perform tests.assert_eq((select count(*)::int from public.report_monthly(ws_a, current_date, current_date) where expense_cents > 0), 0, 'relatório de A vazio para B');
  perform tests.logout();

  -- anônimo não lê nada
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'set role anon';
  perform tests.assert_fails('select count(*) from public.transactions', 'anon lê transações');
  perform tests.assert_fails('select public.session_context()', 'anon chama RPC');
  perform tests.assert((select count(*) from public.app_settings) = 1, 'anon lê marca');
  execute 'reset role';
  raise notice 'isolamento ok';

  -- proprietário do app NÃO vê dados financeiros de outros
  perform public.bootstrap_app_owner('b@example.com');
  perform tests.login(b);
  perform tests.assert_eq((select count(*)::int from public.transactions where workspace_id = ws_a), 0, 'owner do app não lê finanças de A');
  perform tests.assert((select count(*) from public.admin_list_users()) = 2, 'owner do app lista usuários (metadados)');
  perform tests.logout();
  raise notice 'separação admin/finanças ok';
end $$;
rollback;
