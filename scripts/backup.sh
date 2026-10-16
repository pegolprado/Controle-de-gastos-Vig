#!/usr/bin/env bash
# Backup lógico do banco (formato custom do pg_dump, compactado).
# Mantém GRANTs: sem eles a cópia restaurada bloquearia os usuários (verificado em npm run test:db).
# Uso: SUPABASE_DB_URL="postgresql://..." ./scripts/backup.sh [arquivo]
# Opcional: BACKUP_PASSPHRASE para criptografar com GPG (AES256).
set -euo pipefail
: "${SUPABASE_DB_URL:?Defina SUPABASE_DB_URL (Project Settings → Database → Connection string, modo Session)}"
OUT="${1:-backup-$(date -u +%Y%m%dT%H%M%SZ).dump}"
pg_dump "$SUPABASE_DB_URL" --format=custom --no-owner \
  --schema=public --schema=auth --schema=storage \
  --exclude-table-data='auth.audit_log_entries' --exclude-table-data='public.rate_limits' \
  --file="$OUT"
if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
  gpg --batch --yes --pinentry-mode loopback --passphrase "$BACKUP_PASSPHRASE" --symmetric --cipher-algo AES256 -o "$OUT.gpg" "$OUT"
  rm -f "$OUT"
  OUT="$OUT.gpg"
fi
echo "Backup gerado: $OUT ($(du -h "$OUT" | cut -f1))"
