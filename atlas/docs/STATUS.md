# Situação da entrega

## Implementado e testado
Todos os 19 passos do critério de aceitação (seção 22 do prompt) rodam pela API e pela interface — ver [TESTES.md](TESTES.md).
As 30 telas listadas existem e estão ligadas ao banco; não há botões sem ação nem dados fixos.

## Depende de configuração externa
| Item | Situação |
|---|---|
| Servidor + DNS de iamarx.com.br | Precisa de um VPS e dos registros A/AAAA no Registro.br ([DEPLOY.md](DEPLOY.md)). A implantação Docker foi validada (`docker compose config`, `caddy adapt`), mas não executada num servidor real nesta entrega. |
| E-mail (recuperação de senha) | Opcional: SMTP no `.env`. Sem ele, o administrador gera links de redefinição. |
| Mapas | Tiles públicos do OpenStreetMap só para uso leve; para uso contínuo, contratar provedor. |
| Assistente com modelo de linguagem | Não ativado por decisão de segurança (dados sensíveis). O assistente atual é local e determinístico. |

## Limitações conhecidas (documentadas, não escondidas)
- **Layouts reais das operadoras**: os arquivos de demonstração usam layouts **inventados**. O importador é genérico
  (sinônimos de cabeçalho + mapeamento manual salvo por assinatura), mas a precisão com os arquivos reais da TIM, Vivo
  e Claro deve ser conferida com exemplos anonimizados de cada tipo de bilhetagem e extrato de ERB. Com eles, basta
  salvar o mapeamento uma vez por layout.
- **CGI concatenado** (só dígitos, sem separador) não é dividido automaticamente em MCC/MNC/LAC/CI, pois a divisão
  depende do layout; nesses casos mapeie os componentes em colunas separadas ou casa-se pelo CGI inteiro.
- **PDF sem bordas** com células vazias pode desalinhar colunas; a prévia mostra o resultado antes de processar.
  OCR traz confiança por linha e sinaliza linhas abaixo de 80% para revisão.
- **Detecção de operadora** é um indício (nome do arquivo, cabeçalho, MNC) e sempre pede confirmação.
- **XLS** usa xlrd (somente leitura de .xls antigos); arquivos .xls protegidos por senha não são lidos.
- Multiorganização: há isolamento por organização no modelo e nas consultas, mas não há tela de cadastro de
  organizações (cria-se pela linha de comando com `--org`).
- Particionamento físico da tabela de eventos não foi ativado; recomendado acima de dezenas de milhões de registros.
