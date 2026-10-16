#!/usr/bin/env bash
# Restaura um backup gerado por backup.sh em um projeto Supabase NOVO (vazio,
# SEM as migrações aplicadas) ou em um PostgreSQL de homologação.
#
# Ordem segura:
#   1. dados de login (auth.users / auth.identities), antes dos gatilhos existirem
#   2. schema public completo (tabelas, funções, RLS, dados)
#   3. recria os gatilhos que ligam auth.users ao app
#
# Uso: TARGET_DB_URL="postgresql://..." ./scripts/restore.sh arquivo.dump[.gpg]
set -euo pipefail
: "${TARGET_DB_URL:?Defina TARGET_DB_URL}"
FILE="${1:?Informe o arquivo de backup}"
if [[ "$FILE" == *.gpg ]]; then
  : "${BACKUP_PASSPHRASE:?Defina BACKUP_PASSPHRASE para descriptografar}"
  gpg --batch --yes --pinentry-mode loopback --passphrase "$BACKUP_PASSPHRASE" -o "${FILE%.gpg}" -d "$FILE"
  FILE="${FILE%.gpg}"
fi

psql "$TARGET_DB_URL" -X -v ON_ERROR_STOP=1 -q -c "create schema if not exists extensions; create extension if not exists pg_trgm with schema extensions;"

echo "1/3 Restaurando logins (auth.users, auth.identities)…"
pg_restore --dbname="$TARGET_DB_URL" --data-only --no-owner --schema=auth --table=users --table=identities "$FILE" 2>&1 \
  | grep -v 'relation "auth.identities" does not exist' || true

echo "2/3 Restaurando schema public…"
pg_restore --dbname="$TARGET_DB_URL" --no-owner --single-transaction --schema=public "$FILE"

echo "3/3 Recriando gatilhos de autenticação…"
psql "$TARGET_DB_URL" -X -v ON_ERROR_STOP=1 -q <<'SQL'
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed after update of email on auth.users for each row execute function public.handle_user_email_change();
SQL

psql "$TARGET_DB_URL" -X -c "select (select count(*) from public.profiles) as perfis, (select count(*) from public.workspaces) as espacos, (select count(*) from public.transactions) as lancamentos;"
echo "Restauração concluída. Valide o acesso e só então aponte o app para este banco."
