# Testes

| Camada | Comando | O que cobre |
|---|---|---|
| Servidor de login | `cd backend && python -m pytest -q` | só existem as tabelas de usuários; nenhuma rota de dados; limite de corpo; CSRF; bloqueio de conta; `Clear-Site-Data` no logout; escalada de privilégio; ciclo de vida do usuário; MFA; cabeçalhos |
| Motor no navegador | `cd frontend && npx vitest run` | normalização (números, datas, fusos, durações, tipos, CGI, coordenadas), resolução de ERB (R1–R4, ambiguidade, MCC/MNC, versões), assistente |
| Ponta a ponta (também validado na pilha Docker com HTTPS) | `cd frontend && npx playwright test` | login → demonstração → todas as telas sem erro → exportação Excel e PDF → **nada no armazenamento do navegador** → sair → novo login sem dados; carga de arquivo pelo assistente |
| Tipos, lint, build | `npx tsc -b && npx eslint . && npm run build` | |

O teste ponta a ponta precisa da API rodando com o usuário de teste:

```bash
cd backend
export DATABASE_URL=sqlite:////tmp/marx-e2e.db SECRET_KEY=chave-de-teste-0123456789-abcdefghijkl MARX_ADMIN_PASSWORD='Teste!Marx2026'
python -m app.cli create-admin --email admin@marx.local --name "Admin E2E"
uvicorn app.main:app --port 8000 &
cd ../frontend && npx playwright test        # sobe o Vite automaticamente
```

O CI (`.github/workflows/atlas.yml`) roda todas as camadas a cada alteração.

## Volume (medido em Chromium, build de produção atrás do Caddy)
| Cenário | Resultado |
|---|---|
| Arquivo CSV de 200 mil linhas (15 MB): SHA-256 + detecção | 0,2 s |
| Importação completa das 200 mil linhas | ≈ 11–13 s |
| Explorador, contatos e estatística sobre 200 mil registros | < 1,1 s cada |
| Demonstração completa (5 arquivos, resolução de ERB, alertas) | ≈ 3–4 s |
| PDF digitalizado (1 página) com OCR em português | ≈ 6 s, confiança 89% |
