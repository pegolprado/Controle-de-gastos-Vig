# Configuração e publicação (100% gratuita)

Tempo estimado: 30 a 40 minutos. Você precisa de contas gratuitas no **Supabase**, no **Cloudflare** e no **GitHub**.

## 1. Banco de dados e login (Supabase)

1. Em <https://supabase.com/dashboard>, crie um projeto. Região sugerida: **South America (São Paulo)**. Guarde a senha do banco.
2. Em **Project Settings → API**, anote:
   - **Project URL**, que será `VITE_SUPABASE_URL`;
   - **anon / publishable key**, que será `VITE_SUPABASE_ANON_KEY`. Ela é pública por definição; o acesso é protegido por RLS;
   - **service_role / secret key**: **nunca** vai para o front-end. Só use em segredos do GitHub (opcional).
3. Aplique as migrações. Escolha uma das opções:
   - **CLI (recomendado):**
     ```bash
     npx supabase login
     npx supabase link --project-ref SEU_REF
     npx supabase db push
     ```
   - **Painel:** em **SQL Editor**, execute cada arquivo de `supabase/migrations/` **na ordem do nome**.
4. **Authentication → URL Configuration**:
   - Site URL: `https://SEU-DOMINIO` (ou `https://finance-os.pages.dev`);
   - Redirect URLs: `https://SEU-DOMINIO/**` e `http://localhost:5173/**`.
5. **Authentication → Providers → Email**: deixe *Confirm email* ligado, *Secure password change* ligado e senha mínima de 8 caracteres com letras e números.
6. **E-mails (recomendado):** o envio embutido do Supabase tem limite baixo por hora. Para produção, configure em **Authentication → SMTP** um provedor com plano grátis (por exemplo, Brevo: 300 e-mails/dia; Resend: 3.000/mês).
7. *(Opcional)* **Database → Extensions → pg_cron**: ligue e reexecute a migração `20261016000800_storage_cron.sql`. Ela agenda a geração diária de recorrências e a limpeza de registros técnicos. Sem `pg_cron`, as recorrências são geradas quando alguém abre o app.
8. *(Opcional)* Exclusão de conta pelo próprio usuário: `npx supabase functions deploy delete-account`. Sem ela, o app usa o modo de reserva: apaga os dados e desativa o perfil, mas o login continua existindo até um administrador removê-lo em **Authentication → Users**.

## 2. Hospedagem (Cloudflare Pages)

Plano grátis: banda ilimitada, HTTPS automático, deploy de prévia por branch e **rollback com um clique**.

### Opção A — integração Git do Cloudflare (mais simples)

1. **Workers & Pages → Create → Pages → Connect to Git** e escolha este repositório.
2. Build command: `npm run build`. Output: `dist`. Variável `NODE_VERSION=22`.
3. **Environment variables** (Production e Preview):

   | Variável | Valor |
   |---|---|
   | `VITE_SUPABASE_URL` | URL do projeto |
   | `VITE_SUPABASE_ANON_KEY` | anon/publishable key |
   | `VITE_APP_ENV` | `production` (em Preview: `staging`) |

4. Cada push em `main` publica em produção, e cada outra branch gera uma prévia.
5. Nesta opção, as migrações do banco são aplicadas por você (`npx supabase db push`) **antes** de mesclar código que dependa delas.

### Opção B — pipeline completo pelo GitHub Actions (já incluído)

O workflow `.github/workflows/deploy.yml` só roda depois que o **CI passa**. Ele aplica as migrações, publica a Edge Function, faz o build, publica no Cloudflare e registra a versão no painel administrativo.

Em **GitHub → Settings → Environments**, crie `production` e `staging` (em `production`, você pode exigir aprovação manual em *Required reviewers*) e cadastre em cada um:

| Tipo | Nome | Descrição |
|---|---|---|
| Secret | `SUPABASE_ACCESS_TOKEN` | token pessoal (supabase.com → Account → Access Tokens) |
| Secret | `SUPABASE_DB_PASSWORD` | senha do banco |
| Secret | `SUPABASE_SERVICE_ROLE_KEY` | *(opcional)* para registrar versões automaticamente |
| Secret | `CLOUDFLARE_API_TOKEN` | token com permissão *Cloudflare Pages: Edit* |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | ID da conta Cloudflare |
| Secret | `SUPABASE_DB_URL` | *(backup)* string de conexão **Session pooler** |
| Secret | `BACKUP_PASSPHRASE` | *(backup)* senha forte para criptografar os backups |
| Variable | `SUPABASE_PROJECT_REF` | ref do projeto |
| Variable | `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | chaves públicas |
| Variable | `CLOUDFLARE_PROJECT` | nome do projeto no Pages |

Fluxo: `develop` → homologação (`staging`), `main` → produção (`production`).

## 3. Ambientes

| Ambiente | Front-end | Banco |
|---|---|---|
| Desenvolvimento | `npm run dev` | projeto Supabase de homologação, ou `supabase start` (requer Docker) |
| Homologação | prévia do Cloudflare (branch `develop`) | **2º projeto Supabase** (o plano grátis permite 2 projetos ativos) |
| Produção | `main` no Cloudflare | projeto Supabase de produção |

## 4. Definir o proprietário do aplicativo

1. Abra o app publicado e **crie sua conta** normalmente.
2. No Supabase, em **SQL Editor**, execute:
   ```sql
   select public.bootstrap_app_owner('seu-email@exemplo.com');
   ```
3. Saia e entre de novo. O menu **Administração** aparece.

Essa função não pode ser chamada pelo navegador (o privilégio de execução foi revogado), então nenhum usuário consegue se promover.

**Para restringir quem se cadastra:** em *Administração → Configurações → Cadastro*, escolha *Somente convite / aprovação*. Novas contas ficam pendentes até aceitarem um convite ou serem aprovadas.

## 5. Domínio próprio

1. Cloudflare Pages → seu projeto → **Custom domains → Set up a domain** (ex.: `financas.seudominio.com.br`). Com o DNS no Cloudflare, a configuração é automática. Com outro provedor, crie o `CNAME` indicado.
2. O HTTPS é emitido automaticamente.
3. Atualize o **Site URL** e as **Redirect URLs** no Supabase (passo 1.4) com o novo domínio.
4. Para a tela de convite e os e-mails usarem o domínio certo, acesse o app pelo domínio oficial.

## 6. Compartilhar com outras pessoas

1. Envie o endereço oficial (ex.: `https://financas.seudominio.com.br`).
2. Cada pessoa cria a própria conta e começa com um **espaço pessoal privado**.
3. Para um orçamento em família, use *Compartilhamento → Novo espaço compartilhado → Convidar pessoa* e envie o link (WhatsApp, e-mail). Você escolhe a permissão de cada um.

## 7. PWA × navegador × aplicativo nativo

| | Navegador | PWA instalada | App nativo (lojas) |
|---|---|---|---|
| Instalação | nenhuma | "Adicionar à tela inicial" / "Instalar app" | pela Play Store / App Store |
| Ícone e tela cheia | não | sim | sim |
| Atualização | automática | **automática, com aviso** | depende da revisão da loja e do usuário |
| Custo | grátis | grátis | conta de desenvolvedor (Google: US$ 25 uma vez; Apple: US$ 99/ano) |
| Notificação push | — | possível no futuro (Web Push; no iOS só com o app instalado) | sim |
| Acesso offline | não | o casco abre; dados exigem conexão (decisão consciente para não exibir saldos desatualizados) | depende |

Para publicar nas lojas no futuro, o caminho mais curto é empacotar este mesmo PWA (TWA/Bubblewrap no Android; Capacitor no iOS), reaproveitando 100% do código.
