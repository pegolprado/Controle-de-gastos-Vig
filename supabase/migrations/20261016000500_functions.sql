-- =============================================================================
-- FINANCE OS — 0500 Funções de negócio (RPC)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Categorias padrão de um espaço
-- ---------------------------------------------------------------------------
create or replace function public.seed_default_categories(p_workspace uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent uuid;
  r record;
begin
  for r in
    select * from (values
      ('Alimentação', 'expense', '#f59e0b', 'utensils', false, array['Mercado', 'Restaurantes', 'Delivery']),
      ('Moradia', 'expense', '#8b5cf6', 'home', true, array['Aluguel', 'Condomínio', 'Energia', 'Água', 'Internet']),
      ('Transporte', 'expense', '#0ea5e9', 'car', false, array['Combustível', 'Aplicativos', 'Transporte público', 'Manutenção']),
      ('Saúde', 'expense', '#ef4444', 'heart-pulse', false, array['Plano de saúde', 'Farmácia', 'Consultas']),
      ('Educação', 'expense', '#14b8a6', 'graduation-cap', true, array['Mensalidade', 'Cursos', 'Livros']),
      ('Lazer', 'expense', '#ec4899', 'party-popper', false, array['Viagens', 'Cinema e eventos', 'Hobbies']),
      ('Assinaturas', 'expense', '#6366f1', 'repeat', true, array['Streaming', 'Software', 'Academia']),
      ('Compras', 'expense', '#f97316', 'shopping-bag', false, array['Vestuário', 'Eletrônicos', 'Casa']),
      ('Impostos e taxas', 'expense', '#78716c', 'landmark', false, array['Tarifas bancárias', 'Impostos']),
      ('Outros', 'expense', '#64748b', 'circle-dashed', false, array[]::text[]),
      ('Salário', 'income', '#10b981', 'briefcase', true, array[]::text[]),
      ('Renda extra', 'income', '#22c55e', 'sparkles', false, array['Freelance', 'Vendas']),
      ('Investimentos', 'income', '#06b6d4', 'trending-up', false, array['Rendimentos', 'Dividendos']),
      ('Outras receitas', 'income', '#84cc16', 'plus-circle', false, array['Reembolsos', 'Presentes'])
    ) as t(name, kind, color, icon, is_fixed, subs)
  loop
    insert into public.categories (workspace_id, name, kind, color, icon, is_fixed)
    values (p_workspace, r.name, r.kind::public.category_kind, r.color, r.icon, r.is_fixed)
    returning id into v_parent;
    insert into public.categories (workspace_id, parent_id, name, kind, color, icon, is_fixed)
    select p_workspace, v_parent, s, r.kind::public.category_kind, r.color, r.icon, r.is_fixed
    from unnest(r.subs) as s;
  end loop;
end;
$$;
revoke all on function public.seed_default_categories(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Novo usuário: perfil, espaço pessoal, categorias e preferências
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode text;
  v_status public.app_user_status := 'active';
  v_ws uuid;
  v_name text := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '');
begin
  select signup_mode into v_mode from public.app_settings where id = 1;
  if v_mode = 'invite_only' and not exists (
    select 1 from public.invites i
    where lower(i.email) = lower(new.email) and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
  ) then
    v_status := 'pending';
  end if;

  insert into public.profiles (id, email, full_name, status)
  values (new.id, coalesce(new.email, ''), left(v_name, 120), v_status);

  insert into public.workspaces (name, kind, owner_id)
  values ('Pessoal', 'personal', new.id)
  returning id into v_ws;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_ws, new.id, 'owner');

  perform public.seed_default_categories(v_ws);

  insert into public.accounts (workspace_id, name, type, color, created_by)
  values (v_ws, 'Carteira', 'cash', '#10b981', new.id);

  insert into public.user_preferences (user_id, active_workspace_id) values (new.id, v_ws);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = coalesce(new.email, '') where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.handle_user_email_change();

-- ---------------------------------------------------------------------------
-- Contexto da sessão: perfil, papel de app, espaços, configurações
-- ---------------------------------------------------------------------------
create or replace function public.session_context()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'profile', (select to_jsonb(p) - 'status_reason' from public.profiles p where p.id = auth.uid()),
    'status', (select p.status from public.profiles p where p.id = auth.uid()),
    'is_app_owner', public.is_app_owner(),
    'workspaces', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', w.id, 'name', w.name, 'kind', w.kind, 'role', m.role,
        'is_support', m.is_support, 'expires_at', m.expires_at, 'owner_id', w.owner_id
      ) order by w.kind, w.created_at)
      from public.workspace_members m
      join public.workspaces w on w.id = m.workspace_id
      where m.user_id = auth.uid() and (m.expires_at is null or m.expires_at > now())
        and public.is_active_user()
    ), '[]'::jsonb),
    'preferences', (select to_jsonb(u) from public.user_preferences u where u.user_id = auth.uid())
  );
$$;

-- ---------------------------------------------------------------------------
-- Espaços compartilhados
-- ---------------------------------------------------------------------------
create or replace function public.create_workspace(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_max integer;
  v_enabled boolean;
begin
  if not public.is_active_user() then
    raise exception 'Conta inativa.' using errcode = '42501';
  end if;
  perform public.enforce_rate_limit('create_workspace', 10, 3600);
  select coalesce((features ->> 'shared_workspaces')::boolean, true), (limits ->> 'max_workspaces_per_user')::integer
    into v_enabled, v_max from public.app_settings where id = 1;
  if not v_enabled then
    raise exception 'Espaços compartilhados estão desabilitados pelo administrador.';
  end if;
  if v_max is not null and (select count(*) from public.workspaces where owner_id = auth.uid()) >= v_max then
    raise exception 'Limite de % espaços por usuário atingido.', v_max using errcode = 'P0429';
  end if;
  insert into public.workspaces (name, kind, owner_id) values (btrim(p_name), 'shared', auth.uid())
  returning id into v_id;
  insert into public.workspace_members (workspace_id, user_id, role, added_by) values (v_id, auth.uid(), 'owner', auth.uid());
  perform public.seed_default_categories(v_id);
  return v_id;
end;
$$;

create or replace function public.rename_workspace(p_workspace uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_rank(p_workspace, 4);
  update public.workspaces set name = btrim(p_name) where id = p_workspace;
end;
$$;

create or replace function public.delete_workspace(p_workspace uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_rank(p_workspace, 5);
  if exists (select 1 from public.workspaces where id = p_workspace and kind = 'personal') then
    raise exception 'O espaço pessoal não pode ser excluído.';
  end if;
  delete from public.workspaces where id = p_workspace;
end;
$$;

create or replace function public.list_workspace_members(p_workspace uuid)
returns table (user_id uuid, email text, full_name text, role public.workspace_role,
               is_support boolean, expires_at timestamptz, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_rank(p_workspace, 1);
  return query
    select m.user_id, p.email, p.full_name, m.role, m.is_support, m.expires_at, m.created_at
    from public.workspace_members m
    join public.profiles p on p.id = m.user_id
    where m.workspace_id = p_workspace
    order by public.role_rank(m.role) desc, m.created_at;
end;
$$;

create or replace function public.set_member_role(p_workspace uuid, p_user uuid, p_role public.workspace_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_my integer := public.workspace_rank(p_workspace);
  v_target public.workspace_members;
begin
  if v_my < 4 then
    raise exception 'Apenas administradores podem alterar permissões.' using errcode = '42501';
  end if;
  select * into v_target from public.workspace_members where workspace_id = p_workspace and user_id = p_user;
  if v_target.user_id is null then raise exception 'Membro não encontrado.'; end if;
  if v_target.role = 'owner' or p_role = 'owner' then
    raise exception 'A propriedade do espaço não pode ser alterada por aqui.';
  end if;
  if v_target.is_support then
    raise exception 'Acessos de suporte são somente leitura.';
  end if;
  -- administradores não podem promover/alterar outros administradores
  if v_my < 5 and (v_target.role = 'admin' or p_role = 'admin') then
    raise exception 'Somente o proprietário do espaço gerencia administradores.' using errcode = '42501';
  end if;
  update public.workspace_members set role = p_role where workspace_id = p_workspace and user_id = p_user;
end;
$$;

create or replace function public.remove_member(p_workspace uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_my integer := public.workspace_rank(p_workspace);
  v_target public.workspace_members;
begin
  select * into v_target from public.workspace_members where workspace_id = p_workspace and user_id = p_user;
  if v_target.user_id is null then raise exception 'Membro não encontrado.'; end if;
  if v_target.role = 'owner' then raise exception 'O proprietário não pode ser removido.'; end if;
  if p_user <> auth.uid() then
    if v_my < 4 or (v_my < 5 and v_target.role = 'admin') then
      raise exception 'Você não pode remover este membro.' using errcode = '42501';
    end if;
  end if;
  delete from public.workspace_members where workspace_id = p_workspace and user_id = p_user;
end;
$$;

-- Acesso de suporte temporário concedido EXPLICITAMENTE pelo dono do espaço
-- ao proprietário do aplicativo (somente leitura, expira automaticamente).
create or replace function public.grant_support_access(p_workspace uuid, p_hours integer default 24)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  perform public.require_rank(p_workspace, 5);
  if p_hours not between 1 and 168 then raise exception 'Duração inválida (1 a 168 horas).'; end if;
  select r.user_id into v_owner from public.app_roles r where r.role = 'owner' limit 1;
  if v_owner is null then raise exception 'Nenhum administrador de suporte configurado.'; end if;
  if v_owner = auth.uid() then raise exception 'Você já é o proprietário do aplicativo.'; end if;
  if exists (select 1 from public.workspace_members where workspace_id = p_workspace and user_id = v_owner and not is_support) then
    raise exception 'O administrador já é membro deste espaço.';
  end if;
  insert into public.workspace_members (workspace_id, user_id, role, is_support, expires_at, added_by)
  values (p_workspace, v_owner, 'viewer', true, now() + make_interval(hours => p_hours), auth.uid())
  on conflict (workspace_id, user_id) do update set expires_at = excluded.expires_at;
  insert into public.admin_audit_log (actor_id, action, target_type, target_id, details)
  values (auth.uid(), 'support.granted', 'workspace', p_workspace::text, jsonb_build_object('hours', p_hours));
end;
$$;

create or replace function public.revoke_support_access(p_workspace uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_rank(p_workspace, 5);
  delete from public.workspace_members where workspace_id = p_workspace and is_support;
  insert into public.admin_audit_log (actor_id, action, target_type, target_id)
  values (auth.uid(), 'support.revoked', 'workspace', p_workspace::text);
end;
$$;

-- ---------------------------------------------------------------------------
-- Convites
-- ---------------------------------------------------------------------------
create or replace function public.create_invite(p_workspace uuid, p_email text, p_role public.workspace_role default 'viewer', p_days integer default 7)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_id uuid;
  v_max integer;
  v_email text := nullif(lower(btrim(p_email)), '');
begin
  perform public.enforce_rate_limit('create_invite', 30, 3600);
  if p_days not between 1 and 30 then raise exception 'Validade inválida (1 a 30 dias).'; end if;
  if p_role = 'owner' then raise exception 'Não é possível convidar como proprietário.'; end if;

  if p_workspace is null then
    if not public.is_app_owner() then
      raise exception 'Apenas o proprietário do aplicativo emite convites de cadastro.' using errcode = '42501';
    end if;
  else
    perform public.require_rank(p_workspace, 4);
    if p_role = 'admin' and public.workspace_rank(p_workspace) < 5 then
      raise exception 'Somente o proprietário do espaço convida administradores.' using errcode = '42501';
    end if;
    if exists (select 1 from public.workspaces where id = p_workspace and kind = 'personal') then
      raise exception 'Espaços pessoais não podem ser compartilhados. Crie um espaço compartilhado.';
    end if;
    select (limits ->> 'max_members_per_workspace')::integer into v_max from public.app_settings where id = 1;
    if v_max is not null and (select count(*) from public.workspace_members where workspace_id = p_workspace) >= v_max then
      raise exception 'Limite de % membros por espaço atingido.', v_max using errcode = 'P0429';
    end if;
  end if;

  insert into public.invites (token_hash, workspace_id, email, role, created_by, expires_at)
  values (public.hash_token(v_token), p_workspace, v_email, p_role, auth.uid(), now() + make_interval(days => p_days))
  returning id into v_id;

  if p_workspace is null then
    insert into public.admin_audit_log (actor_id, action, target_type, target_id, details)
    values (auth.uid(), 'invite.created', 'invite', v_id::text, jsonb_build_object('email', v_email));
  end if;

  return jsonb_build_object('id', v_id, 'token', v_token);
end;
$$;

create or replace function public.revoke_invite(p_invite uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invites;
begin
  select * into v_inv from public.invites where id = p_invite;
  if v_inv.id is null then raise exception 'Convite não encontrado.'; end if;
  if v_inv.workspace_id is null then
    if not public.is_app_owner() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  else
    perform public.require_rank(v_inv.workspace_id, 4);
  end if;
  update public.invites set revoked_at = now() where id = p_invite and accepted_at is null;
end;
$$;

-- Informações públicas mínimas de um convite (para a tela de aceite)
create or replace function public.peek_invite(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_inv public.invites;
  v_ws text;
begin
  select * into v_inv from public.invites where token_hash = public.hash_token(p_token);
  if v_inv.id is null then return jsonb_build_object('valid', false, 'reason', 'not_found'); end if;
  if v_inv.revoked_at is not null then return jsonb_build_object('valid', false, 'reason', 'revoked'); end if;
  if v_inv.accepted_at is not null then return jsonb_build_object('valid', false, 'reason', 'accepted'); end if;
  if v_inv.expires_at <= now() then return jsonb_build_object('valid', false, 'reason', 'expired'); end if;
  select name into v_ws from public.workspaces where id = v_inv.workspace_id;
  return jsonb_build_object('valid', true, 'workspace_name', v_ws, 'role', v_inv.role,
                            'email_hint', case when v_inv.email is null then null
                                               else left(v_inv.email, 2) || '•••@' || split_part(v_inv.email, '@', 2) end,
                            'expires_at', v_inv.expires_at);
end;
$$;

create or replace function public.accept_invite(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invites;
  v_email text;
begin
  if auth.uid() is null then raise exception 'Faça login para aceitar o convite.' using errcode = '42501'; end if;
  perform public.enforce_rate_limit('accept_invite', 20, 3600);
  select * into v_inv from public.invites where token_hash = public.hash_token(p_token) for update;
  if v_inv.id is null or v_inv.revoked_at is not null or v_inv.accepted_at is not null or v_inv.expires_at <= now() then
    raise exception 'Convite inválido, expirado ou já utilizado.';
  end if;
  select email into v_email from public.profiles where id = auth.uid();
  if v_inv.email is not null and lower(v_inv.email) <> lower(v_email) then
    raise exception 'Este convite foi emitido para outro e-mail.' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles where id = auth.uid() and status in ('suspended', 'revoked')) then
    raise exception 'Conta suspensa.' using errcode = '42501';
  end if;

  update public.profiles set status = 'active' where id = auth.uid() and status = 'pending';

  if v_inv.workspace_id is not null then
    insert into public.workspace_members (workspace_id, user_id, role, added_by)
    values (v_inv.workspace_id, auth.uid(), v_inv.role, v_inv.created_by)
    on conflict (workspace_id, user_id) do update
      set role = case when public.role_rank(public.workspace_members.role) >= public.role_rank(excluded.role)
                      then public.workspace_members.role else excluded.role end,
          is_support = false, expires_at = null;
  end if;
  update public.invites set accepted_at = now(), accepted_by = auth.uid() where id = v_inv.id;
  return jsonb_build_object('workspace_id', v_inv.workspace_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Parcelamento: cria N parcelas de forma atômica e idempotente
-- (centavos residuais vão para a primeira parcela)
-- ---------------------------------------------------------------------------
create or replace function public.create_installment_purchase(
  p_workspace uuid, p_description text, p_total_cents bigint, p_installments integer, p_purchase_date date,
  p_card_id uuid default null, p_account_id uuid default null, p_category_id uuid default null,
  p_tags text[] default '{}', p_notes text default null, p_client_request_id uuid default null,
  p_first_status public.tx_status default 'pending'
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_group uuid;
  v_base bigint;
  v_rest bigint;
  v_date date;
  i integer;
begin
  if p_client_request_id is not null then
    select id into v_group from public.installment_groups where workspace_id = p_workspace and client_request_id = p_client_request_id;
    if v_group is not null then return v_group; end if;
  end if;
  if p_installments < 2 or p_installments > 72 then raise exception 'Número de parcelas inválido (2 a 72).'; end if;
  if p_total_cents < p_installments then raise exception 'Valor total muito baixo para o número de parcelas.'; end if;

  insert into public.installment_groups (workspace_id, description, total_cents, installments_count, purchase_date,
                                         card_id, account_id, category_id, client_request_id)
  values (p_workspace, btrim(p_description), p_total_cents, p_installments, p_purchase_date,
          p_card_id, p_account_id, p_category_id, p_client_request_id)
  returning id into v_group;

  v_base := p_total_cents / p_installments;
  v_rest := p_total_cents - v_base * p_installments;

  for i in 1..p_installments loop
    v_date := (p_purchase_date + make_interval(months => i - 1))::date;
    insert into public.transactions (workspace_id, kind, status, description, amount_cents, occurred_on, due_on,
                                     category_id, account_id, card_id, payment_method, tags, notes,
                                     installment_group_id, installment_number, installments_total)
    values (p_workspace, 'expense',
            case when p_card_id is not null then 'paid'::public.tx_status
                 when i = 1 then p_first_status else 'pending'::public.tx_status end,
            btrim(p_description) || ' (' || i || '/' || p_installments || ')',
            v_base + case when i = 1 then v_rest else 0 end,
            v_date, case when p_card_id is null then v_date end,
            p_category_id, p_account_id, p_card_id,
            case when p_card_id is not null then 'credit_card'::public.payment_method else 'boleto'::public.payment_method end,
            coalesce(p_tags, '{}'), p_notes, v_group, i, p_installments);
  end loop;
  return v_group;
end;
$$;

-- ---------------------------------------------------------------------------
-- Liquidação (pagamento/recebimento total ou parcial com juros e desconto)
-- ---------------------------------------------------------------------------
create or replace function public.settle_transaction(
  p_transaction uuid, p_principal_cents bigint, p_interest_cents bigint default 0, p_discount_cents bigint default 0,
  p_paid_on date default current_date, p_notes text default null, p_client_request_id uuid default null
)
returns public.transactions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tx public.transactions;
  v_remaining bigint;
begin
  select * into v_tx from public.transactions where id = p_transaction for update;
  if v_tx.id is null then raise exception 'Lançamento não encontrado.'; end if;
  if p_client_request_id is not null and exists (
    select 1 from public.tx_settlements where workspace_id = v_tx.workspace_id and client_request_id = p_client_request_id) then
    return v_tx;
  end if;
  if v_tx.kind not in ('income', 'expense') or v_tx.account_id is null then
    raise exception 'Apenas receitas e despesas em conta podem ser liquidadas por aqui.';
  end if;
  if v_tx.status = 'cancelled' then raise exception 'Lançamento cancelado.'; end if;

  -- Converte uma liquidação integral anterior (sem registros) em registro explícito
  if v_tx.status in ('paid', 'received') then
    raise exception 'Este lançamento já está liquidado.';
  end if;

  v_remaining := v_tx.amount_cents - v_tx.settled_principal_cents;
  if p_principal_cents <= 0 or p_principal_cents > v_remaining then
    raise exception 'Valor principal deve estar entre R$ 0,01 e o saldo em aberto.';
  end if;

  insert into public.tx_settlements (transaction_id, workspace_id, principal_cents, interest_cents, discount_cents, paid_on, notes, client_request_id)
  values (v_tx.id, v_tx.workspace_id, p_principal_cents, coalesce(p_interest_cents, 0), coalesce(p_discount_cents, 0), p_paid_on, p_notes, p_client_request_id);

  -- força o recálculo no trigger
  update public.transactions set updated_at = now() where id = v_tx.id returning * into v_tx;
  return v_tx;
end;
$$;

create or replace function public.undo_settlement(p_settlement uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tx uuid;
begin
  delete from public.tx_settlements where id = p_settlement returning transaction_id into v_tx;
  if v_tx is null then raise exception 'Pagamento não encontrado.'; end if;
  -- se não houver mais liquidações, volta para pendente
  update public.transactions
     set status = case when exists (select 1 from public.tx_settlements where transaction_id = v_tx) then status else 'pending' end
   where id = v_tx;
end;
$$;

-- ---------------------------------------------------------------------------
-- Recorrências: geração idempotente de ocorrências
-- Contas (débito em conta): gera até o horizonte (padrão 45 dias) como pendente.
-- Cartão (assinaturas): gera somente até hoje, como compra lançada na fatura.
-- ---------------------------------------------------------------------------
create or replace function public.generate_recurrences(p_workspace uuid, p_horizon date default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.recurrences;
  v_date date;
  v_limit date;
  v_created integer := 0;
  v_rows integer;
begin
  if auth.uid() is not null then
    perform public.require_rank(p_workspace, 1);
  end if;
  perform set_config('finance.system_insert', 'on', true);
  for r in
    select * from public.recurrences where workspace_id = p_workspace and status = 'active' for update skip locked
  loop
    v_limit := case when r.card_id is not null then current_date
                    else coalesce(p_horizon, current_date + 45) end;
    loop
      v_date := public.recurrence_date(r.start_date, r.frequency, r.interval_count, r.occurrences_generated);
      exit when v_date > v_limit or (r.end_date is not null and v_date > r.end_date);
      insert into public.transactions (workspace_id, kind, status, description, amount_cents, occurred_on, due_on,
                                       category_id, account_id, card_id, payment_method, tags, notes,
                                       recurrence_id, recurrence_date, created_by)
      values (r.workspace_id, r.kind,
              case when r.card_id is not null then 'paid'::public.tx_status else 'pending'::public.tx_status end,
              r.description, r.amount_cents, v_date, case when r.card_id is null then v_date end,
              r.category_id, r.account_id, r.card_id, r.payment_method, r.tags, r.notes,
              r.id, v_date, r.created_by)
      on conflict (recurrence_id, recurrence_date) do nothing;
      get diagnostics v_rows = row_count;
      v_created := v_created + v_rows;
      r.occurrences_generated := r.occurrences_generated + 1;
    end loop;
    update public.recurrences set occurrences_generated = r.occurrences_generated where id = r.id;
  end loop;
  perform set_config('finance.system_insert', 'off', true);
  return v_created;
end;
$$;

-- Para pg_cron (sem usuário): gera para todos os espaços
create or replace function public.generate_all_recurrences()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer := 0;
  w uuid;
begin
  for w in select distinct workspace_id from public.recurrences where status = 'active' loop
    v_total := v_total + public.generate_recurrences(w, null);
  end loop;
  return v_total;
end;
$$;
revoke all on function public.generate_all_recurrences() from public, anon, authenticated;

-- Altera a recorrência e, opcionalmente, todas as ocorrências futuras pendentes
create or replace function public.update_recurrence(
  p_recurrence uuid, p_changes jsonb, p_apply_from date default null
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_rec public.recurrences;
  v_count integer := 0;
begin
  select * into v_rec from public.recurrences where id = p_recurrence for update;
  if v_rec.id is null then raise exception 'Recorrência não encontrada.'; end if;

  update public.recurrences set
    description    = coalesce(p_changes ->> 'description', description),
    amount_cents   = coalesce((p_changes ->> 'amount_cents')::bigint, amount_cents),
    category_id    = case when p_changes ? 'category_id' then (p_changes ->> 'category_id')::uuid else category_id end,
    payment_method = case when p_changes ? 'payment_method' then (p_changes ->> 'payment_method')::public.payment_method else payment_method end,
    end_date       = case when p_changes ? 'end_date' then (p_changes ->> 'end_date')::date else end_date end,
    notes          = case when p_changes ? 'notes' then p_changes ->> 'notes' else notes end
  where id = p_recurrence
  returning * into v_rec;

  if p_apply_from is not null then
    perform set_config('finance.bulk_recurrence', 'on', true);
    update public.transactions t set
      description  = v_rec.description,
      amount_cents = v_rec.amount_cents,
      category_id  = v_rec.category_id,
      payment_method = coalesce(v_rec.payment_method, t.payment_method)
    where t.recurrence_id = v_rec.id
      and t.recurrence_date >= p_apply_from
      and t.status in ('planned', 'pending')
      and not t.recurrence_detached;
    get diagnostics v_count = row_count;
    perform set_config('finance.bulk_recurrence', 'off', true);

    if v_rec.end_date is not null then
      delete from public.transactions t
      where t.recurrence_id = v_rec.id and t.recurrence_date > v_rec.end_date
        and t.status in ('planned', 'pending') and not t.recurrence_detached;
    end if;
  end if;
  return v_count;
end;
$$;

create or replace function public.set_recurrence_status(p_recurrence uuid, p_status public.recurrence_status, p_remove_future boolean default false)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_rec public.recurrences;
begin
  select * into v_rec from public.recurrences where id = p_recurrence for update;
  if v_rec.id is null then raise exception 'Recorrência não encontrada.'; end if;
  if v_rec.status = 'cancelled' and p_status <> 'cancelled' then
    raise exception 'Recorrências canceladas não podem ser reativadas. Crie uma nova.';
  end if;
  -- ao retomar, pula ocorrências passadas (não gera cobranças retroativas)
  if p_status = 'active' and v_rec.status = 'paused' then
    while public.recurrence_date(v_rec.start_date, v_rec.frequency, v_rec.interval_count, v_rec.occurrences_generated) < current_date loop
      v_rec.occurrences_generated := v_rec.occurrences_generated + 1;
    end loop;
  end if;
  update public.recurrences set status = p_status, occurrences_generated = v_rec.occurrences_generated where id = p_recurrence;
  if p_remove_future then
    delete from public.transactions
    where recurrence_id = p_recurrence and recurrence_date >= current_date
      and status in ('planned', 'pending') and not recurrence_detached;
  end if;
end;
$$;

-- Marca ocorrência editada individualmente (não será alterada por "todas as futuras")
create or replace function public.tg_detach_recurrence()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.recurrence_id is not null and current_setting('finance.bulk_recurrence', true) is distinct from 'on'
     and (new.amount_cents <> old.amount_cents or new.description <> old.description
          or new.category_id is distinct from old.category_id or new.occurred_on <> old.occurred_on) then
    new.recurrence_detached := true;
  end if;
  return new;
end;
$$;
create trigger transactions_detach_recurrence before update on public.transactions
  for each row when (pg_trigger_depth() = 0) execute function public.tg_detach_recurrence();

-- ---------------------------------------------------------------------------
-- Notificações in-app: orçamentos (50/75/90/100%) e vencimentos
-- ---------------------------------------------------------------------------
create or replace function public.refresh_notifications(p_workspace uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_month date := date_trunc('month', current_date)::date;
  v_prefs public.user_preferences;
  v_count integer := 0;
  v_rows integer;
  b record;
  t record;
  th integer;
begin
  perform public.require_rank(p_workspace, 1);
  select * into v_prefs from public.user_preferences where user_id = v_uid;

  if coalesce(v_prefs.budget_alerts, true) then
    for b in
      select bu.id, bu.limit_cents, bu.alert_thresholds, c.name,
             coalesce((select sum(tx.amount_cents) from public.transactions tx
                       left join public.categories sc on sc.id = tx.category_id
                       where tx.workspace_id = p_workspace and tx.kind = 'expense' and tx.status <> 'cancelled'
                         and tx.occurred_on >= v_month and tx.occurred_on < (v_month + interval '1 month')
                         and (tx.category_id = c.id or sc.parent_id = c.id)), 0) as spent
      from public.budgets bu join public.categories c on c.id = bu.category_id
      where bu.workspace_id = p_workspace and bu.month = v_month
    loop
      foreach th in array b.alert_thresholds loop
        if b.spent * 100 >= b.limit_cents * th then
          insert into public.notifications (user_id, workspace_id, kind, title, body, link, ref_key)
          values (v_uid, p_workspace, 'budget',
                  case when th >= 100 then 'Orçamento de ' || b.name || ' estourado'
                       else 'Orçamento de ' || b.name || ' em ' || th || '%' end,
                  'Você já utilizou ' || floor(b.spent * 100.0 / b.limit_cents) || '% do limite deste mês.',
                  '/orcamentos', 'budget:' || b.id || ':' || th)
          on conflict (user_id, ref_key) do nothing;
          get diagnostics v_rows = row_count;
          v_count := v_count + v_rows;
        end if;
      end loop;
    end loop;
  end if;

  if coalesce(v_prefs.due_alerts, true) then
    for t in
      select tx.id, tx.description, tx.due_on, tx.kind
      from public.transactions tx
      where tx.workspace_id = p_workspace and tx.status in ('planned', 'pending')
        and tx.due_on is not null and tx.due_on <= current_date + 3
        and tx.due_on >= current_date - 30
    loop
      insert into public.notifications (user_id, workspace_id, kind, title, body, link, ref_key)
      values (v_uid, p_workspace,
              case when t.due_on < current_date then 'overdue' else 'due' end,
              case when t.due_on < current_date then 'Em atraso: ' || t.description
                   when t.due_on = current_date then 'Vence hoje: ' || t.description
                   else 'Vence em breve: ' || t.description end,
              case when t.kind = 'income' then 'Recebimento previsto para ' else 'Vencimento em ' end || to_char(t.due_on, 'DD/MM/YYYY') || '.',
              '/compromissos',
              'due:' || t.id || ':' || case when t.due_on < current_date then 'late' else t.due_on::text end)
      on conflict (user_id, ref_key) do nothing;
      get diagnostics v_rows = row_count;
      v_count := v_count + v_rows;
    end loop;
  end if;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Copiar orçamentos do mês anterior
-- ---------------------------------------------------------------------------
create or replace function public.copy_budgets(p_workspace uuid, p_from date, p_to date)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_rows integer;
begin
  insert into public.budgets (workspace_id, category_id, month, limit_cents, alert_thresholds)
  select workspace_id, category_id, date_trunc('month', p_to)::date, limit_cents, alert_thresholds
  from public.budgets where workspace_id = p_workspace and month = date_trunc('month', p_from)::date
  on conflict (workspace_id, category_id, month) do nothing;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

-- ---------------------------------------------------------------------------
-- Erros do cliente (sanitizados, com rate limit)
-- ---------------------------------------------------------------------------
create or replace function public.log_client_error(p_message text, p_route text default null, p_version text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.enforce_rate_limit('client_error', 30, 3600);
  insert into public.client_errors (user_id, app_version, route, message)
  values (auth.uid(), left(p_version, 40), left(p_route, 200), left(p_message, 500));
end;
$$;

-- ---------------------------------------------------------------------------
-- Exclusão dos dados do usuário (LGPD). A remoção do login (auth.users) é feita
-- pela Edge Function delete-account, que usa a service_role no servidor.
-- ---------------------------------------------------------------------------
create or replace function public.delete_my_data()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Não autenticado.' using errcode = '42501'; end if;
  if public.is_app_owner() then
    raise exception 'O proprietário do aplicativo deve transferir a função antes de excluir a conta.';
  end if;
  delete from public.workspaces where owner_id = auth.uid();
  delete from public.workspace_members where user_id = auth.uid();
  delete from public.notifications where user_id = auth.uid();
  update public.profiles set status = 'revoked', full_name = null, avatar_url = null, status_reason = 'Exclusão solicitada pelo titular'
  where id = auth.uid();
end;
$$;
