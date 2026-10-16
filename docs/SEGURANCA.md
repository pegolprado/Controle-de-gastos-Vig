# Segurança e privacidade

## Controles implementados

| Requisito | Implementação |
|---|---|
| HTTPS | Cloudflare Pages + HSTS (`public/_headers`); Supabase só aceita HTTPS |
| Autenticação real | Supabase Auth (senhas com hash bcrypt, fluxo PKCE, confirmação de e-mail, recuperação de senha, sessão com refresh token rotativo); nada é decidido por variáveis do navegador |
| Rotas privadas | `RequireAuth` no cliente, **mas a proteção real é a RLS**: sem JWT válido o banco não devolve nada (`anon` não tem SELECT em tabelas financeiras) |
| Autorização por recurso | RLS em todas as 25 tabelas; papéis por espaço; testes negativos (`20_isolation`, `40_sharing`) |
| IDs não dão acesso | consultas por ID de outro usuário retornam vazio; atualizações e exclusões afetam 0 linhas |
| Referências cruzadas | gatilhos impedem usar a conta, o cartão, a categoria ou a fatura de **outro espaço**, mesmo dentro do próprio espaço (as FKs sozinhas não impediriam) |
| Valores confiáveis | saldos, valores pagos, faturas, limites e status são calculados no banco; o que o cliente envia nesses campos é ignorado |
| Proprietário do app | atribuído só por SQL no servidor (`bootstrap_app_owner`, sem EXECUTE para clientes); não lê dados financeiros; acesso de suporte só com autorização explícita, somente leitura, com prazo e auditado |
| Suspensão | `admin_set_user_status` → RLS bloqueia imediatamente todas as leituras e escritas do usuário |
| Segredos | só a chave pública (anon) vai para o navegador; `service_role` existe apenas em Edge Function/GitHub Secrets; `.env*` no `.gitignore` |
| Rate limiting | Supabase Auth (login, cadastro, e-mails) + `enforce_rate_limit` nas RPCs sensíveis (convites, aceite de convite, criação de espaço, log de erros) |
| Erros e logs | mensagens amigáveis para o usuário; logs técnicos sanitizados (tokens, e-mails e números removidos) antes de enviar; nenhum log com senha, token ou dado financeiro completo |
| Convites | token aleatório de 244 bits exibido uma única vez; o banco guarda só o SHA-256; expiração, uso único, vínculo opcional a um e-mail, revogação |
| Auditoria | `audit_log` por registro financeiro (quem, quando, o que mudou) e `admin_audit_log` para ações administrativas |
| Cabeçalhos | CSP sem `unsafe-inline` para scripts (hash calculado no build), `frame-ancestors 'none'`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` |
| Planilhas | exportação CSV neutraliza injeção de fórmulas (`=`, `+`, `-`, `@`) |
| Uploads | bucket privado; tipos (imagem/PDF) e tamanho (5 MB) limitados; acesso por URL assinada de 2 minutos; caminho prefixado pelo espaço e protegido por RLS |
| Credenciais bancárias | o app **nunca** pede senha de banco, número completo de cartão nem CVV (só os 4 últimos dígitos, opcionais) |

## LGPD

- **Base legal e transparência:** Política de Privacidade em `/privacidade`; consentimento explícito no cadastro.
- **Minimização:** só nome, e-mail e o que o próprio usuário registra.
- **Portabilidade:** *Ajustes → Exportar meus dados* gera um JSON completo de todos os espaços acessíveis.
- **Eliminação:** *Ajustes → Excluir conta* apaga o espaço pessoal, os espaços compartilhados criados pelo usuário e as participações, e remove o login (Edge Function).
- **Retenção:** ver [OPERACAO.md §6](OPERACAO.md).
- **Acesso do operador:** o proprietário do app não tem acesso aos dados financeiros (garantido por RLS, não por convenção).
- **Inteligência artificial:** não há IA integrada. Se for adicionada, deve rodar em backend próprio (Edge Function), com dados minimizados ou anonimizados e sem acesso direto ao banco.

## Riscos conhecidos e mitigação recomendada

| Risco | Situação | Recomendação |
|---|---|---|
| Token de acesso válido por até 1 h após suspensão | os dados já ficam bloqueados pela RLS; só o JWT continua "válido" | para encerrar sessões na hora, use *Authentication → Users → Ban* no Supabase |
| E-mails do Supabase sem SMTP próprio | limite baixo de envio por hora | configure SMTP (Brevo/Resend grátis) |
| Backup só do banco | comprovantes do Storage ficam fora do `pg_dump` | sincronize o Storage via API S3 (`rclone`) |
| Proteção contra senhas vazadas | recurso do plano Pro do Supabase | ative-o se migrar de plano |
