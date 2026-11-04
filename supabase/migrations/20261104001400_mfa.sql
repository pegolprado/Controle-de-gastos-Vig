-- Verificação em duas etapas (app autenticador / TOTP) exigida pelo banco.
-- Quem ativou o 2FA só acessa os dados com uma sessão confirmada pelo código (aal2):
-- com a senha roubada, mas sem o celular, o invasor não lê nem altera nada.
-- Quem não ativou continua entrando só com a senha (aal1).
-- Padrão recomendado pela Supabase: política RESTRITIVA (soma-se às demais com AND).

create or replace function public.mfa_ok()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal', 'aal1') = 'aal2'
      or not exists (
        select 1 from auth.mfa_factors f
        where f.user_id = auth.uid() and f.status::text = 'verified'
      );
$$;
revoke execute on function public.mfa_ok() from public, anon;
grant execute on function public.mfa_ok() to authenticated, service_role;

-- funções centrais de acesso: sem o segundo fator, o usuário não "enxerga" nenhum espaço
create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'active'
  ) and public.mfa_ok();
$$;

create or replace function public.my_workspace_ids(p_min_rank integer default 1)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.workspace_id
  from public.workspace_members m
  join public.profiles p on p.id = m.user_id
  where m.user_id = auth.uid()
    and p.status = 'active'
    and (m.expires_at is null or m.expires_at > now())
    and public.role_rank(m.role) >= p_min_rank
    and public.mfa_ok();
$$;

create or replace function public.workspace_rank(p_workspace uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.mfa_ok() then coalesce((
    select public.role_rank(m.role)
    from public.workspace_members m
    join public.profiles p on p.id = m.user_id
    where m.workspace_id = p_workspace
      and m.user_id = auth.uid()
      and p.status = 'active'
      and (m.expires_at is null or m.expires_at > now())
  ), 0) else 0 end;
$$;

-- política restritiva em todas as tabelas com dados de usuário
do $$
declare
  t text;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
      and c.relname not in ('app_settings', 'app_releases')
  loop
    execute format('drop policy if exists mfa_required on public.%I', t);
    execute format(
      'create policy mfa_required on public.%I as restrictive for all to authenticated using (public.mfa_ok()) with check (public.mfa_ok())', t);
  end loop;
  if to_regclass('storage.objects') is not null then
    drop policy if exists mfa_required on storage.objects;
    create policy mfa_required on storage.objects as restrictive for all to authenticated
      using (public.mfa_ok()) with check (public.mfa_ok());
  end if;
end;
$$;

-- Perdeu o celular: o proprietário do app desativa o 2FA da pessoa (fica no registro de auditoria).
create or replace function public.admin_reset_mfa(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if not public.is_app_owner() or not public.mfa_ok() then
    raise exception 'Somente o proprietário do aplicativo.' using errcode = '42501';
  end if;
  delete from auth.mfa_factors where user_id = p_user;
  get diagnostics v_n = row_count;
  insert into public.admin_audit_log (actor_id, action, target_type, target_id, details)
  values (auth.uid(), 'user.mfa_reset', 'user', p_user::text, jsonb_build_object('factors', v_n));
  return v_n;
end;
$$;
revoke execute on function public.admin_reset_mfa(uuid) from public, anon;
grant execute on function public.admin_reset_mfa(uuid) to authenticated;
