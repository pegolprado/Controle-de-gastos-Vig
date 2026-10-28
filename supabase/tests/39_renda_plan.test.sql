-- Plano da Renda: metas de divisão guardadas por espaço e avisos de oportunidade da carteira
begin;
grant usage on schema tests to service_role;
grant execute on all functions in schema tests to service_role;
do $$
declare
  u uuid; outro uuid; ws uuid; pos uuid; hoje date := public.today_br();
begin
  -- mercado: KNRI com data com hoje (paga em 10 dias) e cotação 5% abaixo de 110,00
  perform public.fii_ingest('KNRI', jsonb_build_object('fund', 'FII KINEA RENDA', 'cashDividends', jsonb_build_array(
    jsonb_build_object('isinCode', 'BRKNRICTF003', 'label', 'RENDIMENTO', 'rate', '1,00000000000',
      'lastDatePrior', to_char(hoje, 'DD/MM/YYYY'), 'paymentDate', to_char(hoje + 10, 'DD/MM/YYYY')))));
  perform public.quote_ingest('KNRI11', '{"Trad":[{"scty":{"SctyQtn":{"curPrc":104.5,"prcFlcn":-1.2}}}]}');

  u := tests.create_user('plano@example.com');
  outro := tests.create_user('plano-outro@example.com');
  select id into ws from public.workspaces where owner_id = u;

  perform tests.login(u);
  insert into public.fii_positions (workspace_id, ticker, quantity) values (ws, 'KNRI11', 0) returning id into pos;
  insert into public.fii_trades (workspace_id, position_id, trade_date, quantity, price_cents) values (ws, pos, hoje - 90, 20, 11000);
  insert into public.renda_settings (workspace_id, plan)
  values (ws, '{"targets":{"rf":25,"acoes":25,"exterior":25,"fii":25},"manual":{"rf":500000}}');
  perform tests.assert_eq((select (plan -> 'targets' ->> 'fii')::int from public.renda_settings where workspace_id = ws), 25, 'plano salvo');
  perform tests.assert_fails(format($q$update public.renda_settings set plan = '[]' where workspace_id = %L$q$, ws), 'plano precisa ser um objeto');
  perform public.push_register('https://push.example.com/plano', 'p256', 'authkey', 'teste');
  perform tests.login(outro);
  perform tests.assert_eq((select count(*)::int from public.renda_settings where workspace_id = ws), 0, 'outro não vê o plano');
  perform tests.logout();

  execute 'set role service_role';
  perform public.push_set_keys(repeat('B', 87), 'privada');
  perform tests.assert((select bool_or(title = 'Último dia para garantir o rendimento de KNRI11') from public.push_digest()), 'aviso de data com');
  perform tests.assert((select bool_or(l.ref_key like 'opp:pm:%KNRI11%') from public.push_log l), 'aviso de preço abaixo do médio');
  perform tests.assert((select count(*) from public.push_digest()) = 0, 'não repete os avisos');
  execute 'reset role';
end;
$$;
rollback;
