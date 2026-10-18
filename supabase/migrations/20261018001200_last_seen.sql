-- =============================================================================
-- "Último acesso" real: o login do Supabase (auth.users.last_sign_in_at) só muda
-- quando a pessoa digita a senha; com o app mantendo a sessão, quem usa todo dia
-- parecia parado na data do primeiro login. Agora o app registra o uso ao abrir
-- (no máximo uma escrita a cada 5 minutos por pessoa).
-- =============================================================================

create table public.user_activity (
  user_id      uuid primary key references public.profiles (id) on delete cascade,
  last_seen_at timestamptz not null default now()
);
alter table public.user_activity enable row level security;
revoke all on public.user_activity from anon, authenticated;
grant all on public.user_activity to service_role;

create or replace function public.touch_last_seen()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return;
  end if;
  insert into public.user_activity as a (user_id, last_seen_at)
  values (auth.uid(), now())
  on conflict (user_id) do update set last_seen_at = now()
  where a.last_seen_at < now() - interval '5 minutes';
end;
$$;

create or replace function public.admin_list_users(p_search text default null, p_limit integer default 50, p_offset integer default 0)
returns table (id uuid, email text, full_name text, status public.app_user_status, status_reason text,
               created_at timestamptz, last_sign_in_at timestamptz, is_app_owner boolean, workspaces bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_app_owner();
  return query
    -- último acesso = o mais recente entre o login e o uso do app
    select p.id, p.email, p.full_name, p.status, p.status_reason, p.created_at,
           greatest(u.last_sign_in_at, a.last_seen_at),
           exists (select 1 from public.app_roles r where r.user_id = p.id),
           (select count(*) from public.workspace_members m where m.user_id = p.id and not m.is_support)
    from public.profiles p
    join auth.users u on u.id = p.id
    left join public.user_activity a on a.user_id = p.id
    where p_search is null or p_search = ''
       or p.email ilike '%' || p_search || '%' or p.full_name ilike '%' || p_search || '%'
    order by p.created_at desc
    limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0);
end;
$$;

revoke execute on function public.touch_last_seen() from public, anon;
grant execute on function public.touch_last_seen() to authenticated;
