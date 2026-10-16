-- Cadastro: perfil, espaço pessoal, categorias, conta inicial, preferências e modo convite
begin;
do $$
declare
  v_u uuid;
  v_ws uuid;
  v_ctx jsonb;
begin
  v_u := tests.create_user('ana@example.com', 'Ana');
  perform tests.assert((select status from public.profiles where id = v_u) = 'active', 'perfil ativo');
  select id into v_ws from public.workspaces where owner_id = v_u and kind = 'personal';
  perform tests.assert(v_ws is not null, 'espaço pessoal criado');
  perform tests.assert_eq((select role::text from public.workspace_members where workspace_id = v_ws and user_id = v_u), 'owner', 'membro owner');
  perform tests.assert((select count(*) from public.categories where workspace_id = v_ws) > 20, 'categorias padrão');
  perform tests.assert_eq((select count(*)::int from public.accounts where workspace_id = v_ws), 1, 'conta Carteira');
  perform tests.assert_eq((select active_workspace_id from public.user_preferences where user_id = v_u), v_ws, 'preferência');
  raise notice 'cadastro ok';

  perform tests.login(v_u);
  v_ctx := public.session_context();
  perform tests.assert_eq(v_ctx ->> 'status', 'active', 'contexto: status');
  perform tests.assert_eq((v_ctx ->> 'is_app_owner')::boolean, false, 'não é dono do app');
  perform tests.assert_eq(jsonb_array_length(v_ctx -> 'workspaces'), 1, 'um espaço');
  -- usuário não consegue se promover a ativo/owner pelo navegador
  update public.profiles set status = 'suspended', email = 'x@x.com' where id = v_u;
  perform tests.logout();
  perform tests.assert_eq((select email from public.profiles where id = v_u), 'ana@example.com', 'email protegido');
  perform tests.assert_eq((select status::text from public.profiles where id = v_u), 'active', 'status protegido');
  perform tests.login(v_u);
  perform tests.assert_fails($q$insert into public.app_roles (user_id, role) values (auth.uid(), 'owner')$q$, 'autopromoção a owner');
  perform tests.assert_fails($q$select public.bootstrap_app_owner('ana@example.com')$q$, 'bootstrap pelo cliente');
  perform tests.assert_fails($q$update public.app_settings set signup_mode = 'open'$q$, 'alterar configurações direto');
  perform tests.logout();
  raise notice 'proteções de perfil ok';

  -- modo somente convite
  update public.app_settings set signup_mode = 'invite_only';
  v_u := tests.create_user('sem-convite@example.com');
  select id into v_ws from public.workspaces where owner_id = v_u;
  perform tests.assert_eq((select status::text from public.profiles where id = v_u), 'pending', 'sem convite → pendente');
  perform tests.login(v_u);
  perform tests.assert_eq((select count(*)::int from public.transactions), 0, 'pendente não lê nada');
  perform tests.assert_eq((select count(*)::int from public.accounts), 0, 'pendente não lê contas');
  perform tests.assert_fails(format($q$insert into public.transactions (workspace_id, kind, description, amount_cents, occurred_on, account_id)
     values (%L, 'expense', 'x', 100, current_date, (select id from public.accounts where workspace_id = %L))$q$, v_ws, v_ws), 'pendente não escreve');
  perform tests.logout();
  raise notice 'invite_only ok';
end $$;
rollback;
