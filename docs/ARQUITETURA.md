# Arquitetura

## Visão geral

```
 Navegador / PWA (React)                         Supabase (gratuito)
 ┌─────────────────────────────┐   HTTPS + JWT   ┌──────────────────────────────────┐
 │ telas (features/*)          │ ──────────────▶ │ Auth (e-mail/senha, recuperação) │
 │ serviços (services/*)       │                 │ PostgREST → PostgreSQL           │
 │ domínio puro (domain/*)     │ ◀────────────── │   • RLS em todas as tabelas      │
 │ cache (TanStack Query)      │                 │   • gatilhos/views calculam      │
 │ service worker (só o casco) │                 │     saldos, faturas e status     │
 └─────────────────────────────┘                 │   • RPCs para operações atômicas │
        ▲  arquivos estáticos                    │ Storage (comprovantes, privado)  │
        │                                        │ Edge Function (excluir conta)    │
 Cloudflare Pages (CDN + HTTPS + rollback)       └──────────────────────────────────┘
```

Princípios:

1. **O banco é a fonte da verdade.** Nada importante fica só no navegador. O service worker guarda apenas o casco do app (HTML/JS/CSS/fontes), **nunca dados financeiros**.
2. **Autorização no servidor.** Cada linha é protegida por RLS. Conhecer o ID de um registro não dá acesso a ele (testado em `supabase/tests/20_isolation.test.sql`).
3. **Valores calculados no servidor.** `paid_cents`, a fatura de cada compra, o status das faturas, os saldos e os limites de cartão são calculados por gatilhos e views. Se o cliente enviar `paid_cents`, o valor é ignorado.
4. **Dinheiro em centavos (`bigint`)**, sem ponto flutuante em nenhuma camada.
5. **Gravações idempotentes.** Lançamentos, parcelamentos, recorrências, liquidações e aportes levam uma `client_request_id` (UUID). O mesmo envio repetido, seja por clique duplo, timeout ou queda de rede, nunca gera duplicata.

## Camadas do front-end

| Pasta | Responsabilidade |
|---|---|
| `domain/` | regras puras e testadas: ciclo de fatura (espelho do SQL), recorrência sem deriva, níveis de orçamento, insights explicáveis, rótulos e permissões |
| `services/` | uma função por operação no Supabase, sem estado; erros sobem para o React Query |
| `hooks/` | consultas reutilizáveis (`useAccounts`, `useLookups`…) com chaves `['ws', id, …]`, invalidadas juntas depois de cada gravação |
| `features/` | telas, carregadas sob demanda (cada uma é um chunk separado) |
| `components/ui` | design system: Button, Field, MoneyInput, Modal/Sheet, Confirm, Card, Badge, Progress, Segmented… |
| `pwa/` | detecção de versão nova e atualização segura |

## Modelo de dados

Migrações em `supabase/migrations` (ordem cronológica):

| Migração | Conteúdo |
|---|---|
| `0100_foundation` | `profiles`, `app_roles` (proprietário do app), `app_settings`, `app_releases`, `admin_audit_log`, `client_errors`, `rate_limits`, funções de autorização |
| `0200_workspaces` | `workspaces` (pessoal/compartilhado), `workspace_members` (papel, suporte temporário), `invites` (token com hash) |
| `0300_finance` | `accounts`, `categories` (1 nível de subcategoria), `credit_cards`, `card_invoices`, `installment_groups`, `recurrences`, `transactions`, `tx_settlements`, `tx_due_changes`, `audit_log` + views `ledger_entries`, `account_balances`, `card_invoice_summary`, `card_limits` |
| `0400_planning` | `budgets`, `goals`, `goal_contributions`, `goal_progress`, `notifications`, `user_preferences` |
| `0500_functions` | cadastro automático, contexto da sessão, espaços, membros, convites, parcelamento, liquidação, recorrências, notificações |
| `0600_admin_reports` | painel do proprietário (só metadados) e relatórios (`report_monthly`, `report_categories`, `budget_progress`) |
| `0700_rls` | todas as policies e GRANTs |
| `0800_storage_cron` | bucket privado `receipts` e tarefas `pg_cron` (opcional) |

### Lançamentos (`transactions`)

| `kind` | Campos obrigatórios | Efeito no saldo | Conta como despesa/receita? |
|---|---|---|---|
| `income` | `account_id` | + valor liquidado | receita |
| `expense` em conta | `account_id` | − valor liquidado | despesa |
| `expense` no cartão | `card_id` (fatura calculada) | nenhum | despesa (no mês da compra/parcela) |
| `transfer` | `account_id`, `destination_account_id` | − origem, + destino | **não** |
| `card_payment` | `account_id`, `invoice_id` | − conta | **não** (liquida a fatura) |

Situações: `planned`, `pending`, `paid`, `received` e `cancelled`. Lançamentos cancelados nunca entram em saldos, faturas ou relatórios.

**Por que não há despesa duplicada:** a compra no cartão é a despesa. O pagamento da fatura (`card_payment`) só transfere dinheiro da conta para quitar a dívida. Os relatórios somam apenas `income` e `expense`, e o teste `30_finance` confirma isso.

### Cartões e faturas

- Ciclo (`card_cycle`): compras **a partir do dia de fechamento** entram na fatura seguinte. Dias inexistentes (31 em fevereiro) usam o último dia do mês. A fatura é identificada pelo mês de vencimento.
- As faturas são criadas pelo servidor (`ensure_invoice`) e o cliente não consegue criá-las.
- Status derivado: `open` (antes do fechamento), `closed`, `partial`, `paid` e `overdue`.
- Um pagamento maior que o saldo em aberto é recusado. Se uma compra for estornada depois do pagamento, a diferença aparece como crédito.
- Limite disponível = limite − soma do que está em aberto em todas as faturas, incluindo parcelas futuras.

### Parcelamentos

`create_installment_purchase` cria N parcelas numa única transação: `description (i/N)`, centavos residuais na 1ª parcela e cada parcela na data da compra + (i−1) meses. No cartão, cada parcela cai na sua própria fatura. Em conta (boleto/carnê), cada parcela fica pendente com o seu vencimento. Excluir o grupo remove todas as parcelas, e cancelar uma parcela isolada é feito pela situação.

### Pagamentos parciais, juros e descontos

`settle_transaction` registra `principal + juros − desconto`. O lançamento só passa a pago quando o principal acumulado cobre o valor. O saldo da conta usa o caixa efetivo na data de cada pagamento, e cada pagamento pode ser desfeito. Mudanças de vencimento ficam gravadas em `tx_due_changes`.

### Recorrências

- A data da n-ésima ocorrência é sempre calculada **a partir da data inicial** (31/01 → 28/02 → 31/03, sem deriva).
- `generate_recurrences` é idempotente por `unique(recurrence_id, recurrence_date)`: rodar duas vezes ou perder o contador não duplica nada. O app chama a função ao abrir o espaço, e o `pg_cron` diário a chama quando está habilitado.
- Ocorrências em conta são geradas até 45 dias à frente, como pendentes. Ocorrências em cartão (assinaturas) são geradas só até hoje.
- Editar "somente esta" marca a ocorrência como `recurrence_detached`. Editar "esta e as futuras" altera a regra e as pendentes não destacadas. Pausar não gera nada, e retomar não cria cobranças retroativas. Encerrar remove as pendentes futuras.

### Orçamentos e alertas

Um orçamento por categoria principal e mês (subcategorias contam na principal). `refresh_notifications` cria alertas in-app em 50, 75, 90 e 100% e para vencimentos, sem repetir (`unique(user_id, ref_key)`). **Não há notificação push em segundo plano.** Isso é informado ao usuário na tela.

## Permissões

### Dentro de um espaço (RLS)

| Ação | viewer | contributor | editor | admin | owner |
|---|:-:|:-:|:-:|:-:|:-:|
| ler dados e relatórios | ✓ | ✓ | ✓ | ✓ | ✓ |
| criar lançamentos e pagamentos | | ✓ | ✓ | ✓ | ✓ |
| editar/excluir os **próprios** lançamentos | | ✓ | ✓ | ✓ | ✓ |
| editar/excluir **qualquer** lançamento | | | ✓ | ✓ | ✓ |
| contas, cartões, categorias, orçamentos, metas, recorrências | | | ✓ | ✓ | ✓ |
| ver histórico de auditoria | | | ✓ | ✓ | ✓ |
| convidar, alterar papéis (até editor), remover membros | | | | ✓ | ✓ |
| gerenciar administradores, excluir o espaço, conceder suporte | | | | | ✓ |

As policies usam `workspace_id in (select my_workspace_ids(N))`, que o planejador avalia uma única vez por consulta. Usuários suspensos, pendentes ou com acesso expirado não aparecem nesse conjunto, então o bloqueio é imediato.

### Proprietário do aplicativo (separado das finanças)

- Atribuído **só** por SQL no servidor: `select public.bootstrap_app_owner('email')` (função sem permissão para `authenticated`/`anon`).
- O proprietário vê usuários, status, convites de cadastro, configurações, versões, auditoria administrativa e erros técnicos, mas **nenhuma tabela financeira**: o papel não aparece em nenhuma policy financeira (teste `20_isolation`).
- **Acesso de suporte:** só o dono do espaço pode concedê-lo, sempre somente leitura, por 1 a 168 h, revogável e registrado em `admin_audit_log`.

## Atualização: código × dados × banco

| O que muda | Como chega aos usuários | Proteções |
|---|---|---|
| **Código** (front-end) | deploy no Cloudflare Pages; o service worker baixa a versão nova em segundo plano; aviso "Nova versão disponível" | não recarrega com formulário sujo ou gravação em andamento; checagem a cada 30 min e ao voltar para a aba; `version.json` sem cache; caches antigos limpos; versão mínima opcional definida pelo admin |
| **Configuração/dados globais** (marca, recursos, limites, aviso) | `app_settings` lido pelo app (atualiza a cada 15 min e ao abrir) | só o proprietário altera, via RPC auditada |
| **Banco** (schema) | migrações versionadas aplicadas pelo CI **antes** do front-end | migrações aditivas (expandir → migrar → contrair), sem DROP automático, backup antes, validadas no CI num PostgreSQL limpo |

Detalhes operacionais em [OPERACAO.md](OPERACAO.md).
