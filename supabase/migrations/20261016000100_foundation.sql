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
