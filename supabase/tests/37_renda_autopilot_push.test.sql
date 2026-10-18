-- Renda v2: compras com data, ações (ISIN por classe, JCP líquido), piloto automático, push
begin;
grant usage on schema tests to service_role;
grant execute on all functions in schema tests to service_role;
do $$
declare
  u uuid; leitor uuid; outro uuid; ws uuid; acc uuid; pos_x uuid; pos_p uuid; n int; r record; v text;
  hoje date := public.today_br();
begin
  -- mesmo UUID do app (src/lib/id.ts → stableUUID)
  perform tests.assert_eq(public.stable_uuid('finance-mv-fii|ws|XPML11|BRXPMLCTF000|RENDIMENTO|2026-10-23'),
    'fc86bc7d-2014-5f59-a78f-574e6f89550e'::uuid, 'stable_uuid igual ao do app');

  -- dados de mercado (como dono)
  perform public.fii_ingest('XPML', jsonb_build_object('fund', 'FII XP MALLS', 'cashDividends', jsonb_build_array(
    jsonb_build_object('isinCode', 'BRXPMLCTF000', 'label', 'RENDIMENTO', 'rate', '0,92000000000',
      'lastDatePrior', to_char(hoje - 5, 'DD/MM/YYYY'), 'paymentDate', to_char(hoje + 1, 'DD/MM/YYYY')),
    jsonb_build_object('isinCode', 'BRXPMLCTF000', 'label', 'RENDIMENTO', 'rate', '0,90000000000',
      'lastDatePrior', to_char(hoje - 35, 'DD/MM/YYYY'), 'paymentDate', to_char(hoje - 3, 'DD/MM/YYYY')))));
  v := public.stock_ingest('PETR4', $j$[{"tradingName":"PETROBRAS   ","cashDividends":[
    {"isinCode":"BRPETRACNPR6","label":"JRS CAP PROPRIO","rate":"0,67407131000","lastDatePrior":"01/01/2026","paymentDate":"01/02/2026"},
    {"isinCode":"BRPETRACNOR9","label":"DIVIDENDO","rate":"9,00000000000","lastDatePrior":"01/01/2026","paymentDate":"01/02/2026"},
    {"isinCode":"BRPETRACNPR6","label":"DIVIDENDO","rate":"0,47156696000","lastDatePrior":"01/01/2026","paymentDate":"A DEFINIR"}]}]$j$::text
    -- (datas montadas abaixo)
  ::jsonb);
  perform tests.assert_eq(v, 'ok', 'ações gravadas');
  update public.stock_distributions set payment_date = hoje where code = 'PETR' and payment_date is not null;
  perform tests.assert_eq((select count(*)::int from public.stock_distributions where code = 'PETR' and payment_date is null), 1, 'data a definir guardada');
  perform tests.assert_eq(public.stock_ingest('ZZZZ', '[]'::jsonb), 'not_found', 'empresa inexistente');
  perform tests.assert(public.stock_isin_matches('PETR4', 'BRPETRACNPR6') and not public.stock_isin_matches('PETR4', 'BRPETRACNOR9')
    and public.stock_isin_matches('TAEE11', 'BRTAEECDAM10') and public.stock_isin_matches('PETR3', 'BRPETRACNOR9'), 'ISIN por classe');
  perform tests.assert(public.quote_ingest('XPML11', '{"Trad":[{"scty":{"SctyQtn":{"curPrc":104.5,"prcFlcn":0.3}}}]}'), 'cotação lida');
  perform tests.assert_eq((select price from public.asset_quotes where ticker = 'XPML11'), 104.5::numeric, 'preço');

  u := tests.create_user('renda2@example.com');
  leitor := tests.create_user('renda2-leitor@example.com');
  outro := tests.create_user('renda2-outro@example.com');
  select id into ws from public.workspaces where owner_id = u;
  insert into public.workspace_members (workspace_id, user_id, role) values (ws, leitor, 'viewer');

  perform tests.login(u);
  insert into public.accounts (workspace_id, name, type) values (ws, 'Corretora', 'investment') returning id into acc;
  insert into public.fii_positions (workspace_id, ticker, quantity) values (ws, 'XPML11', 0) returning id into pos_x;
  insert into public.fii_positions (workspace_id, ticker, quantity, asset_type) values (ws, 'PETR4', 0, 'stock') returning id into pos_p;
  perform tests.assert_fails(format($q$insert into public.fii_positions (workspace_id, ticker, quantity, asset_type) values (%L, 'PETR4X', 0, 'stock')$q$, ws), 'ticker de ação inválido');
  perform tests.assert_fails(format($q$insert into public.fii_positions (workspace_id, ticker, quantity) values (%L, 'PETR4', 0)$q$, ws), 'ação cadastrada como FII');

  -- compras com data: 10 antes da data com do último pagamento, 5 depois
  insert into public.fii_trades (workspace_id, position_id, trade_date, quantity, price_cents) values
    (ws, pos_x, hoje - 60, 10, 10000), (ws, pos_x, hoje - 20, 5, 11000);
  perform tests.assert_eq((select quantity from public.fii_positions where id = pos_x), 15, 'quantidade = soma das compras');
  perform tests.assert_eq((select avg_price_cents from public.fii_positions where id = pos_x), 10333::bigint, 'preço médio ponderado');
  perform tests.assert_fails(format('select public.renda_qty_at(%L, current_date)', pos_x), 'função interna bloqueada para o usuário');
  perform tests.logout();
  perform tests.assert_eq(public.renda_qty_at(pos_x, hoje - 35)::int, 10, 'cotas com direito na data com antiga');
  perform tests.login(u);
  perform tests.assert_fails(format($q$insert into public.fii_trades (workspace_id, position_id, trade_date, quantity) values (%L, %L, current_date, -100)$q$, ws, pos_x), 'venda maior que a posição');
  insert into public.fii_trades (workspace_id, position_id, trade_date, quantity) values (ws, pos_p, null, 100);

  -- eventos: XPML (pago há 3 dias com 10 cotas; amanhã com 15), PETR4 JCP hoje (líquido)
  perform tests.logout();
  select count(*) into n from public.renda_events(ws, hoje - 10, hoje + 10);
  perform tests.assert_eq(n, 3, 'eventos da carteira (ON e data a definir fora)');
  perform tests.assert_eq((select amount_cents from public.renda_events(ws, hoje - 10, hoje + 10) where ticker = 'XPML11' and payment_date = hoje - 3), 900::bigint, '10 cotas × 0,90');
  perform tests.assert_eq((select amount_cents from public.renda_events(ws, hoje - 10, hoje + 10) where ticker = 'XPML11' and payment_date = hoje + 1), 1380::bigint, '15 cotas × 0,92');
  perform tests.assert_eq((select amount_cents from public.renda_events(ws, hoje - 10, hoje + 10) where kind like 'JRS%'), 5729::bigint, 'JCP líquido: 100 × 0,674 × 85%');

  perform tests.login(u);
  -- piloto automático desligado: nada
  perform tests.assert_eq(public.renda_autopilot(ws), 0, 'sem configuração, não lança');
  insert into public.renda_settings (workspace_id, account_id, auto_launch, auto_since) values (ws, acc, true, hoje - 30);
  n := public.renda_autopilot(ws);
  perform tests.assert(n >= 3, 'lança 3 proventos e recebe os que já caíram (' || n || ')');
  perform tests.assert_eq((select count(*)::int from public.transactions where workspace_id = ws and 'auto' = any(tags)), 3, 'três receitas automáticas (data a definir fica de fora)');
  perform tests.assert_eq((select status::text from public.transactions where workspace_id = ws and description = 'Rendimento XPML11' and due_on = hoje + 1), 'pending', 'futuro fica a receber');
  perform tests.assert_eq((select status::text from public.transactions where workspace_id = ws and description = 'Rendimento XPML11' and due_on = hoje - 3), 'received', 'passado vira recebido');
  perform tests.assert_eq((select status::text from public.transactions where workspace_id = ws and description = 'JCP PETR4'), 'received', 'hoje vira recebido');
  perform tests.assert_eq((select client_request_id from public.transactions where workspace_id = ws and description = 'Rendimento XPML11' and due_on = hoje + 1),
    public.stable_uuid('finance-mv-fii|' || ws || '|XPML11|BRXPMLCTF000|RENDIMENTO|' || (hoje + 1)), 'mesma chave do app (sem duplicar)');
  perform tests.assert_eq(public.renda_autopilot(ws), 0, 'rodar de novo não duplica');
  perform tests.assert_eq((select current_balance_cents from public.account_balances where account_id = acc), (900 + 5729)::bigint, 'saldo inclui os recebidos');

  -- leitor não roda o piloto nem altera a carteira; outro usuário não vê nada
  perform tests.login(leitor);
  perform tests.assert_fails(format('select public.renda_autopilot(%L)', ws), 'leitor não roda o piloto');
  perform tests.assert_fails(format($q$insert into public.fii_trades (workspace_id, position_id, quantity) values (%L, %L, 1)$q$, ws, pos_x), 'leitor não compra');
  perform tests.assert_eq((select count(*)::int from public.fii_trades where workspace_id = ws), 3, 'leitor vê as operações');
  perform tests.login(outro);
  perform tests.assert_eq((select count(*)::int from public.fii_trades where workspace_id = ws), 0, 'outro não vê operações');
  perform tests.assert_eq((select count(*)::int from public.renda_settings where workspace_id = ws), 0, 'outro não vê configurações');
  perform tests.assert_fails(format($q$insert into public.fii_trades (workspace_id, position_id, quantity) values (%L, %L, 1)$q$, ws, pos_x), 'outro não compra');

  -- push: inscrição do aparelho
  perform tests.login(u);
  perform public.push_register('https://push.example.com/abc', 'p256', 'authkey', 'teste');
  perform tests.assert_eq((select count(*)::int from public.push_subscriptions), 1, 'vê a própria inscrição');
  perform tests.assert_fails($q$select * from public.push_keys$q$, 'chaves privadas inacessíveis');
  perform tests.assert_fails($q$select * from public.push_digest()$q$, 'usuário não lê os avisos de todos');
  perform tests.assert_fails($q$select public.renda_autopilot_all()$q$, 'usuário não roda a rotina geral');
  perform tests.assert_fails($q$select public.renda_job_sync('XPML11', 'fii')$q$, 'usuário não chama a rotina de sincronização');
  -- conta a vencer amanhã
  insert into public.transactions (workspace_id, kind, status, description, amount_cents, occurred_on, due_on, account_id)
  values (ws, 'expense', 'pending', 'Conta de luz', 18740, hoje, hoje + 1, acc);
  perform tests.logout();

  -- job (service_role): chaves, avisos (uma vez só), relatório de entrega
  execute 'set role service_role';
  perform public.push_set_keys(repeat('A', 87), 'privada');
  perform tests.assert_eq((select vapid_public_key from public.app_settings where id = 1), repeat('A', 87), 'chave pública exposta ao app');
  select count(*) into n from public.push_digest();
  perform tests.assert(n >= 2, 'avisos de hoje/amanhã (' || n || ')');
  perform tests.assert((select bool_or(title = 'Vence amanhã: Conta de luz') from public.push_digest()) is null, 'segunda execução não repete');
  perform tests.assert((select bool_or(l.ref_key like 'renda:%XPML11%') from public.push_log l), 'aviso do XPML11 registrado');
  perform tests.assert((select bool_or(l.ref_key like 'tx:%') from public.push_log l), 'aviso da conta registrado');
  perform public.push_report('https://push.example.com/abc', false, true);
  perform tests.assert_eq((select count(*)::int from public.push_subscriptions), 0, 'inscrição expirada removida');
  perform tests.assert(exists (select 1 from public.renda_all_assets() where ticker = 'PETR4' and asset_type = 'stock'), 'rotina lista os ativos');
  perform tests.assert(public.renda_autopilot_all() >= 0, 'rotina geral roda');
  execute 'reset role';

  -- anônimo
  execute 'set role anon';
  perform tests.assert_fails($q$select public.asset_sync('XPML11')$q$, 'anônimo não sincroniza');
  perform tests.assert_fails($q$select * from public.fii_trades$q$, 'anônimo não lê operações');
  execute 'reset role';
  raise notice 'renda v2 ok';
end $$;
rollback;
