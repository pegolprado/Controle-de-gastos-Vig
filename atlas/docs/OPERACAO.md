# Operação

## Usuários
- Criar o primeiro administrador: `docker compose exec api python -m app.cli create-admin --email ... --name "..."`.
- Demais usuários: tela **Usuários** (somente administradores). Cada novo usuário recebe um **link de ativação** de
  uso único (72 h) — entregue por canal seguro. Sem SMTP configurado, o administrador também gera os links de
  redefinição de senha.
- Por usuário: perfil (Administrador/Usuário), **pode exportar**, desativar, desbloquear, encerrar sessões, excluir.

## Backup
O servidor guarda apenas a lista de usuários.

```bash
./scripts/backup.sh ~/backups                       # cópia consistente do SQLite + SHA-256
BACKUP_PASSPHRASE='...' ./scripts/backup.sh ~/bkp    # cifrado com GPG (AES-256)
./scripts/restore.sh ~/backups/marx-usuarios-AAAAMMDDTHHMMSSZ.db
```

Agendamento diário (crontab do usuário `marx`):
`15 3 * * * cd ~/Controle-de-gastos-Vig/atlas && BACKUP_PASSPHRASE=... ./scripts/backup.sh ~/backups`

## Atualização
```bash
cd ~/Controle-de-gastos-Vig && git pull && cd atlas && ./scripts/backup.sh ~/backups && docker compose up -d --build
```
Usuários com uma análise aberta durante a atualização continuam trabalhando; ao recarregar a página recebem a nova
versão (e a análise em memória é apagada, como sempre).

## Problemas comuns
| Sintoma | Causa provável / ação |
|---|---|
| Certificado não emitido | DNS ainda não aponta para o servidor, ou portas 80/443 fechadas. `docker compose logs web`. |
| “Sessão expirada” e análise apagada | Inatividade maior que `IDLE_MINUTES` ou sessão maior que `SESSION_MINUTES`. Ajuste no `.env`. |
| Navegador lento com arquivo enorme | O processamento usa a memória do computador do usuário. Feche outras abas, use 8 GB+ de RAM, divida o arquivo por período. |
| Mapa sem fundo | Provedor de tiles bloqueado ou `MAP_TILE_URL` vazio; as estações continuam desenhadas. |
| Usuário bloqueado | Tentativas de senha erradas; **Usuários → Desbloquear**. |
