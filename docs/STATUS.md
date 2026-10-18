# Status do projeto

## Concluído

- **Autenticação real:** cadastro, login, recuperação e redefinição de senha, confirmação de e-mail, sair de todos os dispositivos, rotas protegidas, contas pendentes e suspensas.
- **Espaços:** pessoal (privado) e compartilhados, com 5 papéis aplicados por RLS, convites por link (WhatsApp/e-mail) e acesso de suporte autorizado.
- **Lançamentos:** receita, despesa, transferência e pagamento de fatura; categorias e subcategorias, tags, observações e comprovante; situações (prevista, pendente, paga, recebida, cancelada); criar, editar, duplicar, cancelar, excluir com confirmação e histórico de alterações; busca por descrição, categoria, conta, valor e data; filtros; carregamento progressivo; exportação CSV; idempotência; **importação de extrato OFX/CSV** (Nubank, Itaú, BB, Inter e outros), com categoria sugerida pelo histórico, aviso de lançamentos parecidos e reimportação sem duplicar.
- **Contas:** 6 tipos, saldo inicial, saldo atual × previsto, extrato por conta, arquivamento.
- **Cartões:** limite total e disponível, fechamento e vencimento, faturas atual, anteriores e futuras, compras parceladas e recorrentes, pagamento parcial ou total, explicação visual (pago / pendente / próximas).
- **Compromissos:** vencidas, hoje, 7 dias, 30 dias, a receber, pagas; pagamento parcial com juros e desconto; histórico de vencimento.
- **Recorrências:** diária, semanal, mensal, anual e intervalos personalizados; término; pausa; encerramento; "somente esta" × "futuras".
- **Renda FII e ações:** carteira de fundos imobiliários e ações (ON, PN, units) com compras e vendas datadas; quanto e quando cada ativo paga, com data com, JCP líquido, histórico, cotação e valor da carteira; visão do mês vigente (recebido × contagem de dias) e previsão para quem ainda não anunciou; piloto automático (lança e recebe sozinho); meta de renda passiva; relatório para o IR; avisos no celular. Dados públicos da B3 buscados pelo banco (extensão `http`).
- **Painel:** resumo do mês anterior nos primeiros dias do mês. **Lançamentos:** categoria sugerida pelo histórico.
- **Orçamentos** por categoria com alertas 50/75/90/100% e projeção (identificada como estimativa); **metas** com aportes e retiradas.
- **Painel:** saldo consolidado, receitas, despesas, resultado, % do orçamento, vencimentos, despesas por categoria, 12 meses, comparação com o mês anterior, próximas recorrências, faturas abertas, insights explicáveis; filtros por mês, conta, cartão e categoria; ação rápida.
- **Relatórios:** receitas × despesas, evolução patrimonial simplificada, fixas × variáveis, maiores gastos, categorias, projeção de 6 meses, insights, tabela; filtros por período, conta, cartão e usuário; **CSV e PDF**.
- **Administração do proprietário:** usuários (aprovar, suspender, revogar), convites de cadastro, marca (nome, frase, logo, cor), modo de cadastro, recursos, limites de uso, aviso global, versão mínima, versões e reversão, auditoria, erros, status da implantação.
- **PWA:** instalável (com passo a passo para Android, iPhone, computador e navegadores embutidos quando o navegador não oferece o botão), ícones, atalhos, atualização controlada que não interrompe formulários, versão visível.
- **Segurança e LGPD:** ver [SEGURANCA.md](SEGURANCA.md). Exportação JSON e exclusão de conta.
- **Operação:** banco mantido ativo por consulta diária (`keepalive.yml`), CI, deploy de homologação e produção, backup diário criptografado, restauração testada, documentação.
- **Notificações in-app** (orçamento e vencimentos).

## Pendente / próximos passos

| Item | Motivo | Esforço |
|---|---|---|
| **Publicar** (Supabase + Cloudflare) | precisa das suas contas e credenciais, ver [DEPLOY.md](DEPLOY.md) | 30–40 min |
| E2E contra um Supabase real de homologação | indisponível neste ambiente (sem Docker/GitHub) | rodar o roteiro manual de [TESTES.md](TESTES.md) |
| Notificações **push** em segundo plano | exige Web Push + Edge Function agendada; não foi prometido nem implementado | médio |
| Modo offline com fila de sincronização | decisão consciente: o app exige conexão para gravar e informa claramente quando ela cai, sem nunca fingir que salvou | alto |
| Estorno parcial em cartão como lançamento próprio | hoje: editar o valor ou cancelar a compra | baixo |
| Importação de fatura de cartão (CSV) | hoje o extrato é importado para contas; para faturas, use "Inverter sinais" numa conta ou lance as compras no cartão | baixo |
| Integração bancária (Open Finance) | só via provedor autorizado; fora de escopo | alto |
| Backup automático dos arquivos do Storage | o `pg_dump` cobre só o banco | baixo (`rclone`) |
| Transferir a função de proprietário pelo painel | hoje via SQL | baixo |

## Custos estimados

| Serviço | Plano gratuito (suficiente para uso pessoal/familiar) | Quando pagar |
|---|---|---|
| Supabase | **R$ 0**: 500 MB de banco (centenas de milhares de lançamentos, já contando a auditoria), 1 GB de arquivos, 50 mil usuários ativos/mês; o projeto pausa após 7 dias sem uso (o workflow diário `keepalive.yml` evita isso) | **Pro, US$ 25/mês (~R$ 140)**: backups diários gerenciados, sem pausa, 8 GB de banco |
| Cloudflare Pages | **R$ 0**: banda ilimitada, 500 builds/mês, HTTPS, domínio próprio | raramente necessário |
| GitHub (Actions) | **R$ 0**: 2.000 min/mês em repositório privado (ilimitado em público); cada ciclo de CI leva ~5 min | — |
| E-mail (SMTP) | **R$ 0**: Brevo (300/dia) ou Resend (3.000/mês) | volume alto |
| Domínio `.com.br` | opcional: ~R$ 40/ano no Registro.br | — |
| **Total** | **R$ 0/mês** (+ domínio opcional) | ~R$ 140/mês com Supabase Pro |
