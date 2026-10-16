-- Helpers de teste: criar usuários e "logar" como eles.
create schema if not exists tests;
grant usage on schema tests to authenticated, anon;

create or replace function tests.create_user(p_email text, p_name text default null) returns uuid
language plpgsql security definer as $$
declare v_id uuid;
begin
  insert into auth.users (email, raw_user_meta_data) values (p_email, jsonb_build_object('full_name', p_name))
  returning id into v_id;
  return v_id;
end $$;

create or replace function tests.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, false);
  execute 'set role authenticated';
end $$;

create or replace function tests.logout() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', false);
end $$;

create or replace function tests.assert(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'FALHA: %', p_msg; end if;
end $$;

create or replace function tests.assert_eq(p_actual anyelement, p_expected anyelement, p_msg text) returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FALHA: % (esperado %, obtido %)', p_msg, p_expected, p_actual;
  end if;
end $$;

-- Executa SQL e garante que falhou
create or replace function tests.assert_fails(p_sql text, p_msg text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    return;
  end;
  raise exception 'FALHA (deveria ter sido bloqueado): %', p_msg;
end $$;

grant execute on all functions in schema tests to authenticated, anon;
