-- Dados persistidos usados para validar backup/restauração (não fica em transação revertida).
do $$
declare u uuid; ws uuid; acc uuid;
begin
  u := tests.create_user('backup@example.com', 'Backup');
  select id into ws from public.workspaces where owner_id = u;
  select id into acc from public.accounts where workspace_id = ws;
  perform tests.login(u);
  insert into public.transactions (workspace_id, kind, description, amount_cents, occurred_on, account_id)
  select ws, 'expense', 'Item ' || g, g * 101, current_date - g, acc from generate_series(1, 50) g;
  perform tests.logout();
end $$;
