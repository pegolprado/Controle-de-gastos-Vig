# Segurança, permissões e proteção de dados

## Autenticação e sessão
- Senhas com **Argon2id**; mínimo de 12 caracteres com letras e números.
- Sessão em cookie `httpOnly`, `Secure` (produção) e `SameSite=Strict`, assinado (JWT HS256), com expiração
  absoluta (`SESSION_MINUTES`) e por inatividade (`IDLE_MINUTES`). Troca de senha, desativação ou mudança de perfil
  invalidam todas as sessões do usuário (`session_version`).
- **Verificação em duas etapas** (TOTP) opcional por usuário; o login só conclui após o código.
- Bloqueio da conta após `LOGIN_MAX_ATTEMPTS` falhas e limite de falhas por IP. Mensagem de erro e tempo de resposta
  não revelam se o e-mail existe.
- Recuperação de acesso por link de uso único com validade (e-mail via SMTP ou gerado pelo administrador).
- **CSRF**: toda requisição que altera dados exige o cabeçalho `x-csrf-token` igual ao cookie (double submit).

## Autorização (sempre no servidor)
| Perfil global | Pode |
|---|---|
| Administrador | gerenciar usuários, configurações, operação e auditoria completa. **Não** vê o conteúdo dos casos, salvo se marcado “acesso ao conteúdo” (separação de funções). |
| Analista | criar casos; nos casos em que é membro analista: importar, analisar, corrigir, gerar relatórios. |
| Revisor | conferir, comentar e aprovar/devolver relatórios nos casos de que é membro. |
| Consulta | somente visualizar os casos de que é membro. |

- Cada caso tem membros com papel (analista/revisor/consulta) e permissão de exportação. O papel global limita o do caso.
- Casos de outra organização ou sem permissão respondem **404** (não revelam existência).
- Caso pode exigir **justificativa de acesso** registrada (válida por 12 h por usuário).
- Aprovação de relatório exige outra pessoa que não o autor.

## Arquivos
- Originais gravados uma única vez, somente leitura, em armazenamento privado com chaves aleatórias, SHA-256 no recebimento.
  Download apenas pela API, com permissão de exportação e registro em auditoria.
- Validação de uploads: extensões permitidas, tamanho máximo, arquivos vazios recusados.
- ZIP: limite de entradas, de tamanho descompactado e de taxa de compressão (zip bomb); caminhos com `..`/absolutos ignorados; ZIP com senha recusado.
- XML lido sem resolver entidades externas (XXE) e sem rede.
- Arquivos idênticos (mesmo SHA-256) no caso são sinalizados.

## Banco e API
- Consultas parametrizadas (SQLAlchemy); colunas de ordenação por lista permitida (sem SQL dinâmico a partir do usuário).
- Cabeçalhos: CSP restritiva, HSTS, `X-Frame-Options: DENY`, `nosniff`, `no-referrer`, `noindex`; `Cache-Control: no-store` na API.
- Documentação interativa da API desativada em produção.

## Auditoria
Login/logout, falhas e bloqueios, acesso a casos e eventos, importações, correções, exportações, downloads,
relatórios, revisões, alterações de permissões, exclusões e operações administrativas. A trilha é **encadeada por
hash**; detalhes registram identificadores e parâmetros, nunca o conteúdo integral de registros telefônicos.

## Privacidade e LGPD
- A plataforma processa apenas os arquivos que o usuário autorizado envia; não coleta dados de operadoras nem de terceiros.
- Não há mecanismos de interceptação, acesso a contas ou ampliação automática de escopo. Registros fora do período
  autorizado são sinalizados e excluídos das análises por padrão; o aviso não amplia o escopo.
- Nenhum dado é enviado a serviços externos. O assistente analítico é local. O único recurso externo são as imagens
  de mapa (tiles), que recebem apenas coordenadas de enquadramento do mapa — use um provedor contratado ou próprio
  se a política institucional exigir.
- Retenção por caso e exclusão auditada; backups cifrados.

## Recomendações de infraestrutura
- Servidor dedicado com disco cifrado; SSH só por chave; atualizações automáticas de segurança.
- Restringir o acesso por VPN/IP institucional quando possível (no Caddyfile, `@permitidos remote_ip ...`).
- Guardar `SECRET_KEY`, `POSTGRES_PASSWORD` e a frase dos backups fora do repositório.
