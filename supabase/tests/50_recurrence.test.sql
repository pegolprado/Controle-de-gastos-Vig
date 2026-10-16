-- Recorrências: geração idempotente, âncora de fim de mês, pausa, edição futura
begin;
do $$
declare
  u uuid; ws uuid; acc uuid; card uuid; rec uuid; rec2 uuid; n int; t uuid;
begin
  perform tests.assert_eq(public.recurrence_date(date '2026-01-31', 'monthly', 1, 1), date '2026-02-28', '31/01 + 1 mês');
  perform tests.assert_eq(public.recurrence_date(date '2026-01-31', 'monthly', 1, 2), date '2026-03-31', 'sem deriva');
  perform tests.assert_eq(public.recurrence_date(date '2024-02-29', 'yearly', 1, 1), date '2025-02-28', 'bissexto');
  perform tests.assert_eq(public.recurrence_date(date '2026-01-01', 'weekly', 2, 3), date '2026-02-12', 'quinzenal');

  u := tests.create_user('rec@example.com');
  select id into ws from public.workspaces where owner_id = u;
  select id into acc from public.accounts where workspace_id = ws;
  perform tests.login(u);
  insert into public.credit_cards (workspace_id, name, closing_day, due_day) values (ws, 'C', 10, 20) returning id into card;

  insert into public.recurrences (workspace_id, kind, description, amount_cents, account_id, frequency, start_date)
  values (ws, 'expense', 'Aluguel', 150000, acc, 'monthly', current_date - 60) returning id into rec;
  n := public.generate_recurrences(ws, current_date + 30);
  perform tests.assert(n between 3 and 4, 'gera ocorrências passadas e próximas: ' || n);
  perform tests.assert_eq(public.generate_recurrences(ws, current_date + 30), 0, 'reprocessar não duplica');
  perform tests.assert_eq((select count(*)::int from public.transactions where recurrence_id = rec), n, 'contagem estável');
  perform tests.assert((select bool_and(status = 'pending' and due_on = occurred_on) from public.transactions where recurrence_id = rec), 'ocorrências pendentes');
  -- simulando corrida: reset do contador não duplica (unique recurrence_id+date)
  perform tests.logout();
  update public.recurrences set occurrences_generated = 0 where id = rec;
  perform tests.login(u);
  perform public.generate_recurrences(ws, current_date + 30);
  perform tests.assert_eq((select count(*)::int from public.transactions where recurrence_id = rec), n, 'idempotente mesmo com contador perdido');

  -- assinatura no cartão: só até hoje
  insert into public.recurrences (workspace_id, kind, description, amount_cents, card_id, frequency, start_date)
  values (ws, 'expense', 'Streaming', 3990, card, 'monthly', current_date) returning id into rec2;
  perform public.generate_recurrences(ws, current_date + 90);
  perform tests.assert_eq((select count(*)::int from public.transactions where recurrence_id = rec2), 1, 'cartão gera só até hoje');
  perform tests.assert((select invoice_id is not null from public.transactions where recurrence_id = rec2), 'assinatura entra na fatura');

  -- editar só esta ocorrência (destaca da série)
  select id into t from public.transactions where recurrence_id = rec order by recurrence_date desc limit 1;
  update public.transactions set amount_cents = 160000 where id = t;
  perform tests.assert((select recurrence_detached from public.transactions where id = t), 'ocorrência destacada');
  -- editar todas as futuras
  n := public.update_recurrence(rec, '{"amount_cents": 155000}'::jsonb, current_date - 400);
  perform tests.assert_eq((select amount_cents from public.transactions where id = t), 160000::bigint, 'destacada preservada');
  perform tests.assert((select bool_and(amount_cents = 155000) from public.transactions where recurrence_id = rec and id <> t and status = 'pending'), 'futuras atualizadas');
  perform tests.assert((select not bool_or(recurrence_detached) from public.transactions where recurrence_id = rec and id <> t), 'edição em massa não destaca');
  perform tests.assert_eq((select amount_cents from public.recurrences where id = rec), 155000::bigint, 'regra atualizada');

  -- pagas não são alteradas por edição em massa
  update public.transactions set status = 'paid' where recurrence_id = rec and id <> t and recurrence_date = (select min(recurrence_date) from public.transactions where recurrence_id = rec);
  perform public.update_recurrence(rec, '{"amount_cents": 99900}'::jsonb, current_date - 400);
  perform tests.assert_eq((select count(*)::int from public.transactions where recurrence_id = rec and status = 'paid' and amount_cents = 155000), 1, 'paga preservada');

  -- pausar, retomar sem retroativos, cancelar removendo futuras
  perform public.set_recurrence_status(rec, 'paused');
  perform tests.assert_eq(public.generate_recurrences(ws, current_date + 400), 0, 'pausada não gera');
  perform public.set_recurrence_status(rec, 'active');
  perform public.set_recurrence_status(rec, 'cancelled', true);
  perform tests.assert_eq((select count(*)::int from public.transactions where recurrence_id = rec and recurrence_date >= current_date and status = 'pending' and not recurrence_detached), 0, 'futuras removidas');
  perform tests.assert_fails(format($q$select public.set_recurrence_status(%L, 'active')$q$, rec), 'reativar cancelada');

  -- data de término
  insert into public.recurrences (workspace_id, kind, description, amount_cents, account_id, frequency, start_date, end_date)
  values (ws, 'income', 'Bolsa', 50000, acc, 'monthly', current_date, current_date + 40) returning id into rec;
  perform public.generate_recurrences(ws, current_date + 365);
  perform tests.assert_eq((select count(*)::int from public.transactions where recurrence_id = rec), 2, 'respeita término');
  perform tests.logout();
  raise notice 'recorrências ok';
end $$;
rollback;
