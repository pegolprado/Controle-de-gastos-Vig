# Testes

| Camada | Comando | O que cobre |
|---|---|---|
| Servidor de login | `npx vitest run server` | só existem tabelas de usuários; nenhuma rota de dados; primeiro acesso; sal não revela contas; CSRF; bloqueio de conta; inatividade; `Clear-Site-Data`; escalada de privilégio; ativação por link; MFA (vetor RFC 6238); troca de senha; limite de corpo |
| Motor no navegador | `cd frontend && npx vitest run` | normalização (números, datas, fusos, durações, tipos, CGI, coordenadas), resolução de ERB (R1–R4, ambiguidade, MCC/MNC, versões), assistente |
| Ponta a ponta (no mesmo ambiente da Cloudflare, via wrangler) | `npx playwright test` | primeiro acesso → login → demonstração → todas as telas sem erro → exportação Excel e PDF → **nada no armazenamento do navegador** → sair → novo login sem dados; carga de arquivo pelo assistente; cadastro e ativação de usuário; ocultar números; bloqueio e desbloqueio de tela |
| Tipos, lint, build | `npm run typecheck && npx eslint . && npm run build` | inclui a checagem de que nenhum arquivo passa de 25 MiB (CI) |

Todos os comandos rodam na pasta `atlas/frontend`. O teste ponta a ponta compila o site e sobe sozinho o ambiente local da
Cloudflare (`npm run local`: Pages + Functions + D1 em `http://localhost:8788`).

O CI (`.github/workflows/atlas.yml`) roda todas as camadas a cada alteração.

## Volume (medido em Chromium, build de produção)
| Cenário | Resultado |
|---|---|
| Arquivo CSV de 200 mil linhas (15 MB): SHA-256 + detecção | 0,2 s |
| Importação completa das 200 mil linhas | ≈ 11–13 s |
| Explorador, contatos e estatística sobre 200 mil registros | < 1,1 s cada |
| Demonstração completa (5 arquivos, resolução de ERB, alertas) | ≈ 3–4 s |
| PDF digitalizado (1 página) com OCR em português | ≈ 6 s, confiança 89% |
