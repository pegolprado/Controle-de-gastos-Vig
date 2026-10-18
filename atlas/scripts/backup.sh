#!/usr/bin/env bash
# Backup completo: banco (pg_dump formato custom) + arquivos originais/relatórios + manifesto SHA-256.
# Uso direto:   PGURL=postgresql://user:senha@host/atlas STORAGE_DIR=/caminho ./scripts/backup.sh [destino]
# Com Docker:   ./scripts/backup.sh --docker [destino]
# Se BACKUP_PASSPHRASE estiver definida, o pacote é cifrado com GPG (AES-256).
set -euo pipefail
DOCKER=0
if [[ "${1:-}" == "--docker" ]]; then DOCKER=1; shift; fi
DEST="${1:-./backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$DEST" "$WORK/atlas-backup-$STAMP"
OUT="$WORK/atlas-backup-$STAMP"

if [[ $DOCKER == 1 ]]; then
  docker compose exec -T db pg_dump -U atlas -d atlas -Fc --no-owner > "$OUT/db.dump"
  docker compose exec -T api tar -C /data -cf - storage > "$OUT/storage.tar"
else
  : "${PGURL:?defina PGURL}" "${STORAGE_DIR:?defina STORAGE_DIR}"
  pg_dump "$PGURL" -Fc --no-owner -f "$OUT/db.dump"
  tar -C "$(dirname "$STORAGE_DIR")" -cf "$OUT/storage.tar" "$(basename "$STORAGE_DIR")"
fi
(cd "$OUT" && sha256sum db.dump storage.tar > SHA256SUMS)
echo "criado_em=$STAMP" > "$OUT/INFO"
tar -C "$WORK" -czf "$DEST/atlas-backup-$STAMP.tar.gz" "atlas-backup-$STAMP"
FINAL="$DEST/atlas-backup-$STAMP.tar.gz"
if [[ -n "${BACKUP_PASSPHRASE:-}" ]]; then
  gpg --batch --yes --pinentry-mode loopback --passphrase "$BACKUP_PASSPHRASE" --symmetric --cipher-algo AES256 -o "$FINAL.gpg" "$FINAL"
  rm -f "$FINAL"
  FINAL="$FINAL.gpg"
fi
chmod 600 "$FINAL"
echo "$FINAL"
