#!/usr/bin/env bash
# Teste de restauração: faz backup do banco de origem, restaura num banco NOVO e
# compara contagens de tabelas, a cadeia de auditoria e os hashes dos arquivos.
# Uso: SRC_PGURL=postgresql://u@h/atlas TMP_PGURL_ADMIN=postgresql://u@h/postgres \
#      RESTORE_PGURL_FMT='postgresql://u@h/%DB%' STORAGE_DIR=... PY=python ./scripts/test_backup_restore.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PY="${PY:-python3}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
export BACKUP_PASSPHRASE="teste-restauracao-$(date +%s)"
FILE="$(PGURL="$SRC_PGURL" STORAGE_DIR="$STORAGE_DIR" "$HERE/backup.sh" "$WORK")"
echo "backup: $FILE ($(du -h "$FILE" | cut -f1))"
DB="atlas_restore_$(date +%s)"
psql "$TMP_PGURL_ADMIN" -qc "CREATE DATABASE $DB"
RESTORE_URL="${RESTORE_PGURL_FMT//%DB%/$DB}"
mkdir -p "$WORK/restored"
PGURL="$RESTORE_URL" STORAGE_DIR="$WORK/restored/storage" "$HERE/restore.sh" "$FILE"
Q="SELECT string_agg(t || '=' || n, ' ' ORDER BY t) FROM (SELECT 'cases' t, count(*) n FROM cases UNION ALL SELECT 'events', count(*) FROM events UNION ALL SELECT 'source_files', count(*) FROM source_files UNION ALL SELECT 'erb_cells', count(*) FROM erb_cells UNION ALL SELECT 'audit_log', count(*) FROM audit_log UNION ALL SELECT 'reports', count(*) FROM reports) x"
A="$(psql "$SRC_PGURL" -tAc "$Q")"
B="$(psql "$RESTORE_URL" -tAc "$Q")"
echo "origem:     $A"
echo "restaurado: $B"
[[ "$A" == "$B" ]] || { echo "FALHA: contagens diferentes"; exit 1; }
# hashes dos originais restaurados conferem com o banco restaurado
BAD=0
while IFS='|' read -r key sha; do
  got="$(sha256sum "$WORK/restored/storage/$key" | cut -d' ' -f1)"
  [[ "$got" == "$sha" ]] || { echo "hash diverge: $key"; BAD=1; }
done < <(psql "$RESTORE_URL" -tAc "SELECT storage_key, sha256 FROM source_files")
[[ $BAD == 0 ]] || exit 1
echo "hashes dos arquivos originais: OK"
DB_URL_SQLA="${RESTORE_URL/postgresql:/postgresql+psycopg:}"
(cd "$HERE/../backend" && DATABASE_URL="$DB_URL_SQLA" STORAGE_DIR="$WORK/restored/storage" "$PY" -m app.cli verify-audit)
psql "$TMP_PGURL_ADMIN" -qc "DROP DATABASE $DB WITH (FORCE)"
echo "TESTE DE RESTAURAÇÃO: OK"
