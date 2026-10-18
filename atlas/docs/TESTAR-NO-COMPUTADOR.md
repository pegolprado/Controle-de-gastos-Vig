# Testar o MARX no seu computador (antes de contratar o servidor)

Funciona em Windows 10/11, macOS e Linux. Leva cerca de 15 minutos na primeira vez.

## 1. Instale duas ferramentas
- **Docker Desktop**: https://www.docker.com/products/docker-desktop/ — instale, abra e espere aparecer “Engine running”.
  (No Windows, aceite ativar o WSL 2 se ele pedir e reinicie.)
- **Git**: https://git-scm.com/downloads

## 2. Baixe o projeto
Abra o **Terminal** (macOS/Linux) ou o **PowerShell** (Windows) e rode:

```bash
git clone -b ccr-c8f5f853-lvp3xa https://github.com/pegolprado/Controle-de-gastos-Vig.git
cd Controle-de-gastos-Vig/atlas
```

## 3. Configure para rodar localmente
Copie o arquivo de exemplo:

```bash
cp .env.example .env          # Windows PowerShell: copy .env.example .env
```

Abra o `.env` num editor de texto e altere só estas linhas:

```
DOMAIN=localhost
SECRET_KEY=qualquer-texto-longo-com-mais-de-40-caracteres-1234567890
POSTGRES_PASSWORD=uma-senha-qualquer-para-teste
```

## 4. Ligue a plataforma

```bash
docker compose up -d --build
```

A primeira vez demora (baixa e monta tudo, ~5–10 min). Depois crie o seu usuário administrador:

```bash
docker compose exec api python -m app.cli create-admin --email voce@iamarx.com.br --name "Seu nome"
```

Ele pede uma senha (mínimo 12 caracteres, com letras e números).

## 5. Acesse
Abra **https://localhost** no navegador. Na primeira vez o navegador avisa que o certificado não é confiável
(é um certificado local de teste): clique em *Avançado → Continuar*.

Entre com o e-mail e a senha criados. No Workspace, clique em **Gerar caso de demonstração** para ver tudo
funcionando com dados sintéticos, ou crie um caso e importe seus próprios arquivos.

## Comandos úteis
| Para | Comando |
|---|---|
| Desligar | `docker compose stop` |
| Ligar de novo | `docker compose start` |
| Ver registros de erro | `docker compose logs -f api worker` |
| Atualizar para a versão mais nova | `git pull && docker compose up -d --build` |
| Apagar tudo (inclusive dados) | `docker compose down -v` |

Os dados ficam só no seu computador. Para colocar no ar em **iamarx.com.br**, siga [DEPLOY.md](DEPLOY.md):
é o mesmo procedimento, num servidor, com `DOMAIN=iamarx.com.br`.
