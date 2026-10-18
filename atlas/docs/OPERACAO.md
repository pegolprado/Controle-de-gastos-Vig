# Operação: backup, restauração, monitoramento e retenção

## Backup

`scripts/backup.sh` gera um pacote com o banco (`pg_dump` formato custom), todos os arquivos originais e
relatórios, e um manifesto `SHA256SUMS`. Com `BACKUP_PASSPHRASE` definida, o pacote é cifrado (GPG, AES-256).

```bash
cd ~/Controle-de-gastos-Vig/atlas
BACKUP_PASSPHRASE='frase-longa-guardada-em-cofre' ./scripts/backup.sh --docker ~/backups
```

Agendamento diário (crontab do usuário `atlas`):

```
17 3 * * * cd ~/Controle-de-gastos-Vig/atlas && BACKUP_PASSPHRASE=$(cat ~/.atlas-backup-pass) ./scripts/backup.sh --docker ~/backups >> ~/backups/log 2>&1 && find ~/backups -name 'atlas-backup-*' -mtime +30 -delete
```

Copie os backups para fora do servidor (outro provedor ou mídia institucional). Guarde a frase em cofre de senhas:
sem ela o backup cifrado não pode ser restaurado.

## Restauração

```bash
BACKUP_PASSPHRASE=... ./scripts/restore.sh --docker ~/backups/atlas-backup-AAAAMMDDTHHMMSSZ.tar.gz.gpg
```

A restauração confere o `SHA256SUMS` antes de alterar qualquer coisa, para a API e o worker, substitui banco e
arquivos e religa os serviços.

### Teste de restauração

`scripts/test_backup_restore.sh` faz um backup, restaura num banco novo e compara contagens de tabelas, os hashes
de todos os arquivos originais e a cadeia de auditoria. Rode-o periodicamente (ex.: mensalmente) em ambiente de teste.
Resultado registrado em [TESTES.md](TESTES.md).

## Monitoramento

- *Monitoramento operacional* (perfil administrador): tamanho do banco e dos arquivos, fila de tarefas, falhas
  recentes, último sinal do worker e limites configurados.
- `GET /api/health` para monitoramento externo (retorna também tarefas paradas há mais de 5 minutos).
- Logs: `docker compose logs -f api worker web`.
- Tarefas interrompidas (queda do worker) voltam sozinhas para a fila até 3 vezes; a reimportação é idempotente
  (registros parciais da tentativa anterior são removidos antes).

## Retenção e descarte

Cada caso pode ter data de retenção. *Verificar retenção* lista os casos vencidos; a exclusão é feita caso a caso,
exigindo digitar o código do caso e justificar, e fica registrada na auditoria. Não há descarte automático.

## Auditoria

A trilha é encadeada por hash (cada linha guarda o hash da anterior). *Auditoria → Verificar integridade da trilha*
recalcula a cadeia e aponta a primeira linha adulterada. Pela linha de comando: `docker compose exec api python -m app.cli verify-audit`.

## Escala

- Mais tarefas simultâneas: `docker compose up -d --scale worker=3` (a fila usa `SKIP LOCKED`).
- `WEB_WORKERS` no `.env` define os processos da API.
- Para volumes muito grandes, aumente RAM do PostgreSQL (`shared_buffers`, `work_mem`) e considere particionar
  `events` por caso (ver ARQUITETURA.md).
