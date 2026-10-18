# Testar o MARX

## Opção 1 — direto na internet, de graça (recomendado)
Siga os passos 2, 3 e 5 de [DEPLOY.md](DEPLOY.md) **sem mexer no domínio**: o site fica em
`https://marx.pages.dev` e você testa tudo por lá. Quando estiver satisfeito, faça os passos 1 e 4 para
usar `iamarx.com.br`.

## Opção 2 — no seu computador (exatamente como roda na Cloudflare)
1. Instale o **Node.js 22** (https://nodejs.org) e o **Git** (https://git-scm.com/downloads).
2. No Terminal/PowerShell:

```bash
git clone -b ccr-c8f5f853-lvp3xa https://github.com/pegolprado/Controle-de-gastos-Vig.git
cd Controle-de-gastos-Vig/atlas/frontend
npm ci
npm run build
npm run local
```

3. Abra **http://localhost:8788/primeiro-acesso**, use o código `configuracao-teste-123` e crie seu usuário.
4. No Workspace, clique em **Gerar análise de demonstração**, ou vá em **Análise atual → Arquivos**.

> Os arquivos não saem do seu computador e nada é gravado: ao clicar em **Sair e apagar**, fechar a aba,
> recarregar a página ou ficar inativo, a análise some. Exporte em Excel ou PDF o que precisar guardar.

Use Chrome, Edge ou Firefox atualizados. Para arquivos com milhões de linhas, prefira 8 GB de RAM ou mais.
