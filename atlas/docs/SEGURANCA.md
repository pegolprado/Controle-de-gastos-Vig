# Segurança e privacidade

## Princípio: o servidor não recebe os dados

| Item | Onde fica | Quanto tempo |
|---|---|---|
| Arquivos de bilhetagem e cadastros de ERB | memória da aba do navegador do usuário | até sair, fechar, recarregar ou ficar inativo |
| Registros normalizados, consultas, gráficos, grafo, mapa, alertas | memória da aba (DuckDB-WASM em memória) | idem |
| Relatórios e planilhas exportados | computador do usuário (download) | sob responsabilidade do usuário |
| Usuários (nome, e-mail, perfil, impressão protegida da senha, MFA) | Cloudflare D1 | até o administrador excluir |
| Falhas de login por IP (IP como HMAC) | Cloudflare D1 | 15 minutos |

- A aplicação **não usa** `localStorage`, `sessionStorage`, IndexedDB nem cache do navegador para dados de análise
  (verificado em teste automatizado). As respostas da API e a página têm `Cache-Control: no-store`.
- **Ocultar números** esconde os dígitos do meio dos telefones na tela (para projeção/compartilhamento de tela).
- A política de segurança de conteúdo (CSP) só permite conexões do navegador com o **próprio site**
  (`connect-src 'self'`): mesmo que houvesse uma falha no código, o navegador bloquearia o envio de dados a terceiros.
  A única exceção são as imagens de fundo do mapa (tiles), que revelam ao provedor apenas a região exibida; podem ser
  desligadas deixando `MAP_TILE_URL` vazio.
- A API recusa corpos maiores que 16 KB: não existe rota que aceite arquivos ou resultados.
- O motor analítico é baixado em partes e só é usado se o SHA-256 conferir.
- O OCR, o leitor de PDF e o motor analítico são servidos pelo próprio site (sem CDN externa).

## Apagamento
- **Sair e apagar**: o servidor encerra a sessão e responde com `Clear-Site-Data`; o navegador apaga o banco em
  memória e recarrega a página do zero.
- **Bloqueio de tela** (manual ou após 5 min parado): esconde tudo e exige a senha, sem apagar; não interrompe a
  contagem para o apagamento por inatividade.
- **Inatividade** (`IDLE_MINUTES`, padrão 30): mesma limpeza automática.
- **Fechar ou recarregar a aba**: a memória da aba é descartada pelo navegador (há um aviso antes, se houver dados).
- **Apagar análise** (Visão geral): limpa os dados sem sair.

## Isolamento entre usuários
Cada análise existe apenas na aba de quem a criou. Não há compartilhamento, nem visão do administrador, nem cópia
no servidor. O administrador gerencia apenas contas (criar, desativar, bloquear exportação, redefinir senha,
encerrar sessões).

## Autenticação
- **A senha nunca sai do navegador**: ela é transformada em chave com PBKDF2-SHA256 (600 mil iterações, sal por
  e-mail) e o servidor guarda apenas HMAC-SHA256(SECRET_KEY, chave). Sem a SECRET_KEY, o banco vazado não permite
  nem testar senhas; com ela, cada tentativa custa 600 mil iterações. Mínimo de 12 caracteres com letras e números.
- Sessão em cookie `HttpOnly`, `Secure`, `SameSite=Strict`, assinada (HMAC-SHA256), com duração máxima
  (`SESSION_MINUTES`), expiração por inatividade e versão por usuário (encerramento remoto de sessões).
- Proteção CSRF por *double submit*; limite de tentativas por IP e bloqueio de conta (`LOGIN_MAX_ATTEMPTS`).
- Verificação em duas etapas (TOTP) opcional por usuário.
- Links de ativação e redefinição de uso único, com validade, guardados apenas como HMAC.
- Primeiro administrador criado por tela própria protegida pelo `SETUP_TOKEN`; a tela se fecha após o uso.

## Transporte e cabeçalhos
HTTPS obrigatório (Cloudflare), HSTS, `X-Frame-Options DENY`, `Referrer-Policy no-referrer`,
`Cross-Origin-Opener-Policy same-origin`, `X-Robots-Tag noindex`.

## Responsabilidades do usuário
- Os arquivos exportados (Excel/PDF/CSV) saem do controle do sistema: guarde-os em local protegido.
- Use computador e navegador atualizados e de uso pessoal; bloqueie a tela ao se ausentar.
- O SHA-256 de cada arquivo exportado é exibido na tela no momento do download para conferência futura.
