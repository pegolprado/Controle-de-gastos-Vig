# Situação

## Pronto
- Login individual (senha derivada no navegador, MFA opcional, bloqueio por tentativas, links de ativação/redefinição, primeiro acesso protegido), administração de usuários.
- Bloqueio de tela (manual e automático) e ocultação de números na tela.
- Processamento 100% no navegador, sem armazenamento: apagamento ao sair, por inatividade, ao fechar/recarregar.
- Importação universal com assistente (CSV, TXT delimitado e largura fixa, XLS, XLSX, JSON, XML, HTML, PDF com
  texto e com OCR, ZIP), mapeamentos reaproveitáveis na sessão, prévia e ocorrências por linha.
- Todas as análises: explorador, contatos, comparação, vínculos, ERB (resolução + revisão manual), mapa,
  linha do tempo, estatística, cruzamento multifonte, alertas, assistente local.
- Exportação em Excel, PDF (relatório técnico completo com capa, gráficos, mapa e grafo esquemáticos, limitações e
  rastreabilidade) e CSV, com SHA-256 exibido.
- Hospedagem gratuita na Cloudflare (Pages + Functions + D1), HTTPS automático, CSP restritiva, publicação automática a cada alteração no GitHub, CI.

## Limitações conhecidas
- O tamanho máximo prático de arquivo depende da memória do computador do usuário (testado com 200 mil linhas em
  ~170 MB de memória; milhões de linhas exigem 8 GB+ de RAM).
- OCR de documentos digitalizados pode trocar caracteres (ex.: 7 ↔ /); as linhas com baixa confiança são sinalizadas
  e devem ser conferidas antes do processamento.
- Layouts das operadoras variam: o assistente sugere o mapeamento, mas o analista deve confirmá-lo. Recomenda-se
  testar com amostras anonimizadas de cada operadora.
- O mapa de fundo depende de um provedor de tiles externo (ver DEPLOY.md).
- Sem envio de e-mail: links de ativação e de redefinição são entregues pelo administrador.
- A `SECRET_KEY` não pode ser trocada depois de criados os usuários (as senhas dependem dela).
