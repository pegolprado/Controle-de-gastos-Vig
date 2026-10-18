# Arquitetura

```
Navegador do usuário (tudo em memória da aba)                    Cloudflare (plano gratuito)
┌──────────────────────────────────────────────────────────┐     ┌──────────────────────────────┐
│ React (telas)                                            │HTTPS│ Pages: arquivos do site       │
│  └─ src/engine                                           │◀───▶│   (_headers: CSP, HSTS)       │
│      readers.ts   CSV/TXT/XLS/XLSX/JSON/XML/HTML/PDF/ZIP │login│ Functions /api/* → server/app │
│                   OCR (Tesseract WASM), SHA-256          │ só  │   sessão assinada, CSRF, MFA  │
│      importer.ts  mapeamento, normalização, duplicidades │     │ D1: usuários (e nada mais)    │
│      db.ts        DuckDB-WASM em memória                 │     └──────────────────────────────┘
│      erb.ts analytics.ts crossmatch.ts alerts.ts ...     │
│      report.ts exporter.ts  PDF · Excel · CSV            │
│  lib/passkey.ts   senha → chave (PBKDF2 600 mil)         │
└──────────────────────────────────────────────────────────┘
```

## Fluxo
1. Login: o navegador pede o sal do e-mail, deriva a chave da senha (PBKDF2-SHA256, 600 mil iterações) e envia
   só a chave. O servidor compara HMAC(SECRET_KEY, chave) com o valor guardado e devolve um cookie de sessão.
2. O usuário seleciona arquivos → SHA-256, detecção de formato e amostra, tudo no navegador.
3. O assistente confirma mapeamento, datas, fuso e regras; a prévia valida linha a linha.
4. O processamento lê o arquivo em lotes de 20 mil linhas para o DuckDB em memória, mantendo arquivo/linha/página
   e os valores originais.
5. As telas consultam o DuckDB local; cada resultado traz os critérios usados.
6. Exportações são geradas no navegador; o SHA-256 do arquivo aparece na tela.
7. Sair/inatividade/recarregar → memória zerada e página recarregada.

O motor DuckDB (36 MB) é publicado em partes de 20 MB (limite de 25 MB por arquivo do Pages gratuito); o navegador
junta as partes e confere o SHA-256 antes de usar.

## Regras analíticas
`RULES_VERSION` em `src/engine/normalize.ts`, registrada em todo relatório.
- Números em E.164; a operadora **não** é deduzida pelo prefixo (portabilidade).
- Fuso: confirmado / presumido / desconhecido, sinalizado por registro.
- Duplicidade: mesmo alvo, origem, destino, data/hora UTC, duração, tipo, célula e IP.
- ERB: CI, ECI e NCI nunca se equiparam; MCC/MNC do registro prevalece; coordenadas nunca são estimadas.

## Servidor (`frontend/server/app.ts`, executado em `functions/api/[[path]].ts`)
Tabelas D1: `users`, `reset_tokens`, `login_failures` (IP guardado só como HMAC, por 15 minutos).
Rotas: `/api/auth/*` (sal, login, MFA, sessão, senha, desbloqueio), `/api/admin/users*`, `/api/setup`,
`/api/settings`, `/api/health`.
