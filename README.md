# Finance MV

> Este repositório também contém, na pasta [`atlas/`](atlas/README.md), a plataforma **ATLAS Telecom Intelligence** (análise de bilhetagem e ERB), independente deste app.

Controle financeiro pessoal e familiar: contas, cartões e faturas, parcelamentos, recorrências, orçamentos, metas, contas a pagar e receber, relatórios e espaços compartilhados com permissões reais. É um **PWA** que se instala no celular e no computador e se atualiza sozinho, sem reinstalar.

Roda **inteiro nos planos gratuitos**: Supabase Free (banco, login, arquivos), Cloudflare Pages (hospedagem com HTTPS) e GitHub Actions (testes, deploy e backup).

## Stack

| Camada | Tecnologia | Por quê |
|---|---|---|
| Interface | React 19 + TypeScript + Tailwind CSS 4 | tipagem forte, componentes acessíveis, CSS enxuto |
| Build / PWA | Vite 8 + vite-plugin-pwa (Workbox) | carregamento por tela, service worker com atualização controlada |
| Dados no cliente | TanStack Query | cache, nova tentativa só em leitura, invalidação depois de gravar |
| Gráficos | Recharts (carregado sob demanda) | gráficos leves e interativos |
| Backend | Supabase: PostgreSQL 15+, Auth, Storage, Edge Functions | RLS no banco, login de verdade, plano gratuito |
| Regras financeiras | Funções, gatilhos e views em SQL | saldos e faturas são calculados no servidor; o navegador nunca é a fonte da verdade |
| Testes | Vitest, PostgreSQL real (RLS/regras), Playwright (desktop e celular) | ver [docs/TESTES.md](docs/TESTES.md) |

## Começo rápido (desenvolvimento)

```bash
npm install
cp .env.example .env.local      # preencha com a URL e a anon key do seu projeto Supabase
npm run dev                     # http://localhost:5173
```

Aplique as migrações no seu projeto Supabase (`supabase db push`) e defina o proprietário. O passo a passo completo está em [docs/DEPLOY.md](docs/DEPLOY.md).

## Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | servidor de desenvolvimento |
| `npm run build` | checa os tipos, gera o build de produção, o PWA e o hash da CSP |
| `npm run lint` / `npm run typecheck` | ESLint e TypeScript |
| `npm test` | testes unitários (domínio financeiro, datas, dinheiro, CSV, PWA) |
| `npm run test:db` | aplica todas as migrações num PostgreSQL limpo e testa RLS, regras e backup/restauração |
| `npm run test:e2e` | fluxos de tela no Playwright (desktop e celular) |
| `npm run check` | lint + tipos + unitários + banco |

## Documentação

- [docs/ARQUITETURA.md](docs/ARQUITETURA.md): arquitetura, modelo de dados, regras contábeis e permissões
- [docs/DEPLOY.md](docs/DEPLOY.md): configuração gratuita do zero (Supabase, Cloudflare, domínio, variáveis, proprietário)
- [docs/OPERACAO.md](docs/OPERACAO.md): publicar, atualizar, reverter, migrar, fazer backup e restaurar
- [docs/SEGURANCA.md](docs/SEGURANCA.md): segurança, privacidade e LGPD
- [docs/TESTES.md](docs/TESTES.md): relatório dos testes executados
- [docs/STATUS.md](docs/STATUS.md): o que está pronto, o que falta e custos

## Estrutura

```
src/
  app/          provedores (auth, espaço, marca, tema), guardas de rota e tratamento de erros
  components/   ui/ (design system), layout/ (casco, navegação), charts/
  domain/       regras puras e testadas (fatura, recorrência, orçamento, insights)
  features/     telas por módulo (dashboard, transactions, cards, admin, …)
  lib/          dinheiro, datas, CSV, erros, cliente Supabase, proteção de formulários
  pwa/          atualização controlada do service worker
  services/     acesso a dados (uma função por operação; RLS no servidor)
supabase/
  migrations/   migrações SQL versionadas (fonte da verdade do schema)
  tests/        testes do banco (RLS, regras financeiras, admin)
  functions/    Edge Functions (exclusão de conta)
e2e/            testes Playwright
scripts/        teste do banco, backup/restauração, ícones, pós-build
```
