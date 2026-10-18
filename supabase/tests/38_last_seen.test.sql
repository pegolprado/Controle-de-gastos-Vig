-- Último acesso: registrado pelo uso do app, visível para o proprietário
begin;
do $$
declare
  dono uuid; u uuid; v timestamptz;
begin
  dono := tests.create_user('dono-acesso@example.com');
  insert into public.app_roles (user_id, role) values (dono, 'owner') on conflict do nothing;
  u := tests.create_user('usuario-acesso@example.com');
  update auth.users set last_sign_in_at = now() - interval '3 days' where id = u;

  perform tests.login(u);
  perform public.touch_last_seen();
  perform tests.assert_fails($q$select * from public.user_activity$q$, 'usuário não lê a tabela de atividade');
  perform tests.logout();
  v := (select last_seen_at from public.user_activity where user_id = u);
  perform tests.assert(v > now() - interval '1 minute', 'uso registrado');

  -- várias aberturas seguidas: uma escrita a cada 5 minutos
  update public.user_activity set last_seen_at = now() - interval '2 minutes' where user_id = u;
  perform tests.login(u);
  perform public.touch_last_seen();
  perform tests.logout();
  perform tests.assert((select last_seen_at from public.user_activity where user_id = u) < now() - interval '1 minute', 'sem escrita antes de 5 min');

  -- painel do proprietário mostra o uso, não o login antigo
  perform tests.login(dono);
  perform tests.assert((select last_sign_in_at from public.admin_list_users('usuario-acesso')) > now() - interval '1 hour', 'último acesso = uso recente');
  perform tests.login(u);
  perform tests.assert_fails($q$select * from public.admin_list_users()$q$, 'só o proprietário lista usuários');
  perform tests.logout();
  raise notice 'último acesso ok';
end $$;
rollback;
