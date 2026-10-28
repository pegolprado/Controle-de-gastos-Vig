-- Plano de investimento da Renda: metas de divisão da carteira e oportunidades.
-- 1) renda_settings.plan guarda as metas (% por classe) e os valores fora do app (renda fixa, exterior).
-- 2) push_digest passa a avisar oportunidades da própria carteira: data com hoje/amanhã e cotação
--    5% ou mais abaixo do preço médio (no máximo uma vez por semana por ativo).

alter table public.renda_settings
  add column if not exists plan jsonb not null default '{}'::jsonb
  check (jsonb_typeof(plan) = 'object' and pg_column_size(plan) <= 4096);

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

  -- oportunidades da carteira (aba Plano): data com hoje/amanhã e cotação abaixo do preço médio
  insert into push_msgs
  select m.user_id,
         'opp:datacom:' || w.id || ':' || p.ticker || ':' || d.record_date,
         case when d.record_date = v_today then 'Último dia para garantir o rendimento de ' else 'Amanhã é a data com de ' end || p.ticker,
         'R$ ' || to_char(d.rate, 'FM999990D00####') || ' por cota' ||
           coalesce(', paga em ' || to_char(d.payment_date, 'DD/MM'), '') ||
           '. Quem tiver a cota no fim do dia da data com recebe. · ' || w.name,
         '/renda-fii?aba=plano', 3
  from public.fii_positions p
  join public.workspaces w on w.id = p.workspace_id
  join public.workspace_members m on m.workspace_id = w.id and (m.expires_at is null or m.expires_at > now())
  join public.profiles pr on pr.id = m.user_id and pr.status = 'active'
  left join public.user_preferences up on up.user_id = m.user_id
  join lateral (
    select fd.record_date, fd.payment_date, fd.rate from public.fii_distributions fd
    where p.asset_type = 'fii' and fd.code = public.fii_base_code(p.ticker)
      and fd.record_date in (v_today, v_today + 1) and fd.payment_date >= v_today
    union all
    select sd.record_date, sd.payment_date, sd.rate from public.stock_distributions sd
    where p.asset_type = 'stock' and sd.code = left(p.ticker, 4) and public.stock_isin_matches(p.ticker, sd.isin)
      and sd.record_date in (v_today, v_today + 1) and (sd.payment_date is null or sd.payment_date >= v_today)
  ) d on true
  where coalesce(up.renda_alerts, true)
    and exists (select 1 from public.push_subscriptions s where s.user_id = m.user_id);

  insert into push_msgs
  select m.user_id,
         'opp:pm:' || w.id || ':' || p.ticker || ':' || to_char(v_today, 'IYYY-IW'),
         p.ticker || ' está ' || round((1 - q.price * 100 / p.avg_price_cents) * 100)::int || '% abaixo do seu preço médio',
         'Cotação R$ ' || to_char(q.price, 'FM999G990D00') || ' · seu preço médio R$ ' || to_char(p.avg_price_cents / 100.0, 'FM999G990D00') ||
           '. Comprar agora baixa o seu preço médio. · ' || w.name,
         '/renda-fii?aba=plano', 4
  from public.fii_positions p
  join public.asset_quotes q on q.ticker = p.ticker and q.synced_at > now() - interval '3 days'
  join public.workspaces w on w.id = p.workspace_id
  join public.workspace_members m on m.workspace_id = w.id and (m.expires_at is null or m.expires_at > now())
  join public.profiles pr on pr.id = m.user_id and pr.status = 'active'
  left join public.user_preferences up on up.user_id = m.user_id
  where p.avg_price_cents is not null and q.price * 100 <= p.avg_price_cents * 0.95
    and coalesce(up.renda_alerts, true)
    and exists (select 1 from public.push_subscriptions s where s.user_id = m.user_id);

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

