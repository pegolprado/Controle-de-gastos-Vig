-- =============================================================================
-- FINANCE OS — 0600 Administração do aplicativo e relatórios
--
-- O painel administrativo NUNCA lê tabelas financeiras por linha. As funções
-- abaixo expõem somente metadados de usuários e contagens agregadas.
-- =============================================================================

create or replace function public.require_app_owner()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_app_owner() then
    raise exception 'Acesso restrito ao proprietário do aplicativo.' using errcode = '42501';
  end if;
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
    select p.id, p.email, p.full_name, p.status, p.status_reason, p.created_at, u.last_sign_in_at,
           exists (select 1 from public.app_roles r where r.user_id = p.id),
           (select count(*) from public.workspace_members m where m.user_id = p.id and not m.is_support)
    from public.profiles p
    join auth.users u on u.id = p.id
    where p_search is null or p_search = ''
       or p.email ilike '%' || p_search || '%' or p.full_name ilike '%' || p_search || '%'
    order by p.created_at desc
    limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0);
end;
$$;

create or replace function public.admin_set_user_status(p_user uuid, p_status public.app_user_status, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.app_user_status;
begin
  perform public.require_app_owner();
  if p_user = auth.uid() then raise exception 'Você não pode alterar o próprio status.'; end if;
  if exists (select 1 from public.app_roles where user_id = p_user) then
    raise exception 'Não é possível alterar o status de outro proprietário.';
  end if;
  select status into v_old from public.profiles where id = p_user;
  if v_old is null then raise exception 'Usuário não encontrado.'; end if;
  update public.profiles set status = p_status, status_reason = left(p_reason, 300) where id = p_user;
  insert into public.admin_audit_log (actor_id, action, target_type, target_id, details)
  values (auth.uid(), 'user.status', 'user', p_user::text,
          jsonb_build_object('from', v_old, 'to', p_status, 'reason', left(p_reason, 300)));
end;
$$;

create or replace function public.admin_update_settings(p_patch jsonb)
returns public.app_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.app_settings;
begin
  perform public.require_app_owner();
  update public.app_settings set
    app_name            = coalesce(p_patch ->> 'app_name', app_name),
    tagline             = coalesce(p_patch ->> 'tagline', tagline),
    logo_url            = case when p_patch ? 'logo_url' then nullif(p_patch ->> 'logo_url', '') else logo_url end,
    primary_color       = coalesce(p_patch ->> 'primary_color', primary_color),
    signup_mode         = coalesce(p_patch ->> 'signup_mode', signup_mode),
    features            = case when p_patch ? 'features' then features || (p_patch -> 'features') else features end,
    limits              = case when p_patch ? 'limits' then limits || (p_patch -> 'limits') else limits end,
    min_client_version  = case when p_patch ? 'min_client_version' then nullif(p_patch ->> 'min_client_version', '') else min_client_version end,
    maintenance_message = case when p_patch ? 'maintenance_message' then nullif(p_patch ->> 'maintenance_message', '') else maintenance_message end,
    updated_at = now(),
    updated_by = auth.uid()
  where id = 1
  returning * into v_row;
  insert into public.admin_audit_log (actor_id, action, target_type, target_id, details)
  values (auth.uid(), 'settings.update', 'settings', '1', p_patch);
  return v_row;
end;
$$;

create or replace function public.admin_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_app_owner();
  return jsonb_build_object(
    'users_total', (select count(*) from public.profiles),
    'users_active', (select count(*) from public.profiles where status = 'active'),
    'users_pending', (select count(*) from public.profiles where status = 'pending'),
    'users_suspended', (select count(*) from public.profiles where status in ('suspended', 'revoked')),
    'signups_30d', (select count(*) from public.profiles where created_at > now() - interval '30 days'),
    'workspaces_shared', (select count(*) from public.workspaces where kind = 'shared'),
    'transactions_30d', (select count(*) from public.transactions where created_at > now() - interval '30 days'),
    'errors_24h', (select count(*) from public.client_errors where created_at > now() - interval '24 hours'),
    'db_size_mb', (select round(pg_database_size(current_database()) / 1024.0 / 1024.0, 1))
  );
end;
$$;

create or replace function public.admin_list_audit(p_limit integer default 100)
returns table (id bigint, actor_email text, action text, target_type text, target_id text, details jsonb, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_app_owner();
  return query
    select a.id, p.email, a.action, a.target_type, a.target_id, a.details, a.created_at
    from public.admin_audit_log a left join public.profiles p on p.id = a.actor_id
    order by a.created_at desc limit least(greatest(p_limit, 1), 500);
end;
$$;

create or replace function public.admin_list_errors(p_limit integer default 100)
returns table (id bigint, user_email text, app_version text, route text, message text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_app_owner();
  return query
    select e.id, p.email, e.app_version, e.route, e.message, e.created_at
    from public.client_errors e left join public.profiles p on p.id = e.user_id
    order by e.created_at desc limit least(greatest(p_limit, 1), 500);
end;
$$;

create or replace function public.admin_register_release(p_version text, p_notes text default null, p_commit text default null, p_channel text default 'production')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  -- Pode ser chamado pelo proprietário (painel) ou pelo CI com service_role (auth.uid() nulo)
  if auth.uid() is not null then
    perform public.require_app_owner();
  end if;
  insert into public.app_releases (version, channel, commit_sha, notes, published_by)
  values (p_version, p_channel, nullif(lower(p_commit), ''), p_notes, auth.uid())
  on conflict (version, channel) do update
    set notes = coalesce(excluded.notes, public.app_releases.notes),
        commit_sha = coalesce(excluded.commit_sha, public.app_releases.commit_sha),
        status = 'published', published_at = now()
  returning id into v_id;
  insert into public.admin_audit_log (actor_id, action, target_type, target_id, details)
  values (auth.uid(), 'release.published', 'release', v_id::text, jsonb_build_object('version', p_version, 'channel', p_channel));
  return v_id;
end;
$$;

create or replace function public.admin_set_release_status(p_release uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    perform public.require_app_owner();
  end if;
  if p_status not in ('published', 'rolled_back') then raise exception 'Status inválido.'; end if;
  update public.app_releases set status = p_status where id = p_release;
  insert into public.admin_audit_log (actor_id, action, target_type, target_id, details)
  values (auth.uid(), 'release.' || p_status, 'release', p_release::text, '{}'::jsonb);
end;
$$;

-- Retenção: remove registros técnicos antigos (agendado via pg_cron)
create or replace function public.purge_old_records()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.rate_limits where window_start < now() - interval '2 days';
  delete from public.client_errors where created_at < now() - interval '90 days';
  delete from public.notifications where created_at < now() - interval '180 days';
  delete from public.audit_log where created_at < now() - interval '5 years';
  delete from public.invites where expires_at < now() - interval '90 days' and accepted_at is null;
end;
$$;
revoke all on function public.purge_old_records() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Relatórios (security invoker: RLS garante que só dados autorizados entram)
-- ---------------------------------------------------------------------------
create or replace function public.report_monthly(
  p_workspace uuid, p_from date, p_to date,
  p_account uuid default null, p_card uuid default null, p_category uuid default null, p_user uuid default null
)
returns table (month date, income_cents bigint, expense_cents bigint, income_realized_cents bigint,
               expense_realized_cents bigint, fixed_expense_cents bigint, variable_expense_cents bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with months as (
    select generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month')::date as month
  ), tx as (
    select t.*, coalesce(c.is_fixed, false) or t.recurrence_id is not null as fixed
    from public.transactions t
    left join public.categories c on c.id = t.category_id
    where t.workspace_id = p_workspace
      and t.kind in ('income', 'expense') and t.status <> 'cancelled'
      and t.occurred_on >= date_trunc('month', p_from) and t.occurred_on < date_trunc('month', p_to) + interval '1 month'
      and (p_account is null or t.account_id = p_account)
      and (p_card is null or t.card_id = p_card)
      and (p_category is null or t.category_id = p_category or c.parent_id = p_category)
      and (p_user is null or t.created_by = p_user)
  )
  select m.month,
         coalesce(sum(tx.amount_cents) filter (where tx.kind = 'income'), 0)::bigint,
         coalesce(sum(tx.amount_cents) filter (where tx.kind = 'expense'), 0)::bigint,
         coalesce(sum(tx.settled_principal_cents) filter (where tx.kind = 'income'), 0)::bigint,
         coalesce(sum(tx.settled_principal_cents) filter (where tx.kind = 'expense'), 0)::bigint,
         coalesce(sum(tx.amount_cents) filter (where tx.kind = 'expense' and tx.fixed), 0)::bigint,
         coalesce(sum(tx.amount_cents) filter (where tx.kind = 'expense' and not tx.fixed), 0)::bigint
  from months m
  left join tx on date_trunc('month', tx.occurred_on)::date = m.month
  group by m.month
  order by m.month;
$$;

create or replace function public.report_categories(
  p_workspace uuid, p_from date, p_to date, p_kind public.tx_kind default 'expense',
  p_account uuid default null, p_card uuid default null, p_user uuid default null
)
returns table (category_id uuid, name text, color text, icon text, total_cents bigint, items bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select top.id, coalesce(top.name, 'Sem categoria'), coalesce(top.color, '#64748b'), coalesce(top.icon, 'circle-dashed'),
         sum(t.amount_cents)::bigint, count(*)
  from public.transactions t
  left join public.categories c on c.id = t.category_id
  left join public.categories top on top.id = coalesce(c.parent_id, c.id)
  where t.workspace_id = p_workspace and t.kind = p_kind and t.status <> 'cancelled'
    and t.occurred_on >= p_from and t.occurred_on <= p_to
    and (p_account is null or t.account_id = p_account)
    and (p_card is null or t.card_id = p_card)
    and (p_user is null or t.created_by = p_user)
  group by top.id, top.name, top.color, top.icon
  order by 5 desc;
$$;

create or replace function public.budget_progress(p_workspace uuid, p_month date)
returns table (budget_id uuid, category_id uuid, name text, color text, icon text, limit_cents bigint,
               spent_cents bigint, alert_thresholds integer[])
language sql
stable
security invoker
set search_path = ''
as $$
  select b.id, c.id, c.name, c.color, c.icon, b.limit_cents,
         coalesce((select sum(t.amount_cents) from public.transactions t
                   left join public.categories sc on sc.id = t.category_id
                   where t.workspace_id = p_workspace and t.kind = 'expense' and t.status <> 'cancelled'
                     and t.occurred_on >= date_trunc('month', p_month) and t.occurred_on < date_trunc('month', p_month) + interval '1 month'
                     and (t.category_id = c.id or sc.parent_id = c.id)), 0)::bigint,
         b.alert_thresholds
  from public.budgets b
  join public.categories c on c.id = b.category_id
  where b.workspace_id = p_workspace and b.month = date_trunc('month', p_month)::date
  order by c.name;
$$;
