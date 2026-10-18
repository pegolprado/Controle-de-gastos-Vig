# Operação

## Usuários (tela **Usuários**, só administradores)
- **Novo usuário** gera um link de ativação de uso único (72 h). Entregue por canal seguro (o MARX não envia e-mail).
- **Link de senha**: para quem esqueceu a senha (24 h, uso único).
- Por usuário: perfil (Administrador/Usuário), **pode exportar**, desativar, desbloquear, encerrar sessões, excluir.

## Privacidade no dia a dia
- **Bloquear tela** (menu lateral, ou automático após 5 min parado): esconde tudo e pede a senha para voltar,
  sem apagar a análise. Se ninguém desbloquear, a análise é apagada ao atingir `IDLE_MINUTES` (padrão 30).
- **Ocultar números**: mostra os telefones como `(61) 9••••-••32` na tela — útil ao projetar ou compartilhar
  a tela. Exportações sempre trazem o número completo.
- **Sair e apagar**: encerra a sessão e apaga a análise da memória.

## Backup
Só a lista de usuários existe no servidor. O D1 guarda automaticamente o histórico para restauração
(**D1 → marx-usuarios → Time Travel**). Para uma cópia manual:
`npx wrangler d1 export marx-usuarios --remote --output usuarios.sql` (na pasta `atlas/frontend`, após `npx wrangler login`).

## Problemas comuns
| Sintoma | Causa provável / ação |
|---|---|
| Página de erro “sem SECRET_KEY” | Variável `SECRET_KEY` ausente ou com menos de 32 caracteres no projeto Pages. |
| Erro interno ao entrar | Falta a ligação **D1 → `DB`** em *Settings → Bindings*; refaça o deploy. |
| Primeiro acesso pede SETUP_TOKEN | Defina `SETUP_TOKEN` nas variáveis do projeto e refaça o deploy. |
| Todas as senhas pararam de funcionar | `SECRET_KEY` foi alterada. Volte ao valor anterior. |
| “Sessão expirada” e análise apagada | Inatividade maior que `IDLE_MINUTES`; a sessão dura até `SESSION_MINUTES` (480). |
| Usuário bloqueado | Tentativas de senha erradas; **Usuários → Desbloquear**. |
| Navegador lento com arquivo enorme | O processamento usa a memória do computador. Feche outras abas ou divida o arquivo por período. |
