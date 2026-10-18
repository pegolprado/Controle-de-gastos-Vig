-- =============================================================================
-- Renda (FII + ações): compras com data, cotações, metas, piloto automático e
-- avisos no celular (Web Push).
--
-- - fii_positions passa a aceitar ações (asset_type) e a quantidade vem das
--   compras/vendas em fii_trades (a data define quem tinha direito na data com).
-- - Proventos de ações e cotações vêm das consultas públicas da B3, buscadas
--   pelo próprio banco (extensão http), como os de FII.
-- - Piloto automático: lança os proventos anunciados como receita e marca como
--   recebidos no dia do pagamento.
-- - Push: o job diário (GitHub Actions, com a chave de serviço) lê os avisos do
--   dia em push_digest() e envia com as chaves VAPID guardadas aqui.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Utilitários
-- ---------------------------------------------------------------------------

-- Data de hoje no fuso de Brasília (o servidor trabalha em UTC)
create or replace function public.today_br()
returns date
language sql
stable
set search_path = ''
as $$ select (now() at time zone 'America/Sao_Paulo')::date; $$;

/**
 * UUID determinístico idêntico ao stableUUID() do app (SHA-256, formato v5):
 * o mesmo provento lançado pelo app ou pelo piloto automático gera a mesma chave.
 */
create or replace function public.stable_uuid(p_seed text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
declare
  h bytea := substring(sha256(convert_to(p_seed, 'UTF8')) from 1 for 16);
begin
  h := set_byte(h, 6, (get_byte(h, 6) & 15) | 80);
  h := set_byte(h, 8, (get_byte(h, 8) & 63) | 128);
  return encode(h, 'hex')::uuid;
end;
$$;

-- GET na B3 com tempo limite; devolve null se falhar (sem extensão http, fora do ar…)
create or replace function public.renda_http_get(p_url text)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_status integer;
  v_content text;
begin
  if not exists (select 1 from pg_extension where extname = 'http') then
    return null;
  end if;
  begin
    execute $q$select extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '6000')$q$;
    execute $q$
      select r.status, r.content
      from extensions.http((
        'GET', $1, array[extensions.http_header('User-Agent', 'Mozilla/5.0 (FinanceMV)')], null, null
      )::extensions.http_request) r
    $q$ into v_status, v_content using p_url;
  exception when others then
    return null;
  end;
  if v_status is distinct from 200 then
    return null;
  end if;
  return v_content;
end;
$$;

create or replace function public.b3_payload_url(p_base text, p_payload jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select p_base || replace(encode(convert_to(p_payload::text, 'UTF8'), 'base64'), E'\n', '');
$$;

-- ---------------------------------------------------------------------------
-- Carteira: ações e compras com data
-- ---------------------------------------------------------------------------
alter table public.fii_positions add column asset_type text not null default 'fii' check (asset_type in ('fii', 'stock'));
alter table public.fii_positions drop constraint fii_positions_ticker_check;
alter table public.fii_positions add constraint fii_positions_ticker_check check (
  (asset_type = 'fii' and ticker ~ '^[A-Z][A-Z0-9]{3}1[1-5]$')
  or (asset_type = 'stock' and ticker ~ '^[A-Z][A-Z0-9]{3}([3-8]|11)$')
);
alter table public.fii_positions drop constraint fii_positions_quantity_check;
alter table public.fii_positions add constraint fii_positions_quantity_check check (quantity >= 0 and quantity <= 100000000);

create table public.fii_trades (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  position_id  uuid not null references public.fii_positions (id) on delete cascade,
  -- null = "já tinha antes" (vale para qualquer data com)
  trade_date   date check (trade_date between date '1990-01-01' and date '2200-12-31'),
  quantity     integer not null check (quantity <> 0 and abs(quantity) <= 100000000),  -- negativa = venda
  price_cents  bigint check (price_cents is null or (price_cents > 0 and price_cents <= 100000000000)),
  created_by   uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now()
);
create index fii_trades_position_idx on public.fii_trades (position_id, trade_date);

-- quantidade atual e preço médio (compras com preço) sempre derivados das operações
create or replace function public.tg_fii_trades_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pos uuid := coalesce(new.position_id, old.position_id);
  v_qty bigint;
  v_avg bigint;
begin
  select coalesce(sum(quantity), 0),
         case when sum(quantity) filter (where quantity > 0 and price_cents is not null) > 0
              then round(sum(quantity::numeric * price_cents) filter (where quantity > 0 and price_cents is not null)
                         / sum(quantity) filter (where quantity > 0 and price_cents is not null)) end
    into v_qty, v_avg
  from public.fii_trades where position_id = v_pos;
  if v_qty < 0 then
    raise exception 'A venda deixa a quantidade negativa.' using errcode = '22023';
  end if;
  update public.fii_positions
     set quantity = v_qty, avg_price_cents = coalesce(v_avg, avg_price_cents)
   where id = v_pos;
  return null;
end;
$$;
create trigger fii_trades_sync after insert or update or delete on public.fii_trades
  for each row execute function public.tg_fii_trades_sync();

-- operação deve ser do mesmo espaço da posição
create or replace function public.tg_fii_trades_check()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.fii_positions p where p.id = new.position_id and p.workspace_id = new.workspace_id) then
    raise exception 'Operação de outra carteira.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger fii_trades_check before insert or update on public.fii_trades
  for each row execute function public.tg_fii_trades_check();

-- posições existentes viram uma operação "já tinha antes"
insert into public.fii_trades (workspace_id, position_id, trade_date, quantity, price_cents, created_by)
select workspace_id, id, null, quantity, avg_price_cents, created_by from public.fii_positions where quantity > 0;

-- cotas com direito ao provento: operações até a data com (inclusive)
create or replace function public.renda_qty_at(p_position uuid, p_date date)
returns bigint
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(quantity), 0) from public.fii_trades
  where position_id = p_position and (trade_date is null or p_date is null or trade_date <= p_date);
$$;

-- ---------------------------------------------------------------------------
-- Dados de mercado: proventos de ações e cotações
-- ---------------------------------------------------------------------------
create table public.stock_companies (
  code       text primary key check (code ~ '^[A-Z][A-Z0-9]{3}$'),
  name       text,
  not_found  boolean not null default false,
  synced_at  timestamptz not null default now()
);

create table public.stock_distributions (
  id           bigint generated always as identity primary key,
  code         text not null references public.stock_companies (code) on delete cascade,
  isin         text not null,
  kind         text not null,                -- DIVIDENDO, JRS CAP PROPRIO, RENDIMENTO…
  record_date  date,
  payment_date date,                         -- null = a definir
  approved_on  date,
  rate         numeric(20, 11) not null check (rate >= 0),
  related_to   text
);
create index stock_distributions_code_idx on public.stock_distributions (code, payment_date desc);

create table public.asset_quotes (
  ticker     text primary key check (ticker ~ '^[A-Z][A-Z0-9]{3}[0-9]{1,2}$'),
  price      numeric(14, 4) not null check (price > 0),
  change_pct numeric(10, 4),
  synced_at  timestamptz not null default now()
);

-- PETR4 ↔ BRPETRACNPR6 (PN); PETR3 ↔ ACNOR (ON); TAEE11 ↔ CDAM (unit)
create or replace function public.stock_isin_matches(p_ticker text, p_isin text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case regexp_replace(p_ticker, '^[A-Z][A-Z0-9]{3}', '')
    when '3' then substr(p_isin, 7, 5) = 'ACNOR'
    when '4' then substr(p_isin, 7, 5) = 'ACNPR'
    when '5' then substr(p_isin, 7, 5) = 'ACNPA'
    when '6' then substr(p_isin, 7, 5) = 'ACNPB'
    when '7' then substr(p_isin, 7, 5) = 'ACNPC'
    when '8' then substr(p_isin, 7, 5) = 'ACNPD'
    when '11' then substr(p_isin, 7, 4) = 'CDAM'
    else false end;
$$;

create or replace function public.stock_ingest(p_code text, p_payload jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := public.fii_base_code(left(upper(btrim(p_code)), 4));
  v_company jsonb := case when jsonb_typeof(p_payload) = 'array' then p_payload -> 0 else p_payload end;
begin
  if v_code is null then
    raise exception 'Código inválido.' using errcode = '22023';
  end if;
  if v_company is null or coalesce(btrim(v_company ->> 'tradingName'), '') = '' then
    insert into public.stock_companies as c (code, not_found, synced_at) values (v_code, true, now())
    on conflict (code) do update set not_found = true, synced_at = now();
    delete from public.stock_distributions where code = v_code;
    return 'not_found';
  end if;
  insert into public.stock_companies as c (code, name, not_found, synced_at)
  values (v_code, btrim(v_company ->> 'tradingName'), false, now())
  on conflict (code) do update set name = excluded.name, not_found = false, synced_at = now();

  delete from public.stock_distributions where code = v_code;
  insert into public.stock_distributions (code, isin, kind, record_date, payment_date, approved_on, rate, related_to)
  select v_code,
         d ->> 'isinCode',
         upper(coalesce(nullif(btrim(d ->> 'label'), ''), 'DIVIDENDO')),
         public.fii_parse_date(d ->> 'lastDatePrior'),
         public.fii_parse_date(d ->> 'paymentDate'),
         public.fii_parse_date(d ->> 'approvedOn'),
         replace(replace(d ->> 'rate', '.', ''), ',', '.')::numeric,
         left(nullif(btrim(d ->> 'relatedTo'), ''), 60)
  from jsonb_array_elements(coalesce(v_company -> 'cashDividends', '[]'::jsonb)) d
  where (d ->> 'rate') ~ '^[0-9.]+(,[0-9]+)?$'
    and coalesce(d ->> 'isinCode', '') ~ '^BR[A-Z0-9]{10}$'
    -- só o que importa para a carteira: últimos ~2 anos e o que está por vir
    and coalesce(public.fii_parse_date(d ->> 'paymentDate'), public.fii_parse_date(d ->> 'lastDatePrior'), current_date) >= current_date - 800;
  return 'ok';
end;
$$;

create or replace function public.quote_ingest(p_ticker text, p_payload jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  q jsonb := p_payload #> '{Trad,0,scty,SctyQtn}';
  v_price numeric;
begin
  v_price := nullif(q ->> 'curPrc', '')::numeric;
  if v_price is null or v_price <= 0 then
    return false;
  end if;
  insert into public.asset_quotes as a (ticker, price, change_pct, synced_at)
  values (upper(p_ticker), v_price, nullif(q ->> 'prcFlcn', '')::numeric, now())
  on conflict (ticker) do update set price = excluded.price, change_pct = excluded.change_pct, synced_at = now();
  return true;
exception when others then
  return false;
end;
$$;

/** Núcleo da atualização (sem checagem de sessão; uso interno). */
create or replace function public.asset_sync_core(p_ticker text, p_type text, p_force boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticker text := upper(btrim(p_ticker));
  v_code text := public.fii_base_code(left(upper(btrim(p_ticker)), 4));
  v_result text;
  v_body text;
  v_synced timestamptz;
  v_missing boolean;
begin
  if v_code is null or p_type not in ('fii', 'stock') then
    raise exception 'Código inválido. Use o formato da B3, por exemplo HGLG11 ou PETR4.' using errcode = '22023';
  end if;

  -- proventos (cache de 6 h; 30 min quando forçado)
  if p_type = 'fii' then
    select synced_at, not_found into v_synced, v_missing from public.fii_funds where code = v_code;
  else
    select synced_at, not_found into v_synced, v_missing from public.stock_companies where code = v_code;
  end if;
  if v_synced is not null and v_synced > now() - (case when p_force then interval '30 minutes' else interval '6 hours' end) then
    v_result := case when v_missing then 'not_found' else 'cached' end;
  else
    if p_type = 'fii' then
      v_body := public.renda_http_get(public.b3_payload_url(
        'https://sistemaswebb3-listados.b3.com.br/fundsProxy/fundsCall/GetListedSupplementFunds/',
        jsonb_build_object('cnpj', '0', 'identifierFund', v_code, 'typeFund', 7)));
    else
      v_body := public.renda_http_get(public.b3_payload_url(
        'https://sistemaswebb3-listados.b3.com.br/listedCompaniesProxy/CompanyCall/GetListedSupplementCompany/',
        jsonb_build_object('issuingCompany', v_code, 'language', 'pt-br')));
    end if;
    if v_body is null or left(btrim(v_body), 1) not in ('{', '[') then
      v_result := 'unavailable';
    elsif p_type = 'fii' then
      v_result := public.fii_ingest(v_code, v_body::jsonb);
    else
      v_result := public.stock_ingest(v_code, v_body::jsonb);
    end if;
  end if;

  -- cotação (cache de 20 min)
  if v_result <> 'not_found' and not exists (
    select 1 from public.asset_quotes where ticker = v_ticker and synced_at > now() - interval '20 minutes'
  ) then
    v_body := public.renda_http_get('https://cotacao.b3.com.br/mds/api/v1/instrumentQuotation/' || v_ticker);
    if v_body is not null and left(btrim(v_body), 1) = '{' then
      perform public.quote_ingest(v_ticker, v_body::jsonb);
    end if;
  end if;
  return v_result;
end;
$$;

/** Atualiza proventos e cotação de um ativo (usuário logado). ok | cached | not_found | unavailable */
create or replace function public.asset_sync(p_ticker text, p_type text default 'fii', p_force boolean default false)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sessão expirada.' using errcode = '42501';
  end if;
  perform public.enforce_rate_limit('asset_sync', 300, 3600);
  return public.asset_sync_core(p_ticker, p_type, p_force);
end;
$$;

-- ---------------------------------------------------------------------------
-- Configurações da renda por espaço (conta, piloto automático, meta)
-- ---------------------------------------------------------------------------
create table public.renda_settings (
  workspace_id     uuid primary key references public.workspaces (id) on delete cascade,
  account_id       uuid references public.accounts (id) on delete set null,
  auto_launch      boolean not null default false,
  auto_since       date,                       -- só lança proventos pagos a partir desta data
  income_goal_cents bigint check (income_goal_cents is null or (income_goal_cents > 0 and income_goal_cents <= 100000000000)),
  updated_at       timestamptz not null default now()
);
create trigger renda_settings_updated_at before update on public.renda_settings
  for each row execute function public.tg_set_updated_at();

-- ao ligar o piloto, começa a valer do mês atual (não refaz o histórico)
create or replace function public.tg_renda_settings_since()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.auto_launch and (tg_op = 'INSERT' or not old.auto_launch or new.auto_since is null) then
    new.auto_since := coalesce(new.auto_since, date_trunc('month', public.today_br())::date);
  end if;
  if new.account_id is not null and not exists (
    select 1 from public.accounts a where a.id = new.account_id and a.workspace_id = new.workspace_id
  ) then
    raise exception 'Conta de outro espaço.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger renda_settings_since before insert or update on public.renda_settings
  for each row execute function public.tg_renda_settings_since();

-- ---------------------------------------------------------------------------
-- Eventos de renda (proventos de cada posição, com a quantidade com direito)
-- ---------------------------------------------------------------------------
create or replace function public.renda_events(p_workspace uuid, p_from date, p_to date)
returns table (
  position_id uuid, ticker text, asset_type text, isin text, kind text,
  record_date date, payment_date date, rate numeric, quantity bigint, amount_cents bigint
)
language sql
stable
set search_path = ''
as $$
  with ev as (
    select p.id, p.ticker, p.asset_type, d.isin, d.kind, d.record_date, d.payment_date, d.rate
    from public.fii_positions p
    join public.fii_distributions d on p.asset_type = 'fii' and d.code = left(p.ticker, 4)
    where p.workspace_id = p_workspace
    union all
    select p.id, p.ticker, p.asset_type, d.isin, d.kind, d.record_date, d.payment_date, d.rate
    from public.fii_positions p
    join public.stock_distributions d on p.asset_type = 'stock' and d.code = left(p.ticker, 4)
      and public.stock_isin_matches(p.ticker, d.isin)
    where p.workspace_id = p_workspace and d.payment_date is not null
  )
  select ev.id, ev.ticker, ev.asset_type, ev.isin, ev.kind, ev.record_date, ev.payment_date, ev.rate, q.qty,
         -- JCP tem 15% de IR retido na fonte: valor líquido
         floor(round(q.qty * ev.rate * 100 * (case when ev.kind like 'JRS%' then 0.85 else 1 end), 4))::bigint
  from ev
  cross join lateral (select public.renda_qty_at(ev.id, ev.record_date) as qty) q
  where ev.payment_date between p_from and p_to and q.qty > 0;
$$;

-- ---------------------------------------------------------------------------
-- Piloto automático
-- ---------------------------------------------------------------------------
create or replace function public.renda_autopilot_core(p_workspace uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.renda_settings;
  v_today date := public.today_br();
  v_cat uuid;
  v_count integer := 0;
  v_rows integer;
  e record;
  t record;
begin
  select * into s from public.renda_settings where workspace_id = p_workspace;
  if s.workspace_id is null or not s.auto_launch or s.account_id is null then
    return 0;
  end if;
  select c.id into v_cat from public.categories c
  where c.workspace_id = p_workspace and c.kind = 'income' and not c.archived and c.name ~* '(dividendo|rendimento)'
  order by c.parent_id nulls last limit 1;
  if v_cat is null then
    select c.id into v_cat from public.categories c
    where c.workspace_id = p_workspace and c.kind = 'income' and not c.archived and c.name ~* 'invest' limit 1;
  end if;

  perform set_config('finance.system_insert', 'on', true);
  -- 1) proventos anunciados viram receitas (a receber; já recebidas se a data passou)
  for e in select * from public.renda_events(p_workspace, greatest(coalesce(s.auto_since, v_today), v_today - 40), v_today + 120) loop
    if e.amount_cents <= 0 then continue; end if;
    insert into public.transactions (workspace_id, kind, status, description, amount_cents, occurred_on, due_on,
                                     category_id, account_id, tags, notes, client_request_id, created_by)
    values (p_workspace, 'income', 'pending',
            case when e.kind like 'JRS%' then 'JCP ' when e.asset_type = 'stock' then 'Dividendo ' else 'Rendimento ' end || e.ticker,
            e.amount_cents, e.payment_date, e.payment_date, v_cat, s.account_id,
            array[case when e.asset_type = 'fii' then 'fii' else 'acoes' end, 'auto'],
            e.quantity || ' × R$ ' || to_char(e.rate, 'FM999999990.00######') ||
              coalesce(' · data com ' || to_char(e.record_date, 'DD/MM/YYYY'), '') ||
              case when e.kind like 'JRS%' then ' · líquido de 15% de IR' else '' end,
            public.stable_uuid('finance-mv-fii|' || p_workspace || '|' || e.ticker || '|' || e.isin || '|' || e.kind || '|' || e.payment_date),
            null)
    on conflict (workspace_id, client_request_id) do nothing;
    get diagnostics v_rows = row_count;
    v_count := v_count + v_rows;
  end loop;

  -- 2) no dia do pagamento, marca como recebido (inclusive os lançados à mão pela Renda)
  for t in
    select tx.id, tx.amount_cents, tx.settled_principal_cents, tx.due_on
    from public.transactions tx
    where tx.workspace_id = p_workspace and tx.kind = 'income' and tx.status in ('pending', 'planned')
      and tx.tags && array['fii', 'acoes'] and tx.account_id is not null
      and tx.due_on <= v_today and tx.due_on >= v_today - 60
  loop
    insert into public.tx_settlements (transaction_id, workspace_id, principal_cents, paid_on, notes, created_by)
    values (t.id, p_workspace, t.amount_cents - t.settled_principal_cents, t.due_on, 'Recebido automaticamente (Renda)', null);
    update public.transactions set updated_at = now() where id = t.id;
    v_count := v_count + 1;
  end loop;
  perform set_config('finance.system_insert', 'off', true);
  return v_count;
end;
$$;

/** Piloto automático de um espaço (chamado pelo app ao abrir). */
create or replace function public.renda_autopilot(p_workspace uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_rank(p_workspace, 2);
  return public.renda_autopilot_core(p_workspace);
end;
$$;

-- ---------------------------------------------------------------------------
-- Avisos no celular (Web Push)
-- ---------------------------------------------------------------------------
alter table public.app_settings add column vapid_public_key text check (vapid_public_key ~ '^[A-Za-z0-9_-]{80,100}$');

create table public.push_keys (
  id          smallint primary key default 1 check (id = 1),
  public_key  text not null,
  private_key text not null,
  created_at  timestamptz not null default now()
);

create table public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  endpoint   text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  p256dh     text not null check (char_length(p256dh) <= 200),
  auth       text not null check (char_length(auth) <= 100),
  user_agent text check (char_length(user_agent) <= 300),
  failures   integer not null default 0,
  created_at timestamptz not null default now(),
  last_ok_at timestamptz
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

create table public.push_log (
  user_id uuid not null references public.profiles (id) on delete cascade,
  ref_key text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, ref_key)
);

alter table public.user_preferences add column renda_alerts boolean not null default true;

/** Registra (ou transfere para o usuário atual) a inscrição deste aparelho. */
create or replace function public.push_register(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sessão expirada.' using errcode = '42501';
  end if;
  perform public.enforce_rate_limit('push_register', 30, 3600);
  insert into public.push_subscriptions as s (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, failures = 0;
end;
$$;

create or replace function public.push_unregister(p_endpoint text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;

/** Guarda as chaves VAPID geradas pelo job (uma única vez). */
create or replace function public.push_set_keys(p_public text, p_private text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.push_keys (id, public_key, private_key) values (1, p_public, p_private)
  on conflict (id) do nothing;
  update public.app_settings set vapid_public_key = (select public_key from public.push_keys where id = 1) where id = 1;
end;
$$;

create or replace function public.push_get_keys()
returns table (public_key text, private_key text)
language sql
security definer
set search_path = ''
as $$ select public_key, private_key from public.push_keys where id = 1; $$;

/**
 * Avisos de hoje e amanhã para cada usuário com aparelho inscrito.
 * Cada aviso sai uma única vez (push_log). Devolve uma linha por aparelho.
 */
create or replace function public.push_digest()
returns table (endpoint text, p256dh text, auth text, title text, body text, url text, tag text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := public.today_br();
begin
  create temp table if not exists push_msgs (user_id uuid, ref_key text, title text, body text, url text, ord int) on commit drop;
  truncate push_msgs;

  -- contas a pagar e a receber (exceto proventos, que têm aviso próprio)
  insert into push_msgs
  select m.user_id,
         'tx:' || tx.id || ':' || tx.due_on,
         case when tx.kind = 'income' then (case when tx.due_on = v_today then 'A receber hoje: ' else 'A receber amanhã: ' end)
              else (case when tx.due_on = v_today then 'Vence hoje: ' else 'Vence amanhã: ' end) end || tx.description,
         'R$ ' || to_char((tx.amount_cents - tx.settled_principal_cents) / 100.0, 'FM999G999G990D00') || ' · ' || w.name,
         '/compromissos', 1
  from public.transactions tx
  join public.workspaces w on w.id = tx.workspace_id
  join public.workspace_members m on m.workspace_id = tx.workspace_id and (m.expires_at is null or m.expires_at > now())
  join public.profiles pr on pr.id = m.user_id and pr.status = 'active'
  left join public.user_preferences up on up.user_id = m.user_id
  where tx.status in ('planned', 'pending') and tx.due_on in (v_today, v_today + 1)
    and not (tx.tags && array['fii', 'acoes']) and coalesce(up.due_alerts, true)
    and exists (select 1 from public.push_subscriptions s where s.user_id = m.user_id);

  -- proventos que caem hoje ou amanhã
  insert into push_msgs
  select m.user_id,
         'renda:' || w.id || ':' || e.ticker || ':' || e.kind || ':' || e.payment_date,
         e.ticker || case when e.payment_date = v_today then ' paga hoje: ' else ' paga amanhã: ' end
           || 'R$ ' || to_char(e.amount_cents / 100.0, 'FM999G999G990D00'),
         initcap(lower(case when e.kind like 'JRS%' then 'JCP (líquido)' else e.kind end)) || ' · ' || e.quantity || ' cotas × R$ '
           || to_char(e.rate, 'FM999990D00####') || ' · ' || w.name,
         '/renda-fii', 2
  from public.workspaces w
  join public.workspace_members m on m.workspace_id = w.id and (m.expires_at is null or m.expires_at > now())
  join public.profiles pr on pr.id = m.user_id and pr.status = 'active'
  left join public.user_preferences up on up.user_id = m.user_id
  cross join lateral public.renda_events(w.id, v_today, v_today + 1) e
  where coalesce(up.renda_alerts, true)
    and exists (select 1 from public.push_subscriptions s where s.user_id = m.user_id)
    and exists (select 1 from public.fii_positions p where p.workspace_id = w.id);

  -- só o que ainda não foi enviado (no máximo 6 por usuário por execução)
  return query
  with fresh as (
    insert into public.push_log (user_id, ref_key)
    select x.user_id, x.ref_key from (
      select pm.*, row_number() over (partition by pm.user_id order by pm.ord, pm.ref_key) as rn
      from push_msgs pm
      where not exists (select 1 from public.push_log l where l.user_id = pm.user_id and l.ref_key = pm.ref_key)
    ) x where x.rn <= 6
    on conflict do nothing
    returning push_log.user_id, push_log.ref_key
  )
  select s.endpoint, s.p256dh, s.auth, pm.title, pm.body, pm.url, pm.ref_key
  from fresh f
  join push_msgs pm on pm.user_id = f.user_id and pm.ref_key = f.ref_key
  join public.push_subscriptions s on s.user_id = f.user_id;
end;
$$;

/** Resultado do envio: falhas definitivas (404/410) removem a inscrição. */
create or replace function public.push_report(p_endpoint text, p_ok boolean, p_gone boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_gone then
    delete from public.push_subscriptions where endpoint = p_endpoint;
  elsif p_ok then
    update public.push_subscriptions set last_ok_at = now(), failures = 0 where endpoint = p_endpoint;
  else
    update public.push_subscriptions set failures = failures + 1 where endpoint = p_endpoint;
    delete from public.push_subscriptions where endpoint = p_endpoint and failures >= 10;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Rotina diária (job): atualiza todos os ativos e roda o piloto de todos os espaços
-- ---------------------------------------------------------------------------
create or replace function public.renda_all_assets()
returns table (ticker text, asset_type text)
language sql
security definer
set search_path = ''
as $$ select distinct ticker, asset_type from public.fii_positions where quantity > 0 order by 1; $$;

create or replace function public.renda_job_sync(p_ticker text, p_type text)
returns text
language sql
security definer
set search_path = ''
as $$ select public.asset_sync_core(p_ticker, p_type, false); $$;

create or replace function public.renda_autopilot_all()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  w uuid;
  v_total integer := 0;
begin
  for w in select workspace_id from public.renda_settings where auto_launch and account_id is not null loop
    begin
      v_total := v_total + public.renda_autopilot_core(w);
    exception when others then
      raise warning 'piloto automático falhou no espaço %: %', w, sqlerrm;
    end;
  end loop;
  -- limpeza do histórico de avisos
  delete from public.push_log where sent_at < now() - interval '60 days';
  return v_total;
end;
$$;

-- ---------------------------------------------------------------------------
-- Segurança
-- ---------------------------------------------------------------------------
alter table public.fii_trades enable row level security;
alter table public.stock_companies enable row level security;
alter table public.stock_distributions enable row level security;
alter table public.asset_quotes enable row level security;
alter table public.renda_settings enable row level security;
alter table public.push_keys enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.push_log enable row level security;

create policy fii_trades_select on public.fii_trades for select to authenticated
  using (workspace_id in (select public.my_workspace_ids(1)));
create policy fii_trades_insert on public.fii_trades for insert to authenticated
  with check (workspace_id in (select public.my_workspace_ids(3)));
create policy fii_trades_update on public.fii_trades for update to authenticated
  using (workspace_id in (select public.my_workspace_ids(3)))
  with check (workspace_id in (select public.my_workspace_ids(3)));
create policy fii_trades_delete on public.fii_trades for delete to authenticated
  using (workspace_id in (select public.my_workspace_ids(3)));

create policy renda_settings_select on public.renda_settings for select to authenticated
  using (workspace_id in (select public.my_workspace_ids(1)));
create policy renda_settings_insert on public.renda_settings for insert to authenticated
  with check (workspace_id in (select public.my_workspace_ids(3)));
create policy renda_settings_update on public.renda_settings for update to authenticated
  using (workspace_id in (select public.my_workspace_ids(3)))
  with check (workspace_id in (select public.my_workspace_ids(3)));

create policy stock_companies_select on public.stock_companies for select to authenticated using (true);
create policy stock_distributions_select on public.stock_distributions for select to authenticated using (true);
create policy asset_quotes_select on public.asset_quotes for select to authenticated using (true);
create policy push_subscriptions_select on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
-- push_keys e push_log: nenhuma policy (só funções do servidor)

revoke all on public.fii_trades, public.stock_companies, public.stock_distributions, public.asset_quotes,
  public.renda_settings, public.push_keys, public.push_subscriptions, public.push_log from anon, authenticated;
grant select, insert, update, delete on public.fii_trades to authenticated;
grant select, insert, update on public.renda_settings to authenticated;
grant select on public.stock_companies, public.stock_distributions, public.asset_quotes, public.push_subscriptions to authenticated;
grant all on public.fii_trades, public.stock_companies, public.stock_distributions, public.asset_quotes,
  public.renda_settings, public.push_keys, public.push_subscriptions, public.push_log to service_role;
grant update (renda_alerts) on public.user_preferences to authenticated;

-- funções: o app chama só as de usuário; o job (service_role) chama as de rotina
revoke execute on function
  public.today_br(), public.stable_uuid(text), public.renda_http_get(text), public.b3_payload_url(text, jsonb),
  public.tg_fii_trades_sync(), public.tg_fii_trades_check(), public.renda_qty_at(uuid, date),
  public.stock_isin_matches(text, text), public.stock_ingest(text, jsonb), public.quote_ingest(text, jsonb),
  public.asset_sync_core(text, text, boolean), public.asset_sync(text, text, boolean),
  public.tg_renda_settings_since(), public.renda_events(uuid, date, date),
  public.renda_autopilot_core(uuid), public.renda_autopilot(uuid),
  public.push_register(text, text, text, text), public.push_unregister(text),
  public.push_set_keys(text, text), public.push_get_keys(), public.push_digest(), public.push_report(text, boolean, boolean),
  public.renda_all_assets(), public.renda_job_sync(text, text), public.renda_autopilot_all()
from public, anon, authenticated;

grant execute on function
  public.today_br(), public.stable_uuid(text), public.asset_sync(text, text, boolean), public.renda_autopilot(uuid),
  public.push_register(text, text, text, text), public.push_unregister(text)
to authenticated;

grant execute on function
  public.push_set_keys(text, text), public.push_get_keys(), public.push_digest(), public.push_report(text, boolean, boolean),
  public.renda_all_assets(), public.renda_job_sync(text, text), public.renda_autopilot_all()
to service_role;
