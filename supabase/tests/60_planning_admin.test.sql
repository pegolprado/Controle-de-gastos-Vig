-- Orçamentos, alertas, metas, relatórios por categoria e painel administrativo
begin;
do $$
declare
  u uuid; outro uuid; ws uuid; acc uuid; cat uuid; sub uuid; b record; g uuid; n int; st jsonb; owner uuid; r uuid;
  v_month date := date_trunc('month', current_date)::date;
begin
  u := tests.create_user('plan@example.com');
  outro := tests.create_user('outro@example.com');
  select id into ws from public.workspaces where owner_id = u;
  select id into acc from public.accounts where workspace_id = ws;
  select id into cat from public.categories where workspace_id = ws and name = 'Transporte';
  select id into sub from public.categories where workspace_id = ws and name = 'Combustível';
  perform tests.login(u);

  insert into public.budgets (workspace_id, category_id, month, limit_cents) values (ws, cat, v_month, 100000);
  perform tests.assert_fails(format($q$insert into public.budgets (workspace_id, category_id, month, limit_cents) values (%L, %L, %L, 1000)$q$, ws, sub, v_month), 'orçamento em subcategoria');
  insert into public.transactions (workspace_id, kind, description, amount_cents, occurred_on, account_id, category_id)
  values (ws, 'expense', 'Gasolina', 76000, v_month, acc, sub);
  select * into b from public.budget_progress(ws, current_date);
  perform tests.assert_eq(b.spent_cents, 76000::bigint, 'subcategoria conta no orçamento da principal');
  n := public.refresh_notifications(ws);
  perform tests.assert_eq(n, 2, 'alertas de 50% e 75%');
  perform tests.assert_eq(public.refresh_notifications(ws), 0, 'alertas não se repetem');
  insert into public.transactions (workspace_id, kind, description, amount_cents, occurred_on, account_id, category_id)
  values (ws, 'expense', 'Uber', 30000, v_month, acc, cat);
  perform tests.assert_eq(public.refresh_notifications(ws), 2, 'alertas de 90% e 100%');
  perform tests.assert((select count(*) from public.notifications where user_id = u and kind = 'budget' and title like '%estourado%') = 1, 'estouro notificado');
  -- copiar orçamento
  perform tests.assert_eq(public.copy_budgets(ws, v_month, (v_month + interval '1 month')::date), 1, 'copiar orçamento');
  perform tests.assert_eq(public.copy_budgets(ws, v_month, (v_month + interval '1 month')::date), 0, 'copiar idempotente');

  -- vencimentos
  insert into public.transactions (workspace_id, kind, status, description, amount_cents, occurred_on, due_on, account_id)
  values (ws, 'expense', 'pending', 'Internet', 9990, current_date, current_date, acc),
         (ws, 'expense', 'pending', 'IPTU', 30000, current_date - 10, current_date - 2, acc);
  n := public.refresh_notifications(ws);
  perform tests.assert_eq(n, 2, 'vencendo hoje + em atraso');

  -- relatório por categoria agrega subcategorias na principal
  perform tests.assert_eq((select total_cents from public.report_categories(ws, v_month, (v_month + interval '1 month - 1 day')::date) where name = 'Transporte'), 106000::bigint, 'categoria agregada');

  -- metas
  insert into public.goals (workspace_id, name, target_cents) values (ws, 'Viagem', 500000) returning id into g;
  insert into public.goal_contributions (goal_id, workspace_id, amount_cents) values (g, ws, 100000), (g, ws, -20000);
  perform tests.assert_eq((select saved_cents from public.goal_progress where id = g), 80000::bigint, 'progresso da meta');
  perform tests.logout();

  perform tests.login(outro);
  perform tests.assert_eq((select count(*)::int from public.notifications where user_id = u), 0, 'notificações são privadas');
  perform tests.assert_eq((select count(*)::int from public.goal_progress where id = g), 0, 'metas privadas');
  perform tests.assert_fails(format($q$insert into public.goal_contributions (goal_id, workspace_id, amount_cents) values (%L, (select id from public.workspaces where owner_id = auth.uid()), 1)$q$, g), 'aporte em meta de outro espaço');
  -- não-admin não chama funções administrativas
  perform tests.assert_fails('select public.admin_stats()', 'admin_stats');
  perform tests.assert_fails('select * from public.admin_list_users()', 'admin_list_users');
  perform tests.assert_fails($q$select public.admin_set_user_status(auth.uid(), 'active')$q$, 'admin_set_user_status');
  perform tests.assert_fails($q$select public.admin_update_settings('{"app_name":"Hack"}')$q$, 'admin_update_settings');
  perform tests.assert_fails($q$select public.admin_register_release('9.9.9')$q$, 'admin_register_release');
  perform tests.assert_fails($q$select public.create_invite(null, 'x@y.com', 'viewer', 7)$q$, 'convite de app');
  perform tests.assert_fails('select count(*) from public.admin_audit_log', 'ler auditoria admin');
  perform tests.assert_fails('select count(*) from public.client_errors', 'ler erros');
  perform public.log_client_error('Falha X', '/painel', '1.0.0');
  perform tests.logout();
  raise notice 'orçamentos, metas e privacidade ok';

  owner := tests.create_user('dono-app@example.com');
  perform public.bootstrap_app_owner('dono-app@example.com');
  perform tests.login(owner);
  st := public.admin_stats();
  perform tests.assert((st ->> 'users_total')::int = 3, 'estatísticas');
  perform tests.assert((select count(*) from public.admin_list_users('plan')) = 1, 'busca de usuários');
  perform tests.assert((select count(*) from public.admin_list_errors()) = 1, 'erros visíveis ao dono');
  perform public.admin_update_settings('{"app_name": "Casa em Dia", "primary_color": "#22c55e", "signup_mode": "invite_only", "features": {"attachments": false}}'::jsonb);
  perform tests.assert_eq((select app_name from public.app_settings), 'Casa em Dia', 'marca alterada');
  perform tests.assert_eq((select (features ->> 'shared_workspaces')::boolean from public.app_settings), true, 'merge de features');
  perform tests.assert_fails($q$select public.admin_update_settings('{"primary_color": "vermelho"}')$q$, 'cor inválida');
  r := public.admin_register_release('1.2.0', 'Novidades', 'abc1234');
  perform public.admin_set_release_status(r, 'rolled_back');
  perform tests.assert_eq((select status from public.app_releases where id = r), 'rolled_back', 'reversão registrada');
  perform tests.assert_fails(format($q$select public.admin_set_user_status(%L, 'suspended')$q$, owner), 'suspender a si mesmo');
  -- convite de cadastro (modo somente convite)
  st := public.create_invite(null, 'novo@example.com', 'viewer', 7);
  perform tests.logout();
  r := tests.create_user('novo@example.com');
  perform tests.assert_eq((select status::text from public.profiles where id = r), 'active', 'convidado entra ativo');
  perform tests.login(owner);
  perform tests.assert((select count(*) from public.admin_list_audit()) >= 4, 'auditoria administrativa');
  perform tests.logout();
  raise notice 'painel administrativo ok';

  -- rate limit
  perform tests.login(outro);
  begin
    for n in 1..40 loop perform public.log_client_error('spam'); end loop;
    raise exception 'FALHA: rate limit não acionado';
  exception when sqlstate 'P0429' then
    raise notice 'rate limit ok';
  end;
  perform tests.logout();
end $$;
rollback;
