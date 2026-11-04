# Segurança do Finance MV

Nenhum sistema na internet é "impossível de invadir". O objetivo aqui é deixar cada camada
fechada por padrão, com testes automáticos que travam o CI se alguém abrir uma brecha.

## O que já está ativo

| Camada | Proteção |
| --- | --- |
| Banco (Supabase) | RLS em **todas** as tabelas; cada pessoa só vê o próprio espaço. Teste `05_security_lint` falha se aparecer tabela sem RLS, função privilegiada sem `search_path`, view sem `security_invoker`, algo acessível sem login ou tabela sem a regra de 2FA. |
| 2FA | Verificação em duas etapas (app autenticador). Exigida **pelo banco** (política restritiva `mfa_required` + funções de acesso): senha roubada sem o celular não lê nem altera nada. Proprietário pode desativar para quem perdeu o celular (auditado). |
| Navegador | Content-Security-Policy no `index.html` (o GitHub Pages ignora `_headers`): scripts só do próprio site, conexões só com o Supabase, sem plugins, `upgrade-insecure-requests`. Proteção contra o app ser aberto dentro de outro site. |
| Dados no aparelho | Nada financeiro no cache do service worker; OCR do comprovante roda no celular. |
| Segredos | Só a chave pública (anon) no front-end. `service_role`, senha do banco e SMTP ficam nos Secrets do GitHub/Supabase. Varredura de segredos no repositório: limpa. |
| Dependências | `npm audit` sem falhas no código que vai para o navegador. Dependabot semanal + CodeQL (análise de segurança) a cada PR. |
| GitHub Actions | Permissões mínimas (`contents: read`) em todos os fluxos. |

## Ajustes que só o dono das contas pode fazer (recomendado)

Supabase → **Authentication**:

1. **Sign In / Providers → Email**: manter *Confirm email* ligado.
2. **Passwords** (Auth → Settings): mínimo de 8 caracteres com letras e números e ligar
   **Leaked password protection** (bloqueia senhas que já vazaram na internet).
3. **Multi-Factor**: deixar *TOTP* habilitado (padrão).
4. **Rate Limits**: revisar limites de login, cadastro e recuperação de senha.
5. **Attack Protection → CAPTCHA** (opcional): Cloudflare Turnstile no cadastro/login.

Supabase → **Advisors → Security Advisor**: rodar e conferir que não há avisos.

GitHub → **Settings**:

1. **Pages → Enforce HTTPS** marcado.
2. **Code security**: ligar *Dependabot alerts*, *Secret scanning* e *Push protection*.
3. **Branches → main**: exigir o CI verde antes do merge.
4. Sua conta GitHub e a conta Supabase com **2FA**.

## Se algo acontecer

1. Ajustes → **Sair de todos os dispositivos**.
2. Supabase → Settings → API: **rotacionar** a chave `service_role` e atualizar o Secret no GitHub.
3. Trocar a senha do banco e o segredo SMTP.
4. Conferir **Administração → Auditoria** no app.
