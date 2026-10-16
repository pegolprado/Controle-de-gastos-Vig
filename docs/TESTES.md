# Relatório de testes

Execução de **16/10/2026** neste repositório (Node 22, PostgreSQL 16.15, Chromium do Playwright). Todos os números abaixo saíram de execuções reais. O que **não** foi testado está listado no fim.

| Suíte | Comando | Resultado |
|---|---|---|
| Lint (ESLint) | `npm run lint` | ✅ 0 erros, 0 avisos |
| Tipos (TypeScript strict) | `npm run typecheck` | ✅ sem erros |
| Unitários (Vitest) | `npm test` | ✅ **43/43** testes em 7 arquivos |
| Banco: migrações + RLS + regras (PostgreSQL real) | `npm run test:db` | ✅ **8 migrações aplicadas** num banco limpo, **6/6** arquivos (cerca de 190 asserções) e **backup + restauração** verificados |
| Interface E2E (Playwright, desktop 1366×860 + Pixel 7) | `npm run test:e2e` | ✅ **48/48** (24 cenários × 2 dispositivos) |
| Build de produção + PWA | `npm run build` | ✅ 69 arquivos no pré-cache; PDF fora do pré-cache |

## Cobertura por requisito

| Requisito | Onde é testado |
|---|---|
| Cadastro e login | `10_signup` (perfil, espaço pessoal, categorias, conta inicial, preferências); E2E: login, senha errada, sessão mantida após recarregar, logout, validação de senha forte e consentimento |
| Recuperação de senha | E2E: resposta não revela se o e-mail existe |
| Isolamento entre usuários | `20_isolation`: leitura, alteração e exclusão por ID alheio, inserção em espaço alheio, referências cruzadas (conta/categoria/transferência de outro espaço), mover entre espaços, RPCs, relatórios e acesso anônimo |
| Proprietário do app sem acesso financeiro | `20_isolation`, `40_sharing` |
| Permissões de espaço compartilhado | `40_sharing`: viewer, contributor, editor e admin; autoria imutável; convites (e-mail errado, reuso, token inválido); remoção; saída; expiração; suspensão; acesso de suporte autorizado, somente leitura e revogado |
| Receitas e despesas; edição | `30_finance`: status normalizado, `paid_cents` do cliente ignorado, mudança de tipo bloqueada |
| Transferências | `30_finance`: origem e destino corretos, consolidado preservado, mesma conta bloqueada |
| Cálculo de saldos | `30_finance`: atual × projetado × pendências, cancelados excluídos |
| Compras parceladas | `30_finance`: soma exata, centavos na 1ª parcela, uma parcela por fatura, idempotência, exclusão do grupo; `money.test` (cliente) |
| Pagamento de faturas | `30_finance`: pagamento parcial e total, excesso bloqueado, débito na conta, limite liberado, **despesas não duplicadas** no relatório |
| Ciclo de fatura | `30_finance` (SQL) e `domain.test` (TS espelho): antes/no dia do fechamento, vencimento no mês seguinte, 31 de fevereiro, virada de ano |
| Despesas recorrentes | `50_recurrence`: geração idempotente (inclusive com o contador perdido), âncora de fim de mês, cartão só até hoje, "somente esta" × "futuras", pagas preservadas, pausa/retomada, encerramento, data de término |
| Pagamentos parciais | `30_finance`: juros, desconto, quitação, desfazer, histórico de vencimento |
| Orçamentos e relatórios | `60_planning_admin`: subcategorias somam na principal, alertas 50/75/90/100 sem repetição, cópia de mês, relatório por categoria; `domain.test`: níveis e projeção |
| Exportações | `csv.test`: separador `;`, BOM, aspas, neutralização de fórmulas |
| Operações duplicadas | `30_finance` (`client_request_id`); E2E: **clique duplo cria 1 lançamento** |
| Falhas de rede | E2E: rede cai ao salvar → erro claro, **nada fingido como salvo**, formulário preservado, reenvio cria exatamente 1; `errors.test` |
| Atualização do PWA | E2E: aviso de nova versão via `version.json`; **com formulário aberto o botão fica bloqueado e o rascunho é mantido**; manifesto, ícones e `sw.js` publicados; `formGuard.test`, `version.test` |
| Migrações do banco | `test:db` aplica todas as migrações em sequência num banco vazio, também no CI |
| Backup e restauração | `test:db`: `backup.sh` → banco vazio → `restore.sh` → contagens e somas idênticas + RLS e cadastro funcionando na cópia. Esse teste **encontrou e corrigiu um defeito real**: o backup descartava as permissões (GRANTs) |
| Painel administrativo | `60_planning_admin`: funções negadas a não proprietários, estatísticas, busca, marca, validação de cor, versões e reversão, convite de cadastro, auditoria, rate limit; E2E: rota negada a não proprietário |
| Layout mobile e desktop | E2E: 12 telas nos dois dispositivos **sem rolagem horizontal e sem erros de JavaScript** |

## Limitações (honestas)

- **E2E com backend simulado.** Neste ambiente não havia Docker nem acesso ao GitHub para baixar PostgREST/GoTrue, então os testes de interface interceptam as chamadas HTTP do Supabase (`e2e/mockSupabase.ts`). As regras reais de segurança e cálculo são testadas separadamente contra PostgreSQL de verdade. **Recomendado:** antes da primeira publicação, rodar o roteiro manual abaixo no ambiente de homologação.
- O comportamento do Supabase Auth (envio de e-mail, links de confirmação e de recuperação) não foi exercitado de ponta a ponta. Isso depende do projeto Supabase configurado.
- A atualização via **service worker real** (troca de versão em cache) é coberta pela configuração do Workbox e pelo teste do aviso; a troca física de versões em dois deploys consecutivos deve ser conferida em homologação.
- A "reversão de implantação" é uma operação da hospedagem (Cloudflare Rollback). O registro da reversão no painel está testado; o clique no Cloudflare não.
- **Ainda não foi publicado.** Nenhum endereço de produção existe até você seguir [DEPLOY.md](DEPLOY.md).

## Roteiro manual de homologação (15 min)

1. Criar conta → confirmar e-mail → entrar.
2. Cadastrar conta com saldo inicial, lançar receita e despesa → sair → entrar → conferir saldo.
3. Cadastrar cartão (fechamento 5, vencimento 12) → compra parcelada 3x → conferir 3 faturas → pagar a fatura atual → conferir que as despesas do mês não dobraram.
4. Criar uma conta a pagar pendente → pagamento parcial com juros → quitar.
5. Criar um espaço compartilhado → convidar um 2º usuário como **Somente leitura** → confirmar que ele vê e não consegue lançar.
6. Como proprietário, suspender o 2º usuário → confirmar o bloqueio.
7. Publicar a versão `x.y.z+1` → no celular com o app instalado, ver o aviso e atualizar.
8. Rodar o workflow **Backup do banco** manualmente e baixar o artefato.
