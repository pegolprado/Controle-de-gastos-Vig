#!/usr/bin/env bash
# Backup da ÚNICA coisa que o servidor guarda: a lista de usuários (SQLite).
# Não há arquivos, consultas nem relatórios no servidor para copiar.
# Uso (na pasta atlas, com o Docker rodando):   ./scripts/backup.sh [destino]
# Se BACKUP_PASSPHRASE estiver definida, a cópia é cifrada com GPG (AES-256).
set -euo pipefail
DEST="${1:-./backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$DEST"
OUT="$DEST/marx-usuarios-$STAMP.db"
docker compose exec -T api python -c "
import sqlite3, sys
src = sqlite3.connect('/data/marx-usuarios.db'); dst = sqlite3.connect('/tmp/copia.db')
src.backup(dst); dst.close(); sys.stdout.buffer.write(open('/tmp/copia.db','rb').read())
" > "$OUT"
sha256sum "$OUT" > "$OUT.sha256"
if [[ -n "${BACKUP_PASSPHRASE:-}" ]]; then
  gpg --batch --yes --pinentry-mode loopback --passphrase "$BACKUP_PASSPHRASE" --symmetric --cipher-algo AES256 -o "$OUT.gpg" "$OUT"
  rm -f "$OUT"
  echo "backup cifrado: $OUT.gpg"
else
  echo "backup: $OUT"
fi
