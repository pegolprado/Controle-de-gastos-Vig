#!/usr/bin/env bash
# Restaura um backup gerado por backup.sh. ATENÇÃO: substitui o banco e os arquivos atuais.
# Uso direto:  PGURL=... STORAGE_DIR=... ./scripts/restore.sh atlas-backup-XXXX.tar.gz[.gpg]
# Com Docker:  ./scripts/restore.sh --docker atlas-backup-XXXX.tar.gz[.gpg]
set -euo pipefail
DOCKER=0
if [[ "${1:-}" == "--docker" ]]; then DOCKER=1; shift; fi
FILE="${1:?informe o arquivo de backup}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
if [[ "$FILE" == *.gpg ]]; then
  : "${BACKUP_PASSPHRASE:?defina BACKUP_PASSPHRASE}"
  gpg --batch --pinentry-mode loopback --passphrase "$BACKUP_PASSPHRASE" -d -o "$WORK/b.tar.gz" "$FILE"
  FILE="$WORK/b.tar.gz"
fi
tar -C "$WORK" -xzf "$FILE"
DIR="$(find "$WORK" -maxdepth 1 -type d -name 'atlas-backup-*' | head -1)"
(cd "$DIR" && sha256sum -c SHA256SUMS)   # integridade antes de restaurar
if [[ $DOCKER == 1 ]]; then
  docker compose stop api worker
  docker compose exec -T db psql -U atlas -d postgres -c "DROP DATABASE IF EXISTS atlas WITH (FORCE);" -c "CREATE DATABASE atlas OWNER atlas;"
  docker compose exec -T db pg_restore -U atlas -d atlas --no-owner < "$DIR/db.dump"
  docker compose run --rm -T --entrypoint sh api -c "rm -rf /data/storage/* && tar -C /data -xf -" < "$DIR/storage.tar"
  docker compose start api worker
else
  : "${PGURL:?defina PGURL}" "${STORAGE_DIR:?defina STORAGE_DIR}"
  pg_restore --clean --if-exists --no-owner -d "$PGURL" "$DIR/db.dump"
  rm -rf "$STORAGE_DIR"
  tar -C "$(dirname "$STORAGE_DIR")" -xf "$DIR/storage.tar"
fi
echo "restauração concluída"
