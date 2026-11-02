# RADAR INTELIGENTE DE PROMOÇÕES — Etapa 2: Bot do Telegram

> Status: **aguardando você executar e confirmar o teste**.
> Referências oficiais: https://core.telegram.org/bots/tutorial · https://core.telegram.org/bots/api

## Regra de ouro
O **token** do bot é a senha dele. Não envie para ninguém, nem para mim. Ele ficará guardado nas
Propriedades do Script do Google (Etapa 4). Se vazar: BotFather → `/revoke` → escolha o bot → gera um novo.

## Passo 1 — Criar o bot
1. No Telegram, procure **@BotFather** (tem selo azul de verificado).
2. Toque em **Iniciar** e envie `/newbot`.
3. Nome de exibição: `Radar de Promoções` (pode ser outro).
4. Nome de usuário: precisa terminar em `bot` e ser único. Ex.: `radar_promocoes_seunome_bot`.
5. O BotFather responde com o token no formato `123456789:ABCdef...`. Copie e guarde num local seguro
   (gerenciador de senhas ou nota privada).

## Passo 2 — Iniciar conversa com o seu bot
1. Abra o link `t.me/<nome_do_bot>` que o BotFather mostrou.
2. Toque em **Iniciar** e envie `oi`. (Um bot só pode mandar mensagem para quem falou com ele antes.)

## Passo 3 — Descobrir o CHAT_ID
1. No navegador do computador, abra (troque `SEU_TOKEN` pelo token, sem espaços):
   `https://api.telegram.org/botSEU_TOKEN/getUpdates`
2. Procure o trecho `"chat":{"id":123456789,` — esse número é o **CHAT_ID**. Anote.
3. Se aparecer `{"ok":true,"result":[]}`: envie outro `oi` ao bot e recarregue a página.
4. Se aparecer `401 Unauthorized`: o token foi copiado errado.

## Passo 4 — Teste de envio
No navegador, abra (troque os dois valores):
`https://api.telegram.org/botSEU_TOKEN/sendMessage?chat_id=SEU_CHAT_ID&text=Radar%20de%20Promocoes%3A%20teste%20OK`

**Resultado esperado:**
- No navegador: `{"ok":true,"result":{...}}`
- No Telegram: o bot envia "Radar de Promocoes: teste OK".

Erros comuns: `chat not found` → CHAT_ID errado ou você não tocou em Iniciar no bot.

Depois do teste, apague essas URLs do histórico do navegador (elas contêm o token).

## Critério para dar a etapa como concluída
- [ ] Bot criado
- [ ] Token guardado em local seguro (não compartilhado)
- [ ] CHAT_ID anotado
- [ ] Mensagem de teste recebida no Telegram
