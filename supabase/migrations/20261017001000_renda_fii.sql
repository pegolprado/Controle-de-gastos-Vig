-- =============================================================================
-- Renda FII: carteira de fundos imobiliários e proventos anunciados na B3.
--
-- Os proventos vêm da consulta pública de fundos listados da B3
-- (sistemaswebb3-listados.b3.com.br). O navegador não pode consultá-la direto
-- (sem CORS), então o próprio banco busca com a extensão http, guarda em cache
-- por 6 horas e serve a todos os usuários. Dados de mercado são públicos; a
-- carteira (código e quantidade) fica no espaço, protegida por RLS.
-- =============================================================================

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'http') then
    create schema if not exists extensions;
    create extension if not exists http with schema extensions;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Carteira
-- ---------------------------------------------------------------------------
create table public.fii_positions (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  ticker          text not null check (ticker ~ '^[A-Z][A-Z0-9]{3}1[1-5]$'),
  quantity        integer not null check (quantity > 0 and quantity <= 100000000),
  avg_price_cents bigint check (avg_price_cents is null or (avg_price_cents > 0 and avg_price_cents <= 100000000000)),
  created_by      uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (workspace_id, ticker)
);
create index fii_positions_ws_idx on public.fii_positions (workspace_id);
create trigger fii_positions_updated_at before update on public.fii_positions
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- Dados de mercado (cache compartilhado da B3)
-- ---------------------------------------------------------------------------
create table public.fii_funds (
  code          text primary key check (code ~ '^[A-Z][A-Z0-9]{3}$'),
  name          text,
  administrator text,
  not_found     boolean not null default false,
  synced_at     timestamptz not null default now()
);

create table public.fii_distributions (
  code         text not null references public.fii_funds (code) on delete cascade,
  isin         text not null,
  kind         text not null,                 -- RENDIMENTO, AMORTIZAÇÃO…
  record_date  date,                          -- data com (último dia com direito)
  payment_date date not null,
  approved_on  date,
  rate         numeric(20, 11) not null check (rate >= 0),  -- R$ por cota
  related_to   text,
  primary key (code, isin, kind, payment_date)
);
create index fii_distributions_payment_idx on public.fii_distributions (code, payment_date desc);

-- "HSML11" → "HSML" (a B3 identifica o fundo pelos 4 primeiros caracteres)
create or replace function public.fii_base_code(p_ticker text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when upper(btrim(p_ticker)) ~ '^[A-Z][A-Z0-9]{3}(1[1-5])?$' then left(upper(btrim(p_ticker)), 4) end;
$$;

create or replace function public.fii_parse_date(p text)
returns date
language sql
immutable
set search_path = ''
as $$
  select case when p ~ '^\d{2}/\d{2}/\d{4}$' and substr(p, 7, 4)::int between 1990 and 2200
              then to_date(p, 'DD/MM/YYYY') end;
$$;

/** Grava a resposta da B3 para um fundo (substitui o histórico anterior). */
create or replace function public.fii_ingest(p_code text, p_payload jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := public.fii_base_code(p_code);
begin
  if v_code is null then
    raise exception 'Código de fundo inválido.' using errcode = '22023';
  end if;
  if p_payload is null or coalesce(p_payload ->> 'fund', '') in ('', 'ISIN GENERIC') then
    insert into public.fii_funds as f (code, not_found, synced_at) values (v_code, true, now())
    on conflict (code) do update set not_found = true, synced_at = now();
    delete from public.fii_distributions where code = v_code;
    return 'not_found';
  end if;

  insert into public.fii_funds as f (code, name, administrator, not_found, synced_at)
  values (v_code, nullif(btrim(p_payload ->> 'fund'), ''), nullif(btrim(p_payload ->> 'ifd'), ''), false, now())
  on conflict (code) do update set name = excluded.name, administrator = excluded.administrator, not_found = false, synced_at = now();

  delete from public.fii_distributions where code = v_code;
  insert into public.fii_distributions (code, isin, kind, record_date, payment_date, approved_on, rate, related_to)
  select v_code,
         d ->> 'isinCode',
         upper(coalesce(nullif(btrim(d ->> 'label'), ''), 'RENDIMENTO')),
         public.fii_parse_date(d ->> 'lastDatePrior'),
         public.fii_parse_date(d ->> 'paymentDate'),
         public.fii_parse_date(d ->> 'approvedOn'),
         replace(replace(d ->> 'rate', '.', ''), ',', '.')::numeric,
         left(nullif(btrim(d ->> 'relatedTo'), ''), 60)
  from jsonb_array_elements(coalesce(p_payload -> 'cashDividends', '[]'::jsonb)) d
  -- só cotas do fundo (ISIN "BR????CTF…"); recibos de subscrição têm outro ISIN
  where d ->> 'isinCode' ~ '^BR[A-Z0-9]{4}CTF'
    and public.fii_parse_date(d ->> 'paymentDate') is not null
    and (d ->> 'rate') ~ '^[0-9.]+(,[0-9]+)?$'
  on conflict do nothing;
  return 'ok';
end;
$$;

/**
 * Atualiza os proventos de um fundo a partir da B3 (no máximo a cada 6 horas;
 * p_force reduz para 30 minutos). Devolve: ok, cached, not_found ou unavailable.
 */
create or replace function public.fii_sync(p_ticker text, p_force boolean default false)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := public.fii_base_code(p_ticker);
  v_fund public.fii_funds;
  v_url text;
  v_status integer;
  v_content text;
begin
  if auth.uid() is null then
    raise exception 'Sessão expirada.' using errcode = '42501';
  end if;
  if v_code is null then
    raise exception 'Código inválido. Use o formato da B3, por exemplo HGLG11.' using errcode = '22023';
  end if;

  select * into v_fund from public.fii_funds where code = v_code;
  if found and v_fund.synced_at > now() - (case when p_force then interval '30 minutes' else interval '6 hours' end) then
    return case when v_fund.not_found then 'not_found' else 'cached' end;
  end if;

  perform public.enforce_rate_limit('fii_sync', 200, 3600);
  if not exists (select 1 from pg_extension where extname = 'http') then
    return 'unavailable';
  end if;

  v_url := 'https://sistemaswebb3-listados.b3.com.br/fundsProxy/fundsCall/GetListedSupplementFunds/'
    || replace(encode(convert_to(jsonb_build_object('cnpj', '0', 'identifierFund', v_code, 'typeFund', 7)::text, 'UTF8'), 'base64'), E'\n', '');
  begin
    -- a B3 responde em menos de 1 s; não deixar a sessão presa se ela travar
    execute $q$select extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '6000')$q$;
    execute $q$
      select r.status, r.content
      from extensions.http((
        'GET', $1, array[extensions.http_header('User-Agent', 'Mozilla/5.0 (FinanceMV)')], null, null
      )::extensions.http_request) r
    $q$ into v_status, v_content using v_url;
  exception when others then
    return 'unavailable';
  end;
  if v_status is distinct from 200 or v_content is null or left(btrim(v_content), 1) <> '{' then
    return 'unavailable';
  end if;
  return public.fii_ingest(v_code, v_content::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Segurança
-- ---------------------------------------------------------------------------
alter table public.fii_positions enable row level security;
alter table public.fii_funds enable row level security;
alter table public.fii_distributions enable row level security;

create policy fii_positions_select on public.fii_positions for select to authenticated
  using (workspace_id in (select public.my_workspace_ids(1)));
create policy fii_positions_insert on public.fii_positions for insert to authenticated
  with check (workspace_id in (select public.my_workspace_ids(3)));
create policy fii_positions_update on public.fii_positions for update to authenticated
  using (workspace_id in (select public.my_workspace_ids(3)))
  with check (workspace_id in (select public.my_workspace_ids(3)));
create policy fii_positions_delete on public.fii_positions for delete to authenticated
  using (workspace_id in (select public.my_workspace_ids(3)));

create policy fii_funds_select on public.fii_funds for select to authenticated using (true);
create policy fii_distributions_select on public.fii_distributions for select to authenticated using (true);

revoke all on public.fii_positions, public.fii_funds, public.fii_distributions from anon, authenticated;
grant select, insert, update, delete on public.fii_positions to authenticated;
grant select on public.fii_funds, public.fii_distributions to authenticated;
grant all on public.fii_positions, public.fii_funds, public.fii_distributions to service_role;

revoke execute on function public.fii_ingest(text, jsonb), public.fii_sync(text, boolean),
  public.fii_base_code(text), public.fii_parse_date(text) from public, anon;
revoke execute on function public.fii_ingest(text, jsonb) from authenticated;
grant execute on function public.fii_sync(text, boolean), public.fii_base_code(text), public.fii_parse_date(text) to authenticated;
grant execute on all functions in schema public to service_role;
