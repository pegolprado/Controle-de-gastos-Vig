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
  created_by            uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
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
