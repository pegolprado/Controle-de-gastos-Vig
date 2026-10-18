# MARX · Intelligence Pro

**ANÁLISE • CONEXÕES • INTELIGÊNCIA** — plataforma web de análise de bilhetagem telefônica (CDR), extratos de
ERB, vínculos, linha do tempo e geolocalização, para uso em **iamarx.com.br**.

## Como funciona: nada fica salvo

- O usuário entra com **e-mail e senha próprios** (cadastrados pelo administrador; MFA opcional).
- Os arquivos (CSV, TXT, XLS/XLSX, XML, JSON, HTML, PDF com OCR, ZIP) são **lidos e processados no próprio
  navegador**, num banco analítico em memória (DuckDB-WASM). **Eles não são enviados ao servidor.**
- Consultas, gráficos, mapa, grafo e relatórios aparecem na tela e podem ser **exportados em Excel, PDF ou CSV**,
  gerados no navegador e baixados direto para o computador do usuário.
- **Sair, fechar a aba, recarregar a página ou ficar inativo (30 min, configurável) apaga tudo.** Ao voltar, é
  preciso carregar os arquivos e refazer as consultas.
- Cada análise existe apenas na aba de quem a fez: **ninguém mais vê** — nem outros usuários, nem o administrador,
  nem o servidor.
- O servidor guarda **somente a lista de usuários** (senhas com Argon2id). Toda a comunicação é por HTTPS.

## Funcionalidades

Importação com detecção de layout e mapeamento de colunas · normalização de números (E.164), datas, fusos e
durações · duplicidades e período autorizado · explorador de registros com filtros · contatos e reciprocidade ·
comparação entre números e períodos · grafo de vínculos · resolução técnica de ERB contra cadastros (sem inventar
coordenadas) · mapa com setores esquemáticos e reprodução cronológica · linha do tempo com anotações · estatística
e padrões · cruzamento multifonte de registros recíprocos · alertas configuráveis · assistente analítico local ·
relatório técnico rastreável (SHA-256 dos arquivos de entrada e do arquivo gerado).

## Documentação

| Documento | Conteúdo |
|---|---|
| [docs/TESTAR-NO-COMPUTADOR.md](docs/TESTAR-NO-COMPUTADOR.md) | Testar no seu computador em ~15 minutos |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Publicar em iamarx.com.br (servidor + DNS no Registro.br) |
| [docs/OPERACAO.md](docs/OPERACAO.md) | Usuários, backup, atualização e problemas comuns |
| [docs/SEGURANCA.md](docs/SEGURANCA.md) | Modelo de privacidade e controles de segurança |
| [docs/ARQUITETURA.md](docs/ARQUITETURA.md) | Componentes e fluxo de dados |
| [docs/TESTES.md](docs/TESTES.md) | Testes automatizados e de volume |
| [docs/STATUS.md](docs/STATUS.md) | O que está pronto e limitações conhecidas |

## Estrutura

```
atlas/
  backend/    servidor de login (FastAPI + SQLite: só usuários)
  frontend/   aplicação React; src/engine = motor analítico que roda no navegador
  deploy/     Caddy (HTTPS automático, cabeçalhos de segurança)
  scripts/    backup/restauração da lista de usuários
```
