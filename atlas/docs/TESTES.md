# Testes executados

Ambiente: contêiner Linux, 4 vCPU, 15 GB RAM, PostgreSQL 16 local, Python 3.13, Node 22, Chromium (Playwright).
Data: 18/10/2026.

## Automatizados

| Conjunto | Resultado |
|---|---|
| Back-end — `pytest` (PostgreSQL real, banco recriado a cada execução) | **86 aprovados** |
| Front-end — `tsc`, `eslint`, `vitest`, `vite build` | sem erros · 4 testes aprovados |

Cobertura por área (back-end):
- **Importação/leitores** (`test_parsers.py`): CSV com `;` `,` TAB `|`; codificações cp1252, UTF-8, UTF-8 BOM, UTF-16; preâmbulo antes do
  cabeçalho; ausência de cabeçalho; campos entre aspas e colunas desconhecidas; arquivo vazio; XLSX corrompido; XLSX e XLS;
  largura fixa; JSON, XML (inclusive bloqueio de entidade externa/XXE) e HTML; PDF textual; **PDF digitalizado com OCR**; ZIP com
  caminho malicioso e zip bomb.
- **Normalização** (`test_normalize.py`): números (CSP, internacional, curtos, sem inventar 9º dígito), durações, datas/horários
  em vários formatos, ambiguidade dia/mês, offset explícito, horário de verão, tipos de evento, identificadores de célula por
  tecnologia, hexadecimal, CGI, coordenadas (decimal, DMS, micrograus, inválidas), indício de operadora sem usar prefixo.
- **ERB** (`test_erb.py`): exata por identificador completo e por CGI; CI nunca casa com ECI; provável sem área; ambígua;
  regra de operadora × MCC/MNC; estação com setores; versão mais recente e divergência entre versões; não resolvida.
- **Fluxo de aceitação** (`test_flow.py`): os passos 1–18 da seção 22 pela API (criar caso; alvos; importar duas bilhetagens
  sintéticas de layouts e operadoras diferentes; mapear; validar; processar; consultar; estatísticas com regras de duração e
  exclusões; comparar números; cruzamento multifonte; cadastro ERB; resolução; mapa; linha do tempo; grafo; alertas; relatórios
  PDF/XLSX/CSV/JSON/HTML com hash conferido; origem verificável; correção auditável sem alterar relatório; revisão com
  segregação de funções; permissões; auditoria e cadeia). Também: justificativa de acesso, caso de demonstração criado e
  removido sem afetar casos reais, importação em vários lotes (12.345 linhas).
- **Segurança** (`test_security.py`): sem sessão → 401; CSRF ausente/forjado; erro genérico de login e bloqueio; elevação de
  privilégio; ciclo de vida de usuário, link de uso único e revogação de sessões; MFA; tentativas de injeção; uploads
  proibidos/vazios/ZIP malicioso; acesso a arquivo de outro caso; originais somente leitura no disco; cabeçalhos; cadeia de auditoria.

## Interface (Playwright, Chromium)
Login e navegação por todas as 27 rotas principais sem erros de JavaScript nem respostas de erro da API. Fluxo pela interface:
envio de CSV → assistente (detecção de layout e operadora, mapeamento sugerido, prévia normalizada) → processamento → resumo.
Únicos erros observados: bloqueio de rede às imagens do OpenStreetMap no ambiente de teste (esperado sem internet).

## Volume (`backend/scripts/perf_import.py`)
CSV sintético com 10 colunas (números, data, hora, duração, tipo, MCC, MNC, LAC, CI), importado pelo mesmo pipeline da aplicação.

| Registros | Importação | Taxa | Resolução ERB | Resumo | Contatos | Página de eventos | Grafo | Linha do tempo | Memória máx. do processo |
|---|---|---|---|---|---|---|---|---|---|
| 100.000 | 14,0 s | 7.128/s | 7,7 s | 1,4 s | 0,34 s | 0,25 s | 0,31 s | 0,43 s | 99 MB |
| 1.000.000 | 136,5 s | 7.324/s | 84,4 s | 9,6 s | 2,5 s | 2,1 s | 1,8 s | 3,7 s | 99 MB |

Leituras: a importação é linear e em fluxo (memória constante). Consultas sobre o caso inteiro de 1 milhão ficam entre
2 e 10 s nesse hardware; com filtros (alvo, período) caem proporcionalmente. São medições neste ambiente, não garantias.
Para casos maiores, use mais RAM no PostgreSQL e considere particionar `events` (ver ARQUITETURA.md).

## Backup e restauração (`scripts/test_backup_restore.sh`)
Backup cifrado (GPG AES-256) de 27 MB → restauração em banco novo → `SHA256SUMS` conferido → contagens idênticas
(`cases=2 events=102479 erb_cells=73 source_files=6 audit_log=28`) → SHA-256 de todos os arquivos originais restaurados
conferem → cadeia de auditoria íntegra. **Resultado: OK.**

## Implantação
`docker compose config` (produção e desenvolvimento) e `caddy adapt` do Caddyfile validados. A subida completa num servidor
com domínio real não pôde ser executada neste ambiente (sem daemon Docker nem DNS público).
