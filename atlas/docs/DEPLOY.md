# Publicar o MARX em iamarx.com.br

O MARX tem duas partes: a **aplicação**, que roda no navegador de cada usuário (e é onde os arquivos são
processados), e um **pequeno servidor de login** que guarda só a lista de usuários. Por causa do login, hospedagem
de site estático (GitHub Pages, hospedagem compartilhada) **não serve**. O caminho recomendado é um servidor virtual
(VPS) Linux com Docker. O Caddy, incluído, obtém e renova o certificado HTTPS sozinho.

## 1. Servidor

Como o processamento acontece no computador de cada usuário, o servidor é pequeno e barato:

| Uso | Recomendado |
|---|---|
| Até algumas dezenas de usuários | 1 vCPU · 1–2 GB RAM · 20 GB SSD |

Os arquivos analisados **não passam pelo servidor**; quem precisa de memória é o computador do usuário
(8 GB de RAM ou mais para arquivos com milhões de linhas).
Use Ubuntu 24.04 LTS. Abra somente as portas **22** (SSH, de preferência restrita ao seu IP), **80** e **443**.

```bash
# no servidor, como root
apt update && apt -y upgrade
curl -fsSL https://get.docker.com | sh
adduser marx && usermod -aG docker marx
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
su - marx
git clone -b ccr-c8f5f853-lvp3xa https://github.com/pegolprado/Controle-de-gastos-Vig.git && cd Controle-de-gastos-Vig/atlas
cp .env.example .env
nano .env          # DOMAIN=iamarx.com.br e SECRET_KEY forte
docker compose up -d --build
docker compose exec api python -m app.cli create-admin --email voce@iamarx.com.br --name "Seu nome"
```

Gere segredos com `openssl rand -base64 48`. Em ~1 minuto `https://iamarx.com.br` responde com certificado válido.
Entre com o administrador, ative a **verificação em duas etapas** em *Configurações* e cadastre os usuários em
*Usuários* (cada um recebe um link de ativação de uso único; marque quem pode exportar).

Para conhecer a plataforma, use *Gerar análise de demonstração* no Workspace (dados sintéticos, gerados no navegador).

## 4. Recursos que dependem de configuração externa

| Recurso | O que configurar |
|---|---|
| E-mail de recuperação de senha | `SMTP_*` no `.env`. Sem SMTP, o administrador gera o link de redefinição na tela de usuários. |
| Mapa | O fundo do mapa vem de um provedor de *tiles* (o navegador pede as imagens da região exibida). O servidor público do OpenStreetMap tem [política de uso](https://operations.osmfoundation.org/policies/tiles/) restrita; para uso contínuo, contrate um provedor e ajuste `MAP_TILE_URL` e `EXTRA_IMG_SRC`. Deixe `MAP_TILE_URL` vazio para não usar mapa externo — as estações continuam sendo desenhadas. |
| Backup | Só a lista de usuários precisa de backup: `scripts/backup.sh` (ver OPERACAO.md). |

## 5. Atualizar

```bash
cd ~/Controle-de-gastos-Vig && git pull
cd atlas && ./scripts/backup.sh ~/backups   # lista de usuários
docker compose up -d --build
```

## 6. Desenvolvimento local

```bash
cd backend && python -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt
python -m app.cli create-admin --email voce@exemplo.com.br --name "Você"   # SQLite em ./data
uvicorn app.main:app --reload                                            # API de login em :8000
cd ../frontend && npm ci && npm run dev                                  # aplicação em http://localhost:5173
```
