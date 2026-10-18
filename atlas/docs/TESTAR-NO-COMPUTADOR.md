# Testar o MARX no seu computador

Funciona em Windows 10/11, macOS e Linux. Leva cerca de 15 minutos na primeira vez.

## 1. Instale duas ferramentas
- **Docker Desktop**: https://www.docker.com/products/docker-desktop/ — instale, abra e espere aparecer “Engine running”.
  (No Windows, aceite ativar o WSL 2 se ele pedir e reinicie.)
- **Git**: https://git-scm.com/downloads

## 2. Baixe o projeto
No **Terminal** (macOS/Linux) ou **PowerShell** (Windows):

```bash
git clone -b ccr-c8f5f853-lvp3xa https://github.com/pegolprado/Controle-de-gastos-Vig.git
cd Controle-de-gastos-Vig/atlas
cp .env.example .env          # Windows PowerShell: copy .env.example .env
```

Abra o `.env` num editor de texto e altere só estas duas linhas:

```
DOMAIN=localhost
SECRET_KEY=qualquer-texto-longo-com-mais-de-40-caracteres-1234567890
```

## 3. Ligue a plataforma

```bash
docker compose up -d --build
docker compose exec api python -m app.cli create-admin --email voce@iamarx.com.br --name "Seu nome"
```

A primeira montagem leva de 5 a 10 minutos. O segundo comando pede a senha do administrador
(mínimo 12 caracteres, com letras e números).

## 4. Acesse
Abra **https://localhost**. Na primeira vez o navegador avisa que o certificado não é confiável (é um certificado
local de teste): clique em *Avançado → Continuar*.

Entre com o e-mail e a senha. No Workspace clique em **Gerar análise de demonstração** para ver tudo funcionando com
dados sintéticos, ou vá em **Análise atual → Arquivos** e selecione os seus arquivos.

> Os arquivos não saem do seu computador e nada é gravado: ao clicar em **Sair e apagar**, fechar a aba ou recarregar
> a página, a análise some. Exporte em Excel ou PDF o que precisar guardar.

Use Chrome, Edge ou Firefox atualizados. Para arquivos muito grandes (milhões de linhas), prefira um computador com
8 GB de RAM ou mais.

## Comandos úteis
| Para | Comando |
|---|---|
| Desligar | `docker compose stop` |
| Ligar de novo | `docker compose start` |
| Ver registros de erro | `docker compose logs -f api web` |
| Atualizar para a versão mais nova | `git pull && docker compose up -d --build` |
| Apagar tudo (inclusive usuários) | `docker compose down -v` |

Para colocar no ar em **iamarx.com.br**, siga [DEPLOY.md](DEPLOY.md): é o mesmo procedimento num servidor, com
`DOMAIN=iamarx.com.br`.
