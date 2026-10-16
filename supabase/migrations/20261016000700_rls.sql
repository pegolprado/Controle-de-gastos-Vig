-- =============================================================================
-- FINANCE OS — 0700 Row Level Security e privilégios
--
-- Matriz de papéis no espaço (rank):
--   owner(5)  admin(4)  editor(3)  contributor(2)  viewer(1)
--   * leitura de dados financeiros ........ rank >= 1
--   * criar lançamentos / pagamentos ...... rank >= 2
--   * editar/excluir lançamentos próprios . rank >= 2 (created_by = usuário)
--   * editar/excluir qualquer lançamento .. rank >= 3
--   * contas, cartões, categorias, orçamentos, metas, recorrências: rank >= 3
--   * histórico de auditoria .............. rank >= 3
--   * membros e convites .................. rank >= 4 (via RPC)
--   * excluir espaço ...................... rank  = 5 (via RPC)
-- O papel de proprietário do APLICATIVO não aparece em nenhuma policy financeira.
-- =============================================================================

alter table public.profiles enable row level security;
alter table public.app_roles enable row level security;
alter table public.app_settings enable row level security;
alter table public.app_releases enable row level security;
alter table public.admin_audit_log enable row level security;
alter table public.client_errors enable row level security;
alter table public.rate_limits enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.invites enable row level security;
alter table public.accounts enable row level security;
alter table public.categories enable row level security;
alter table public.credit_cards enable row level security;
alter table public.card_invoices enable row level security;
alter table public.installment_groups enable row level security;
alter table public.recurrences enable row level security;
alter table public.transactions enable row level security;
alter table public.tx_settlements enable row level security;
alter table public.tx_due_changes enable row level security;
alter table public.audit_log enable row level security;
alter table public.budgets enable row level security;
alter table public.goals enable row level security;
alter table public.goal_contributions enable row level security;
alter table public.notifications enable row level security;
alter table public.user_preferences enable row level security;

-- ---------------------------------------------------------------------------
-- Perfis: o próprio perfil + perfis de quem divide espaço comigo (nome/e-mail)
-- ---------------------------------------------------------------------------
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1 from public.workspace_members m
      where m.user_id = profiles.id and m.workspace_id in (select public.my_workspace_ids(1))
    )
  );
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Status e e-mail só mudam pelo servidor
create or replace function public.tg_profiles_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.status := old.status;
    new.status_reason := old.status_reason;
    new.email := old.email;
    new.id := old.id;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.tg_profiles_guard();

-- app_roles: apenas leitura do próprio papel
create policy app_roles_self on public.app_roles for select to authenticated using (user_id = auth.uid());

-- Configurações globais: leitura pública (marca na tela de login); escrita via RPC
create policy app_settings_read on public.app_settings for select to anon, authenticated using (true);

-- Versões: leitura para usuários autenticados
create policy app_releases_read on public.app_releases for select to authenticated using (true);

-- admin_audit_log, client_errors, rate_limits: sem policies → acesso só via RPC

-- ---------------------------------------------------------------------------
-- Espaços e membros
-- ---------------------------------------------------------------------------
create policy workspaces_select on public.workspaces for select to authenticated
  using (id in (select public.my_workspace_ids(1)));

create policy members_select on public.workspace_members for select to authenticated
  using (workspace_id in (select public.my_workspace_ids(1)));

create policy invites_select on public.invites for select to authenticated
  using (
    (workspace_id is not null and workspace_id in (select public.my_workspace_ids(4)))
    or (workspace_id is null and public.is_app_owner())
  );

-- ---------------------------------------------------------------------------
-- Estruturas financeiras (editor+ escreve, todos os membros leem)
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['accounts', 'categories', 'credit_cards', 'recurrences', 'budgets', 'goals']
  loop
    execute format('create policy %1$s_select on public.%1$I for select to authenticated
                      using (workspace_id in (select public.my_workspace_ids(1)))', t);
    execute format('create policy %1$s_insert on public.%1$I for insert to authenticated
                      with check (workspace_id in (select public.my_workspace_ids(3)))', t);
    execute format('create policy %1$s_update on public.%1$I for update to authenticated
                      using (workspace_id in (select public.my_workspace_ids(3)))
                      with check (workspace_id in (select public.my_workspace_ids(3)))', t);
    execute format('create policy %1$s_delete on public.%1$I for delete to authenticated
                      using (workspace_id in (select public.my_workspace_ids(3)))', t);
  end loop;
end;
$$;

-- Faturas: leitura; criação somente pelo servidor (ensure_invoice)
create policy card_invoices_select on public.card_invoices for select to authenticated
  using (workspace_id in (select public.my_workspace_ids(1)));

-- Parcelamentos: colaboradores criam; editores (ou o autor) excluem
create policy installment_groups_select on public.installment_groups for select to authenticated
  using (workspace_id in (select public.my_workspace_ids(1)));
create policy installment_groups_insert on public.installment_groups for insert to authenticated
  with check (workspace_id in (select public.my_workspace_ids(2)));
create policy installment_groups_delete on public.installment_groups for delete to authenticated
  using (workspace_id in (select public.my_workspace_ids(3))
         or (workspace_id in (select public.my_workspace_ids(2)) and created_by = auth.uid()));

-- ---------------------------------------------------------------------------
-- Lançamentos
-- ---------------------------------------------------------------------------
create policy transactions_select on public.transactions for select to authenticated
  using (workspace_id in (select public.my_workspace_ids(1)));
create policy transactions_insert on public.transactions for insert to authenticated
  with check (workspace_id in (select public.my_workspace_ids(2)));
create policy transactions_update on public.transactions for update to authenticated
  using (workspace_id in (select public.my_workspace_ids(3))
         or (workspace_id in (select public.my_workspace_ids(2)) and created_by = auth.uid()))
  with check (workspace_id in (select public.my_workspace_ids(3))
              or (workspace_id in (select public.my_workspace_ids(2)) and created_by = auth.uid()));
create policy transactions_delete on public.transactions for delete to authenticated
  using (workspace_id in (select public.my_workspace_ids(3))
         or (workspace_id in (select public.my_workspace_ids(2)) and created_by = auth.uid()));

create policy tx_settlements_select on public.tx_settlements for select to authenticated
  using (workspace_id in (select public.my_workspace_ids(1)));
create policy tx_settlements_insert on public.tx_settlements for insert to authenticated
  with check (workspace_id in (select public.my_workspace_ids(2))
              and exists (select 1 from public.transactions t where t.id = transaction_id and t.workspace_id = tx_settlements.workspace_id));
create policy tx_settlements_delete on public.tx_settlements for delete to authenticated
  using (workspace_id in (select public.my_workspace_ids(3))
         or (workspace_id in (select public.my_workspace_ids(2)) and created_by = auth.uid()));

create policy tx_due_changes_select on public.tx_due_changes for select to authenticated
  using (workspace_id in (select public.my_workspace_ids(1)));

create policy audit_log_select on public.audit_log for select to authenticated
  using (workspace_id in (select public.my_workspace_ids(3)));

create policy goal_contributions_select on public.goal_contributions for select to authenticated
  using (workspace_id in (select public.my_workspace_ids(1)));
create policy goal_contributions_insert on public.goal_contributions for insert to authenticated
  with check (workspace_id in (select public.my_workspace_ids(2)));
create policy goal_contributions_delete on public.goal_contributions for delete to authenticated
  using (workspace_id in (select public.my_workspace_ids(3))
         or (workspace_id in (select public.my_workspace_ids(2)) and created_by = auth.uid()));

-- ---------------------------------------------------------------------------
-- Dados estritamente pessoais
-- ---------------------------------------------------------------------------
create policy notifications_own on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_update_own on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_delete_own on public.notifications for delete to authenticated using (user_id = auth.uid());

create policy prefs_select on public.user_preferences for select to authenticated using (user_id = auth.uid());
create policy prefs_insert on public.user_preferences for insert to authenticated with check (user_id = auth.uid());
create policy prefs_update on public.user_preferences for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and (active_workspace_id is null or active_workspace_id in (select public.my_workspace_ids(1))));

-- ---------------------------------------------------------------------------
-- Privilégios de tabela (RLS continua valendo; anon praticamente sem acesso)
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;
grant select on public.app_settings to anon;

grant select on all tables in schema public to authenticated;
grant insert, update, delete on
  public.accounts, public.categories, public.credit_cards, public.recurrences, public.budgets, public.goals,
  public.transactions, public.tx_settlements, public.goal_contributions, public.installment_groups
  to authenticated;
grant update on public.profiles, public.notifications to authenticated;
grant delete on public.notifications to authenticated;
grant insert, update on public.user_preferences to authenticated;
revoke select on public.rate_limits, public.admin_audit_log, public.client_errors from authenticated;

grant all on all tables in schema public to service_role;
grant usage on all sequences in schema public to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Privilégios de funções: nada executável por anon exceto o estritamente público
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;

revoke execute on function
  public.bootstrap_app_owner(text),
  public.ensure_invoice(uuid, date),
  public.seed_default_categories(uuid),
  public.generate_all_recurrences(),
  public.purge_old_records(),
  public.enforce_rate_limit(text, integer, integer),
  public.handle_new_user(),
  public.handle_user_email_change()
from authenticated;

grant execute on function public.peek_invite(text) to anon;
grant execute on function public.hash_token(text) to anon;

alter default privileges in schema public revoke execute on functions from public, anon;
