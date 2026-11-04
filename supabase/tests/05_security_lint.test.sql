-- Revisão automática de segurança do banco: falha se algo novo abrir uma brecha.
--  1) toda tabela do schema public tem RLS ligado;
--  2) toda função "security definer" fixa o search_path (evita sequestro por objetos falsos);
--  3) toda view do public roda com as permissões de quem consulta (security_invoker);
--  4) visitante sem login (anon) só lê a configuração pública e só executa as funções liberadas.
begin;
do $$
declare
  bad text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity;
  perform tests.assert(bad is null, 'tabelas sem RLS: ' || coalesce(bad, ''));

  select string_agg(p.proname, ', ' order by p.proname) into bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%');
  perform tests.assert(bad is null, 'security definer sem search_path: ' || coalesce(bad, ''));

  select string_agg(c.relname, ', ' order by c.relname) into bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'v'
    and not coalesce(c.reloptions::text[] @> array['security_invoker=true'], false);
  perform tests.assert(bad is null, 'views sem security_invoker: ' || coalesce(bad, ''));

  select string_agg(c.relname, ', ' order by c.relname) into bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
    and c.relname not in ('app_settings')
    and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('anon', c.oid, 'insert')
      or has_table_privilege('anon', c.oid, 'update') or has_table_privilege('anon', c.oid, 'delete'));
  perform tests.assert(bad is null, 'tabelas acessíveis sem login: ' || coalesce(bad, ''));

  select string_agg(p.proname, ', ' order by p.proname) into bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef and p.prokind = 'f'
    and has_function_privilege('anon', p.oid, 'execute')
    -- peek_invite: tela do convite antes do login; exige o código secreto do convite (só o hash fica no banco)
    and p.proname not in ('peek_invite');
  perform tests.assert(bad is null, 'funções privilegiadas executáveis sem login: ' || coalesce(bad, ''));
end;
$$;
rollback;
