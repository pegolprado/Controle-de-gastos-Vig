-- =============================================================================
-- Finance MV — 0900 Nome definitivo do aplicativo
-- Só troca o nome se ele ainda for o provisório (não sobrescreve um nome que o
-- proprietário já tenha definido pelo painel de Administração).
-- =============================================================================
alter table public.app_settings alter column app_name set default 'Finance MV';
update public.app_settings set app_name = 'Finance MV' where id = 1 and app_name = 'FINANCE OS';
