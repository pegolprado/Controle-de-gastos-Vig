-- Espaços compartilhados: convites, papéis, permissões reais e suspensão
begin;
do $$
declare
  dono uuid; adm uuid; ed uuid; col uuid; leitor uuid; intruso uuid;
  ws uuid; acc uuid; inv jsonb; tx_col uuid; tx_ed uuid; n int; app_owner uuid;
begin
  dono := tests.create_user('dono@example.com');
  adm := tests.create_user('adm@example.com');
  ed := tests.create_user('editor@example.com');
  col := tests.create_user('colab@example.com');
  leitor := tests.create_user('leitor@example.com');
  intruso := tests.create_user('intruso@example.com');

  perform tests.login(dono);
  ws := public.create_workspace('Casa');
  insert into public.accounts (workspace_id, name) values (ws, 'Conta conjunta') returning id into acc;
  -- espaço pessoal não pode ser compartilhado
  perform tests.assert_fails(format($q$select public.create_invite(%L, null, 'viewer', 7)$q$,
    (select id from public.workspaces where owner_id = auth.uid() and kind = 'personal')), 'compartilhar espaço pessoal');
  inv := public.create_invite(ws, 'adm@example.com', 'admin', 7);
  perform tests.logout();

  -- convite com e-mail errado
  perform tests.login(intruso);
  perform tests.assert_fails(format('select public.accept_invite(%L)', inv ->> 'token'), 'convite de outro e-mail');
  perform tests.assert_fails($q$select public.accept_invite('token-invalido')$q$, 'token inválido');
  perform tests.logout();

  perform tests.login(adm);
  perform tests.assert((public.peek_invite(inv ->> 'token') ->> 'valid')::boolean, 'peek válido');
  perform public.accept_invite(inv ->> 'token');
  perform tests.assert_eq(public.workspace_rank(ws), 4, 'admin entrou');
  perform tests.assert_fails(format('select public.accept_invite(%L)', inv ->> 'token'), 'convite reutilizado');
  -- admin convida editor/colaborador/leitor (sem e-mail fixo)
  perform public.accept_invite(inv ->> 'token') from (select 1) x where false;
  perform tests.assert_fails(format($q$select public.create_invite(%L, null, 'admin', 7)$q$, ws), 'admin não convida admin');
  inv := public.create_invite(ws, null, 'editor', 7);
  perform tests.logout();
  perform tests.login(ed); perform public.accept_invite(inv ->> 'token'); perform tests.logout();
  perform tests.login(adm); inv := public.create_invite(ws, null, 'contributor', 7); perform tests.logout();
  perform tests.login(col); perform public.accept_invite(inv ->> 'token'); perform tests.logout();
  perform tests.login(adm); inv := public.create_invite(ws, null, 'viewer', 7); perform tests.logout();
  perform tests.login(leitor); perform public.accept_invite(inv ->> 'token'); perform tests.logout();

  -- leitor: lê, não escreve
  perform tests.login(leitor);
  perform tests.assert_eq((select count(*)::int from public.accounts where workspace_id = ws), 1, 'leitor lê contas');
  perform tests.assert_fails(format($q$insert into public.transactions (workspace_id, kind, description, amount_cents, occurred_on, account_id)
    values (%L,'expense','leitor',100,current_date,%L)$q$, ws, acc), 'leitor não cria lançamento');
  perform tests.assert_fails(format($q$insert into public.accounts (workspace_id, name) values (%L,'x')$q$, ws), 'leitor não cria conta');
  perform tests.assert_fails(format($q$select public.create_invite(%L, null, 'viewer', 7)$q$, ws), 'leitor não convida');
  perform tests.assert_eq((select count(*)::int from public.audit_log where workspace_id = ws), 0, 'leitor não vê auditoria');
  perform tests.logout();

  -- colaborador: cria e edita os próprios; não edita dos outros nem estrutura
  perform tests.login(col);
  insert into public.transactions (workspace_id, kind, description, amount_cents, occurred_on, account_id)
  values (ws, 'expense', 'Feira', 7000, current_date, acc) returning id into tx_col;
  update public.transactions set amount_cents = 7500 where id = tx_col;
  get diagnostics n = row_count; perform tests.assert_eq(n, 1, 'colaborador edita o próprio');
  perform tests.assert_fails(format($q$insert into public.accounts (workspace_id, name) values (%L,'x')$q$, ws), 'colaborador não cria conta');
  perform tests.logout();

  perform tests.login(ed);
  insert into public.transactions (workspace_id, kind, description, amount_cents, occurred_on, account_id)
  values (ws, 'expense', 'Gás', 12000, current_date, acc) returning id into tx_ed;
  update public.transactions set amount_cents = 7600 where id = tx_col;
  get diagnostics n = row_count; perform tests.assert_eq(n, 1, 'editor edita de qualquer um');
  insert into public.credit_cards (workspace_id, name, closing_day, due_day) values (ws, 'Cartão casa', 1, 10);
  perform tests.assert((select count(*) from public.audit_log where workspace_id = ws) > 0, 'editor vê auditoria');
  perform tests.assert_fails(format($q$select public.create_invite(%L, null, 'viewer', 7)$q$, ws), 'editor não convida');
  perform tests.logout();

  perform tests.login(col);
  update public.transactions set amount_cents = 1 where id = tx_ed;
  get diagnostics n = row_count; perform tests.assert_eq(n, 0, 'colaborador não edita do outro');
  delete from public.transactions where id = tx_ed;
  get diagnostics n = row_count; perform tests.assert_eq(n, 0, 'colaborador não exclui do outro');
  update public.transactions set created_by = col where id = tx_ed;
  get diagnostics n = row_count; perform tests.assert_eq(n, 0, 'forjar autoria em lançamento alheio');
  update public.transactions set created_by = ed where id = tx_col;
  perform tests.assert_eq((select created_by from public.transactions where id = tx_col), col, 'autoria imutável');
  perform tests.logout();
  raise notice 'papéis ok';

  -- gestão de membros
  perform tests.login(adm);
  perform public.set_member_role(ws, leitor, 'contributor');
  perform tests.assert_fails(format($q$select public.set_member_role(%L, %L, 'admin')$q$, ws, leitor), 'admin não promove a admin');
  perform tests.assert_fails(format($q$select public.set_member_role(%L, %L, 'viewer')$q$, ws, dono), 'rebaixar o dono');
  perform tests.assert_fails(format($q$select public.remove_member(%L, %L)$q$, ws, dono), 'remover o dono');
  perform public.remove_member(ws, leitor);
  perform tests.logout();
  perform tests.login(leitor);
  perform tests.assert_eq((select count(*)::int from public.transactions where workspace_id = ws), 0, 'removido perde acesso');
  perform tests.logout();
  perform tests.login(col);
  perform public.remove_member(ws, col);  -- sair do espaço
  perform tests.assert_eq(public.workspace_rank(ws), 0, 'saiu do espaço');
  perform tests.logout();
  raise notice 'gestão de membros ok';

  -- suspensão pelo proprietário do app bloqueia imediatamente via RLS
  app_owner := tests.create_user('owner-app@example.com');
  perform public.bootstrap_app_owner('owner-app@example.com');
  perform tests.login(app_owner);
  perform tests.assert_eq((select count(*)::int from public.transactions where workspace_id = ws), 0, 'dono do app não vê espaço alheio');
  perform public.admin_set_user_status(ed, 'suspended', 'teste');
  perform tests.logout();
  perform tests.login(ed);
  perform tests.assert_eq((select count(*)::int from public.transactions), 0, 'suspenso não lê');
  perform tests.assert_fails(format($q$insert into public.transactions (workspace_id, kind, description, amount_cents, occurred_on, account_id)
    values (%L,'expense','suspenso',100,current_date,%L)$q$, ws, acc), 'suspenso não escreve');
  perform tests.logout();

  -- acesso de suporte: só com autorização explícita do dono do espaço, somente leitura e temporário
  perform tests.login(dono);
  perform public.grant_support_access(ws, 2);
  perform tests.logout();
  perform tests.login(app_owner);
  perform tests.assert((select count(*) from public.transactions where workspace_id = ws) > 0, 'suporte autorizado lê');
  perform tests.assert_fails(format($q$insert into public.transactions (workspace_id, kind, description, amount_cents, occurred_on, account_id)
    values (%L,'expense','suporte',100,current_date,%L)$q$, ws, acc), 'suporte não escreve');
  perform tests.logout();
  perform tests.login(dono);
  perform public.revoke_support_access(ws);
  perform tests.logout();
  perform tests.login(app_owner);
  perform tests.assert_eq((select count(*)::int from public.transactions where workspace_id = ws), 0, 'suporte revogado');
  perform tests.logout();
  perform tests.assert((select count(*) from public.admin_audit_log where action like 'support.%') = 2, 'suporte auditado');
  -- expiração
  update public.workspace_members set expires_at = now() - interval '1 minute' where workspace_id = ws and user_id = adm;
  perform tests.login(adm);
  perform tests.assert_eq(public.workspace_rank(ws), 0, 'acesso expirado');
  perform tests.logout();
  raise notice 'suspensão e suporte ok';

  perform tests.login(dono);
  perform public.delete_workspace(ws);
  perform tests.assert_eq((select count(*)::int from public.workspaces where id = ws), 0, 'espaço excluído');
  perform tests.logout();
end $$;
rollback;
