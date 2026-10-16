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
