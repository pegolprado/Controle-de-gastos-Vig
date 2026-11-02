# RADAR INTELIGENTE DE PROMOÇÕES — Etapa 1: Arquitetura

> Status: **proposta, aguardando validação**. Nenhum código foi escrito ainda e nenhuma integração foi testada.
> Data da pesquisa: 02/11/2026. Fuso: America/Sao_Paulo. Moeda: R$.

## 1. Resposta direta: dá para fazer de graça?

**Sim, com uma ressalva honesta.** O "motor" do sistema (planilha, script, agendamento, histórico, filtros, Telegram) é 100% gratuito e confiável. O que **não** é gratuito nem garantido é o acesso automático aos preços das 6 lojas: a maioria delas não oferece API pública gratuita para pessoa física em 2026.

Por isso, o sistema foi desenhado com **fontes em camadas**: o que funciona hoje entra já; o que depende de cadastro/aprovação entra como "módulo" que você liga depois, sem mexer no resto. Nenhuma loja aparecerá como "monitorada" no painel sem um teste real de sucesso.

## 2. Diagrama

```
                        ┌──────────────────────────────┐
                        │  GATILHOS DE TEMPO (Apps     │
                        │  Script) ex.: a cada 2 h,    │
                        │  só no horário configurado   │
                        └──────────────┬───────────────┘
                                       ▼
┌─────────────────────────── GOOGLE APPS SCRIPT ───────────────────────────┐
│                                                                          │
│  1. COLETORES (um por fonte, isolados com try/catch)                     │
│     ├─ Shopee Afiliados (API oficial)          [depende de aprovação]    │
│     ├─ Mercado Livre (API oficial, item por ID) [a testar na Etapa 5]    │
│     ├─ Gmail: e-mails de alerta de preço        [funciona já]            │
│     ├─ Feeds RSS públicos de ofertas            [cada um testado antes]  │
│     ├─ Página do produto cadastrado (opcional)  [experimental, ver §4]   │
│     └─ Lançamento manual (você cola preço/link) [funciona já]            │
│                         │                                                │
│  2. NORMALIZAÇÃO → {produto, loja, preço, link, fonte, horário}          │
│                         │                                                │
│  3. RECONHECIMENTO → casa a oferta com um item da aba PRODUTOS           │
│     (palavras obrigatórias, proibidas, marca, modelo)                    │
│                         │                                                │
│  4. HISTÓRICO → grava em HISTORICO_PRECOS (é a nossa "memória")          │
│                         │                                                │
│  5. FILTRO INTELIGENTE → EXCELENTE / BOA / DESCARTADA + motivo           │
│                         │                                                │
│  6. ANTIDUPLICIDADE → chave (produto+loja+faixa de preço) em 24–72 h     │
│                         │                                                │
│  7. ENVIO → Telegram Bot API (com nova tentativa e registro)             │
│                                                                          │
└───────────┬──────────────────────────────────────────────┬───────────────┘
            ▼                                              ▼
┌───────────────────────── GOOGLE SHEETS ──────┐   ┌──────── TELEGRAM ─────────┐
│ PAINEL · PRODUTOS · LOJAS · FONTES · OFERTAS │   │ alertas EXCELENTES        │
│ HISTORICO_PRECOS · NOTIFICACOES · LOGS ·     │   │ resumo diário (BOAS)      │
│ CONFIGURACOES                                │   │ alerta de falha do sistema│
└──────────────────────────────────────────────┘   │ comandos: /lista /add ... │
                                                   └───────────────────────────┘
Credenciais (token do bot, chaves de API): PropertiesService (Propriedades do script),
nunca na planilha nem no código.
```

## 3. Situação real de cada loja (pesquisada em 02/11/2026)

| Loja | Integração oficial | Gratuita para você? | Situação | Plano |
|---|---|---|---|---|
| **Shopee Brasil** | Shopee Affiliate Open API (GraphQL, assinatura HMAC-SHA256) | Sim, **após aprovação** no programa de afiliados (affiliate.shopee.com.br) | Melhor rota oficial disponível. Documentação fica dentro do painel do afiliado. | Módulo da Etapa 5, se você for aprovado. |
| **Mercado Livre** | API oficial (developers.mercadolivre.com.br) | Sim (cadastro de app grátis) | A **busca pública** `/sites/MLB/search` vem retornando **403** para muitos desenvolvedores desde o início de 2026 (relatos públicos, sem comunicado oficial). Consulta de **anúncio por ID** ainda precisa ser testada. | Testar na Etapa 5: você cadastra o link/ID do anúncio e o sistema consulta só aquele item. Se falhar, a loja fica "INDISPONÍVEL" no painel. |
| **Amazon Brasil** | Creators API (substituiu a PA-API 5.0, desativada em 2026) | **Na prática, não.** Exige conta de Associado com vendas qualificadas recentes (relatos: 10 vendas em 30 dias); sem isso o acesso é pausado. | Inviável para uso pessoal. | Alternativas: alertas por e-mail (Gmail) e feeds de ofertas que citem Amazon. |
| **Magazine Luiza** | Nenhuma API pública de produtos conhecida | Não | Programa "Parceiro Magalu" é de vitrine/afiliado, não API de preços. | Gmail + feeds + lançamento manual. |
| **KaBuM!** | Nenhuma API pública conhecida | Não | — | Gmail + feeds + lançamento manual (+ leitura opcional da página, §4). |
| **Casas Bahia** | Nenhuma API pública conhecida | Não | Possíveis feeds via redes de afiliados (exigem aprovação; não verificado). | Gmail + feeds + lançamento manual. |

Serviços **excluídos por serem pagos**: Keepa, SerpAPI/Google Shopping, Apify, scrapers comerciais.

## 4. Fontes alternativas gratuitas (e seus limites)

1. **Gmail como fonte (recomendado, 100% dentro das regras).** Você ativa alertas de preço/lista de desejos nas lojas e em comparadores, e os e-mails caem num marcador `RADAR`. O script lê esses e-mails, extrai produto/preço/link e passa pelo filtro. Limite: depende do que as lojas enviam; formatos mudam.
2. **Feeds RSS públicos de comunidades de ofertas.** Só entram depois de um teste real a partir do Apps Script (este ambiente de desenvolvimento não tem acesso a esses sites, então **nada foi confirmado ainda**). Feed que não responder fica "INDISPONÍVEL".
3. **Leitura da página do produto que você cadastrou (opcional, experimental).** Uma consulta leve (ex.: 1 vez a cada 6 h por link) aos dados estruturados da página (`schema.org/Offer`). Limites: os termos de uso de várias lojas proíbem acesso automatizado e algumas bloqueiam os servidores do Google (Amazon costuma bloquear). Por isso vem **desligada** por padrão, respeita `robots.txt` e é desativada sozinha se a loja bloquear. Você decide se liga.
4. **Lançamento manual.** Viu um preço? Cola na aba OFERTAS (ou manda `/preco` ao bot). Entra no histórico e passa pelo filtro.
5. **Canais de promoção do Telegram:** um bot **não consegue** ler canais dos quais não é administrador; ler como usuário exigiria um servidor rodando o tempo todo (fora do Apps Script). **Não implementaremos.**

## 5. Filtro inteligente (como evita desconto falso)

- **Preço de referência = mediana do nosso próprio histórico** (últimos 30–60 dias), só quando houver pelo menos N observações (configurável, padrão 5). O preço riscado da loja **nunca** é usado como histórico; aparece apenas como "preço anunciado pela loja".
- Sem histórico suficiente → a mensagem diz "preço competitivo (sem histórico confiável)", nunca "menor preço".
- Regras (todas ajustáveis em CONFIGURACOES):
  - **EXCELENTE:** preço ≤ seu preço-alvo **ou** ≥ X% abaixo da mediana histórica (padrão 15%), vendedor aceitável, produto disponível.
  - **BOA:** abaixo da mediana, mas sem atingir o alvo/limiar → vai para o resumo diário, não para alerta imediato.
  - **DESCARTADA:** sem preço válido, link inválido, palavra proibida (ex.: "capa", "película", "usado", "recondicionado"), vendedor com reputação baixa (quando a fonte informa), duplicada, ou "desconto" que não bate com o histórico. Sempre com o **motivo** registrado.
- **Comparação entre lojas** só quando houver preço do mesmo produto vindo de 2+ fontes no período.
- Frete, cupom e avaliação só aparecem na mensagem se a fonte informar; caso contrário: "verificar no checkout".

## 6. Escolha de produtos (o que você controla sem código)

Aba **PRODUTOS**, uma linha por item: Ativo (✔), Nome, Categoria, Palavras obrigatórias, Palavras proibidas, Preço-alvo (R$), Preço mínimo plausível (para barrar anúncios-isca), Lojas permitidas, Links/IDs de anúncios (opcional), Prioridade.
Exemplo: "Galaxy Tab S10 FE" · obrigatórias `galaxy tab s10 fe` · proibidas `capa, película, + , plus` · alvo R$ 2.300 · mínimo R$ 1.200.

Além disso, via Telegram (comandos lidos a cada 5–10 min por consulta `getUpdates`, sem servidor): `/lista`, `/add`, `/alvo`, `/pausar`, `/status`, `/teste`.

## 7. Limites gratuitos que o projeto respeita (conta Google comum)

| Recurso | Limite aproximado | Como respeitamos |
|---|---|---|
| Tempo por execução | 6 min | Processa em lotes e salva o ponto onde parou |
| Tempo total de gatilhos | 90 min/dia | Frequência padrão a cada 2 h, só das 7h às 23h |
| Chamadas UrlFetch | 20.000/dia | Contador diário na aba LOGS com teto configurável |
| Leitura de Gmail | cota diária de leitura | Lê só o marcador `RADAR`, só e-mails novos |
| Telegram | ~1 msg/s por chat | Fila com pausa e máximo de alertas por dia |

## 8. Confiabilidade e segurança

- Cada fonte roda isolada: falha em uma não para as outras.
- Aba FONTES mostra status real: OK / FALHANDO / INDISPONÍVEL / NÃO CONFIGURADA, com data do último sucesso.
- Após 3 falhas seguidas numa fonte → alerta no Telegram e pausa automática.
- `LockService` impede duas execuções simultâneas.
- Validação de URL (só https e domínios da lista de lojas).
- Token e chaves só em Propriedades do Script; logs nunca imprimem credenciais.
- Resumo de "saúde do sistema" diário no Telegram (opcional).

## 9. O que é possível já x o que depende de terceiros

| Pronto para implementar já | Depende de você / de terceiros |
|---|---|
| Planilha, painel, histórico, filtros, antiduplicidade | Aprovação no Shopee Afiliados |
| Bot do Telegram + comandos | Teste da API do Mercado Livre por ID de anúncio |
| Gatilhos automáticos e alertas de falha | Feeds RSS: cada um precisa passar no teste real |
| Fonte Gmail (alertas por e-mail) | Leitura de página: só se você autorizar e a loja permitir |
| Lançamento manual de preço | Amazon/Magalu/KaBuM/Casas Bahia: sem API gratuita |

## 10. Ajustes sugeridos ao prompt original

- **Retirar** "avaliação da comunidade" e "reputação do vendedor" como critérios obrigatórios: entram só quando a fonte fornecer.
- **Trocar** "comparar preço entre lojas" por "comparar quando houver 2+ fontes para o mesmo produto".
- **Acrescentar:** preço mínimo plausível por produto, palavras proibidas, resumo diário das BOAS, horário silencioso, comandos no Telegram, alerta de saúde do sistema e histórico próprio como base do "preço real".
- **Aceitar** que a cobertura das 6 lojas não será automática para todas: o sistema é honesto sobre isso no painel.

## 11. Próximas etapas

2. Bot no BotFather + CHAT_ID → 3. Planilha → 4. Código → 5. Fontes (uma por vez, com teste) → 6. Filtros → 7. Telegram → 8. Gatilhos → 9. Testes → 10. Manutenção.

## Fontes consultadas

- Amazon — aviso de descontinuação da PA-API 5.0: https://affiliate-program.amazon.com/creatorsapi/docs/en-us/paapiv5-deprecation
- Documentação PA-API 5.0 (aviso de desativação): https://webservices.amazon.com/paapi5/documentation/
- Mercado Livre — permissões funcionais (erro 403): https://developers.mercadolivre.com.br/pt-br/permissoes-funcionais
- Relatos de 403 em `/sites/MLB/search`: https://www.reclameaqui.com.br/mercado-livre/bloqueio-do-endpoint-de-busca-publica-forbidden-na-api-do-mercado-livre_yi5DSFwTKmoXaNgP/ e https://github.com/RafaPato/Loja-Pato-Stuido-3d/issues/5
- Shopee Affiliate Open API (SDK de terceiros que documenta endpoint e assinatura): https://www.nuget.org/packages/Shopee.Affiliate
