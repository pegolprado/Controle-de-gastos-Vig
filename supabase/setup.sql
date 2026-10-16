-- FINANCE OS — instalação completa do banco (gerado por scripts/build-setup-sql.mjs)
-- Cole TUDO no Supabase → SQL Editor → New query → Run. Execute uma única vez num projeto novo.
-- Equivale a aplicar 9 migrações de supabase/migrations em ordem.

-- >>>>>>>>>> 20261016000100_foundation.sql
-- =============================================================================
-- FINANCE OS — 0100 Foundation
-- Perfis, papéis da aplicação, configurações globais, versões, auditoria
-- administrativa, rate limiting e funções auxiliares de autorização.
--
-- Convenções:
--   * Valores monetários: bigint em centavos (sem ponto flutuante).
--   * Todas as funções SECURITY DEFINER usam search_path vazio.
--   * Nada aqui concede ao proprietário do app acesso a dados financeiros.
-- =============================================================================

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------------
create type public.app_user_status as enum ('active', 'pending', 'suspended', 'revoked');
create type public.workspace_role as enum ('owner', 'admin', 'editor', 'contributor', 'viewer');
create type public.workspace_kind as enum ('personal', 'shared');

-- ---------------------------------------------------------------------------
-- Função genérica de updated_at
-- ---------------------------------------------------------------------------
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Perfis (1:1 com auth.users)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text not null,
  full_name     text check (char_length(full_name) <= 120),
  avatar_url    text check (char_length(avatar_url) <= 500),
  status        public.app_user_status not null default 'active',
  status_reason text check (char_length(status_reason) <= 300),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index profiles_email_idx on public.profiles (lower(email));

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- Papéis da APLICAÇÃO (não do espaço financeiro). Só é gravável pelo servidor
-- (service_role / SQL Editor). Nenhuma policy de escrita existe.
-- ---------------------------------------------------------------------------
create table public.app_roles (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  role       text not null check (role in ('owner')),
  granted_at timestamptz not null default now(),
  granted_by text not null default current_user
);

-- ---------------------------------------------------------------------------
-- Configurações globais (linha única)
-- ---------------------------------------------------------------------------
create table public.app_settings (
  id                  smallint primary key default 1 check (id = 1),
  app_name            text not null default 'FINANCE OS' check (char_length(app_name) between 2 and 40),
  tagline             text not null default 'Seu dinheiro, em ordem.' check (char_length(tagline) <= 80),
  logo_url            text check (char_length(logo_url) <= 500),
  primary_color       text not null default '#10b981' check (primary_color ~ '^#[0-9a-fA-F]{6}$'),
  signup_mode         text not null default 'open' check (signup_mode in ('open', 'invite_only')),
  features            jsonb not null default '{"shared_workspaces": true, "attachments": true, "exports": true, "support_access": true}'::jsonb,
  limits              jsonb not null default '{"max_workspaces_per_user": 5, "max_members_per_workspace": 12, "max_transactions_per_month": 3000, "max_attachment_mb": 5}'::jsonb,
  min_client_version  text check (min_client_version ~ '^\d+\.\d+\.\d+$'),
  maintenance_message text check (char_length(maintenance_message) <= 300),
  updated_at          timestamptz not null default now(),
  updated_by          uuid references public.profiles (id) on delete set null
);
insert into public.app_settings (id) values (1);

-- ---------------------------------------------------------------------------
-- Registro de versões publicadas (preenchido pelo CI ou pelo painel admin)
-- ---------------------------------------------------------------------------
create table public.app_releases (
  id           uuid primary key default gen_random_uuid(),
  version      text not null check (version ~ '^\d+\.\d+\.\d+$'),
  channel      text not null default 'production' check (channel in ('production', 'staging')),
  commit_sha   text check (commit_sha ~ '^[0-9a-f]{7,40}$'),
  notes        text check (char_length(notes) <= 4000),
  status       text not null default 'published' check (status in ('published', 'rolled_back')),
  published_at timestamptz not null default now(),
  published_by uuid references public.profiles (id) on delete set null,
  unique (version, channel)
);

-- ---------------------------------------------------------------------------
-- Auditoria administrativa (ações do proprietário do app)
-- ---------------------------------------------------------------------------
create table public.admin_audit_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid references public.profiles (id) on delete set null,
  action      text not null,
  target_type text,
  target_id   text,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index admin_audit_log_created_idx on public.admin_audit_log (created_at desc);

-- ---------------------------------------------------------------------------
-- Erros operacionais enviados pelo cliente (sem dados financeiros)
-- ---------------------------------------------------------------------------
create table public.client_errors (
  id          bigint generated always as identity primary key,
  user_id     uuid references public.profiles (id) on delete set null,
  app_version text check (char_length(app_version) <= 40),
  route       text check (char_length(route) <= 200),
  message     text not null check (char_length(message) <= 500),
  created_at  timestamptz not null default now()
);
create index client_errors_created_idx on public.client_errors (created_at desc);

-- ---------------------------------------------------------------------------
-- Rate limiting simples por usuário/balde (janela fixa)
-- ---------------------------------------------------------------------------
create table public.rate_limits (
  bucket       text not null,
  subject      text not null,
  window_start timestamptz not null,
  hits         integer not null default 0,
  primary key (bucket, subject, window_start)
);

create or replace function public.enforce_rate_limit(p_bucket text, p_max integer, p_window_seconds integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subject text := coalesce(auth.uid()::text, 'anon');
  v_window  timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits    integer;
begin
  insert into public.rate_limits as r (bucket, subject, window_start, hits)
  values (p_bucket, v_subject, v_window, 1)
  on conflict (bucket, subject, window_start) do update set hits = r.hits + 1
  returning hits into v_hits;

  if v_hits > p_max then
    raise exception 'Muitas tentativas. Aguarde alguns instantes e tente novamente.'
      using errcode = 'P0429';
  end if;
end;
$$;
revoke all on function public.enforce_rate_limit(text, integer, integer) from public, anon;

-- ---------------------------------------------------------------------------
-- Funções auxiliares de autorização
-- ---------------------------------------------------------------------------
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
  );
$$;

create or replace function public.is_app_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.app_roles r
    join public.profiles p on p.id = r.user_id
    where r.user_id = auth.uid() and r.role = 'owner' and p.status = 'active'
  );
$$;

create or replace function public.role_rank(p_role public.workspace_role)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_role
    when 'owner' then 5
    when 'admin' then 4
    when 'editor' then 3
    when 'contributor' then 2
    when 'viewer' then 1
  end;
$$;

-- Atribuição do proprietário: somente via SQL Editor / service_role.
create or replace function public.bootstrap_app_owner(p_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.profiles where lower(email) = lower(p_email);
  if v_id is null then
    raise exception 'Usuário % não encontrado. Ele precisa se cadastrar primeiro.', p_email;
  end if;
  insert into public.app_roles (user_id, role) values (v_id, 'owner')
  on conflict (user_id) do update set role = 'owner';
  update public.profiles set status = 'active', status_reason = null where id = v_id;
  insert into public.admin_audit_log (actor_id, action, target_type, target_id, details)
  values (null, 'owner.bootstrap', 'user', v_id::text, jsonb_build_object('by', current_user));
  return v_id;
end;
$$;
revoke all on function public.bootstrap_app_owner(text) from public, anon, authenticated;


-- >>>>>>>>>> 20261016000200_workspaces.sql
-- =============================================================================
-- FINANCE OS — 0200 Espaços financeiros, membros e convites
-- =============================================================================

create table public.workspaces (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 60),
  kind       public.workspace_kind not null default 'shared',
  owner_id   uuid not null references public.profiles (id) on delete cascade,
  currency   text not null default 'BRL' check (currency = 'BRL'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index workspaces_one_personal_per_user on public.workspaces (owner_id) where kind = 'personal';
create index workspaces_owner_idx on public.workspaces (owner_id);
create trigger workspaces_updated_at before update on public.workspaces
  for each row execute function public.tg_set_updated_at();

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  role         public.workspace_role not null,
  is_support   boolean not null default false,
  expires_at   timestamptz,
  added_by     uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id),
  -- Acesso de suporte é sempre temporário e somente leitura.
  check (not is_support or (expires_at is not null and role = 'viewer'))
);
create index workspace_members_user_idx on public.workspace_members (user_id);

-- Conjunto de espaços acessíveis ao usuário atual com papel mínimo.
-- Usado nas policies como `workspace_id in (select public.my_workspace_ids(N))`,
-- o que o planner avalia uma única vez por consulta.
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
    and public.role_rank(m.role) >= p_min_rank;
$$;

create or replace function public.workspace_rank(p_workspace uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select public.role_rank(m.role)
    from public.workspace_members m
    join public.profiles p on p.id = m.user_id
    where m.workspace_id = p_workspace
      and m.user_id = auth.uid()
      and p.status = 'active'
      and (m.expires_at is null or m.expires_at > now())
  ), 0);
$$;

create or replace function public.require_rank(p_workspace uuid, p_min integer)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.workspace_rank(p_workspace) < p_min then
    raise exception 'Você não tem permissão para esta ação neste espaço.' using errcode = '42501';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Convites (de aplicação quando workspace_id é nulo; de espaço caso contrário)
-- O token é exibido uma única vez; apenas o hash SHA-256 é armazenado.
-- ---------------------------------------------------------------------------
create table public.invites (
  id           uuid primary key default gen_random_uuid(),
  token_hash   text not null unique,
  workspace_id uuid references public.workspaces (id) on delete cascade,
  email        text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role         public.workspace_role not null default 'viewer' check (role <> 'owner'),
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  accepted_at  timestamptz,
  accepted_by  uuid references public.profiles (id) on delete set null,
  revoked_at   timestamptz
);
create index invites_workspace_idx on public.invites (workspace_id);
create index invites_email_idx on public.invites (lower(email));

create or replace function public.hash_token(p_token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
$$;


-- >>>>>>>>>> 20261016000300_finance.sql
-- =============================================================================
-- FINANCE OS — 0300 Núcleo financeiro
-- Contas, categorias, cartões, faturas, parcelamentos, recorrências,
-- lançamentos, liquidações (pagamentos parciais) e auditoria por registro.
--
-- Regras contábeis (fonte da verdade — o navegador nunca envia saldos):
--   * income/expense afetam o saldo da conta pelo valor efetivamente liquidado
--     (paid_cents = principal + juros − desconto).
--   * expense em cartão (card_id) NÃO afeta conta; entra na fatura.
--   * card_payment debita a conta e liquida a fatura; NÃO é despesa.
--   * transfer debita a origem e credita o destino; NÃO é receita nem despesa.
--   * cancelled nunca entra em saldos nem relatórios.
-- =============================================================================

create type public.account_type as enum ('checking', 'savings', 'cash', 'payment', 'investment', 'other');
create type public.category_kind as enum ('income', 'expense');
create type public.tx_kind as enum ('income', 'expense', 'transfer', 'card_payment');
create type public.tx_status as enum ('planned', 'pending', 'paid', 'received', 'cancelled');
create type public.payment_method as enum ('pix', 'debit', 'credit_card', 'cash', 'boleto', 'transfer', 'auto_debit', 'other');
create type public.recurrence_freq as enum ('daily', 'weekly', 'monthly', 'yearly');
create type public.recurrence_status as enum ('active', 'paused', 'cancelled');

-- ---------------------------------------------------------------------------
-- Contas
-- ---------------------------------------------------------------------------
create table public.accounts (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references public.workspaces (id) on delete cascade,
  name                  text not null check (char_length(name) between 1 and 60),
  type                  public.account_type not null default 'checking',
  institution           text check (char_length(institution) <= 60),
  initial_balance_cents bigint not null default 0 check (abs(initial_balance_cents) <= 100000000000),
  color                 text not null default '#10b981' check (color ~ '^#[0-9a-fA-F]{6}$'),
  include_in_total      boolean not null default true,
  archived              boolean not null default false,
  sort_order            integer not null default 0,
  created_by            uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (id, workspace_id)
);
create index accounts_workspace_idx on public.accounts (workspace_id);
create trigger accounts_updated_at before update on public.accounts
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- Categorias (um nível de subcategoria)
-- ---------------------------------------------------------------------------
create table public.categories (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  parent_id    uuid references public.categories (id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 40),
  kind         public.category_kind not null,
  color        text not null default '#64748b' check (color ~ '^#[0-9a-fA-F]{6}$'),
  icon         text not null default 'tag' check (char_length(icon) <= 40),
  is_fixed     boolean not null default false,
  archived     boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index categories_workspace_idx on public.categories (workspace_id);
create index categories_parent_idx on public.categories (parent_id);
create trigger categories_updated_at before update on public.categories
  for each row execute function public.tg_set_updated_at();

create or replace function public.tg_categories_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_parent public.categories;
begin
  if tg_op = 'UPDATE' and new.workspace_id <> old.workspace_id then
    raise exception 'Não é possível mover categoria entre espaços.';
  end if;
  if new.parent_id is not null then
    select * into v_parent from public.categories where id = new.parent_id;
    if v_parent.id is null or v_parent.workspace_id <> new.workspace_id then
      raise exception 'Categoria pai inválida.';
    end if;
    if v_parent.parent_id is not null then
      raise exception 'Subcategorias aceitam apenas um nível.';
    end if;
    if v_parent.kind <> new.kind then
      raise exception 'Subcategoria deve ter o mesmo tipo da categoria pai.';
    end if;
    if new.parent_id = new.id then
      raise exception 'Categoria não pode ser pai de si mesma.';
    end if;
  end if;
  return new;
end;
$$;
create trigger categories_validate before insert or update on public.categories
  for each row execute function public.tg_categories_validate();

-- ---------------------------------------------------------------------------
-- Cartões de crédito
-- ---------------------------------------------------------------------------
create table public.credit_cards (
  id                         uuid primary key default gen_random_uuid(),
  workspace_id               uuid not null references public.workspaces (id) on delete cascade,
  name                       text not null check (char_length(name) between 1 and 40),
  brand                      text check (char_length(brand) <= 30),
  last_digits                text check (last_digits ~ '^\d{4}$'),
  limit_cents                bigint not null default 0 check (limit_cents between 0 and 100000000000),
  closing_day                smallint not null check (closing_day between 1 and 31),
  due_day                    smallint not null check (due_day between 1 and 31),
  color                      text not null default '#6366f1' check (color ~ '^#[0-9a-fA-F]{6}$'),
  default_payment_account_id uuid references public.accounts (id) on delete set null,
  archived                   boolean not null default false,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);
create index credit_cards_workspace_idx on public.credit_cards (workspace_id);
create trigger credit_cards_updated_at before update on public.credit_cards
  for each row execute function public.tg_set_updated_at();

create or replace function public.tg_credit_cards_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.workspace_id <> old.workspace_id then
    raise exception 'Não é possível mover cartão entre espaços.';
  end if;
  if new.default_payment_account_id is not null and not exists (
    select 1 from public.accounts a where a.id = new.default_payment_account_id and a.workspace_id = new.workspace_id
  ) then
    raise exception 'Conta de pagamento inválida para este espaço.';
  end if;
  return new;
end;
$$;
create trigger credit_cards_validate before insert or update on public.credit_cards
  for each row execute function public.tg_credit_cards_validate();

-- Data com dia limitado ao último dia do mês.
create or replace function public.clamp_date(p_year integer, p_month integer, p_day integer)
returns date
language sql
immutable
set search_path = ''
as $$
  select make_date(p_year, p_month, 1)
       + (least(p_day, extract(day from (make_date(p_year, p_month, 1) + interval '1 month - 1 day'))::integer) - 1);
$$;

-- Ciclo da fatura de uma compra.
-- Convenção: compras feitas A PARTIR do dia de fechamento entram na próxima fatura.
-- reference_month = primeiro dia do mês de vencimento ("fatura de novembro").
create or replace function public.card_cycle(p_closing_day integer, p_due_day integer, p_purchase date,
  out reference_month date, out closing_date date, out due_date date)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_month_start date := date_trunc('month', p_purchase)::date;
  v_close_this  date := public.clamp_date(extract(year from p_purchase)::integer, extract(month from p_purchase)::integer, p_closing_day);
  v_close_month date;
  v_due_month   date;
begin
  if p_purchase < v_close_this then
    v_close_month := v_month_start;
  else
    v_close_month := (v_month_start + interval '1 month')::date;
  end if;
  closing_date := public.clamp_date(extract(year from v_close_month)::integer, extract(month from v_close_month)::integer, p_closing_day);
  if p_due_day > p_closing_day then
    v_due_month := v_close_month;
  else
    v_due_month := (v_close_month + interval '1 month')::date;
  end if;
  due_date := public.clamp_date(extract(year from v_due_month)::integer, extract(month from v_due_month)::integer, p_due_day);
  reference_month := v_due_month;
end;
$$;

-- ---------------------------------------------------------------------------
-- Faturas (criadas automaticamente pelo servidor)
-- ---------------------------------------------------------------------------
create table public.card_invoices (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  card_id         uuid not null references public.credit_cards (id) on delete cascade,
  reference_month date not null check (extract(day from reference_month) = 1),
  closing_date    date not null,
  due_date        date not null,
  created_at      timestamptz not null default now(),
  unique (card_id, reference_month)
);
create index card_invoices_workspace_idx on public.card_invoices (workspace_id, due_date);

create or replace function public.ensure_invoice(p_card uuid, p_purchase date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_card public.credit_cards;
  v_cycle record;
  v_id uuid;
begin
  select * into v_card from public.credit_cards where id = p_card;
  if v_card.id is null then
    raise exception 'Cartão inexistente.';
  end if;
  select * into v_cycle from public.card_cycle(v_card.closing_day, v_card.due_day, p_purchase);
  insert into public.card_invoices (workspace_id, card_id, reference_month, closing_date, due_date)
  values (v_card.workspace_id, v_card.id, v_cycle.reference_month, v_cycle.closing_date, v_cycle.due_date)
  on conflict (card_id, reference_month) do nothing;
  select id into v_id from public.card_invoices where card_id = v_card.id and reference_month = v_cycle.reference_month;
  return v_id;
end;
$$;
revoke all on function public.ensure_invoice(uuid, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Compras parceladas
-- ---------------------------------------------------------------------------
create table public.installment_groups (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces (id) on delete cascade,
  description        text not null check (char_length(description) between 1 and 140),
  total_cents        bigint not null check (total_cents > 0 and total_cents <= 100000000000),
  installments_count integer not null check (installments_count between 2 and 72),
  purchase_date      date not null,
  card_id            uuid references public.credit_cards (id),
  account_id         uuid references public.accounts (id),
  category_id        uuid references public.categories (id) on delete set null,
  client_request_id  uuid,
  created_by         uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at         timestamptz not null default now(),
  unique (workspace_id, client_request_id),
  check ((card_id is null) <> (account_id is null))
);
create index installment_groups_workspace_idx on public.installment_groups (workspace_id);

-- ---------------------------------------------------------------------------
-- Recorrências
-- ---------------------------------------------------------------------------
create table public.recurrences (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references public.workspaces (id) on delete cascade,
  kind                  public.tx_kind not null check (kind in ('income', 'expense')),
  description           text not null check (char_length(description) between 1 and 140),
  amount_cents          bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
  category_id           uuid references public.categories (id) on delete set null,
  account_id            uuid references public.accounts (id),
  card_id               uuid references public.credit_cards (id),
  payment_method        public.payment_method,
  tags                  text[] not null default '{}',
  notes                 text check (char_length(notes) <= 2000),
  frequency             public.recurrence_freq not null default 'monthly',
  interval_count        integer not null default 1 check (interval_count between 1 and 366),
  start_date            date not null,
  end_date              date check (end_date is null or end_date >= start_date),
  occurrences_generated integer not null default 0 check (occurrences_generated >= 0),
  status                public.recurrence_status not null default 'active',
  client_request_id     uuid,
  created_by            uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (workspace_id, client_request_id),
  check ((card_id is null) <> (account_id is null)),
  check (card_id is null or kind = 'expense')
);
create index recurrences_workspace_idx on public.recurrences (workspace_id, status);
create trigger recurrences_updated_at before update on public.recurrences
  for each row execute function public.tg_set_updated_at();

-- Data da n-ésima ocorrência (0 = data inicial), sempre calculada a partir da
-- âncora para evitar deriva (ex.: dia 31 → 28/29 → 31).
create or replace function public.recurrence_date(p_start date, p_freq public.recurrence_freq, p_interval integer, p_n integer)
returns date
language sql
immutable
set search_path = ''
as $$
  select case p_freq
    when 'daily'   then p_start + (p_n * p_interval)
    when 'weekly'  then p_start + (p_n * p_interval * 7)
    when 'monthly' then (p_start + make_interval(months => p_n * p_interval))::date
    when 'yearly'  then (p_start + make_interval(years => p_n * p_interval))::date
  end;
$$;

-- ---------------------------------------------------------------------------
-- Lançamentos
-- ---------------------------------------------------------------------------
create table public.transactions (
  id                      uuid primary key default gen_random_uuid(),
  workspace_id            uuid not null references public.workspaces (id) on delete cascade,
  kind                    public.tx_kind not null,
  status                  public.tx_status not null default 'paid',
  description             text not null check (char_length(btrim(description)) between 1 and 140),
  amount_cents            bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
  paid_cents              bigint not null default 0,
  settled_principal_cents bigint not null default 0,
  occurred_on             date not null check (occurred_on between date '1990-01-01' and date '2200-12-31'),
  due_on                  date,
  category_id             uuid references public.categories (id) on delete set null,
  account_id              uuid references public.accounts (id),
  destination_account_id  uuid references public.accounts (id),
  card_id                 uuid references public.credit_cards (id),
  invoice_id              uuid references public.card_invoices (id),
  payment_method          public.payment_method,
  tags                    text[] not null default '{}' check (cardinality(tags) <= 12),
  notes                   text check (char_length(notes) <= 2000),
  attachment_path         text check (char_length(attachment_path) <= 400),
  installment_group_id    uuid references public.installment_groups (id) on delete cascade,
  installment_number      integer check (installment_number >= 1),
  installments_total      integer check (installments_total >= 1),
  recurrence_id           uuid references public.recurrences (id) on delete set null,
  recurrence_date         date,
  recurrence_detached     boolean not null default false,
  client_request_id       uuid,
  created_by              uuid references public.profiles (id) on delete set null default auth.uid(),
  updated_by              uuid references public.profiles (id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (workspace_id, client_request_id),
  unique (recurrence_id, recurrence_date),
  constraint tx_shape check (
    case kind
      when 'income' then account_id is not null and card_id is null and destination_account_id is null and invoice_id is null
      when 'expense' then (account_id is null) <> (card_id is null) and destination_account_id is null
      when 'transfer' then account_id is not null and destination_account_id is not null
                           and account_id <> destination_account_id and card_id is null and category_id is null
      when 'card_payment' then account_id is not null and card_id is not null and invoice_id is not null
                               and destination_account_id is null and category_id is null
    end
  ),
  constraint tx_status_by_kind check (
    case kind
      when 'income' then status in ('planned', 'pending', 'received', 'cancelled')
      when 'expense' then status in ('planned', 'pending', 'paid', 'cancelled')
      else status in ('pending', 'paid', 'cancelled')
    end
  ),
  constraint tx_installment_shape check (
    (installment_group_id is null and installment_number is null)
    or (installment_group_id is not null and installment_number between 1 and installments_total)
  )
);

create index transactions_ws_date_idx on public.transactions (workspace_id, occurred_on desc, created_at desc);
create index transactions_ws_due_idx on public.transactions (workspace_id, due_on) where status in ('planned', 'pending');
create index transactions_account_idx on public.transactions (account_id);
create index transactions_dest_idx on public.transactions (destination_account_id) where destination_account_id is not null;
create index transactions_invoice_idx on public.transactions (invoice_id) where invoice_id is not null;
create index transactions_category_idx on public.transactions (category_id);
create index transactions_recurrence_idx on public.transactions (recurrence_id) where recurrence_id is not null;
create index transactions_installment_idx on public.transactions (installment_group_id) where installment_group_id is not null;
create index transactions_ws_created_idx on public.transactions (workspace_id, created_at);
create index transactions_description_trgm on public.transactions using gin (description extensions.gin_trgm_ops);

-- Liquidações (pagamentos/recebimentos totais ou parciais com juros/descontos)
create table public.tx_settlements (
  id                uuid primary key default gen_random_uuid(),
  transaction_id    uuid not null references public.transactions (id) on delete cascade,
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  principal_cents   bigint not null check (principal_cents > 0),
  interest_cents    bigint not null default 0 check (interest_cents >= 0),
  discount_cents    bigint not null default 0 check (discount_cents >= 0),
  paid_on           date not null,
  notes             text check (char_length(notes) <= 300),
  client_request_id uuid,
  created_by        uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at        timestamptz not null default now(),
  unique (workspace_id, client_request_id),
  check (discount_cents <= principal_cents + interest_cents)
);
create index tx_settlements_tx_idx on public.tx_settlements (transaction_id);

-- Histórico de alterações de vencimento
create table public.tx_due_changes (
  id             bigint generated always as identity primary key,
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  old_due_on     date,
  new_due_on     date,
  changed_by     uuid references public.profiles (id) on delete set null default auth.uid(),
  changed_at     timestamptz not null default now()
);
create index tx_due_changes_tx_idx on public.tx_due_changes (transaction_id);

-- ---------------------------------------------------------------------------
-- Validação e normalização de lançamentos (executa antes de RLS WITH CHECK)
-- ---------------------------------------------------------------------------
create or replace function public.tg_transactions_before()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cat_kind public.category_kind;
  v_inv public.card_invoices;
  v_paid_principal bigint;
  v_paid_cash bigint;
  v_has_settlements boolean := false;
  v_invoice_total bigint;
  v_invoice_paid bigint;
  v_limit integer;
  v_count integer;
begin
  if tg_op = 'UPDATE' then
    if new.workspace_id <> old.workspace_id then
      raise exception 'Não é possível mover lançamentos entre espaços.';
    end if;
    if new.kind <> old.kind then
      raise exception 'O tipo do lançamento não pode ser alterado. Exclua e crie novamente.';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.client_request_id := old.client_request_id;
    new.updated_by := auth.uid();
    new.updated_at := now();
  else
    if current_setting('finance.system_insert', true) is distinct from 'on' or new.created_by is null then
      new.created_by := coalesce(auth.uid(), new.created_by);
    end if;
    -- Limite de uso configurável por mês e espaço
    select (limits ->> 'max_transactions_per_month')::integer into v_limit from public.app_settings where id = 1;
    if v_limit is not null then
      select count(*) into v_count from public.transactions
      where workspace_id = new.workspace_id and created_at >= date_trunc('month', now());
      if v_count >= v_limit then
        raise exception 'Limite mensal de % lançamentos atingido neste espaço.', v_limit using errcode = 'P0429';
      end if;
    end if;
  end if;

  new.description := btrim(new.description);

  -- Status coerente com o tipo
  if new.kind = 'income' and new.status = 'paid' then new.status := 'received'; end if;
  if new.kind = 'expense' and new.status = 'received' then new.status := 'paid'; end if;
  if new.kind in ('transfer', 'card_payment') and new.status in ('received', 'planned') then
    new.status := case when new.status = 'received' then 'paid' else 'pending' end;
  end if;

  -- Referências precisam pertencer ao MESMO espaço (FKs não verificam isso)
  if new.account_id is not null and not exists (
    select 1 from public.accounts where id = new.account_id and workspace_id = new.workspace_id) then
    raise exception 'Conta inválida para este espaço.';
  end if;
  if new.destination_account_id is not null and not exists (
    select 1 from public.accounts where id = new.destination_account_id and workspace_id = new.workspace_id) then
    raise exception 'Conta de destino inválida para este espaço.';
  end if;
  if new.card_id is not null and not exists (
    select 1 from public.credit_cards where id = new.card_id and workspace_id = new.workspace_id) then
    raise exception 'Cartão inválido para este espaço.';
  end if;
  if new.category_id is not null then
    select kind into v_cat_kind from public.categories where id = new.category_id and workspace_id = new.workspace_id;
    if v_cat_kind is null then
      raise exception 'Categoria inválida para este espaço.';
    end if;
    if new.kind in ('income', 'expense') and v_cat_kind::text <> new.kind::text then
      raise exception 'A categoria não corresponde ao tipo do lançamento.';
    end if;
  end if;
  if new.installment_group_id is not null and not exists (
    select 1 from public.installment_groups where id = new.installment_group_id and workspace_id = new.workspace_id) then
    raise exception 'Parcelamento inválido para este espaço.';
  end if;
  if new.recurrence_id is not null and not exists (
    select 1 from public.recurrences where id = new.recurrence_id and workspace_id = new.workspace_id) then
    raise exception 'Recorrência inválida para este espaço.';
  end if;

  -- Despesa no cartão: fatura calculada no servidor
  if new.kind = 'expense' and new.card_id is not null then
    if tg_op = 'INSERT' or new.occurred_on <> old.occurred_on or new.card_id <> old.card_id or old.invoice_id is null then
      new.invoice_id := public.ensure_invoice(new.card_id, new.occurred_on);
    end if;
    if new.status <> 'cancelled' then
      new.status := 'paid';
    end if;
    new.payment_method := 'credit_card';
    new.due_on := null;
  elsif new.kind = 'expense' then
    new.invoice_id := null;
  end if;

  -- Pagamento de fatura
  if new.kind = 'card_payment' then
    select * into v_inv from public.card_invoices where id = new.invoice_id;
    if v_inv.id is null or v_inv.workspace_id <> new.workspace_id then
      raise exception 'Fatura inválida para este espaço.';
    end if;
    new.card_id := v_inv.card_id;
    if new.status = 'paid' then
      select coalesce(sum(amount_cents), 0) into v_invoice_total from public.transactions
        where invoice_id = new.invoice_id and kind = 'expense' and status <> 'cancelled';
      select coalesce(sum(amount_cents), 0) into v_invoice_paid from public.transactions
        where invoice_id = new.invoice_id and kind = 'card_payment' and status = 'paid'
          and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);
      if v_invoice_paid + new.amount_cents > v_invoice_total then
        raise exception 'O pagamento (%) excede o saldo em aberto da fatura (%).',
          new.amount_cents, greatest(v_invoice_total - v_invoice_paid, 0);
      end if;
    end if;
  end if;

  -- Valores liquidados: sempre calculados aqui, nunca confiados ao cliente
  if tg_op = 'UPDATE' then
    select exists (select 1 from public.tx_settlements where transaction_id = new.id) into v_has_settlements;
  end if;
  if v_has_settlements then
    select coalesce(sum(principal_cents), 0), coalesce(sum(principal_cents + interest_cents - discount_cents), 0)
      into v_paid_principal, v_paid_cash
      from public.tx_settlements where transaction_id = new.id;
    new.settled_principal_cents := v_paid_principal;
    new.paid_cents := v_paid_cash;
    if new.status <> 'cancelled' then
      if v_paid_principal >= new.amount_cents then
        new.status := case when new.kind = 'income' then 'received' else 'paid' end;
      elsif new.status in ('paid', 'received') then
        new.status := 'pending';
      end if;
    end if;
  elsif new.status in ('paid', 'received') then
    new.settled_principal_cents := new.amount_cents;
    new.paid_cents := new.amount_cents;
  else
    new.settled_principal_cents := 0;
    new.paid_cents := 0;
  end if;

  -- Histórico de alteração de vencimento
  if tg_op = 'UPDATE' and new.due_on is distinct from old.due_on then
    insert into public.tx_due_changes (transaction_id, workspace_id, old_due_on, new_due_on)
    values (new.id, new.workspace_id, old.due_on, new.due_on);
  end if;

  return new;
end;
$$;

create trigger transactions_before before insert or update on public.transactions
  for each row execute function public.tg_transactions_before();

-- Impede que a fatura fique com pagamento maior que o total ao cancelar/editar compras?
-- Não: o excedente é exibido como crédito na fatura (comportamento dos bancos).

-- ---------------------------------------------------------------------------
-- Auditoria por registro (dados financeiros: visível só para editores+ do espaço)
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id           bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  actor_id     uuid references public.profiles (id) on delete set null,
  table_name   text not null,
  record_id    uuid not null,
  action       text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_data     jsonb,
  new_data     jsonb,
  created_at   timestamptz not null default now()
);
create index audit_log_record_idx on public.audit_log (record_id, created_at desc);
create index audit_log_ws_idx on public.audit_log (workspace_id, created_at desc);

create or replace function public.tg_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_ws uuid;
  v_id uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then v_old := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_new := to_jsonb(new); end if;
  if tg_op = 'UPDATE' then
    -- remove campos não alterados para manter o log enxuto
    select jsonb_object_agg(key, value) into v_new
      from jsonb_each(v_new) where v_old -> key is distinct from value and key not in ('updated_at');
    if v_new is null then return new; end if;
    select jsonb_object_agg(key, value) into v_old
      from jsonb_each(v_old) where key in (select jsonb_object_keys(v_new));
  end if;
  v_ws := coalesce((v_new ->> 'workspace_id')::uuid, (v_old ->> 'workspace_id')::uuid,
                   case when tg_op = 'DELETE' then old.workspace_id else new.workspace_id end);
  v_id := case when tg_op = 'DELETE' then old.id else new.id end;
  -- Exclusão em cascata de um espaço inteiro não precisa de log por linha
  if not exists (select 1 from public.workspaces where id = v_ws) then
    return null;
  end if;
  insert into public.audit_log (workspace_id, actor_id, table_name, record_id, action, old_data, new_data)
  values (v_ws, auth.uid(), tg_table_name, v_id, tg_op, v_old, v_new);
  return null;
end;
$$;

create trigger transactions_audit after insert or update or delete on public.transactions
  for each row execute function public.tg_audit();
create trigger accounts_audit after insert or update or delete on public.accounts
  for each row execute function public.tg_audit();
create trigger credit_cards_audit after insert or update or delete on public.credit_cards
  for each row execute function public.tg_audit();
create trigger recurrences_audit after insert or update or delete on public.recurrences
  for each row execute function public.tg_audit();
create trigger tx_settlements_audit after insert or update or delete on public.tx_settlements
  for each row execute function public.tg_audit();

-- ---------------------------------------------------------------------------
-- Validação de recorrências e parcelamentos (mesmo espaço)
-- ---------------------------------------------------------------------------
create or replace function public.tg_same_workspace_refs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.workspace_id <> old.workspace_id then
    raise exception 'Não é possível mover registros entre espaços.';
  end if;
  if new.account_id is not null and not exists (
    select 1 from public.accounts where id = new.account_id and workspace_id = new.workspace_id) then
    raise exception 'Conta inválida para este espaço.';
  end if;
  if new.card_id is not null and not exists (
    select 1 from public.credit_cards where id = new.card_id and workspace_id = new.workspace_id) then
    raise exception 'Cartão inválido para este espaço.';
  end if;
  if new.category_id is not null and not exists (
    select 1 from public.categories where id = new.category_id and workspace_id = new.workspace_id) then
    raise exception 'Categoria inválida para este espaço.';
  end if;
  return new;
end;
$$;
create trigger recurrences_refs before insert or update on public.recurrences
  for each row execute function public.tg_same_workspace_refs();
create trigger installment_groups_refs before insert or update on public.installment_groups
  for each row execute function public.tg_same_workspace_refs();

-- ---------------------------------------------------------------------------
-- Razão contábil por conta e saldos (views com security_invoker → RLS aplica)
-- ---------------------------------------------------------------------------
create view public.ledger_entries with (security_invoker = true) as
  -- receitas/despesas em conta sem liquidações parciais
  select t.workspace_id, t.account_id, t.id as transaction_id, t.occurred_on as entry_date,
         case when t.status in ('paid', 'received')
              then (case when t.kind = 'income' then 1 else -1 end) * t.amount_cents else 0 end as realized_cents,
         case when t.status in ('planned', 'pending')
              then (case when t.kind = 'income' then 1 else -1 end) * t.amount_cents else 0 end as pending_cents
  from public.transactions t
  where t.kind in ('income', 'expense') and t.account_id is not null and t.status <> 'cancelled'
    and not exists (select 1 from public.tx_settlements s where s.transaction_id = t.id)
  union all
  -- liquidações (caixa efetivo na data do pagamento, com juros e descontos)
  select t.workspace_id, t.account_id, t.id, s.paid_on,
         (case when t.kind = 'income' then 1 else -1 end) * (s.principal_cents + s.interest_cents - s.discount_cents),
         0
  from public.tx_settlements s
  join public.transactions t on t.id = s.transaction_id
  where t.status <> 'cancelled' and t.account_id is not null
  union all
  -- saldo remanescente de lançamentos parcialmente liquidados
  select t.workspace_id, t.account_id, t.id, coalesce(t.due_on, t.occurred_on),
         0,
         (case when t.kind = 'income' then 1 else -1 end) * greatest(t.amount_cents - t.settled_principal_cents, 0)
  from public.transactions t
  where t.kind in ('income', 'expense') and t.account_id is not null and t.status <> 'cancelled'
    and exists (select 1 from public.tx_settlements s where s.transaction_id = t.id)
  union all
  select t.workspace_id, t.account_id, t.id, t.occurred_on,
         case when t.status = 'paid' then -t.amount_cents else 0 end,
         case when t.status = 'pending' then -t.amount_cents else 0 end
  from public.transactions t
  where t.kind in ('transfer', 'card_payment') and t.status <> 'cancelled'
  union all
  select t.workspace_id, t.destination_account_id, t.id, t.occurred_on,
         case when t.status = 'paid' then t.amount_cents else 0 end,
         case when t.status = 'pending' then t.amount_cents else 0 end
  from public.transactions t
  where t.kind = 'transfer' and t.status <> 'cancelled';

create view public.account_balances with (security_invoker = true) as
  select a.id as account_id,
         a.workspace_id,
         (a.initial_balance_cents
           + coalesce(sum(l.realized_cents) filter (where l.entry_date <= current_date), 0))::bigint as current_balance_cents,
         (a.initial_balance_cents
           + coalesce(sum(l.realized_cents), 0))::bigint as realized_balance_cents,
         (a.initial_balance_cents
           + coalesce(sum(l.realized_cents), 0)
           + coalesce(sum(l.pending_cents), 0))::bigint as projected_balance_cents,
         coalesce(sum(l.pending_cents) filter (where l.pending_cents > 0), 0)::bigint as pending_in_cents,
         coalesce(-sum(l.pending_cents) filter (where l.pending_cents < 0), 0)::bigint as pending_out_cents
  from public.accounts a
  left join public.ledger_entries l on l.account_id = a.id
  group by a.id;

-- Totais e situação das faturas
create view public.card_invoice_summary with (security_invoker = true) as
  select i.id, i.workspace_id, i.card_id, i.reference_month, i.closing_date, i.due_date,
         coalesce(e.total_cents, 0)::bigint as total_cents,
         coalesce(e.items, 0)::integer as items,
         coalesce(p.paid_cents, 0)::bigint as paid_cents,
         (coalesce(e.total_cents, 0) - coalesce(p.paid_cents, 0))::bigint as remaining_cents,
         case
           when current_date < i.closing_date then 'open'
           when coalesce(e.total_cents, 0) - coalesce(p.paid_cents, 0) <= 0 then 'paid'
           when current_date > i.due_date then 'overdue'
           when coalesce(p.paid_cents, 0) > 0 then 'partial'
           else 'closed'
         end as status
  from public.card_invoices i
  left join lateral (
    select sum(t.amount_cents) as total_cents, count(*) as items
    from public.transactions t
    where t.invoice_id = i.id and t.kind = 'expense' and t.status <> 'cancelled'
  ) e on true
  left join lateral (
    select sum(t.amount_cents) as paid_cents
    from public.transactions t
    where t.invoice_id = i.id and t.kind = 'card_payment' and t.status = 'paid'
  ) p on true;

create view public.card_limits with (security_invoker = true) as
  select c.id as card_id, c.workspace_id, c.limit_cents,
         coalesce(sum(greatest(s.remaining_cents, 0)), 0)::bigint as used_cents,
         (c.limit_cents - coalesce(sum(greatest(s.remaining_cents, 0)), 0))::bigint as available_cents
  from public.credit_cards c
  left join public.card_invoice_summary s on s.card_id = c.id
  group by c.id;


-- >>>>>>>>>> 20261016000400_planning.sql
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


-- >>>>>>>>>> 20261016000500_functions.sql
-- =============================================================================
-- FINANCE OS — 0500 Funções de negócio (RPC)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Categorias padrão de um espaço
-- ---------------------------------------------------------------------------
create or replace function public.seed_default_categories(p_workspace uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent uuid;
  r record;
begin
  for r in
    select * from (values
      ('Alimentação', 'expense', '#f59e0b', 'utensils', false, array['Mercado', 'Restaurantes', 'Delivery']),
      ('Moradia', 'expense', '#8b5cf6', 'home', true, array['Aluguel', 'Condomínio', 'Energia', 'Água', 'Internet']),
      ('Transporte', 'expense', '#0ea5e9', 'car', false, array['Combustível', 'Aplicativos', 'Transporte público', 'Manutenção']),
      ('Saúde', 'expense', '#ef4444', 'heart-pulse', false, array['Plano de saúde', 'Farmácia', 'Consultas']),
      ('Educação', 'expense', '#14b8a6', 'graduation-cap', true, array['Mensalidade', 'Cursos', 'Livros']),
      ('Lazer', 'expense', '#ec4899', 'party-popper', false, array['Viagens', 'Cinema e eventos', 'Hobbies']),
      ('Assinaturas', 'expense', '#6366f1', 'repeat', true, array['Streaming', 'Software', 'Academia']),
      ('Compras', 'expense', '#f97316', 'shopping-bag', false, array['Vestuário', 'Eletrônicos', 'Casa']),
      ('Impostos e taxas', 'expense', '#78716c', 'landmark', false, array['Tarifas bancárias', 'Impostos']),
      ('Outros', 'expense', '#64748b', 'circle-dashed', false, array[]::text[]),
      ('Salário', 'income', '#10b981', 'briefcase', true, array[]::text[]),
      ('Renda extra', 'income', '#22c55e', 'sparkles', false, array['Freelance', 'Vendas']),
      ('Investimentos', 'income', '#06b6d4', 'trending-up', false, array['Rendimentos', 'Dividendos']),
      ('Outras receitas', 'income', '#84cc16', 'plus-circle', false, array['Reembolsos', 'Presentes'])
    ) as t(name, kind, color, icon, is_fixed, subs)
  loop
    insert into public.categories (workspace_id, name, kind, color, icon, is_fixed)
    values (p_workspace, r.name, r.kind::public.category_kind, r.color, r.icon, r.is_fixed)
    returning id into v_parent;
    insert into public.categories (workspace_id, parent_id, name, kind, color, icon, is_fixed)
    select p_workspace, v_parent, s, r.kind::public.category_kind, r.color, r.icon, r.is_fixed
    from unnest(r.subs) as s;
  end loop;
end;
$$;
revoke all on function public.seed_default_categories(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Novo usuário: perfil, espaço pessoal, categorias e preferências
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode text;
  v_status public.app_user_status := 'active';
  v_ws uuid;
  v_name text := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '');
begin
  select signup_mode into v_mode from public.app_settings where id = 1;
  if v_mode = 'invite_only' and not exists (
    select 1 from public.invites i
    where lower(i.email) = lower(new.email) and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
  ) then
    v_status := 'pending';
  end if;

  insert into public.profiles (id, email, full_name, status)
  values (new.id, coalesce(new.email, ''), left(v_name, 120), v_status);

  insert into public.workspaces (name, kind, owner_id)
  values ('Pessoal', 'personal', new.id)
  returning id into v_ws;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_ws, new.id, 'owner');

  perform public.seed_default_categories(v_ws);

  insert into public.accounts (workspace_id, name, type, color, created_by)
  values (v_ws, 'Carteira', 'cash', '#10b981', new.id);

  insert into public.user_preferences (user_id, active_workspace_id) values (new.id, v_ws);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = coalesce(new.email, '') where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.handle_user_email_change();

-- ---------------------------------------------------------------------------
-- Contexto da sessão: perfil, papel de app, espaços, configurações
-- ---------------------------------------------------------------------------
create or replace function public.session_context()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'profile', (select to_jsonb(p) - 'status_reason' from public.profiles p where p.id = auth.uid()),
    'status', (select p.status from public.profiles p where p.id = auth.uid()),
    'is_app_owner', public.is_app_owner(),
    'workspaces', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', w.id, 'name', w.name, 'kind', w.kind, 'role', m.role,
        'is_support', m.is_support, 'expires_at', m.expires_at, 'owner_id', w.owner_id
      ) order by w.kind, w.created_at)
      from public.workspace_members m
      join public.workspaces w on w.id = m.workspace_id
      where m.user_id = auth.uid() and (m.expires_at is null or m.expires_at > now())
        and public.is_active_user()
    ), '[]'::jsonb),
    'preferences', (select to_jsonb(u) from public.user_preferences u where u.user_id = auth.uid())
  );
$$;

-- ---------------------------------------------------------------------------
-- Espaços compartilhados
-- ---------------------------------------------------------------------------
create or replace function public.create_workspace(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_max integer;
  v_enabled boolean;
begin
  if not public.is_active_user() then
    raise exception 'Conta inativa.' using errcode = '42501';
  end if;
  perform public.enforce_rate_limit('create_workspace', 10, 3600);
  select coalesce((features ->> 'shared_workspaces')::boolean, true), (limits ->> 'max_workspaces_per_user')::integer
    into v_enabled, v_max from public.app_settings where id = 1;
  if not v_enabled then
    raise exception 'Espaços compartilhados estão desabilitados pelo administrador.';
  end if;
  if v_max is not null and (select count(*) from public.workspaces where owner_id = auth.uid()) >= v_max then
    raise exception 'Limite de % espaços por usuário atingido.', v_max using errcode = 'P0429';
  end if;
  insert into public.workspaces (name, kind, owner_id) values (btrim(p_name), 'shared', auth.uid())
  returning id into v_id;
  insert into public.workspace_members (workspace_id, user_id, role, added_by) values (v_id, auth.uid(), 'owner', auth.uid());
  perform public.seed_default_categories(v_id);
  return v_id;
end;
$$;

create or replace function public.rename_workspace(p_workspace uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_rank(p_workspace, 4);
  update public.workspaces set name = btrim(p_name) where id = p_workspace;
end;
$$;

create or replace function public.delete_workspace(p_workspace uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_rank(p_workspace, 5);
  if exists (select 1 from public.workspaces where id = p_workspace and kind = 'personal') then
    raise exception 'O espaço pessoal não pode ser excluído.';
  end if;
  delete from public.workspaces where id = p_workspace;
end;
$$;

create or replace function public.list_workspace_members(p_workspace uuid)
returns table (user_id uuid, email text, full_name text, role public.workspace_role,
               is_support boolean, expires_at timestamptz, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_rank(p_workspace, 1);
  return query
    select m.user_id, p.email, p.full_name, m.role, m.is_support, m.expires_at, m.created_at
    from public.workspace_members m
    join public.profiles p on p.id = m.user_id
    where m.workspace_id = p_workspace
    order by public.role_rank(m.role) desc, m.created_at;
end;
$$;

create or replace function public.set_member_role(p_workspace uuid, p_user uuid, p_role public.workspace_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_my integer := public.workspace_rank(p_workspace);
  v_target public.workspace_members;
begin
  if v_my < 4 then
    raise exception 'Apenas administradores podem alterar permissões.' using errcode = '42501';
  end if;
  select * into v_target from public.workspace_members where workspace_id = p_workspace and user_id = p_user;
  if v_target.user_id is null then raise exception 'Membro não encontrado.'; end if;
  if v_target.role = 'owner' or p_role = 'owner' then
    raise exception 'A propriedade do espaço não pode ser alterada por aqui.';
  end if;
  if v_target.is_support then
    raise exception 'Acessos de suporte são somente leitura.';
  end if;
  -- administradores não podem promover/alterar outros administradores
  if v_my < 5 and (v_target.role = 'admin' or p_role = 'admin') then
    raise exception 'Somente o proprietário do espaço gerencia administradores.' using errcode = '42501';
  end if;
  update public.workspace_members set role = p_role where workspace_id = p_workspace and user_id = p_user;
end;
$$;

create or replace function public.remove_member(p_workspace uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_my integer := public.workspace_rank(p_workspace);
  v_target public.workspace_members;
begin
  select * into v_target from public.workspace_members where workspace_id = p_workspace and user_id = p_user;
  if v_target.user_id is null then raise exception 'Membro não encontrado.'; end if;
  if v_target.role = 'owner' then raise exception 'O proprietário não pode ser removido.'; end if;
  if p_user <> auth.uid() then
    if v_my < 4 or (v_my < 5 and v_target.role = 'admin') then
      raise exception 'Você não pode remover este membro.' using errcode = '42501';
    end if;
  end if;
  delete from public.workspace_members where workspace_id = p_workspace and user_id = p_user;
end;
$$;

-- Acesso de suporte temporário concedido EXPLICITAMENTE pelo dono do espaço
-- ao proprietário do aplicativo (somente leitura, expira automaticamente).
create or replace function public.grant_support_access(p_workspace uuid, p_hours integer default 24)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  perform public.require_rank(p_workspace, 5);
  if p_hours not between 1 and 168 then raise exception 'Duração inválida (1 a 168 horas).'; end if;
  select r.user_id into v_owner from public.app_roles r where r.role = 'owner' limit 1;
  if v_owner is null then raise exception 'Nenhum administrador de suporte configurado.'; end if;
  if v_owner = auth.uid() then raise exception 'Você já é o proprietário do aplicativo.'; end if;
  if exists (select 1 from public.workspace_members where workspace_id = p_workspace and user_id = v_owner and not is_support) then
    raise exception 'O administrador já é membro deste espaço.';
  end if;
  insert into public.workspace_members (workspace_id, user_id, role, is_support, expires_at, added_by)
  values (p_workspace, v_owner, 'viewer', true, now() + make_interval(hours => p_hours), auth.uid())
  on conflict (workspace_id, user_id) do update set expires_at = excluded.expires_at;
  insert into public.admin_audit_log (actor_id, action, target_type, target_id, details)
  values (auth.uid(), 'support.granted', 'workspace', p_workspace::text, jsonb_build_object('hours', p_hours));
end;
$$;

create or replace function public.revoke_support_access(p_workspace uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_rank(p_workspace, 5);
  delete from public.workspace_members where workspace_id = p_workspace and is_support;
  insert into public.admin_audit_log (actor_id, action, target_type, target_id)
  values (auth.uid(), 'support.revoked', 'workspace', p_workspace::text);
end;
$$;

-- ---------------------------------------------------------------------------
-- Convites
-- ---------------------------------------------------------------------------
create or replace function public.create_invite(p_workspace uuid, p_email text, p_role public.workspace_role default 'viewer', p_days integer default 7)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_id uuid;
  v_max integer;
  v_email text := nullif(lower(btrim(p_email)), '');
begin
  perform public.enforce_rate_limit('create_invite', 30, 3600);
  if p_days not between 1 and 30 then raise exception 'Validade inválida (1 a 30 dias).'; end if;
  if p_role = 'owner' then raise exception 'Não é possível convidar como proprietário.'; end if;

  if p_workspace is null then
    if not public.is_app_owner() then
      raise exception 'Apenas o proprietário do aplicativo emite convites de cadastro.' using errcode = '42501';
    end if;
  else
    perform public.require_rank(p_workspace, 4);
    if p_role = 'admin' and public.workspace_rank(p_workspace) < 5 then
      raise exception 'Somente o proprietário do espaço convida administradores.' using errcode = '42501';
    end if;
    if exists (select 1 from public.workspaces where id = p_workspace and kind = 'personal') then
      raise exception 'Espaços pessoais não podem ser compartilhados. Crie um espaço compartilhado.';
    end if;
    select (limits ->> 'max_members_per_workspace')::integer into v_max from public.app_settings where id = 1;
    if v_max is not null and (select count(*) from public.workspace_members where workspace_id = p_workspace) >= v_max then
      raise exception 'Limite de % membros por espaço atingido.', v_max using errcode = 'P0429';
    end if;
  end if;

  insert into public.invites (token_hash, workspace_id, email, role, created_by, expires_at)
  values (public.hash_token(v_token), p_workspace, v_email, p_role, auth.uid(), now() + make_interval(days => p_days))
  returning id into v_id;

  if p_workspace is null then
    insert into public.admin_audit_log (actor_id, action, target_type, target_id, details)
    values (auth.uid(), 'invite.created', 'invite', v_id::text, jsonb_build_object('email', v_email));
  end if;

  return jsonb_build_object('id', v_id, 'token', v_token);
end;
$$;

create or replace function public.revoke_invite(p_invite uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invites;
begin
  select * into v_inv from public.invites where id = p_invite;
  if v_inv.id is null then raise exception 'Convite não encontrado.'; end if;
  if v_inv.workspace_id is null then
    if not public.is_app_owner() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  else
    perform public.require_rank(v_inv.workspace_id, 4);
  end if;
  update public.invites set revoked_at = now() where id = p_invite and accepted_at is null;
end;
$$;

-- Informações públicas mínimas de um convite (para a tela de aceite)
create or replace function public.peek_invite(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_inv public.invites;
  v_ws text;
begin
  select * into v_inv from public.invites where token_hash = public.hash_token(p_token);
  if v_inv.id is null then return jsonb_build_object('valid', false, 'reason', 'not_found'); end if;
  if v_inv.revoked_at is not null then return jsonb_build_object('valid', false, 'reason', 'revoked'); end if;
  if v_inv.accepted_at is not null then return jsonb_build_object('valid', false, 'reason', 'accepted'); end if;
  if v_inv.expires_at <= now() then return jsonb_build_object('valid', false, 'reason', 'expired'); end if;
  select name into v_ws from public.workspaces where id = v_inv.workspace_id;
  return jsonb_build_object('valid', true, 'workspace_name', v_ws, 'role', v_inv.role,
                            'email_hint', case when v_inv.email is null then null
                                               else left(v_inv.email, 2) || '•••@' || split_part(v_inv.email, '@', 2) end,
                            'expires_at', v_inv.expires_at);
end;
$$;

create or replace function public.accept_invite(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invites;
  v_email text;
begin
  if auth.uid() is null then raise exception 'Faça login para aceitar o convite.' using errcode = '42501'; end if;
  perform public.enforce_rate_limit('accept_invite', 20, 3600);
  select * into v_inv from public.invites where token_hash = public.hash_token(p_token) for update;
  if v_inv.id is null or v_inv.revoked_at is not null or v_inv.accepted_at is not null or v_inv.expires_at <= now() then
    raise exception 'Convite inválido, expirado ou já utilizado.';
  end if;
  select email into v_email from public.profiles where id = auth.uid();
  if v_inv.email is not null and lower(v_inv.email) <> lower(v_email) then
    raise exception 'Este convite foi emitido para outro e-mail.' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles where id = auth.uid() and status in ('suspended', 'revoked')) then
    raise exception 'Conta suspensa.' using errcode = '42501';
  end if;

  update public.profiles set status = 'active' where id = auth.uid() and status = 'pending';

  if v_inv.workspace_id is not null then
    insert into public.workspace_members (workspace_id, user_id, role, added_by)
    values (v_inv.workspace_id, auth.uid(), v_inv.role, v_inv.created_by)
    on conflict (workspace_id, user_id) do update
      set role = case when public.role_rank(public.workspace_members.role) >= public.role_rank(excluded.role)
                      then public.workspace_members.role else excluded.role end,
          is_support = false, expires_at = null;
  end if;
  update public.invites set accepted_at = now(), accepted_by = auth.uid() where id = v_inv.id;
  return jsonb_build_object('workspace_id', v_inv.workspace_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Parcelamento: cria N parcelas de forma atômica e idempotente
-- (centavos residuais vão para a primeira parcela)
-- ---------------------------------------------------------------------------
create or replace function public.create_installment_purchase(
  p_workspace uuid, p_description text, p_total_cents bigint, p_installments integer, p_purchase_date date,
  p_card_id uuid default null, p_account_id uuid default null, p_category_id uuid default null,
  p_tags text[] default '{}', p_notes text default null, p_client_request_id uuid default null,
  p_first_status public.tx_status default 'pending'
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_group uuid;
  v_base bigint;
  v_rest bigint;
  v_date date;
  i integer;
begin
  if p_client_request_id is not null then
    select id into v_group from public.installment_groups where workspace_id = p_workspace and client_request_id = p_client_request_id;
    if v_group is not null then return v_group; end if;
  end if;
  if p_installments < 2 or p_installments > 72 then raise exception 'Número de parcelas inválido (2 a 72).'; end if;
  if p_total_cents < p_installments then raise exception 'Valor total muito baixo para o número de parcelas.'; end if;

  insert into public.installment_groups (workspace_id, description, total_cents, installments_count, purchase_date,
                                         card_id, account_id, category_id, client_request_id)
  values (p_workspace, btrim(p_description), p_total_cents, p_installments, p_purchase_date,
          p_card_id, p_account_id, p_category_id, p_client_request_id)
  returning id into v_group;

  v_base := p_total_cents / p_installments;
  v_rest := p_total_cents - v_base * p_installments;

  for i in 1..p_installments loop
    v_date := (p_purchase_date + make_interval(months => i - 1))::date;
    insert into public.transactions (workspace_id, kind, status, description, amount_cents, occurred_on, due_on,
                                     category_id, account_id, card_id, payment_method, tags, notes,
                                     installment_group_id, installment_number, installments_total)
    values (p_workspace, 'expense',
            case when p_card_id is not null then 'paid'::public.tx_status
                 when i = 1 then p_first_status else 'pending'::public.tx_status end,
            btrim(p_description) || ' (' || i || '/' || p_installments || ')',
            v_base + case when i = 1 then v_rest else 0 end,
            v_date, case when p_card_id is null then v_date end,
            p_category_id, p_account_id, p_card_id,
            case when p_card_id is not null then 'credit_card'::public.payment_method else 'boleto'::public.payment_method end,
            coalesce(p_tags, '{}'), p_notes, v_group, i, p_installments);
  end loop;
  return v_group;
end;
$$;

-- ---------------------------------------------------------------------------
-- Liquidação (pagamento/recebimento total ou parcial com juros e desconto)
-- ---------------------------------------------------------------------------
create or replace function public.settle_transaction(
  p_transaction uuid, p_principal_cents bigint, p_interest_cents bigint default 0, p_discount_cents bigint default 0,
  p_paid_on date default current_date, p_notes text default null, p_client_request_id uuid default null
)
returns public.transactions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tx public.transactions;
  v_remaining bigint;
begin
  select * into v_tx from public.transactions where id = p_transaction for update;
  if v_tx.id is null then raise exception 'Lançamento não encontrado.'; end if;
  if p_client_request_id is not null and exists (
    select 1 from public.tx_settlements where workspace_id = v_tx.workspace_id and client_request_id = p_client_request_id) then
    return v_tx;
  end if;
  if v_tx.kind not in ('income', 'expense') or v_tx.account_id is null then
    raise exception 'Apenas receitas e despesas em conta podem ser liquidadas por aqui.';
  end if;
  if v_tx.status = 'cancelled' then raise exception 'Lançamento cancelado.'; end if;

  -- Converte uma liquidação integral anterior (sem registros) em registro explícito
  if v_tx.status in ('paid', 'received') then
    raise exception 'Este lançamento já está liquidado.';
  end if;

  v_remaining := v_tx.amount_cents - v_tx.settled_principal_cents;
  if p_principal_cents <= 0 or p_principal_cents > v_remaining then
    raise exception 'Valor principal deve estar entre R$ 0,01 e o saldo em aberto.';
  end if;

  insert into public.tx_settlements (transaction_id, workspace_id, principal_cents, interest_cents, discount_cents, paid_on, notes, client_request_id)
  values (v_tx.id, v_tx.workspace_id, p_principal_cents, coalesce(p_interest_cents, 0), coalesce(p_discount_cents, 0), p_paid_on, p_notes, p_client_request_id);

  -- força o recálculo no trigger
  update public.transactions set updated_at = now() where id = v_tx.id returning * into v_tx;
  return v_tx;
end;
$$;

create or replace function public.undo_settlement(p_settlement uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tx uuid;
begin
  delete from public.tx_settlements where id = p_settlement returning transaction_id into v_tx;
  if v_tx is null then raise exception 'Pagamento não encontrado.'; end if;
  -- se não houver mais liquidações, volta para pendente
  update public.transactions
     set status = case when exists (select 1 from public.tx_settlements where transaction_id = v_tx) then status else 'pending' end
   where id = v_tx;
end;
$$;

-- ---------------------------------------------------------------------------
-- Recorrências: geração idempotente de ocorrências
-- Contas (débito em conta): gera até o horizonte (padrão 45 dias) como pendente.
-- Cartão (assinaturas): gera somente até hoje, como compra lançada na fatura.
-- ---------------------------------------------------------------------------
create or replace function public.generate_recurrences(p_workspace uuid, p_horizon date default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.recurrences;
  v_date date;
  v_limit date;
  v_created integer := 0;
  v_rows integer;
begin
  if auth.uid() is not null then
    perform public.require_rank(p_workspace, 1);
  end if;
  perform set_config('finance.system_insert', 'on', true);
  for r in
    select * from public.recurrences where workspace_id = p_workspace and status = 'active' for update skip locked
  loop
    v_limit := case when r.card_id is not null then current_date
                    else coalesce(p_horizon, current_date + 45) end;
    loop
      v_date := public.recurrence_date(r.start_date, r.frequency, r.interval_count, r.occurrences_generated);
      exit when v_date > v_limit or (r.end_date is not null and v_date > r.end_date);
      insert into public.transactions (workspace_id, kind, status, description, amount_cents, occurred_on, due_on,
                                       category_id, account_id, card_id, payment_method, tags, notes,
                                       recurrence_id, recurrence_date, created_by)
      values (r.workspace_id, r.kind,
              case when r.card_id is not null then 'paid'::public.tx_status else 'pending'::public.tx_status end,
              r.description, r.amount_cents, v_date, case when r.card_id is null then v_date end,
              r.category_id, r.account_id, r.card_id, r.payment_method, r.tags, r.notes,
              r.id, v_date, r.created_by)
      on conflict (recurrence_id, recurrence_date) do nothing;
      get diagnostics v_rows = row_count;
      v_created := v_created + v_rows;
      r.occurrences_generated := r.occurrences_generated + 1;
    end loop;
    update public.recurrences set occurrences_generated = r.occurrences_generated where id = r.id;
  end loop;
  perform set_config('finance.system_insert', 'off', true);
  return v_created;
end;
$$;

-- Para pg_cron (sem usuário): gera para todos os espaços
create or replace function public.generate_all_recurrences()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer := 0;
  w uuid;
begin
  for w in select distinct workspace_id from public.recurrences where status = 'active' loop
    v_total := v_total + public.generate_recurrences(w, null);
  end loop;
  return v_total;
end;
$$;
revoke all on function public.generate_all_recurrences() from public, anon, authenticated;

-- Altera a recorrência e, opcionalmente, todas as ocorrências futuras pendentes
create or replace function public.update_recurrence(
  p_recurrence uuid, p_changes jsonb, p_apply_from date default null
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_rec public.recurrences;
  v_count integer := 0;
begin
  select * into v_rec from public.recurrences where id = p_recurrence for update;
  if v_rec.id is null then raise exception 'Recorrência não encontrada.'; end if;

  update public.recurrences set
    description    = coalesce(p_changes ->> 'description', description),
    amount_cents   = coalesce((p_changes ->> 'amount_cents')::bigint, amount_cents),
    category_id    = case when p_changes ? 'category_id' then (p_changes ->> 'category_id')::uuid else category_id end,
    payment_method = case when p_changes ? 'payment_method' then (p_changes ->> 'payment_method')::public.payment_method else payment_method end,
    end_date       = case when p_changes ? 'end_date' then (p_changes ->> 'end_date')::date else end_date end,
    notes          = case when p_changes ? 'notes' then p_changes ->> 'notes' else notes end
  where id = p_recurrence
  returning * into v_rec;

  if p_apply_from is not null then
    perform set_config('finance.bulk_recurrence', 'on', true);
    update public.transactions t set
      description  = v_rec.description,
      amount_cents = v_rec.amount_cents,
      category_id  = v_rec.category_id,
      payment_method = coalesce(v_rec.payment_method, t.payment_method)
    where t.recurrence_id = v_rec.id
      and t.recurrence_date >= p_apply_from
      and t.status in ('planned', 'pending')
      and not t.recurrence_detached;
    get diagnostics v_count = row_count;
    perform set_config('finance.bulk_recurrence', 'off', true);

    if v_rec.end_date is not null then
      delete from public.transactions t
      where t.recurrence_id = v_rec.id and t.recurrence_date > v_rec.end_date
        and t.status in ('planned', 'pending') and not t.recurrence_detached;
    end if;
  end if;
  return v_count;
end;
$$;

create or replace function public.set_recurrence_status(p_recurrence uuid, p_status public.recurrence_status, p_remove_future boolean default false)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_rec public.recurrences;
begin
  select * into v_rec from public.recurrences where id = p_recurrence for update;
  if v_rec.id is null then raise exception 'Recorrência não encontrada.'; end if;
  if v_rec.status = 'cancelled' and p_status <> 'cancelled' then
    raise exception 'Recorrências canceladas não podem ser reativadas. Crie uma nova.';
  end if;
  -- ao retomar, pula ocorrências passadas (não gera cobranças retroativas)
  if p_status = 'active' and v_rec.status = 'paused' then
    while public.recurrence_date(v_rec.start_date, v_rec.frequency, v_rec.interval_count, v_rec.occurrences_generated) < current_date loop
      v_rec.occurrences_generated := v_rec.occurrences_generated + 1;
    end loop;
  end if;
  update public.recurrences set status = p_status, occurrences_generated = v_rec.occurrences_generated where id = p_recurrence;
  if p_remove_future then
    delete from public.transactions
    where recurrence_id = p_recurrence and recurrence_date >= current_date
      and status in ('planned', 'pending') and not recurrence_detached;
  end if;
end;
$$;

-- Marca ocorrência editada individualmente (não será alterada por "todas as futuras")
create or replace function public.tg_detach_recurrence()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.recurrence_id is not null and current_setting('finance.bulk_recurrence', true) is distinct from 'on'
     and (new.amount_cents <> old.amount_cents or new.description <> old.description
          or new.category_id is distinct from old.category_id or new.occurred_on <> old.occurred_on) then
    new.recurrence_detached := true;
  end if;
  return new;
end;
$$;
create trigger transactions_detach_recurrence before update on public.transactions
  for each row when (pg_trigger_depth() = 0) execute function public.tg_detach_recurrence();

-- ---------------------------------------------------------------------------
-- Notificações in-app: orçamentos (50/75/90/100%) e vencimentos
-- ---------------------------------------------------------------------------
create or replace function public.refresh_notifications(p_workspace uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_month date := date_trunc('month', current_date)::date;
  v_prefs public.user_preferences;
  v_count integer := 0;
  v_rows integer;
  b record;
  t record;
  th integer;
begin
  perform public.require_rank(p_workspace, 1);
  select * into v_prefs from public.user_preferences where user_id = v_uid;

  if coalesce(v_prefs.budget_alerts, true) then
    for b in
      select bu.id, bu.limit_cents, bu.alert_thresholds, c.name,
             coalesce((select sum(tx.amount_cents) from public.transactions tx
                       left join public.categories sc on sc.id = tx.category_id
                       where tx.workspace_id = p_workspace and tx.kind = 'expense' and tx.status <> 'cancelled'
                         and tx.occurred_on >= v_month and tx.occurred_on < (v_month + interval '1 month')
                         and (tx.category_id = c.id or sc.parent_id = c.id)), 0) as spent
      from public.budgets bu join public.categories c on c.id = bu.category_id
      where bu.workspace_id = p_workspace and bu.month = v_month
    loop
      foreach th in array b.alert_thresholds loop
        if b.spent * 100 >= b.limit_cents * th then
          insert into public.notifications (user_id, workspace_id, kind, title, body, link, ref_key)
          values (v_uid, p_workspace, 'budget',
                  case when th >= 100 then 'Orçamento de ' || b.name || ' estourado'
                       else 'Orçamento de ' || b.name || ' em ' || th || '%' end,
                  'Você já utilizou ' || floor(b.spent * 100.0 / b.limit_cents) || '% do limite deste mês.',
                  '/orcamentos', 'budget:' || b.id || ':' || th)
          on conflict (user_id, ref_key) do nothing;
          get diagnostics v_rows = row_count;
          v_count := v_count + v_rows;
        end if;
      end loop;
    end loop;
  end if;

  if coalesce(v_prefs.due_alerts, true) then
    for t in
      select tx.id, tx.description, tx.due_on, tx.kind
      from public.transactions tx
      where tx.workspace_id = p_workspace and tx.status in ('planned', 'pending')
        and tx.due_on is not null and tx.due_on <= current_date + 3
        and tx.due_on >= current_date - 30
    loop
      insert into public.notifications (user_id, workspace_id, kind, title, body, link, ref_key)
      values (v_uid, p_workspace,
              case when t.due_on < current_date then 'overdue' else 'due' end,
              case when t.due_on < current_date then 'Em atraso: ' || t.description
                   when t.due_on = current_date then 'Vence hoje: ' || t.description
                   else 'Vence em breve: ' || t.description end,
              case when t.kind = 'income' then 'Recebimento previsto para ' else 'Vencimento em ' end || to_char(t.due_on, 'DD/MM/YYYY') || '.',
              '/compromissos',
              'due:' || t.id || ':' || case when t.due_on < current_date then 'late' else t.due_on::text end)
      on conflict (user_id, ref_key) do nothing;
      get diagnostics v_rows = row_count;
      v_count := v_count + v_rows;
    end loop;
  end if;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Copiar orçamentos do mês anterior
-- ---------------------------------------------------------------------------
create or replace function public.copy_budgets(p_workspace uuid, p_from date, p_to date)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_rows integer;
begin
  insert into public.budgets (workspace_id, category_id, month, limit_cents, alert_thresholds)
  select workspace_id, category_id, date_trunc('month', p_to)::date, limit_cents, alert_thresholds
  from public.budgets where workspace_id = p_workspace and month = date_trunc('month', p_from)::date
  on conflict (workspace_id, category_id, month) do nothing;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

-- ---------------------------------------------------------------------------
-- Erros do cliente (sanitizados, com rate limit)
-- ---------------------------------------------------------------------------
create or replace function public.log_client_error(p_message text, p_route text default null, p_version text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.enforce_rate_limit('client_error', 30, 3600);
  insert into public.client_errors (user_id, app_version, route, message)
  values (auth.uid(), left(p_version, 40), left(p_route, 200), left(p_message, 500));
end;
$$;

-- ---------------------------------------------------------------------------
-- Exclusão dos dados do usuário (LGPD). A remoção do login (auth.users) é feita
-- pela Edge Function delete-account, que usa a service_role no servidor.
-- ---------------------------------------------------------------------------
create or replace function public.delete_my_data()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Não autenticado.' using errcode = '42501'; end if;
  if public.is_app_owner() then
    raise exception 'O proprietário do aplicativo deve transferir a função antes de excluir a conta.';
  end if;
  delete from public.workspaces where owner_id = auth.uid();
  delete from public.workspace_members where user_id = auth.uid();
  delete from public.notifications where user_id = auth.uid();
  update public.profiles set status = 'revoked', full_name = null, avatar_url = null, status_reason = 'Exclusão solicitada pelo titular'
  where id = auth.uid();
end;
$$;


-- >>>>>>>>>> 20261016000600_admin_reports.sql
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


-- >>>>>>>>>> 20261016000700_rls.sql
-- =============================================================================
-- FINANCE OS — 0700 Row Level Security e privilégios
--
-- Matriz de papéis no espaço (rank):
--   owner(5)  admin(4)  editor(3)  contributor(2)  viewer(1)
--   * leitura de dados financeiros ........ rank >= 1
--   * criar lançamentos / pagamentos ...... rank >= 2
--   * editar/excluir lançamentos próprios . rank >= 2 (created_by = usuário)
--   * editar/excluir qualquer lançamento .. rank >= 3
--   * contas, cartões, categorias, orçamentos, metas, recorrências: rank >= 3
--   * histórico de auditoria .............. rank >= 3
--   * membros e convites .................. rank >= 4 (via RPC)
--   * excluir espaço ...................... rank  = 5 (via RPC)
-- O papel de proprietário do APLICATIVO não aparece em nenhuma policy financeira.
-- =============================================================================

alter table public.profiles enable row level security;
alter table public.app_roles enable row level security;
alter table public.app_settings enable row level security;
alter table public.app_releases enable row level security;
alter table public.admin_audit_log enable row level security;
alter table public.client_errors enable row level security;
alter table public.rate_limits enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.invites enable row level security;
alter table public.accounts enable row level security;
alter table public.categories enable row level security;
alter table public.credit_cards enable row level security;
alter table public.card_invoices enable row level security;
alter table public.installment_groups enable row level security;
alter table public.recurrences enable row level security;
alter table public.transactions enable row level security;
alter table public.tx_settlements enable row level security;
alter table public.tx_due_changes enable row level security;
alter table public.audit_log enable row level security;
alter table public.budgets enable row level security;
alter table public.goals enable row level security;
alter table public.goal_contributions enable row level security;
alter table public.notifications enable row level security;
alter table public.user_preferences enable row level security;

-- ---------------------------------------------------------------------------
-- Perfis: o próprio perfil + perfis de quem divide espaço comigo (nome/e-mail)
-- ---------------------------------------------------------------------------
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1 from public.workspace_members m
      where m.user_id = profiles.id and m.workspace_id in (select public.my_workspace_ids(1))
    )
  );
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Status e e-mail só mudam pelo servidor
create or replace function public.tg_profiles_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.status := old.status;
    new.status_reason := old.status_reason;
    new.email := old.email;
    new.id := old.id;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.tg_profiles_guard();

-- app_roles: apenas leitura do próprio papel
create policy app_roles_self on public.app_roles for select to authenticated using (user_id = auth.uid());

-- Configurações globais: leitura pública (marca na tela de login); escrita via RPC
create policy app_settings_read on public.app_settings for select to anon, authenticated using (true);

-- Versões: leitura para usuários autenticados
create policy app_releases_read on public.app_releases for select to authenticated using (true);

-- admin_audit_log, client_errors, rate_limits: sem policies → acesso só via RPC

-- ---------------------------------------------------------------------------
-- Espaços e membros
-- ---------------------------------------------------------------------------
create policy workspaces_select on public.workspaces for select to authenticated
  using (id in (select public.my_workspace_ids(1)));

create policy members_select on public.workspace_members for select to authenticated
  using (workspace_id in (select public.my_workspace_ids(1)));

create policy invites_select on public.invites for select to authenticated
  using (
    (workspace_id is not null and workspace_id in (select public.my_workspace_ids(4)))
    or (workspace_id is null and public.is_app_owner())
  );

-- ---------------------------------------------------------------------------
-- Estruturas financeiras (editor+ escreve, todos os membros leem)
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['accounts', 'categories', 'credit_cards', 'recurrences', 'budgets', 'goals']
  loop
    execute format('create policy %1$s_select on public.%1$I for select to authenticated
                      using (workspace_id in (select public.my_workspace_ids(1)))', t);
    execute format('create policy %1$s_insert on public.%1$I for insert to authenticated
                      with check (workspace_id in (select public.my_workspace_ids(3)))', t);
    execute format('create policy %1$s_update on public.%1$I for update to authenticated
                      using (workspace_id in (select public.my_workspace_ids(3)))
                      with check (workspace_id in (select public.my_workspace_ids(3)))', t);
    execute format('create policy %1$s_delete on public.%1$I for delete to authenticated
                      using (workspace_id in (select public.my_workspace_ids(3)))', t);
  end loop;
end;
$$;

-- Faturas: leitura; criação somente pelo servidor (ensure_invoice)
create policy card_invoices_select on public.card_invoices for select to authenticated
  using (workspace_id in (select public.my_workspace_ids(1)));

-- Parcelamentos: colaboradores criam; editores (ou o autor) excluem
create policy installment_groups_select on public.installment_groups for select to authenticated
  using (workspace_id in (select public.my_workspace_ids(1)));
create policy installment_groups_insert on public.installment_groups for insert to authenticated
  with check (workspace_id in (select public.my_workspace_ids(2)));
create policy installment_groups_delete on public.installment_groups for delete to authenticated
  using (workspace_id in (select public.my_workspace_ids(3))
         or (workspace_id in (select public.my_workspace_ids(2)) and created_by = auth.uid()));

-- ---------------------------------------------------------------------------
-- Lançamentos
-- ---------------------------------------------------------------------------
create policy transactions_select on public.transactions for select to authenticated
  using (workspace_id in (select public.my_workspace_ids(1)));
create policy transactions_insert on public.transactions for insert to authenticated
  with check (workspace_id in (select public.my_workspace_ids(2)));
create policy transactions_update on public.transactions for update to authenticated
  using (workspace_id in (select public.my_workspace_ids(3))
         or (workspace_id in (select public.my_workspace_ids(2)) and created_by = auth.uid()))
  with check (workspace_id in (select public.my_workspace_ids(3))
              or (workspace_id in (select public.my_workspace_ids(2)) and created_by = auth.uid()));
create policy transactions_delete on public.transactions for delete to authenticated
  using (workspace_id in (select public.my_workspace_ids(3))
         or (workspace_id in (select public.my_workspace_ids(2)) and created_by = auth.uid()));

create policy tx_settlements_select on public.tx_settlements for select to authenticated
  using (workspace_id in (select public.my_workspace_ids(1)));
create policy tx_settlements_insert on public.tx_settlements for insert to authenticated
  with check (workspace_id in (select public.my_workspace_ids(2))
              and exists (select 1 from public.transactions t where t.id = transaction_id and t.workspace_id = tx_settlements.workspace_id));
create policy tx_settlements_delete on public.tx_settlements for delete to authenticated
  using (workspace_id in (select public.my_workspace_ids(3))
         or (workspace_id in (select public.my_workspace_ids(2)) and created_by = auth.uid()));

create policy tx_due_changes_select on public.tx_due_changes for select to authenticated
  using (workspace_id in (select public.my_workspace_ids(1)));

create policy audit_log_select on public.audit_log for select to authenticated
  using (workspace_id in (select public.my_workspace_ids(3)));

create policy goal_contributions_select on public.goal_contributions for select to authenticated
  using (workspace_id in (select public.my_workspace_ids(1)));
create policy goal_contributions_insert on public.goal_contributions for insert to authenticated
  with check (workspace_id in (select public.my_workspace_ids(2)));
create policy goal_contributions_delete on public.goal_contributions for delete to authenticated
  using (workspace_id in (select public.my_workspace_ids(3))
         or (workspace_id in (select public.my_workspace_ids(2)) and created_by = auth.uid()));

-- ---------------------------------------------------------------------------
-- Dados estritamente pessoais
-- ---------------------------------------------------------------------------
create policy notifications_own on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_update_own on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_delete_own on public.notifications for delete to authenticated using (user_id = auth.uid());

create policy prefs_select on public.user_preferences for select to authenticated using (user_id = auth.uid());
create policy prefs_insert on public.user_preferences for insert to authenticated with check (user_id = auth.uid());
create policy prefs_update on public.user_preferences for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and (active_workspace_id is null or active_workspace_id in (select public.my_workspace_ids(1))));

-- ---------------------------------------------------------------------------
-- Privilégios de tabela (RLS continua valendo; anon praticamente sem acesso)
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;
grant select on public.app_settings to anon;

grant select on all tables in schema public to authenticated;
grant insert, update, delete on
  public.accounts, public.categories, public.credit_cards, public.recurrences, public.budgets, public.goals,
  public.transactions, public.tx_settlements, public.goal_contributions, public.installment_groups
  to authenticated;
grant update on public.profiles, public.notifications to authenticated;
grant delete on public.notifications to authenticated;
grant insert, update on public.user_preferences to authenticated;
revoke select on public.rate_limits, public.admin_audit_log, public.client_errors from authenticated;

grant all on all tables in schema public to service_role;
grant usage on all sequences in schema public to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Privilégios de funções: nada executável por anon exceto o estritamente público
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;

revoke execute on function
  public.bootstrap_app_owner(text),
  public.ensure_invoice(uuid, date),
  public.seed_default_categories(uuid),
  public.generate_all_recurrences(),
  public.purge_old_records(),
  public.enforce_rate_limit(text, integer, integer),
  public.handle_new_user(),
  public.handle_user_email_change()
from authenticated;

grant execute on function public.peek_invite(text) to anon;
grant execute on function public.hash_token(text) to anon;

alter default privileges in schema public revoke execute on functions from public, anon;


-- >>>>>>>>>> 20261016000800_storage_cron.sql
-- =============================================================================
-- FINANCE OS — 0800 Comprovantes (Storage) e tarefas agendadas (pg_cron)
-- Caminho do arquivo: <workspace_id>/<transaction_id>/<nome>
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
on conflict (id) do nothing;

create or replace function public.storage_workspace(p_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return split_part(p_name, '/', 1)::uuid;
exception when others then
  return null;
end;
$$;
grant execute on function public.storage_workspace(text) to authenticated;

create policy receipts_select on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and public.storage_workspace(name) in (select public.my_workspace_ids(1)));
create policy receipts_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and public.storage_workspace(name) in (select public.my_workspace_ids(2)));
create policy receipts_delete on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and public.storage_workspace(name) in (select public.my_workspace_ids(2)));

-- pg_cron é opcional (habilite em Database → Extensions). Quando presente,
-- agenda geração de recorrências e limpeza de registros técnicos.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
      perform cron.schedule('finance-generate-recurrences', '15 3 * * *', 'select public.generate_all_recurrences()');
      perform cron.schedule('finance-purge', '45 3 * * 0', 'select public.purge_old_records()');
    exception when others then
      raise notice 'pg_cron indisponível: %', sqlerrm;
    end;
  end if;
end;
$$;


-- >>>>>>>>>> 20261016000900_brand_finance_mv.sql
-- =============================================================================
-- Finance MV — 0900 Nome definitivo do aplicativo
-- Só troca o nome se ele ainda for o provisório (não sobrescreve um nome que o
-- proprietário já tenha definido pelo painel de Administração).
-- =============================================================================
alter table public.app_settings alter column app_name set default 'Finance MV';
update public.app_settings set app_name = 'Finance MV' where id = 1 and app_name = 'FINANCE OS';
