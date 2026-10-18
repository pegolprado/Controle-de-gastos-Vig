# Arquitetura

```
navegador ──HTTPS──> Caddy (TLS automático, front-end estático, cabeçalhos)
                        └── /api ──> FastAPI (uvicorn) ──> PostgreSQL 16
                                          │                  ▲
                                          └── fila (tabela jobs) ── worker(s) Python
                                     armazenamento privado de arquivos (volume)
```

| Camada | Tecnologia |
|---|---|
| Interface | React 19 + TypeScript + Vite + Tailwind 4, TanStack Query, Recharts, Cytoscape (grafo), Leaflet (mapa) |
| API | Python 3.13 + FastAPI, SQLAlchemy 2, Alembic |
| Banco | PostgreSQL 16 (índices por caso/número/data/célula; JSONB para valores originais) |
| Fila | tabela `jobs` com `SELECT … FOR UPDATE SKIP LOCKED` (sem Redis: menos um serviço, estado transacional e auditável) |
| Leitura de arquivos | csv, openpyxl (XLSX), xlrd (XLS), lxml (XML/HTML), pdfplumber (PDF texto) + Tesseract (OCR) |
| Relatórios | ReportLab (PDF), openpyxl (XLSX), CSV, JSON, HTML |

## Módulos do back-end (`backend/app`)
- `parsers/` — detecção de formato/codificação/separador/cabeçalho, leitores por formato, ZIP seguro, catálogo de campos e sinônimos.
- `services/normalize.py` — números (E.164, sem deduzir operadora), datas/fusos, durações, tipos de evento, identificadores de célula, coordenadas, indício de operadora.
- `services/importer.py` — análise, prévia, importação em lotes (COPY), ocorrências por linha, deduplicação, cadastro de ERB versionado.
- `services/erb.py` — motor de resolução de células (regras versionadas, ambiguidades, revisão manual preservada).
- `services/analytics.py` — filtros combinados e consultas analíticas (resumo, contatos, períodos, comparação, contatos em comum, coincidências, grafo, linha do tempo, células, mapa, sequência, padrões).
- `services/crossmatch.py` — validação prévia e correspondência de registros recíprocos entre fontes.
- `services/alerts.py`, `services/reports.py`, `services/assistant.py`, `services/demo.py`.
- `routers/` — API REST; `deps.py` — autenticação e permissões por caso; `audit.py` — trilha encadeada; `jobs.py`/`tasks.py` — fila.

## Modelo de dados (principais tabelas)
`organizations`, `users`, `cases`, `case_members`, `access_justifications`, `targets`, `source_files` (original + SHA-256),
`imports` + `import_issues`, `layout_profiles` (mapeamentos reutilizáveis), `events` (registro normalizado com valores
originais em `raw`, linha/página de origem, hash do arquivo, fuso e status do fuso, flags de duplicidade/escopo e resolução
de ERB), `event_corrections`, `erb_registry_versions` + `erb_cells`, `resolution_runs`, `saved_queries`, `annotations`,
`alert_rules` + `alerts`, `reports` + `report_reviews`, `audit_log`, `jobs`, `system_settings`.

## Rastreabilidade
- Todo evento aponta para arquivo (com SHA-256), importação (com mapeamento, opções e versão das regras) e linha/página.
- Toda resposta analítica devolve `criteria` (filtros, regras, limites) exibido na interface.
- Relatórios são congelados: arquivo final com SHA-256 registrado + manifesto JSON com os dados usados.

## Escalabilidade
Importação em fluxo (sem carregar o arquivo na memória), gravação por COPY em lotes, agregações no servidor,
paginação no servidor, resolução de ERB por assinatura de célula (um único UPDATE com junção por hash), deduplicação
por função de janela. Para dezenas de milhões de registros por caso, particione `events` por `case_id`
(PARTITION BY HASH) — o modelo já filtra sempre por caso.
