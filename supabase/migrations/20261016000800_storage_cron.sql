-- =============================================================================
-- FINANCE OS — 0800 Comprovantes (Storage) e tarefas agendadas (pg_cron)
-- Caminho do arquivo: <workspace_id>/<transaction_id>/<nome>
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
on conflict (id) do nothing;

create or replace function public.storage_workspace(p_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return split_part(p_name, '/', 1)::uuid;
exception when others then
  return null;
end;
$$;
grant execute on function public.storage_workspace(text) to authenticated;

create policy receipts_select on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and public.storage_workspace(name) in (select public.my_workspace_ids(1)));
create policy receipts_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and public.storage_workspace(name) in (select public.my_workspace_ids(2)));
create policy receipts_delete on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and public.storage_workspace(name) in (select public.my_workspace_ids(2)));

-- pg_cron é opcional (habilite em Database → Extensions). Quando presente,
-- agenda geração de recorrências e limpeza de registros técnicos.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
      perform cron.schedule('finance-generate-recurrences', '15 3 * * *', 'select public.generate_all_recurrences()');
      perform cron.schedule('finance-purge', '45 3 * * 0', 'select public.purge_old_records()');
    exception when others then
      raise notice 'pg_cron indisponível: %', sqlerrm;
    end;
  end if;
end;
$$;
