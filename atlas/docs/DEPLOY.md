# Publicar o MARX em iamarx.com.br

O MARX precisa de um **servidor** (back-end Python + PostgreSQL + fila de tarefas). Hospedagens de site estático
(Cloudflare Pages, GitHub Pages, hospedagem compartilhada) **não servem**. O caminho recomendado é um servidor
virtual (VPS) Linux com Docker. O Caddy, incluído, obtém e renova o certificado HTTPS sozinho.

## 1. Servidor

| Uso | Recomendado |
|---|---|
| Até ~2 milhões de registros, poucos usuários | 2 vCPU · 4 GB RAM · 80 GB SSD |
| Dezenas de milhões de registros | 4–8 vCPU · 16 GB RAM · SSD NVMe ≥ 200 GB |

Qualquer provedor serve (ex.: provedores nacionais, para manter os dados no Brasil — avalie a política institucional e a LGPD).
Use Ubuntu 24.04 LTS. Abra somente as portas **22** (SSH, de preferência restrita ao seu IP), **80** e **443**.

```bash
# no servidor, como root
apt update && apt -y upgrade
curl -fsSL https://get.docker.com | sh
adduser atlas && usermod -aG docker atlas
ufw allow OpenSSH && ufw allow 80,443/tcp && ufw allow 443/udp && ufw enable
```

## 2. DNS no Registro.br

No painel do Registro.br → domínio **iamarx.com.br** → *Editar zona* (use os servidores DNS do próprio Registro.br,
ou crie os registros no provedor de DNS que você usa):

| Tipo | Nome | Valor |
|---|---|---|
| A | (vazio / `@`) | IP público do servidor |
| A | `www` | IP público do servidor |
| AAAA | (vazio) e `www` | IPv6 do servidor, se houver |
| CAA (opcional) | (vazio) | `0 issue "letsencrypt.org"` |

A propagação costuma levar minutos (até algumas horas). Confira com `dig +short iamarx.com.br`.

## 3. Instalar a aplicação

```bash
su - atlas
git clone https://github.com/pegolprado/Controle-de-gastos-Vig.git && cd Controle-de-gastos-Vig/atlas
cp .env.example .env
nano .env          # DOMAIN=iamarx.com.br, SECRET_KEY e POSTGRES_PASSWORD fortes
docker compose up -d --build
docker compose exec api python -m app.cli create-admin --email voce@iamarx.com.br --name "Seu nome"
```

Gere segredos com `openssl rand -base64 48`. Em ~1 minuto `https://iamarx.com.br` responde com certificado válido.
Entre com o administrador, ative a **verificação em duas etapas** em *Configurações* e cadastre os usuários em
*Usuários e permissões* (cada um recebe um link de ativação de uso único).

Para conhecer a plataforma, use *Gerar caso de demonstração* no Workspace (dados sintéticos, apagáveis em um clique).

## 4. Recursos que dependem de configuração externa

| Recurso | O que configurar |
|---|---|
| E-mail de recuperação de senha | `SMTP_*` no `.env`. Sem SMTP, o administrador gera o link de redefinição na tela de usuários. |
| Mapa | O servidor público do OpenStreetMap tem [política de uso](https://operations.osmfoundation.org/policies/tiles/) restrita a uso leve. Para uso contínuo, contrate um provedor de *tiles* e ajuste `MAP_TILE_URL` e `EXTRA_IMG_SRC` (CSP). Com o mapa bloqueado, todas as demais funções continuam. |
| Backup externo | Agende `scripts/backup.sh --docker` (ver OPERACAO.md) e copie os arquivos cifrados para outro local. |

## 5. Atualizar

```bash
cd ~/Controle-de-gastos-Vig && git pull
cd atlas && ./scripts/backup.sh --docker ~/backups   # sempre antes de atualizar
docker compose up -d --build                         # migrações rodam automaticamente
```

## 6. Desenvolvimento local

```bash
docker compose -f docker-compose.dev.yml up -d            # PostgreSQL em localhost:5432
cd backend && python -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt
export DATABASE_URL=postgresql+psycopg://atlas:atlas@localhost:5432/atlas
alembic upgrade head && python -m app.cli create-admin --email voce@exemplo.com.br
uvicorn app.main:app --reload                             # API em :8000 (worker embutido)
cd ../frontend && npm ci && npm run dev                   # interface em http://localhost:5173
```
