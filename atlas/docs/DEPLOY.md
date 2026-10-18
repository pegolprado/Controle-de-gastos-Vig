# Publicar o MARX em iamarx.com.br — gratuito (Cloudflare)

O MARX roda **sem servidor pago**: o site e o login ficam no plano gratuito da Cloudflare
(Pages + Functions + banco D1). Os arquivos analisados nunca vão para a Cloudflare — são processados no
navegador de cada usuário. Na Cloudflare ficam só o código do site e a lista de usuários.

| Item | Custo |
|---|---|
| Hospedagem do site, HTTPS, login e banco de usuários (Cloudflare Free) | R$ 0 |
| Domínio iamarx.com.br (Registro.br, que você já paga) | anuidade do domínio |

Limites do plano gratuito, muito acima do uso do MARX: 100 mil requisições de login/dia, 5 GB de banco,
500 publicações/mês, tráfego do site ilimitado.

## 1. Conta e domínio na Cloudflare (uma vez)
1. Crie uma conta gratuita em https://dash.cloudflare.com/sign-up.
2. **Add a domain** → digite `iamarx.com.br` → escolha o plano **Free**.
3. A Cloudflare mostra **dois servidores DNS** (algo como `xxx.ns.cloudflare.com`).
4. No **Registro.br** → *Meus domínios* → `iamarx.com.br` → **Alterar servidores DNS** → informe os dois
   servidores da Cloudflare → salvar. A troca leva de minutos a algumas horas; a Cloudflare avisa por e-mail
   quando o domínio estiver ativo.

## 2. Banco de usuários (D1)
**Storage & Databases → D1 SQL Database → Create** → nome `marx-usuarios` → Create.
(As tabelas são criadas sozinhas no primeiro acesso.)

## 3. Projeto do site (Pages) ligado ao GitHub
1. **Workers & Pages → Create → Pages → Connect to Git** → autorize o GitHub e escolha o repositório
   `pegolprado/Controle-de-gastos-Vig`.
2. Configuração do build:

   | Campo | Valor |
   |---|---|
   | Project name | `marx` |
   | Production branch | `ccr-c8f5f853-lvp3xa` (ou `main`, depois de juntar as alterações) |
   | Framework preset | None |
   | Build command | `npm ci && npm run build` |
   | Build output directory | `dist` |
   | Root directory (advanced) | `atlas/frontend` |

3. Em **Environment variables**, adicione (marque *Encrypt* nas duas primeiras):

   | Variável | Valor |
   |---|---|
   | `SECRET_KEY` | texto aleatório com 48+ caracteres (gere em https://www.random.org/strings ou com `openssl rand -base64 48`) — **nunca troque depois**, ou todas as senhas deixam de funcionar |
   | `SETUP_TOKEN` | um código só seu, 12+ caracteres, usado uma única vez para criar o administrador |
   | `NODE_VERSION` | `22` |
   | `IDLE_MINUTES` | (opcional) minutos sem uso até apagar a análise — padrão 30 |

4. **Save and Deploy**. O primeiro build leva ~3 minutos.
5. No projeto: **Settings → Bindings → Add → D1 database** → *Variable name* `DB` → banco `marx-usuarios` →
   salvar. Depois **Deployments → ⋯ → Retry deployment** para aplicar.

O site já responde em `https://marx.pages.dev` (endereço gratuito da Cloudflare) — dá para testar por ali.

## 4. Endereço próprio
No projeto: **Custom domains → Set up a custom domain** → `iamarx.com.br` → ativar. Repita para
`www.iamarx.com.br`. Como o DNS já está na Cloudflare, o certificado HTTPS é emitido sozinho.

## 5. Primeiro acesso
Abra **https://iamarx.com.br/primeiro-acesso**, informe o `SETUP_TOKEN`, seu nome, e-mail e senha.
Pronto: você é o administrador. Essa tela se fecha para sempre depois do primeiro cadastro.

Em seguida: *Configurações* → ative a **verificação em duas etapas**; *Usuários* → cadastre as pessoas
(cada uma recebe um link de ativação de uso único; marque quem pode exportar).

## Atualizações
Cada alteração enviada ao GitHub na branch de produção publica uma nova versão automaticamente (e cada
outra branch ganha um endereço de prévia `*.marx.pages.dev`). Para voltar a uma versão anterior:
**Deployments → ⋯ → Rollback**.

## Mapa
O fundo do mapa vem do OpenStreetMap (o navegador pede apenas as imagens da região exibida). O servidor público
do OpenStreetMap tem [política de uso](https://operations.osmfoundation.org/policies/tiles/) para uso leve. Para
outro provedor, defina `MAP_TILE_URL` e inclua o domínio dele em `img-src` no arquivo `frontend/public/_headers`.
Com `MAP_TILE_URL` vazio, o mapa mostra só as estações, sem fundo.

## Alternativa: rodar no seu computador
Veja [TESTAR-NO-COMPUTADOR.md](TESTAR-NO-COMPUTADOR.md).
