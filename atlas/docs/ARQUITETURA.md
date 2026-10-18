# Arquitetura

```
Navegador do usuário (tudo em memória da aba)                         Servidor
┌─────────────────────────────────────────────────────────────┐      ┌───────────────────────┐
│ React (telas)                                               │ HTTPS│ Caddy (HTTPS, CSP)    │
│  └─ src/engine                                              │◀────▶│  ├─ arquivos do site  │
│      readers.ts    CSV/TXT/XLS/XLSX/JSON/XML/HTML/PDF/ZIP   │ login│  └─ /api → FastAPI    │
│                    OCR (Tesseract WASM), SHA-256            │ only │       SQLite: usuários│
│      importer.ts   mapeamento, normalização, duplicidades   │      └───────────────────────┘
│      db.ts         DuckDB-WASM em memória (eventos, ERB)    │
│      erb.ts        resolução de células (regras R1–R4)      │
│      analytics.ts  contatos, vínculos, timeline, geo, stats │
│      crossmatch.ts alerts.ts assistant.ts                   │
│      report.ts exporter.ts   PDF (jsPDF) · Excel (ExcelJS)  │
│      session.ts    estado da sessão (sem armazenamento)     │
└─────────────────────────────────────────────────────────────┘
```

## Fluxo
1. Login → cookie de sessão. A API devolve só os dados do usuário (`/api/auth/me`).
2. O usuário seleciona arquivos → o navegador calcula o SHA-256, detecta formato/layout e mostra amostra.
3. O assistente de importação confirma mapeamento, formatos de data, fuso e regras; a prévia valida linha a linha.
4. O processamento lê o arquivo em fluxo (lotes de 20 mil linhas) e grava no DuckDB em memória, mantendo o
   vínculo com arquivo/linha/página e os valores originais.
5. As telas consultam o DuckDB local; cada resultado traz os critérios usados.
6. Exportações são geradas no navegador e baixadas; o SHA-256 do arquivo aparece na tela.
7. Sair/inatividade/recarregar → banco e estado zerados, página recarregada.

## Regras analíticas
Versão das regras: `RULES_VERSION` (src/engine/normalize.ts), registrada em todo relatório.
- Números em E.164; a operadora **não** é deduzida pelo prefixo (portabilidade).
- Fuso: confirmado / presumido / desconhecido, sinalizado por registro.
- Duplicidade: mesmo alvo, origem, destino, data/hora UTC, duração, tipo, célula e IP.
- ERB: CI, ECI e NCI nunca se equiparam; MCC/MNC do registro prevalece sobre a operadora do arquivo; coordenadas
  nunca são estimadas; ambiguidades são listadas para revisão manual.

## Servidor
FastAPI + SQLAlchemy + SQLite (WAL, `secure_delete`). Tabelas: `users` e `password_reset_tokens`. Rotas:
`/api/auth/*` (login, MFA, senha, sessão), `/api/admin/users*`, `/api/settings`, `/api/health`.
