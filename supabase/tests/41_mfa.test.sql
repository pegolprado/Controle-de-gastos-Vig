-- 2FA: com fator verificado, sessão só com senha (aal1) não vê nem altera nada; aal2 vê tudo.
begin;
do $$
declare
  u uuid; semfa uuid; ws uuid; acc uuid;
begin
  u := tests.create_user('mfa@example.com');
  semfa := tests.create_user('sem-mfa@example.com');
  select id into ws from public.workspaces where owner_id = u;
  select id into acc from public.accounts where workspace_id = ws limit 1;

  -- antes de ativar: entra só com a senha
  perform tests.login(u);
  perform tests.assert((select count(*) from public.accounts where workspace_id = ws) > 0, 'sem 2FA, senha basta');
  perform tests.logout();

  insert into auth.mfa_factors (user_id, status) values (u, 'verified');

  -- só senha (aal1): nada aparece, nada muda, RPCs negam
  perform set_config('request.jwt.claims', '{"aal":"aal1"}', false);
  perform tests.login(u);
  perform tests.assert_eq((select count(*)::int from public.accounts where workspace_id = ws), 0, 'aal1 não lê contas');
  perform tests.assert_eq((select count(*)::int from public.transactions), 0, 'aal1 não lê lançamentos');
  perform tests.assert_eq(jsonb_array_length(public.session_context() -> 'workspaces'), 0, 'aal1 não vê os espaços');
  perform tests.assert_fails(format($q$insert into public.transactions (workspace_id, kind, description, amount_cents, occurred_on, account_id)
    values (%L, 'expense', 'invasor', 100, current_date, %L)$q$, ws, acc), 'aal1 não lança');
  perform tests.assert_fails(format('select public.generate_recurrences(%L)', ws), 'aal1 não chama RPC do espaço');
  perform tests.logout();

  -- com o código (aal2): tudo normal
  perform set_config('request.jwt.claims', '{"aal":"aal2"}', false);
  perform tests.login(u);
  perform tests.assert((select count(*) from public.accounts where workspace_id = ws) > 0, 'aal2 lê contas');
  insert into public.transactions (workspace_id, kind, description, amount_cents, occurred_on, account_id)
  values (ws, 'expense', 'Com 2FA', 100, current_date, acc);
  perform tests.logout();

  -- quem não ativou continua com aal1
  perform set_config('request.jwt.claims', '{"aal":"aal1"}', false);
  perform tests.login(semfa);
  perform tests.assert((select count(*) from public.accounts) > 0, 'usuário sem 2FA não é afetado');
  perform tests.logout();
  -- perdeu o celular: só o proprietário do app reseta (e fica registrado)
  perform tests.login(semfa);
  perform tests.assert_fails(format('select public.admin_reset_mfa(%L)', u), 'usuário comum não reseta 2FA de outro');
  perform tests.logout();
  insert into public.app_roles (user_id, role) values (semfa, 'owner') on conflict do nothing;
  perform tests.login(semfa);
  perform tests.assert_eq(public.admin_reset_mfa(u), 1, 'proprietário desativa o 2FA');
  perform tests.logout();
  perform tests.assert((select count(*) from auth.mfa_factors where user_id = u) = 0, 'fator removido');
  perform tests.assert(exists (select 1 from public.admin_audit_log where action = 'user.mfa_reset'), 'reset auditado');
  perform set_config('request.jwt.claims', '', false);
end;
$$;
rollback;
