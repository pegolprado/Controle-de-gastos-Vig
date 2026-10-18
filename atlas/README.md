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
- O servidor guarda **somente a lista de usuários** — a senha nunca sai do navegador. Toda a comunicação é por HTTPS.
- **Custo zero de hospedagem**: site, login e banco de usuários no plano gratuito da Cloudflare (ver DEPLOY.md).
- **Bloquear tela** (pausa sem perder a análise) e **ocultar números** na tela para projeção/compartilhamento.

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
| [docs/DEPLOY.md](docs/DEPLOY.md) | Publicar de graça em iamarx.com.br (Cloudflare + Registro.br) |
| [docs/TESTAR-NO-COMPUTADOR.md](docs/TESTAR-NO-COMPUTADOR.md) | Testar antes de publicar |
| [docs/OPERACAO.md](docs/OPERACAO.md) | Usuários, backup, atualização e problemas comuns |
| [docs/SEGURANCA.md](docs/SEGURANCA.md) | Modelo de privacidade e controles de segurança |
| [docs/ARQUITETURA.md](docs/ARQUITETURA.md) | Componentes e fluxo de dados |
| [docs/TESTES.md](docs/TESTES.md) | Testes automatizados e de volume |
| [docs/STATUS.md](docs/STATUS.md) | O que está pronto e limitações conhecidas |

## Estrutura

```
atlas/
  frontend/
    src/          aplicação React; src/engine = motor analítico que roda no navegador
    server/       servidor de login (Cloudflare Functions + D1: só usuários)
    functions/    ponto de entrada das Functions (/api/*)
    public/       arquivos estáticos e _headers (CSP e cabeçalhos de segurança)
  docs/           documentação
```
