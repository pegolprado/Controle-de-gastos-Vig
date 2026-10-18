# iaMARX — Intelligence Pro

*Análise • Conexões • Inteligência*

<img src="brand/logo-original.png" alt="iaMARX Intelligence Pro" width="280">

Plataforma web para importar, normalizar, correlacionar e analisar bilhetagens telefônicas (CDR) e extratos/cadastros
de ERB fornecidos por operadoras (TIM, Vivo, Claro e outras), mediante autorização legal — com rastreabilidade de
cada resultado até a linha do arquivo original, permissões por caso e trilha de auditoria.

> Pasta independente dentro deste repositório: não altera o app Finance MV da raiz.

## O que está pronto

| Módulo | Destaques |
|---|---|
| Central de casos | período e escopo autorizados, alvos (sem deduzir operadora pelo prefixo), membros com papel e exportação, justificativa de acesso, retenção, exclusão auditada |
| Importação universal | CSV (qualquer separador/codificação), TXT delimitado e de **largura fixa**, XLS, XLSX, XML, JSON, HTML, PDF texto e **PDF digitalizado com OCR** (confiança por linha), ZIP seguro; detecção de cabeçalho com preâmbulo, indício de operadora com confiança, assistente em 6 etapas, mapeamento salvo por assinatura de layout, prévia normalizada, ocorrências por linha, fusos confirmado/presumido/desconhecido, deduplicação, escopo |
| Análise telefônica | explorador com filtros combinados e consultas salvas, colunas configuráveis, exportação CSV/XLSX auditada, detalhe do registro com valores originais e correções versionadas |
| Contatos e vínculos | contatos recorrentes (dias, reciprocidade, regularidade), comparação de períodos, comparação de números, contatos em comum (matriz), células compartilhadas, coincidências temporais (mesma célula ou estações próximas), grafo interativo com expansão |
| ERB | cadastro versionado com validação (coordenadas inválidas, conflitos), motor de resolução por tecnologia/operadora/versão (exata, provável, ambígua, não resolvida), revisão manual auditada, células por período, inconsistências |
| Geolocalização | mapa com estações e setores **esquemáticos**, sequência de células, reprodução cronológica (sem simular trajeto) |
| Linha do tempo e estatística | picos, lacunas, anotações, distribuições, z-scores, dias atípicos, intervalos incomuns — método explicitado |
| Cruzamento multifonte | validação prévia (fusos, normalização, duplicidades, períodos, proveniência) e correspondência recíproca exata/provável/ambígua/ausente |
| Alertas | 7 tipos de regra configuráveis, registros de suporte, revisão pelo analista |
| Relatórios | PDF (capa, sumário, cabeçalho/rodapé, gráficos, mapa e grafo esquemáticos), XLSX, CSV, JSON, HTML; manifesto congelado, SHA-256, revisão e aprovação com segregação de funções |
| Segurança | Argon2id, MFA (TOTP), bloqueio por tentativas, CSRF, sessão com expiração, RBAC + permissões por caso, auditoria encadeada por hash |
| Assistente analítico | local e determinístico: pergunta → filtro verificável → resposta classificada (dado, cálculo, correlação, hipótese, limite) |
| Demonstração | caso sintético com 3 layouts diferentes, cadastro com problemas propositais, removível sem afetar casos reais |

## Começo rápido

- Produção em **iamarx.com.br**: [docs/DEPLOY.md](docs/DEPLOY.md)
- Operação, backup e restauração: [docs/OPERACAO.md](docs/OPERACAO.md)
- Segurança e LGPD: [docs/SEGURANCA.md](docs/SEGURANCA.md)
- Arquitetura e modelo de dados: [docs/ARQUITETURA.md](docs/ARQUITETURA.md)
- Testes executados e medições: [docs/TESTES.md](docs/TESTES.md)
- Situação e limitações: [docs/STATUS.md](docs/STATUS.md)

## Estrutura

```
atlas/
  backend/      FastAPI, SQLAlchemy, Alembic, leitores, serviços analíticos, testes (pytest)
  frontend/     React + TypeScript + Vite + Tailwind
  deploy/       Caddyfile e imagem do front-end
  scripts/      backup, restauração e teste de restauração
  docs/
  docker-compose.yml       produção (db, api, worker, web/Caddy)
  docker-compose.dev.yml   PostgreSQL para desenvolvimento
```
