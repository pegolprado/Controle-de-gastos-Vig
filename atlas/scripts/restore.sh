#!/usr/bin/env bash
# Restaura a lista de usuários a partir de um backup feito por backup.sh.
# Uso: ./scripts/restore.sh arquivo.db[.gpg]
set -euo pipefail
IN="${1:?informe o arquivo de backup}"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
if [[ "$IN" == *.gpg ]]; then
  gpg --batch --yes --pinentry-mode loopback --passphrase "${BACKUP_PASSPHRASE:?defina BACKUP_PASSPHRASE}" -d -o "$TMP" "$IN"
else
  cp "$IN" "$TMP"
fi
python3 -c "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); assert c.execute('PRAGMA integrity_check').fetchone()[0]=='ok'; print('usuários no backup:', c.execute('SELECT count(*) FROM users').fetchone()[0])" "$TMP"
docker compose stop api
docker compose run --rm -T -v "$TMP:/restore.db:ro" api python -c "import shutil; shutil.copy('/restore.db', '/data/marx-usuarios.db')"
docker compose start api
echo "restaurado."
