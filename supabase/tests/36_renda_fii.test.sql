-- Renda FII: carteira por espaço (RLS), leitura da resposta da B3 e cache
begin;
do $$
declare
  u uuid; outro uuid; ws uuid; n int; r text;
  payload jsonb := $j${"fund":"FII HSI MALL","ifd":"BRL TRUST DTVM S.A.","code":"HSML","cashDividends":[
    {"assetIssued":"BRHSMLCTF007","paymentDate":"07/10/2026","rate":"0,75000000000","relatedTo":"Setembro/2026/2026","approvedOn":"30/09/2026","isinCode":"BRHSMLCTF007","label":"RENDIMENTO","lastDatePrior":"30/09/2026"},
    {"assetIssued":"BRHSMLCTF007","paymentDate":"08/09/2026","rate":"0,75000000000","relatedTo":"Agosto/2026/2026","approvedOn":"31/08/2026","isinCode":"BRHSMLCTF007","label":"RENDIMENTO","lastDatePrior":"31/08/2026"},
    {"assetIssued":"BRHSMLR09M12","paymentDate":"21/01/2026","rate":"0,87000000000","isinCode":"BRHSMLR09M12","label":"RENDIMENTO","lastDatePrior":"14/01/2026"},
    {"assetIssued":"BRHSMLCTF007","paymentDate":"","rate":"0,1","isinCode":"BRHSMLCTF007","label":"RENDIMENTO"}
  ]}$j$;
begin
  -- leitura da resposta da B3 (como dono das funções)
  perform tests.assert_eq(public.fii_base_code('hsml11'), 'HSML', 'código normalizado');
  perform tests.assert_eq(public.fii_base_code('HSML'), 'HSML', 'código sem sufixo');
  perform tests.assert(public.fii_base_code('PETR4X') is null, 'código inválido');
  perform tests.assert_eq(public.fii_ingest('HSML11', payload), 'ok', 'resposta gravada');
  select count(*) into n from public.fii_distributions where code = 'HSML';
  perform tests.assert_eq(n, 2, 'só cotas com data válida (recibo de subscrição e linha sem data ignorados)');
  perform tests.assert_eq((select rate from public.fii_distributions where code = 'HSML' and payment_date = date '2026-10-07'), 0.75::numeric, 'valor por cota');
  perform tests.assert_eq((select record_date from public.fii_distributions where code = 'HSML' and payment_date = date '2026-10-07'), date '2026-09-30', 'data com');
  perform tests.assert_eq(public.fii_ingest('HSML', payload), 'ok', 'reprocessar substitui sem duplicar');
  perform tests.assert_eq((select count(*)::int from public.fii_distributions where code = 'HSML'), 2, 'sem duplicados');
  perform tests.assert_eq(public.fii_ingest('ZZZZ', '{"fund":"ISIN GENERIC","cashDividends":[]}'), 'not_found', 'fundo inexistente');

  u := tests.create_user('fii@example.com');
  outro := tests.create_user('fii-outro@example.com');
  select id into ws from public.workspaces where owner_id = u;

  perform tests.login(u);
  -- cache recente: não consulta a B3
  perform tests.assert_eq(public.fii_sync('HSML11'), 'cached', 'cache de 6 horas');
  perform tests.assert_eq(public.fii_sync('ZZZZ11'), 'not_found', 'inexistente fica em cache');
  perform tests.assert_fails($q$select public.fii_sync('ABC')$q$, 'código inválido recusado');
  perform tests.assert_fails($q$select public.fii_ingest('HSML', '{}'::jsonb)$q$, 'usuário não grava dados de mercado');
  perform tests.assert_fails($q$insert into public.fii_distributions (code, isin, kind, payment_date, rate) values ('HSML', 'x', 'RENDIMENTO', current_date, 1)$q$, 'usuário não forja proventos');
  perform tests.assert_eq((select count(*)::int from public.fii_distributions where code = 'HSML'), 2, 'usuário lê proventos');

  insert into public.fii_positions (workspace_id, ticker, quantity) values (ws, 'HSML11', 24);
  perform tests.assert_fails(format($q$insert into public.fii_positions (workspace_id, ticker, quantity) values (%L, 'HSML11', 1)$q$, ws), 'fundo repetido no espaço');
  perform tests.assert_fails(format($q$insert into public.fii_positions (workspace_id, ticker, quantity) values (%L, 'hsml11', 1)$q$, ws), 'código fora do padrão');
  perform tests.assert_fails(format($q$insert into public.fii_positions (workspace_id, ticker, quantity) values (%L, 'BRCO11', -1)$q$, ws), 'quantidade negativa');
  update public.fii_positions set quantity = 30 where ticker = 'HSML11';
  perform tests.assert_eq((select quantity from public.fii_positions where workspace_id = ws and ticker = 'HSML11'), 30, 'quantidade editada');

  -- outro usuário não vê nem altera a carteira
  perform tests.login(outro);
  perform tests.assert_eq((select count(*)::int from public.fii_positions where workspace_id = ws), 0, 'carteira invisível para outros');
  update public.fii_positions set quantity = 1 where workspace_id = ws;
  get diagnostics n = row_count;
  perform tests.assert_eq(n, 0, 'outro usuário não altera');
  perform tests.assert_fails(format($q$insert into public.fii_positions (workspace_id, ticker, quantity) values (%L, 'MXRF11', 10)$q$, ws), 'outro usuário não insere');

  -- sem sessão: nada
  perform tests.logout();
  execute 'set role anon';
  perform tests.assert_fails($q$select public.fii_sync('HSML11')$q$, 'anônimo não consulta');
  perform tests.assert_fails($q$select * from public.fii_distributions$q$, 'anônimo não lê');
  execute 'reset role';
  raise notice 'renda FII ok';
end $$;
rollback;
