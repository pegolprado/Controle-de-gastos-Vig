-- Regras financeiras: saldos, transferências, cartões, faturas, parcelas, liquidações, idempotência
begin;
do $$
declare
  u uuid; ws uuid; acc uuid; acc2 uuid; card uuid; cat uuid; inc_cat uuid;
  inv uuid; inv2 uuid; tx uuid; grp uuid; grp2 uuid; req uuid := gen_random_uuid();
  c record; bal record; s record; m record; n int;
begin
  u := tests.create_user('fin@example.com');
  select id into ws from public.workspaces where owner_id = u;
  select id into cat from public.categories where workspace_id = ws and name = 'Alimentação';
  select id into inc_cat from public.categories where workspace_id = ws and name = 'Salário';

  -- ciclo de fatura (função pura)
  select * into c from public.card_cycle(5, 12, date '2026-03-04');
  perform tests.assert_eq(c.reference_month, date '2026-03-01', 'antes do fechamento: fatura de março');
  perform tests.assert_eq(c.due_date, date '2026-03-12', 'vencimento 12/03');
  select * into c from public.card_cycle(5, 12, date '2026-03-05');
  perform tests.assert_eq(c.reference_month, date '2026-04-01', 'no dia do fechamento: próxima fatura');
  select * into c from public.card_cycle(25, 5, date '2026-01-20');
  perform tests.assert_eq(c.closing_date, date '2026-01-25', 'fecha 25/01');
  perform tests.assert_eq(c.due_date, date '2026-02-05', 'vence 05/02');
  select * into c from public.card_cycle(31, 10, date '2026-02-10');
  perform tests.assert_eq(c.closing_date, date '2026-02-28', 'fechamento ajustado para fim de fevereiro');
  perform tests.assert_eq(c.due_date, date '2026-03-10', 'vence 10/03');
  select * into c from public.card_cycle(31, 10, date '2026-12-31');
  perform tests.assert_eq(c.reference_month, date '2027-02-01', 'virada de ano');
  raise notice 'ciclo de fatura ok';

  perform tests.login(u);
  insert into public.accounts (workspace_id, name, type, initial_balance_cents) values (ws, 'Banco', 'checking', 100000) returning id into acc;
  insert into public.accounts (workspace_id, name, type) values (ws, 'Poupança', 'savings') returning id into acc2;

  -- receitas e despesas
  insert into public.transactions (workspace_id, kind, status, description, amount_cents, occurred_on, account_id, category_id)
  values (ws, 'income', 'paid', 'Salário', 500000, current_date - 1, acc, inc_cat);  -- 'paid' normaliza para 'received'
  perform tests.assert_eq((select status::text from public.transactions where description = 'Salário'), 'received', 'status normalizado');
  insert into public.transactions (workspace_id, kind, status, description, amount_cents, occurred_on, account_id, category_id)
  values (ws, 'expense', 'paid', 'Mercado', 25050, current_date, acc, cat);
  insert into public.transactions (workspace_id, kind, status, description, amount_cents, occurred_on, due_on, account_id, category_id)
  values (ws, 'expense', 'pending', 'Conta de luz', 18000, current_date, current_date + 5, acc, cat);
  insert into public.transactions (workspace_id, kind, status, description, amount_cents, occurred_on, account_id, category_id)
  values (ws, 'expense', 'cancelled', 'Cancelada', 99999, current_date, acc, cat);
  -- paid_cents enviado pelo cliente é ignorado
  insert into public.transactions (workspace_id, kind, status, description, amount_cents, paid_cents, occurred_on, account_id)
  values (ws, 'expense', 'pending', 'Tentativa de fraude', 100, 999999, current_date, acc) returning id into tx;
  perform tests.assert_eq((select paid_cents from public.transactions where id = tx), 0::bigint, 'paid_cents calculado no servidor');
  delete from public.transactions where id = tx;

  -- transferência: não altera o consolidado
  insert into public.transactions (workspace_id, kind, description, amount_cents, occurred_on, account_id, destination_account_id)
  values (ws, 'transfer', 'Reserva', 50000, current_date, acc, acc2);

  select * into bal from public.account_balances where account_id = acc;
  -- 1000 + 5000 - 250,50 - 500 (transf) = 5249,50
  perform tests.assert_eq(bal.current_balance_cents, 524950::bigint, 'saldo atual da conta');
  perform tests.assert_eq(bal.projected_balance_cents, 506950::bigint, 'saldo projetado (inclui conta de luz pendente)');
  perform tests.assert_eq(bal.pending_out_cents, 18000::bigint, 'saídas pendentes');
  perform tests.assert_eq((select current_balance_cents from public.account_balances where account_id = acc2), 50000::bigint, 'saldo do destino');
  perform tests.assert_eq((select sum(current_balance_cents) from public.account_balances where workspace_id = ws and account_id in (acc, acc2))::bigint, 574950::bigint, 'consolidado preserva transferência');
  raise notice 'saldos e transferências ok';

  -- liquidação parcial com juros e desconto
  select id into tx from public.transactions where description = 'Conta de luz';
  perform public.settle_transaction(tx, 10000, 500, 0, current_date);
  select * into s from public.transactions where id = tx;
  perform tests.assert_eq(s.status::text, 'pending', 'parcial continua pendente');
  perform tests.assert_eq(s.paid_cents, 10500::bigint, 'caixa = principal + juros');
  perform tests.assert_eq(s.settled_principal_cents, 10000::bigint, 'principal liquidado');
  perform tests.assert_fails(format('select public.settle_transaction(%L, 9000)', tx), 'não liquida acima do saldo em aberto');
  perform public.settle_transaction(tx, 8000, 0, 300, current_date);
  select * into s from public.transactions where id = tx;
  perform tests.assert_eq(s.status::text, 'paid', 'liquidação completa → pago');
  perform tests.assert_eq(s.paid_cents, 18200::bigint, 'caixa total com juros e desconto');
  select * into bal from public.account_balances where account_id = acc;
  perform tests.assert_eq(bal.current_balance_cents, (524950 - 18200)::bigint, 'saldo reflete o caixa efetivo');
  perform tests.assert_eq(bal.pending_out_cents, 0::bigint, 'nada mais pendente');
  -- idempotência da liquidação
  update public.transactions set status = 'pending' where id = tx;  -- trigger reverte para pago (há liquidações)
  perform tests.assert_eq((select status::text from public.transactions where id = tx), 'paid', 'status derivado das liquidações');
  perform public.undo_settlement((select id from public.tx_settlements where transaction_id = tx and principal_cents = 8000));
  perform tests.assert_eq((select status::text from public.transactions where id = tx), 'pending', 'desfazer pagamento');
  perform tests.assert_eq((select paid_cents from public.transactions where id = tx), 10500::bigint, 'desfazer recalcula caixa');
  perform tests.assert_eq((select count(*)::int from public.tx_due_changes where transaction_id = tx), 0, 'sem mudança de vencimento');
  update public.transactions set due_on = due_on + 10 where id = tx;
  perform tests.assert_eq((select count(*)::int from public.tx_due_changes where transaction_id = tx), 1, 'histórico de vencimento');
  raise notice 'liquidações ok';

  -- idempotência de criação
  insert into public.transactions (workspace_id, kind, description, amount_cents, occurred_on, account_id, client_request_id)
  values (ws, 'expense', 'Café', 800, current_date, acc, req);
  perform tests.assert_fails(format($q$insert into public.transactions (workspace_id, kind, description, amount_cents, occurred_on, account_id, client_request_id)
    values (%L, 'expense', 'Café', 800, current_date, %L, %L)$q$, ws, acc, req), 'reenvio com mesma chave');
  perform tests.assert_eq((select count(*)::int from public.transactions where client_request_id = req), 1, 'sem duplicata');
  insert into public.transactions (workspace_id, kind, description, amount_cents, occurred_on, account_id, client_request_id)
  values (ws, 'expense', 'Café', 800, current_date, acc, req) on conflict (workspace_id, client_request_id) do nothing;
  perform tests.assert_eq((select count(*)::int from public.transactions where client_request_id = req), 1, 'upsert idempotente');
  raise notice 'idempotência ok';

  -- cartão de crédito
  insert into public.credit_cards (workspace_id, name, limit_cents, closing_day, due_day, default_payment_account_id)
  values (ws, 'Roxinho', 500000, 5, 12, acc) returning id into card;
  insert into public.transactions (workspace_id, kind, description, amount_cents, occurred_on, card_id, category_id)
  values (ws, 'expense', 'Jantar', 20000, date '2026-03-02', card, cat) returning invoice_id into inv;
  insert into public.transactions (workspace_id, kind, description, amount_cents, occurred_on, card_id, category_id)
  values (ws, 'expense', 'Livro', 5000, date '2026-03-04', card, cat);
  insert into public.transactions (workspace_id, kind, description, amount_cents, occurred_on, card_id, category_id)
  values (ws, 'expense', 'Tênis', 30000, date '2026-03-06', card, cat) returning invoice_id into inv2;
  perform tests.assert(inv <> inv2, 'compras após fechamento vão para a próxima fatura');
  perform tests.assert_eq((select reference_month from public.card_invoices where id = inv), date '2026-03-01', 'fatura de março');
  perform tests.assert_eq((select total_cents from public.card_invoice_summary where id = inv), 25000::bigint, 'total da fatura');
  perform tests.assert_eq((select status from public.transactions where description = 'Jantar'), 'paid'::public.tx_status, 'compra no cartão confirmada');
  perform tests.assert_eq((select used_cents from public.card_limits where card_id = card), 55000::bigint, 'limite usado');
  perform tests.assert_eq((select available_cents from public.card_limits where card_id = card), 445000::bigint, 'limite disponível');
  -- compra no cartão não mexe no saldo da conta
  perform tests.assert_eq((select current_balance_cents from public.account_balances where account_id = acc), (524950 - 10500 - 800)::bigint, 'cartão não afeta conta');
  -- não pode forjar invoice_id de outra fatura
  update public.transactions set occurred_on = date '2026-03-07' where description = 'Livro';
  perform tests.assert_eq((select invoice_id from public.transactions where description = 'Livro'), inv2, 'editar data recalcula fatura');
  update public.transactions set occurred_on = date '2026-03-04' where description = 'Livro';

  -- pagamento da fatura: debita conta, liquida fatura, NÃO é despesa
  perform tests.assert_fails(format($q$insert into public.transactions (workspace_id, kind, description, amount_cents, occurred_on, account_id, invoice_id)
    values (%L, 'card_payment', 'Pagamento', 25001, current_date, %L, %L)$q$, ws, acc, inv), 'pagamento acima da fatura');
  insert into public.transactions (workspace_id, kind, description, amount_cents, occurred_on, account_id, invoice_id)
  values (ws, 'card_payment', 'Pagamento parcial', 10000, current_date, acc, inv);
  perform tests.assert_eq((select remaining_cents from public.card_invoice_summary where id = inv), 15000::bigint, 'restante da fatura');
  insert into public.transactions (workspace_id, kind, description, amount_cents, occurred_on, account_id, invoice_id)
  values (ws, 'card_payment', 'Pagamento final', 15000, current_date, acc, inv);
  perform tests.assert_eq((select status from public.card_invoice_summary where id = inv), 'paid', 'fatura paga');
  perform tests.assert_eq((select current_balance_cents from public.account_balances where account_id = acc), (524950 - 10500 - 800 - 25000)::bigint, 'pagamento debita conta');
  perform tests.assert_eq((select used_cents from public.card_limits where card_id = card), 30000::bigint, 'limite liberado');

  -- relatório: despesas de março = compras (25k) + tênis(30k na fatura de abril, mas competência março) — pagamento NÃO conta
  select * into m from public.report_monthly(ws, date '2026-03-01', date '2026-03-01');
  perform tests.assert_eq(m.expense_cents, 55000::bigint, 'despesas de março sem duplicar pagamento de fatura');
  select * into m from public.report_monthly(ws, current_date, current_date);
  perform tests.assert_eq(m.income_cents, case when date_trunc('month', current_date - 1) = date_trunc('month', current_date) then 500000::bigint else 0::bigint end, 'receita do mês');
  perform tests.assert(m.expense_cents = 25050 + 18000 + 800, 'despesas do mês atual excluem transferência, pagamento de fatura e canceladas');
  raise notice 'cartões e faturas ok';

  -- parcelamento no cartão: 3x de R$ 100,00 (R$ 300,01 → 100,03 + 99,99*?)
  grp := public.create_installment_purchase(ws, 'Geladeira', 100001, 3, date '2026-05-10', card, null, cat, '{}', null, req);
  perform tests.assert_eq((select count(*)::int from public.transactions where installment_group_id = grp), 3, '3 parcelas');
  perform tests.assert_eq((select sum(amount_cents) from public.transactions where installment_group_id = grp), 100001::numeric, 'soma das parcelas = total');
  perform tests.assert_eq((select amount_cents from public.transactions where installment_group_id = grp and installment_number = 1), 33335::bigint, 'centavos residuais na 1ª');
  perform tests.assert_eq((select count(distinct invoice_id)::int from public.transactions where installment_group_id = grp), 3, 'uma parcela por fatura');
  perform tests.assert_eq((select description from public.transactions where installment_group_id = grp and installment_number = 2), 'Geladeira (2/3)', 'descrição numerada');
  grp2 := public.create_installment_purchase(ws, 'Geladeira', 100001, 3, date '2026-05-10', card, null, cat, '{}', null, req);
  perform tests.assert_eq(grp2, grp, 'parcelamento idempotente');
  perform tests.assert_eq((select count(*)::int from public.installment_groups where workspace_id = ws), 1, 'sem grupo duplicado');
  -- parcelamento em boleto (conta): parcelas pendentes com vencimento
  grp2 := public.create_installment_purchase(ws, 'Curso', 60000, 2, current_date, null, acc, cat);
  perform tests.assert_eq((select count(*)::int from public.transactions where installment_group_id = grp2 and status = 'pending' and due_on is not null), 2, 'boletos pendentes');
  delete from public.installment_groups where id = grp2;
  perform tests.assert_eq((select count(*)::int from public.transactions where installment_group_id = grp2), 0, 'excluir parcelamento remove parcelas');
  raise notice 'parcelamentos ok';

  -- integridade: valores inválidos
  perform tests.assert_fails(format($q$insert into public.transactions (workspace_id, kind, description, amount_cents, occurred_on, account_id) values (%L,'expense','neg',-5,current_date,%L)$q$, ws, acc), 'valor negativo');
  perform tests.assert_fails(format($q$insert into public.transactions (workspace_id, kind, description, amount_cents, occurred_on, account_id, destination_account_id) values (%L,'transfer','mesma',5,current_date,%L,%L)$q$, ws, acc, acc), 'transferência para a mesma conta');
  perform tests.assert_fails(format($q$insert into public.transactions (workspace_id, kind, description, amount_cents, occurred_on, account_id, category_id) values (%L,'expense','cat errada',5,current_date,%L,%L)$q$, ws, acc, inc_cat), 'categoria de receita em despesa');
  perform tests.assert_fails(format($q$insert into public.transactions (workspace_id, kind, description, amount_cents, occurred_on, account_id, card_id) values (%L,'expense','dupla',5,current_date,%L,%L)$q$, ws, acc, card), 'conta e cartão ao mesmo tempo');
  perform tests.assert_fails(format($q$update public.transactions set kind = 'income' where description = 'Mercado'$q$), 'mudar tipo');
  perform tests.assert_fails(format($q$delete from public.accounts where id = %L$q$, acc), 'excluir conta com movimentações');
  perform tests.assert_fails(format($q$insert into public.card_invoices (workspace_id, card_id, reference_month, closing_date, due_date) values (%L,%L,'2030-01-01','2030-01-01','2030-01-10')$q$, ws, card), 'cliente cria fatura');
  raise notice 'integridade ok';

  -- auditoria registra alterações
  perform tests.assert((select count(*) from public.audit_log where workspace_id = ws and table_name = 'transactions' and action = 'UPDATE') >= 1, 'auditoria de updates');
  perform tests.assert((select count(*) from public.audit_log where workspace_id = ws and action = 'DELETE') >= 1, 'auditoria de exclusões');
  perform tests.logout();
end $$;
rollback;
