# Operação: publicar, atualizar, reverter, fazer backup e restaurar

## 1. Publicar uma nova versão

1. Crie uma branch e desenvolva. Valide localmente:
   ```bash
   npm run check        # lint + tipos + unitários + banco (PostgreSQL real)
   npm run test:e2e     # fluxos de tela, desktop e celular
   ```
2. Aumente a versão em `package.json` (semântica: `1.4.0` → `1.5.0`). Ela aparece no app, no `version.json` e no painel.
3. Abra um Pull Request para `develop`. O **CI** roda lint, tipos, testes unitários, build, migrações + RLS num PostgreSQL limpo e Playwright.
4. Ao mesclar em `develop`, a homologação é publicada. Teste com um usuário real.
5. Abra o PR `develop → main`. Ao mesclar (e aprovar o environment `production`, se configurado), o deploy:
   1. aplica as migrações no banco de produção;
   2. publica a Edge Function;
   3. publica o front-end no Cloudflare Pages;
   4. registra a versão em *Administração → Versões*.
6. Os usuários recebem o aviso **"Nova versão disponível"** em até 30 minutos (ou ao voltar para a aba) e atualizam sem reinstalar.

### Forçar atualização

Em *Administração → Configurações → Versão mínima exigida*, informe a versão (ex.: `1.5.0`). Clientes abaixo dela atualizam sozinhos **assim que não houver formulário aberto nem gravação em andamento**. Nenhum lançamento em digitação é perdido. Se a pessoa tentar fechar a aba com dados não salvos, o navegador pede confirmação.

### Aviso geral aos usuários

*Administração → Configurações → Aviso para todos os usuários* (ex.: "Manutenção domingo às 22h").

## 2. Três tipos de atualização, três estratégias

| Tipo | Exemplo | Estratégia |
|---|---|---|
| **Código** | nova tela, correção visual | deploy imutável no Cloudflare; o service worker troca a versão sob controle do usuário; `cleanupOutdatedCaches` remove os arquivos antigos; `index.html`, `sw.js` e `version.json` são servidos sem cache |
| **Dados** | ajustar configurações, corrigir registros | configurações pelo painel (auditado). Correções de dados em massa: script SQL revisado, executado **numa transação**, testado em homologação e com backup feito antes |
| **Banco (schema)** | nova coluna/tabela | migração versionada em `supabase/migrations/AAAAMMDDHHMMSS_nome.sql`, aplicada pelo CI **antes** do front-end |

### Regras para migrações seguras

- **Expandir → migrar → contrair.** Primeiro adicione (coluna nula ou com default, tabela nova), publique o código que usa o novo e o antigo, e só numa versão posterior remova o antigo.
- Nunca use `DROP`/`RENAME` destrutivo na mesma versão que muda o código. O front-end antigo pode continuar aberto em celulares por algumas horas.
- Toda migração passa no `npm run test:db`, que aplica **todas** as migrações num banco limpo e roda os testes de RLS e de regras.
- Antes de uma migração arriscada, rode o workflow **Backup do banco** manualmente.
- Migração com defeito: crie uma **nova** migração corretiva (não edite migrações já aplicadas).

## 3. Reverter uma versão problemática

**Front-end (instantâneo):**

1. Cloudflare → Workers & Pages → projeto → **Deployments**.
2. Na implantação anterior, use **⋯ → Rollback to this deployment**.
3. Em *Administração → Versões*, marque a versão como **revertida** (fica registrado).
4. Os clientes detectam o `version.json` diferente e recebem o aviso de atualização.
5. Corrija na branch, aumente a versão (ex.: `1.5.1`) e publique normalmente.

Alternativa via Git: `git revert <commit>` + push em `main` (passa pelo CI).

**Banco:** como as migrações são aditivas, reverter o front-end costuma bastar: o código antigo ignora colunas novas. Se for preciso desfazer o schema, escreva uma migração reversa revisada. Em perda de dados, restaure o backup (seção 5) primeiro em homologação.

## 4. Backup

| Camada | Como | Frequência | Retenção |
|---|---|---|---|
| Banco (dados + schema + permissões) | workflow **Backup do banco** (`.github/workflows/backup.yml`), `pg_dump` criptografado com AES-256 (GPG) | diário, 03:17 de Brasília, ou manual | 30 dias como artefato do GitHub |
| Banco (plano pago Pro) | backups diários e PITR do Supabase | diário | 7 dias ou mais |
| Comprovantes (Storage) | não entram no `pg_dump`. Use a API S3 do Supabase Storage com `rclone sync` para um bucket próprio ou baixe pelo painel | semanal (recomendado) | a definir |
| Código | Git/GitHub | a cada commit | permanente |

> O plano **gratuito** do Supabase não inclui backups que você possa baixar. Por isso o backup diário pelo GitHub Actions é essencial. Projetos gratuitos sem atividade por 7 dias são pausados; o workflow `keepalive.yml` faz uma consulta pública por dia para evitar isso, mesmo sem o backup configurado.

Backup manual pelo seu computador:

```bash
SUPABASE_DB_URL="postgresql://postgres.REF:SENHA@aws-0-sa-east-1.pooler.supabase.com:5432/postgres" \
BACKUP_PASSPHRASE="senha-forte" ./scripts/backup.sh
```

Use a string de conexão **Session pooler** (porta 5432 do pooler). A conexão direta do plano grátis é só IPv6.

## 5. Restaurar (procedimento testado)

O procedimento abaixo é exercitado automaticamente em `npm run test:db`: gera dados, faz o backup com `scripts/backup.sh`, restaura num banco vazio com `scripts/restore.sh`, compara as contagens e somas e roda o teste de isolamento (RLS + cadastro) na cópia restaurada.

1. Crie um projeto Supabase **novo e vazio**. **Não** aplique as migrações: o backup já contém o schema.
2. Restaure:
   ```bash
   TARGET_DB_URL="postgresql://postgres.NOVOREF:SENHA@...pooler.supabase.com:5432/postgres" \
   BACKUP_PASSPHRASE="senha-forte" ./scripts/restore.sh backup-20261016.dump.gpg
   ```
   O script restaura os logins (`auth.users`), depois o schema `public` completo (tabelas, funções, RLS, permissões, dados) e recria os gatilhos de cadastro.
3. Valide: entre com um usuário real e confira saldos e lançamentos.
4. Registre o histórico de migrações para a CLI reconhecer o estado: `npx supabase migration repair --status applied <versões>` (liste com `ls supabase/migrations`).
5. Aponte o front-end para o novo projeto (variáveis `VITE_SUPABASE_*`) e publique.
6. Restaure os comprovantes do Storage, se houver.

## 6. Retenção e exclusão de dados

| Dado | Retenção |
|---|---|
| Lançamentos e cadastros | enquanto o espaço existir |
| Histórico de auditoria financeira | 5 anos (`purge_old_records`) |
| Erros técnicos do cliente | 90 dias |
| Notificações | 180 dias |
| Convites não usados | 90 dias após expirar |
| Conta excluída pelo titular | dados apagados imediatamente; o login é removido pela Edge Function |

## 7. Monitoramento

- *Administração → Visão geral*: usuários, cadastros, volume de lançamentos, erros nas últimas 24 h, tamanho do banco, versão publicada × versão local.
- *Administração → Erros*: mensagens técnicas sanitizadas no navegador, sem tokens, e-mails ou números.
- Supabase → **Reports/Logs**: API, Auth e banco.
- Limites do plano grátis: 500 MB de banco, 1 GB de Storage, 50 mil usuários ativos por mês, 5 GB de banda de saída. O tamanho atual aparece no painel administrativo.
