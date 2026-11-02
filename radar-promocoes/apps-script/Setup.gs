/**
 * RADAR INTELIGENTE DE PROMOÇÕES — Setup.gs
 * Etapa 3: cria e verifica a estrutura da planilha.
 *
 * Pode ser executado quantas vezes quiser: NUNCA apaga dados.
 * - Aba que não existe → é criada com cabeçalhos, formatos e exemplos.
 * - Aba que já existe → só recebe as colunas que estiverem faltando (no final).
 * - CONFIGURACOES → só recebe as chaves que estiverem faltando.
 *
 * Como usar: no editor do Apps Script, escolha a função "criarEstrutura" e clique em Executar.
 */

const RADAR_VERSAO_ESQUEMA = '1.0';
const RADAR_FUSO = 'America/Sao_Paulo';
const RADAR_LINHAS_VALIDACAO = 1000; // até quantas linhas aplicar caixas de seleção e listas

const RADAR_FORMATO_MOEDA = '"R$" #,##0.00';
const RADAR_FORMATO_DATA = 'dd/MM/yyyy HH:mm';
const RADAR_FORMATO_PCT = '0.00"%"';

const RADAR_CATEGORIAS = [
  'Tablets',
  'Celulares e smartphones',
  'Notebooks e computadores',
  'Informática e periféricos',
  'Televisores',
  'Eletrodomésticos',
  'Áudio e acessórios',
  'Tecnologia em geral',
  'Outros'
];

/**
 * Definição de cada aba. "sistema: true" = coluna preenchida pelo robô (fundo cinza).
 * tipo: 'moeda' | 'data' | 'pct' | 'check' | 'numero' | 'texto' (padrão)
 * lista: valores permitidos (cria lista suspensa)
 */
const RADAR_ESQUEMA = {
  PAINEL: { cor: '#202124', colunas: [] }, // montado por montarPainel_()

  PRODUTOS: {
    cor: '#1a73e8',
    colunas: [
      { nome: 'ID', largura: 60, nota: 'Código único do produto. Ex.: P001, P002...' },
      { nome: 'Ativo', largura: 55, tipo: 'check', nota: 'Marque para monitorar este produto.' },
      { nome: 'Produto', largura: 220 },
      { nome: 'Categoria', largura: 170, lista: RADAR_CATEGORIAS },
      { nome: 'Marca', largura: 90 },
      { nome: 'Modelo', largura: 140 },
      { nome: 'Palavras obrigatórias', largura: 220,
        nota: 'Separe por vírgula: TODAS precisam aparecer no título.\nUse | para alternativas.\nEx.: galaxy tab, s10 fe+|s10 fe plus\nMaiúsculas e acentos são ignorados.' },
      { nome: 'Palavras proibidas', largura: 240,
        nota: 'Separe por vírgula. Se QUALQUER uma aparecer no título, a oferta é descartada.\nEx.: capa, película, usado, recondicionado' },
      { nome: 'Preço-alvo (R$)', largura: 110, tipo: 'moeda',
        nota: 'Preço máximo que você aceita pagar. Igual ou abaixo = alerta prioritário.\nPode deixar vazio: aí vale só o histórico.' },
      { nome: 'Preço mínimo plausível (R$)', largura: 120, tipo: 'moeda',
        nota: 'Abaixo deste valor a oferta é descartada (acessório, anúncio-isca ou golpe).' },
      { nome: 'Lojas permitidas', largura: 140,
        nota: 'Escreva "todas" ou os IDs da aba LOJAS separados por vírgula.\nEx.: amazon, kabum, magalu' },
      { nome: 'Links ou IDs monitorados', largura: 220,
        nota: 'Opcional. Links de anúncios específicos (ou IDs MLB do Mercado Livre), separados por vírgula.' },
      { nome: 'Prioridade', largura: 85, lista: ['ALTA', 'MÉDIA', 'BAIXA'] },
      { nome: 'Último preço (R$)', largura: 110, tipo: 'moeda', sistema: true },
      { nome: 'Loja do último preço', largura: 120, sistema: true },
      { nome: 'Data do último preço', largura: 130, tipo: 'data', sistema: true },
      { nome: 'Menor preço visto (R$)', largura: 120, tipo: 'moeda', sistema: true },
      { nome: 'Mediana do histórico (R$)', largura: 130, tipo: 'moeda', sistema: true },
      { nome: 'Observações', largura: 200 }
    ],
    exemplos: [
      ['P001', true, 'Samsung Galaxy Tab S10 FE', 'Tablets', 'Samsung', 'Galaxy Tab S10 FE',
        'galaxy tab, s10 fe', 'fe+, fe plus, capa, case, película, pelicula, teclado, caneta, usado, recondicionado, vitrine',
        2300, 1200, 'todas', '', 'ALTA', '', '', '', '', '', ''],
      ['P002', true, 'Samsung Galaxy Tab S10 FE+', 'Tablets', 'Samsung', 'Galaxy Tab S10 FE+',
        'galaxy tab, s10 fe+|s10 fe plus', 'capa, case, película, pelicula, teclado, caneta, usado, recondicionado, vitrine',
        2800, 1500, 'todas', '', 'ALTA', '', '', '', '', '', ''],
      ['P003', true, 'Notebook Lenovo', 'Notebooks e computadores', 'Lenovo', '',
        'notebook, lenovo', 'capa, mochila, case, carregador, fonte, bateria, teclado, tela, película, usado, recondicionado',
        3000, 1500, 'todas', '', 'MÉDIA', '', '', '', '', '', ''],
      ['P004', false, 'Notebook Dell', 'Notebooks e computadores', 'Dell', '',
        'notebook, dell', 'capa, mochila, carregador, fonte, bateria, teclado, tela, usado, recondicionado',
        '', 1500, 'todas', '', 'MÉDIA', '', '', '', '', '', 'Exemplo: preencha o preço-alvo e marque Ativo.'],
      ['P005', false, 'Smartphone Samsung Galaxy', 'Celulares e smartphones', 'Samsung', '',
        'samsung, galaxy|smartphone|celular', 'capa, capinha, película, pelicula, carregador, cabo, tablet, tab, watch, buds, usado, recondicionado',
        '', 500, 'todas', '', 'MÉDIA', '', '', '', '', '', 'Exemplo: troque por um modelo específico (ex.: Galaxy S25).'],
      ['P006', false, 'iPhone', 'Celulares e smartphones', 'Apple', '',
        'iphone', 'capa, capinha, película, pelicula, carregador, cabo, usado, recondicionado, seminovo, vitrine',
        '', 1500, 'todas', '', 'MÉDIA', '', '', '', '', '', 'Exemplo: especifique o modelo (ex.: iphone 16, 128gb).'],
      ['P007', false, 'SSD NVMe 1TB', 'Informática e periféricos', '', '',
        'ssd, nvme, 1tb|1 tb', 'case, gaveta, adaptador, usado',
        '', 200, 'todas', '', 'BAIXA', '', '', '', '', '', ''],
      ['P008', false, 'Memória RAM DDR5 16GB', 'Informática e periféricos', '', '',
        'memoria|memória, ddr5, 16gb|16 gb', 'notebook|sodimm, usado',
        '', 150, 'todas', '', 'BAIXA', '', '', '', '', '', 'Ajuste para DDR4 ou para notebook (SODIMM) se for o seu caso.'],
      ['P009', false, 'Monitor 27"', 'Informática e periféricos', '', '',
        'monitor, 27', 'suporte, braço, cabo, usado',
        '', 500, 'todas', '', 'BAIXA', '', '', '', '', '', ''],
      ['P010', false, 'Smart TV 55"', 'Televisores', '', '',
        'smart tv|televisor|tv, 55', 'suporte, controle, cabo, usado',
        '', 1500, 'todas', '', 'BAIXA', '', '', '', '', '', '']
    ]
  },

  LOJAS: {
    cor: '#e37400',
    colunas: [
      { nome: 'ID', largura: 110, nota: 'Identificador curto, sem espaços. Usado em "Lojas permitidas".' },
      { nome: 'Ativa', largura: 55, tipo: 'check' },
      { nome: 'Loja', largura: 150 },
      { nome: 'Domínios', largura: 260, nota: 'Domínios oficiais separados por vírgula. Links de outros domínios são recusados.' },
      { nome: 'Integração disponível', largura: 380 },
      { nome: 'Status', largura: 140, sistema: true },
      { nome: 'Observações', largura: 220 }
    ],
    exemplos: [
      ['amazon', true, 'Amazon Brasil', 'amazon.com.br, amzn.to',
        'Sem API gratuita para uso pessoal (Creators API exige vendas como afiliado). Cobertura via Gmail, feeds e manual.', 'SEM FONTE ATIVA', ''],
      ['mercadolivre', true, 'Mercado Livre', 'mercadolivre.com.br, mercadolivre.com, mercadolibre.com',
        'API oficial. Busca pública com erro 403 desde 2026 (relatos). Consulta por anúncio (ID) a testar na Etapa 5.', 'SEM FONTE ATIVA', ''],
      ['magalu', true, 'Magazine Luiza', 'magazineluiza.com.br, magazinevoce.com.br',
        'Sem API pública de preços conhecida. Cobertura via Gmail, feeds e manual.', 'SEM FONTE ATIVA', ''],
      ['shopee', true, 'Shopee Brasil', 'shopee.com.br',
        'API oficial de afiliados (gratuita, depende de aprovação).', 'SEM FONTE ATIVA', ''],
      ['kabum', true, 'KaBuM!', 'kabum.com.br',
        'Sem API pública conhecida. Cobertura via Gmail, feeds e manual.', 'SEM FONTE ATIVA', ''],
      ['casasbahia', true, 'Casas Bahia', 'casasbahia.com.br',
        'Sem API pública conhecida. Cobertura via Gmail, feeds e manual.', 'SEM FONTE ATIVA', '']
    ]
  },

  FONTES: {
    cor: '#9334e6',
    colunas: [
      { nome: 'ID', largura: 110 },
      { nome: 'Ativa', largura: 55, tipo: 'check' },
      { nome: 'Fonte', largura: 230 },
      { nome: 'Tipo', largura: 80, lista: ['API', 'GMAIL', 'RSS', 'PAGINA', 'MANUAL'] },
      { nome: 'Lojas', largura: 150 },
      { nome: 'Endereço ou parâmetro', largura: 280 },
      { nome: 'Intervalo mínimo (min)', largura: 110, tipo: 'numero' },
      { nome: 'Status', largura: 140, sistema: true,
        nota: 'OK / FALHANDO / INDISPONÍVEL / NÃO CONFIGURADA / NÃO TESTADA / DESLIGADA.\nSó fica OK depois de uma coleta real bem-sucedida.' },
      { nome: 'Último sucesso', largura: 130, tipo: 'data', sistema: true },
      { nome: 'Última falha', largura: 130, tipo: 'data', sistema: true },
      { nome: 'Falhas seguidas', largura: 90, tipo: 'numero', sistema: true },
      { nome: 'Última mensagem', largura: 380, sistema: true },
      { nome: 'Itens na última coleta', largura: 110, tipo: 'numero', sistema: true }
    ],
    exemplos: [
      ['MANUAL', true, 'Lançamento manual', 'MANUAL', 'todas', 'Aba OFERTAS com Fonte = MANUAL', 0,
        'NÃO TESTADA', '', '', 0, 'Você cola preço e link na aba OFERTAS.', ''],
      ['GMAIL', false, 'Alertas por e-mail (Gmail)', 'GMAIL', 'todas', 'RADAR', 60,
        'NÃO CONFIGURADA', '', '', 0, 'Lê e-mails com o marcador RADAR. Configuração na Etapa 5.', ''],
      ['SHOPEE_API', false, 'Shopee Afiliados (API oficial)', 'API', 'shopee', 'https://open-api.affiliate.shopee.com.br/graphql', 120,
        'NÃO CONFIGURADA', '', '', 0, 'Depende de aprovação no programa de afiliados. Endereço a confirmar no painel do afiliado.', ''],
      ['ML_ITENS', false, 'Mercado Livre (anúncio por ID)', 'API', 'mercadolivre', 'https://api.mercadolibre.com/items/{ID}', 120,
        'NÃO TESTADA', '', '', 0, 'Busca pública retorna 403 desde 2026 (relatos). Consulta por ID será testada na Etapa 5.', ''],
      ['PAGINA', false, 'Página do produto (experimental)', 'PAGINA', 'kabum, magalu, casasbahia', 'Links da aba PRODUTOS', 360,
        'DESLIGADA', '', '', 0, 'Opcional. Só ligar com sua autorização. Respeita robots.txt e se desliga se a loja bloquear.', '']
    ]
  },

  OFERTAS: {
    cor: '#188038',
    colunas: [
      { nome: 'ID', largura: 120, sistema: true },
      { nome: 'Data/hora', largura: 130, tipo: 'data', nota: 'Pode deixar vazio no lançamento manual: o sistema preenche.' },
      { nome: 'Fonte', largura: 100, nota: 'Para lançar à mão, escreva MANUAL.' },
      { nome: 'Loja', largura: 110, nota: 'ID da aba LOJAS. Ex.: kabum' },
      { nome: 'ID do produto', largura: 90, nota: 'ID da aba PRODUTOS. Pode deixar vazio: o sistema tenta reconhecer pelo título.' },
      { nome: 'Produto', largura: 200, sistema: true },
      { nome: 'Título original', largura: 300 },
      { nome: 'Preço (R$)', largura: 100, tipo: 'moeda' },
      { nome: 'Preço anunciado pela loja (R$)', largura: 120, tipo: 'moeda',
        nota: 'O preço "de" riscado. Só informativo: NUNCA é usado como histórico.' },
      { nome: 'Frete', largura: 100 },
      { nome: 'Cupom', largura: 100 },
      { nome: 'Vendedor', largura: 130 },
      { nome: 'Disponível', largura: 80 },
      { nome: 'Link', largura: 260 },
      { nome: 'Mediana de referência (R$)', largura: 120, tipo: 'moeda', sistema: true },
      { nome: 'Observações no histórico', largura: 100, tipo: 'numero', sistema: true },
      { nome: 'Diferença vs. mediana (%)', largura: 110, tipo: 'pct', sistema: true },
      { nome: 'Classificação', largura: 110, sistema: true },
      { nome: 'Motivo', largura: 300, sistema: true },
      { nome: 'Chave de duplicidade', largura: 160, sistema: true },
      { nome: 'Notificado', largura: 90, sistema: true }
    ]
  },

  HISTORICO_PRECOS: {
    cor: '#12b5cb',
    colunas: [
      { nome: 'Data/hora', largura: 130, tipo: 'data' },
      { nome: 'ID do produto', largura: 90 },
      { nome: 'Produto', largura: 200 },
      { nome: 'Loja', largura: 110 },
      { nome: 'Preço (R$)', largura: 100, tipo: 'moeda' },
      { nome: 'Fonte', largura: 100 },
      { nome: 'Link', largura: 260 },
      { nome: 'ID da oferta', largura: 120 }
    ]
  },

  CONFIGURACOES: {
    cor: '#5f6368',
    colunas: [
      { nome: 'Chave', largura: 280 },
      { nome: 'Valor', largura: 120 },
      { nome: 'Descrição', largura: 520 }
    ]
  },

  NOTIFICACOES: {
    cor: '#d93025',
    colunas: [
      { nome: 'Data/hora', largura: 130, tipo: 'data' },
      { nome: 'Tipo', largura: 90, nota: 'ALERTA / RESUMO / FALHA / TESTE' },
      { nome: 'ID do produto', largura: 90 },
      { nome: 'Produto', largura: 200 },
      { nome: 'Loja', largura: 110 },
      { nome: 'Preço (R$)', largura: 100, tipo: 'moeda' },
      { nome: 'Classificação', largura: 110 },
      { nome: 'Chave de duplicidade', largura: 160 },
      { nome: 'Status', largura: 90, nota: 'ENVIADO / FALHOU' },
      { nome: 'Tentativas', largura: 80, tipo: 'numero' },
      { nome: 'Resposta / erro', largura: 300 },
      { nome: 'ID da mensagem', largura: 100 }
    ]
  },

  LOGS: {
    cor: '#80868b',
    colunas: [
      { nome: 'Data/hora', largura: 130, tipo: 'data' },
      { nome: 'Nível', largura: 70, nota: 'INFO / AVISO / ERRO' },
      { nome: 'Módulo', largura: 120 },
      { nome: 'Mensagem', largura: 380 },
      { nome: 'Detalhes', largura: 380 }
    ]
  }
};

/** Configurações padrão: [chave, valor, descrição]. Altere os VALORES direto na aba CONFIGURACOES. */
const RADAR_CONFIG_PADRAO = [
  ['VERSAO_ESQUEMA', RADAR_VERSAO_ESQUEMA, 'Versão da estrutura da planilha. Não altere.'],
  ['MODO_TESTE', 'SIM', 'SIM = mensagens saem com o prefixo [TESTE]. Troque para NAO quando tudo estiver validado.'],
  ['FREQUENCIA_MINUTOS', 120, 'De quanto em quanto tempo o radar roda. Aceitos: 60, 120, 240, 360, 480, 720.'],
  ['HORA_INICIO', 7, 'Hora (0–23) em que o radar começa a funcionar no dia.'],
  ['HORA_FIM', 23, 'Hora (0–23) em que o radar para. Fora desse horário não consulta nem envia.'],
  ['CATEGORIAS_MONITORADAS', 'todas', 'Escreva "todas" ou categorias separadas por vírgula (iguais às da aba PRODUTOS).'],
  ['PRECO_MINIMO_GLOBAL', 50, 'Ofertas abaixo deste valor (R$) são ignoradas.'],
  ['PRECO_MAXIMO_GLOBAL', 20000, 'Ofertas acima deste valor (R$) são ignoradas.'],
  ['DESCONTO_MIN_EXCELENTE_PCT', 15, '% abaixo da mediana do histórico para ser EXCELENTE (quando não atingir o preço-alvo).'],
  ['DESCONTO_MIN_BOA_PCT', 5, '% abaixo da mediana do histórico para ser BOA.'],
  ['MIN_OBSERVACOES_HISTORICO', 5, 'Quantos preços registrados são necessários para o histórico ser considerado confiável.'],
  ['JANELA_HISTORICO_DIAS', 60, 'Quantos dias de histórico entram no cálculo da mediana.'],
  ['MAX_ALERTAS_DIA', 10, 'Limite de alertas imediatos por dia (proteção contra excesso).'],
  ['JANELA_DUPLICIDADE_HORAS', 48, 'A mesma oferta (produto + loja + preço) não é reenviada dentro deste prazo.'],
  ['QUEDA_EXTRA_REALERTA_PCT', 3, 'Se o preço cair mais este % dentro da janela, um novo alerta é permitido.'],
  ['ENVIAR_BOAS_IMEDIATO', 'NAO', 'SIM = ofertas BOAS também geram alerta na hora. NAO = só no resumo diário.'],
  ['RESUMO_DIARIO_ATIVO', 'SIM', 'Envia um resumo com as ofertas BOAS do dia.'],
  ['HORA_RESUMO_DIARIO', 21, 'Hora (0–23) do resumo diário.'],
  ['ALERTA_FALHA_APOS', 3, 'Depois de quantas falhas seguidas uma fonte gera aviso no Telegram e é pausada.'],
  ['LIMITE_URLFETCH_DIA', 2000, 'Teto próprio de consultas externas por dia (a cota do Google é bem maior).'],
  ['GMAIL_MARCADOR', 'RADAR', 'Marcador do Gmail lido pela fonte GMAIL.'],
  ['DIAS_MANTER_LOGS', 30, 'Linhas de LOGS mais antigas que isso são apagadas na manutenção.']
];

/* ============================== FUNÇÃO PRINCIPAL ============================== */

function criarEstrutura() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Abra o Apps Script pelo menu Extensões > Apps Script DENTRO da planilha.');

  ss.setSpreadsheetTimeZone(RADAR_FUSO);
  try { ss.setSpreadsheetLocale('pt_BR'); } catch (e) { /* não é crítico */ }

  const relatorio = [];
  const ordem = ['PAINEL', 'PRODUTOS', 'LOJAS', 'FONTES', 'OFERTAS', 'HISTORICO_PRECOS',
    'CONFIGURACOES', 'NOTIFICACOES', 'LOGS'];

  ordem.forEach(function (nomeAba, indice) {
    if (nomeAba === 'PAINEL') return; // o painel é montado no fim, depois das outras abas existirem
    relatorio.push(prepararAba_(ss, nomeAba, RADAR_ESQUEMA[nomeAba], indice));
  });
  relatorio.push(completarConfiguracoes_(ss));
  relatorio.push(montarPainel_(ss));
  removerAbaPadraoVazia_(ss);

  const texto = 'RADAR — estrutura verificada:\n• ' + relatorio.join('\n• ');
  console.log(texto);
  try { SpreadsheetApp.getUi().alert(texto); } catch (e) { /* executado pelo editor: veja o Registro de execução */ }
  return texto;
}

/* ============================== ABAS DE DADOS ============================== */

function prepararAba_(ss, nomeAba, def, indice) {
  let aba = ss.getSheetByName(nomeAba);
  let nova = false;
  if (!aba) {
    aba = ss.insertSheet(nomeAba, Math.min(indice, ss.getSheets().length));
    nova = true;
  }

  const esperadas = def.colunas.map(function (c) { return c.nome; });
  const ultimaCol = aba.getLastColumn();
  const atuais = ultimaCol > 0
    ? aba.getRange(1, 1, 1, ultimaCol).getValues()[0].map(function (v) { return String(v).trim(); })
    : [];
  const linha1Vazia = atuais.every(function (v) { return v === ''; });

  let acao;
  if (linha1Vazia) {
    aba.getRange(1, 1, 1, esperadas.length).setValues([esperadas]);
    aplicarFormatos_(aba, def, 1);
    if (def.exemplos && aba.getLastRow() <= 1) {
      aba.getRange(2, 1, def.exemplos.length, esperadas.length).setValues(def.exemplos);
      acao = nova ? 'criada com ' + def.exemplos.length + ' linhas de exemplo' : 'cabeçalhos e exemplos inseridos';
    } else {
      acao = nova ? 'criada' : 'cabeçalhos inseridos';
    }
  } else {
    const faltando = esperadas.filter(function (n) { return atuais.indexOf(n) === -1; });
    if (faltando.length === 0) {
      acao = 'já estava correta (nada alterado)';
    } else {
      const inicio = ultimaCol + 1;
      aba.getRange(1, inicio, 1, faltando.length).setValues([faltando]);
      const defFaltando = { colunas: def.colunas.filter(function (c) { return faltando.indexOf(c.nome) !== -1; }) };
      aplicarFormatos_(aba, defFaltando, inicio);
      acao = 'colunas adicionadas: ' + faltando.join(', ');
    }
  }

  if (def.cor) aba.setTabColor(def.cor);
  aba.setFrozenRows(1);
  return nomeAba + ': ' + acao;
}

/** Aplica cabeçalho, larguras, notas, formatos e validações a partir da coluna "inicio". */
function aplicarFormatos_(aba, def, inicio) {
  const n = def.colunas.length;
  const linhas = RADAR_LINHAS_VALIDACAO - 1;
  const garantirLinhas = RADAR_LINHAS_VALIDACAO - aba.getMaxRows();
  if (garantirLinhas > 0) aba.insertRowsAfter(aba.getMaxRows(), garantirLinhas);

  aba.getRange(1, inicio, 1, n)
    .setFontWeight('bold')
    .setFontColor('#ffffff')
    .setBackground('#3c4043')
    .setWrap(true)
    .setVerticalAlignment('middle');

  def.colunas.forEach(function (col, i) {
    const c = inicio + i;
    aba.setColumnWidth(c, col.largura || 120);
    const cab = aba.getRange(1, c);
    const corpo = aba.getRange(2, c, linhas, 1);

    if (col.sistema) {
      cab.setBackground('#5f6368');
      corpo.setBackground('#f1f3f4');
    }
    const nota = (col.nota ? col.nota : '') + (col.sistema ? (col.nota ? '\n' : '') + 'Preenchido automaticamente pelo sistema.' : '');
    if (nota) cab.setNote(nota);

    if (col.tipo === 'moeda') corpo.setNumberFormat(RADAR_FORMATO_MOEDA);
    if (col.tipo === 'data') corpo.setNumberFormat(RADAR_FORMATO_DATA);
    if (col.tipo === 'pct') corpo.setNumberFormat(RADAR_FORMATO_PCT);
    if (col.tipo === 'numero') corpo.setNumberFormat('0');
    if (col.tipo === 'check') {
      corpo.setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
    }
    if (col.lista) {
      corpo.setDataValidation(SpreadsheetApp.newDataValidation()
        .requireValueInList(col.lista, true)
        .setAllowInvalid(false)
        .build());
    }
  });
}

function completarConfiguracoes_(ss) {
  const aba = ss.getSheetByName('CONFIGURACOES');
  const ultima = aba.getLastRow();
  const existentes = ultima > 1
    ? aba.getRange(2, 1, ultima - 1, 1).getValues().map(function (l) { return String(l[0]).trim(); })
    : [];
  const novas = RADAR_CONFIG_PADRAO.filter(function (l) { return existentes.indexOf(l[0]) === -1; });
  if (novas.length) {
    aba.getRange(ultima + 1, 1, novas.length, 3).setValues(novas);
    aba.getRange(2, 1, ultima - 1 + novas.length, 1).setFontWeight('bold');
    aba.getRange(2, 2, ultima - 1 + novas.length, 1).setBackground('#fef7e0').setHorizontalAlignment('center');
    aba.getRange(2, 3, ultima - 1 + novas.length, 1).setWrap(true);
  }
  return 'CONFIGURACOES: ' + (novas.length ? novas.length + ' chave(s) adicionada(s)' : 'todas as chaves já existiam');
}

function removerAbaPadraoVazia_(ss) {
  ['Página1', 'Pagina1', 'Sheet1', 'Planilha1'].forEach(function (nome) {
    const aba = ss.getSheetByName(nome);
    if (aba && aba.getLastRow() === 0 && aba.getLastColumn() === 0 && ss.getSheets().length > 1) {
      ss.deleteSheet(aba);
    }
  });
}

/* ============================== PAINEL ============================== */

/** Letra da coluna (A, B, ... AA) de um cabeçalho de uma aba do esquema. */
function letraColuna_(nomeAba, nomeColuna) {
  const idx = RADAR_ESQUEMA[nomeAba].colunas.map(function (c) { return c.nome; }).indexOf(nomeColuna);
  if (idx === -1) throw new Error('Coluna não encontrada: ' + nomeAba + ' > ' + nomeColuna);
  let n = idx + 1, s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/** Ex.: col_('OFERTAS','Preço (R$)') -> "OFERTAS!H2:H" (sem cabeçalho) */
function col_(aba, nome) {
  const l = letraColuna_(aba, nome);
  return aba + '!' + l + '2:' + l;
}

/** Para QUERY: "Col8" a partir do nome da coluna. */
function qcol_(aba, nome) {
  return 'Col' + (RADAR_ESQUEMA[aba].colunas.map(function (c) { return c.nome; }).indexOf(nome) + 1);
}

function intervaloAba_(aba) {
  const ultima = letraColuna_(aba, RADAR_ESQUEMA[aba].colunas[RADAR_ESQUEMA[aba].colunas.length - 1].nome);
  return '{' + aba + '!A1:' + ultima + '}';
}

function montarPainel_(ss) {
  let aba = ss.getSheetByName('PAINEL');
  if (!aba) aba = ss.insertSheet('PAINEL', 0);
  // O painel só contém fórmulas: pode ser refeito sem perder dados.
  aba.clear();
  aba.clearNotes();
  aba.setTabColor(RADAR_ESQUEMA.PAINEL.cor);
  if (aba.getMaxRows() < 160) aba.insertRowsAfter(aba.getMaxRows(), 160 - aba.getMaxRows());
  const larguras = [230, 140, 140, 130, 130, 130, 260];
  larguras.forEach(function (w, i) { aba.setColumnWidth(i + 1, w); });

  aba.getRange(1, 1).setValue('📡 RADAR INTELIGENTE DE PROMOÇÕES — PAINEL')
    .setFontSize(16).setFontWeight('bold');
  aba.getRange(2, 1).setValue('Atualizado em:').setFontColor('#5f6368');
  aba.getRange(2, 2).setFormula('=NOW()').setNumberFormat(RADAR_FORMATO_DATA).setFontColor('#5f6368');

  const O = 'OFERTAS', N = 'NOTIFICACOES', L = 'LOGS', F = 'FONTES', P = 'PRODUTOS', J = 'LOJAS';
  const indicadores = [
    ['Produtos ativos', '=COUNTIF(' + col_(P, 'Ativo') + ',TRUE)'],
    ['Lojas ativas', '=COUNTIF(' + col_(J, 'Ativa') + ',TRUE)'],
    ['Fontes funcionando (OK)', '=COUNTIF(' + col_(F, 'Status') + ',"OK")'],
    ['Fontes com problema', '=COUNTIF(' + col_(F, 'Status') + ',"FALHANDO")+COUNTIF(' + col_(F, 'Status') + ',"INDISPONÍVEL")'],
    ['Ofertas EXCELENTES (7 dias)', '=COUNTIFS(' + col_(O, 'Classificação') + ',"EXCELENTE",' + col_(O, 'Data/hora') + ',">="&(NOW()-7))'],
    ['Ofertas BOAS (7 dias)', '=COUNTIFS(' + col_(O, 'Classificação') + ',"BOA",' + col_(O, 'Data/hora') + ',">="&(NOW()-7))'],
    ['Ofertas DESCARTADAS (7 dias)', '=COUNTIFS(' + col_(O, 'Classificação') + ',"DESCARTADA",' + col_(O, 'Data/hora') + ',">="&(NOW()-7))'],
    ['Notificações enviadas hoje', '=COUNTIFS(' + col_(N, 'Status') + ',"ENVIADO",' + col_(N, 'Data/hora') + ',">="&TODAY())'],
    ['Erros nas últimas 24 h', '=COUNTIFS(' + col_(L, 'Nível') + ',"ERRO",' + col_(L, 'Data/hora') + ',">="&(NOW()-1))'],
    ['Preços no histórico', '=COUNTA(' + col_('HISTORICO_PRECOS', 'Preço (R$)') + ')']
  ];
  aba.getRange(4, 1).setValue('INDICADORES').setFontWeight('bold').setBackground('#e8f0fe');
  indicadores.forEach(function (ind, i) {
    aba.getRange(5 + i, 1).setValue(ind[0]);
    aba.getRange(5 + i, 2).setFormula(ind[1]).setFontWeight('bold').setHorizontalAlignment('center');
  });

  // Seções com tabelas (QUERY). Cada uma tem espaço reservado para não sobrepor a seguinte.
  const secoes = [
    { titulo: 'PRODUTOS MONITORADOS', aba: P, limite: 40,
      cols: ['Produto', 'Preço-alvo (R$)', 'Último preço (R$)', 'Loja do último preço', 'Menor preço visto (R$)', 'Mediana do histórico (R$)', 'Data do último preço'],
      onde: qcol_(P, 'Ativo') + ' = true', ordem: '', vazio: 'Nenhum produto ativo' },
    { titulo: 'MELHORES PROMOÇÕES (EXCELENTES)', aba: O, limite: 10,
      cols: ['Data/hora', 'Produto', 'Loja', 'Preço (R$)', 'Diferença vs. mediana (%)', 'Notificado', 'Link'],
      onde: qcol_(O, 'Classificação') + " = 'EXCELENTE'", ordem: qcol_(O, 'Data/hora') + ' desc', vazio: 'Nenhuma oferta excelente ainda' },
    { titulo: 'OFERTAS BOAS RECENTES', aba: O, limite: 10,
      cols: ['Data/hora', 'Produto', 'Loja', 'Preço (R$)', 'Diferença vs. mediana (%)', 'Motivo', 'Link'],
      onde: qcol_(O, 'Classificação') + " = 'BOA'", ordem: qcol_(O, 'Data/hora') + ' desc', vazio: 'Nenhuma oferta boa ainda' },
    { titulo: 'OFERTAS DESCARTADAS RECENTES', aba: O, limite: 10,
      cols: ['Data/hora', 'Título original', 'Loja', 'Preço (R$)', 'Motivo'],
      onde: qcol_(O, 'Classificação') + " = 'DESCARTADA'", ordem: qcol_(O, 'Data/hora') + ' desc', vazio: 'Nenhuma oferta descartada ainda' },
    { titulo: 'LOJAS', aba: J, limite: 20,
      cols: ['Loja', 'Ativa', 'Status', 'Integração disponível'],
      onde: qcol_(J, 'Loja') + " is not null", ordem: '', vazio: 'Nenhuma loja cadastrada' },
    { titulo: 'STATUS DAS FONTES DE DADOS', aba: F, limite: 20,
      cols: ['Fonte', 'Ativa', 'Status', 'Último sucesso', 'Falhas seguidas', 'Última mensagem'],
      onde: qcol_(F, 'Fonte') + " is not null", ordem: '', vazio: 'Nenhuma fonte cadastrada' },
    { titulo: 'HISTÓRICO DE PREÇOS (ÚLTIMOS 15)', aba: 'HISTORICO_PRECOS', limite: 15,
      cols: ['Data/hora', 'Produto', 'Loja', 'Preço (R$)', 'Fonte'],
      onde: qcol_('HISTORICO_PRECOS', 'Preço (R$)') + ' is not null', ordem: qcol_('HISTORICO_PRECOS', 'Data/hora') + ' desc', vazio: 'Histórico vazio' },
    { titulo: 'NOTIFICAÇÕES ENVIADAS (ÚLTIMAS 10)', aba: N, limite: 10,
      cols: ['Data/hora', 'Tipo', 'Produto', 'Loja', 'Preço (R$)', 'Status'],
      onde: qcol_(N, 'Tipo') + ' is not null', ordem: qcol_(N, 'Data/hora') + ' desc', vazio: 'Nenhuma notificação ainda' },
    { titulo: 'ERROS DE INTEGRAÇÃO (ÚLTIMOS 10)', aba: L, limite: 10,
      cols: ['Data/hora', 'Módulo', 'Mensagem'],
      onde: qcol_(L, 'Nível') + " = 'ERRO'", ordem: qcol_(L, 'Data/hora') + ' desc', vazio: 'Nenhum erro registrado' }
  ];

  let linha = 17;
  secoes.forEach(function (s) {
    aba.getRange(linha, 1).setValue(s.titulo).setFontWeight('bold').setBackground('#e8f0fe');
    const select = s.cols.map(function (c) { return qcol_(s.aba, c); }).join(', ');
    let q = 'select ' + select + ' where ' + s.onde;
    if (s.ordem) q += ' order by ' + s.ordem;
    q += ' limit ' + s.limite;
    const formula = '=IFERROR(QUERY(' + intervaloAba_(s.aba) + ',"' + q.replace(/"/g, '""') + '",1),"' + s.vazio + '")';
    aba.getRange(linha + 1, 1).setFormula(formula);
    aba.getRange(linha + 1, 1, 1, s.cols.length).setFontWeight('bold').setBackground('#f1f3f4');
    s.cols.forEach(function (nomeCol, i) {
      const def = RADAR_ESQUEMA[s.aba].colunas.filter(function (c) { return c.nome === nomeCol; })[0];
      const fmt = def.tipo === 'moeda' ? RADAR_FORMATO_MOEDA : def.tipo === 'data' ? RADAR_FORMATO_DATA
        : def.tipo === 'pct' ? RADAR_FORMATO_PCT : null;
      if (fmt) aba.getRange(linha + 2, i + 1, s.limite, 1).setNumberFormat(fmt);
    });
    linha += s.limite + 4; // título + cabeçalho + linhas + respiro
  });

  aba.setFrozenRows(2);
  return 'PAINEL: montado (' + indicadores.length + ' indicadores e ' + secoes.length + ' tabelas)';
}
