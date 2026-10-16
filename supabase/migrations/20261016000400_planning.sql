-- =============================================================================
-- FINANCE OS — 0400 Orçamentos, metas, notificações e preferências
-- =============================================================================

create table public.budgets (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces (id) on delete cascade,
  category_id      uuid not null references public.categories (id) on delete cascade,
  month            date not null check (extract(day from month) = 1),
  limit_cents      bigint not null check (limit_cents > 0 and limit_cents <= 100000000000),
  alert_thresholds integer[] not null default '{50,75,90,100}'
                   check (alert_thresholds <@ array[50, 75, 90, 100]),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (workspace_id, category_id, month)
);
create index budgets_ws_month_idx on public.budgets (workspace_id, month);
create trigger budgets_updated_at before update on public.budgets
  for each row execute function public.tg_set_updated_at();

create or replace function public.tg_budgets_validate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.workspace_id <> old.workspace_id then
    raise exception 'Não é possível mover orçamentos entre espaços.';
  end if;
  if not exists (
    select 1 from public.categories
    where id = new.category_id and workspace_id = new.workspace_id and kind = 'expense' and parent_id is null
  ) then
    raise exception 'Orçamentos devem usar uma categoria principal de despesa deste espaço.';
  end if;
  return new;
end;
$$;
create trigger budgets_validate before insert or update on public.budgets
  for each row execute function public.tg_budgets_validate();

create table public.goals (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 60),
  target_cents bigint not null check (target_cents > 0 and target_cents <= 100000000000),
  deadline     date,
  color        text not null default '#10b981' check (color ~ '^#[0-9a-fA-F]{6}$'),
  icon         text not null default 'target' check (char_length(icon) <= 40),
  archived     boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index goals_ws_idx on public.goals (workspace_id);
create trigger goals_updated_at before update on public.goals
  for each row execute function public.tg_set_updated_at();

create table public.goal_contributions (
  id                uuid primary key default gen_random_uuid(),
  goal_id           uuid not null references public.goals (id) on delete cascade,
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  amount_cents      bigint not null check (amount_cents <> 0 and abs(amount_cents) <= 100000000000),
  contributed_on    date not null default current_date,
  notes             text check (char_length(notes) <= 300),
  client_request_id uuid,
  created_by        uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at        timestamptz not null default now(),
  unique (workspace_id, client_request_id)
);
create index goal_contributions_goal_idx on public.goal_contributions (goal_id);

create or replace function public.tg_goal_contrib_validate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.goals where id = new.goal_id and workspace_id = new.workspace_id) then
    raise exception 'Meta inválida para este espaço.';
  end if;
  return new;
end;
$$;
create trigger goal_contrib_validate before insert or update on public.goal_contributions
  for each row execute function public.tg_goal_contrib_validate();

create view public.goal_progress with (security_invoker = true) as
  select g.*, coalesce(sum(c.amount_cents), 0)::bigint as saved_cents
  from public.goals g
  left join public.goal_contributions c on c.goal_id = g.id
  group by g.id;

-- Notificações in-app (geradas pelo servidor). Não há push em segundo plano.
create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  workspace_id uuid references public.workspaces (id) on delete cascade,
  kind         text not null check (kind in ('budget', 'due', 'overdue', 'invoice', 'system', 'invite')),
  title        text not null check (char_length(title) <= 120),
  body         text check (char_length(body) <= 400),
  link         text check (char_length(link) <= 200),
  ref_key      text not null,
  created_at   timestamptz not null default now(),
  read_at      timestamptz,
  unique (user_id, ref_key)
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.user_preferences (
  user_id             uuid primary key references public.profiles (id) on delete cascade,
  theme               text not null default 'system' check (theme in ('system', 'light', 'dark')),
  active_workspace_id uuid references public.workspaces (id) on delete set null,
  hide_values         boolean not null default false,
  budget_alerts       boolean not null default true,
  due_alerts          boolean not null default true,
  updated_at          timestamptz not null default now()
);
create trigger user_preferences_updated_at before update on public.user_preferences
  for each row execute function public.tg_set_updated_at();
