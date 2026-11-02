// Teste local do Setup.gs com uma planilha simulada (Node, sem dependências).
// Uso: node radar-promocoes/testes/teste-setup.cjs
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

function criarPlanilhaFalsa() {
  const abas = [];
  function novaAba(nome) {
    const celulas = {}; // "l,c" -> valor
    let maxRows = 1000;
    const aba = {
      nome, celulas, formulas: {}, notas: {}, validacoes: {},
      getName: () => nome,
      getLastRow() { let m = 0; for (const k in celulas) if (celulas[k] !== '' && celulas[k] != null) m = Math.max(m, +k.split(',')[0]); return m; },
      getLastColumn() { let m = 0; for (const k in celulas) if (celulas[k] !== '' && celulas[k] != null) m = Math.max(m, +k.split(',')[1]); return m; },
      getMaxRows: () => maxRows,
      insertRowsAfter(_, n) { maxRows += n; },
      setTabColor() { return aba; }, setFrozenRows() { return aba; }, setColumnWidth() { return aba; },
      clear() { for (const k in celulas) delete celulas[k]; aba.formulas = {}; return aba; },
      clearNotes() { aba.notas = {}; return aba; },
      getRange(l, c, nl = 1, nc = 1) {
        if (l < 1 || c < 1 || nl < 1 || nc < 1) throw new Error(`getRange inválido em ${nome}: ${l},${c},${nl},${nc}`);
        if (l + nl - 1 > maxRows) throw new Error(`Faixa além do limite de linhas em ${nome}`);
        const r = {
          setValues(v) {
            assert.strictEqual(v.length, nl, `setValues: linhas ${v.length} != ${nl} em ${nome}`);
            v.forEach((linha, i) => { assert.strictEqual(linha.length, nc, `setValues: colunas ${linha.length} != ${nc} em ${nome}`);
              linha.forEach((x, j) => { celulas[`${l + i},${c + j}`] = x; }); });
            return r;
          },
          setValue(x) { celulas[`${l},${c}`] = x; return r; },
          setFormula(f) { assert.ok(f.startsWith('='), 'fórmula sem ='); aba.formulas[`${l},${c}`] = f; celulas[`${l},${c}`] = f; return r; },
          getValues() { const out = []; for (let i = 0; i < nl; i++) { const linha = []; for (let j = 0; j < nc; j++) { const v = celulas[`${l + i},${c + j}`]; linha.push(v == null ? '' : v); } out.push(linha); } return out; },
          setNote(t) { aba.notas[`${l},${c}`] = t; return r; },
          setDataValidation(v) { aba.validacoes[`${c}`] = v; return r; },
        };
        ['setFontWeight', 'setFontColor', 'setBackground', 'setWrap', 'setVerticalAlignment', 'setNumberFormat',
          'setHorizontalAlignment', 'setFontSize'].forEach(m => { r[m] = () => r; });
        return r;
      }
    };
    return aba;
  }
  abas.push(novaAba('Página1'));
  return {
    abas,
    getSheetByName: n => abas.find(a => a.nome === n) || null,
    getSheets: () => abas.slice(),
    insertSheet(n, i) { const a = novaAba(n); abas.splice(i, 0, a); return a; },
    deleteSheet(a) { abas.splice(abas.indexOf(a), 1); },
    setSpreadsheetTimeZone(tz) { this.tz = tz; },
    setSpreadsheetLocale(l) { this.locale = l; },
  };
}

function carregar(ss) {
  const validacao = () => { const b = { requireCheckbox: () => b, requireValueInList: (l) => { b.lista = l; return b; }, setAllowInvalid: () => b, build: () => b }; return b; };
  const ctx = {
    console: { log: () => {} },
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, newDataValidation: validacao, getUi: () => { throw new Error('sem UI'); } },
  };
  vm.createContext(ctx);
  const codigo = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Setup.gs'), 'utf8');
  vm.runInContext(codigo + '\n;this.__exp = {criarEstrutura, col_, RADAR_ESQUEMA, RADAR_CONFIG_PADRAO};', ctx);
  return ctx.__exp;
}

let ok = 0;
function teste(nome, fn) { fn(); ok++; console.log('✔ ' + nome); }

const ss = criarPlanilhaFalsa();
const R = carregar(ss);
const rel1 = R.criarEstrutura();

teste('cria as 9 abas na ordem e remove "Página1" vazia', () => {
  assert.deepStrictEqual(ss.abas.map(a => a.nome),
    ['PAINEL', 'PRODUTOS', 'LOJAS', 'FONTES', 'OFERTAS', 'HISTORICO_PRECOS', 'CONFIGURACOES', 'NOTIFICACOES', 'LOGS']);
  assert.strictEqual(ss.tz, 'America/Sao_Paulo');
});

teste('cabeçalhos iguais ao esquema em todas as abas de dados', () => {
  for (const nome of Object.keys(R.RADAR_ESQUEMA)) {
    if (nome === 'PAINEL') continue;
    const esperado = JSON.parse(JSON.stringify(R.RADAR_ESQUEMA[nome].colunas.map(c => c.nome)));
    const aba = ss.getSheetByName(nome);
    assert.deepStrictEqual(aba.getRange(1, 1, 1, esperado.length).getValues()[0], esperado, nome);
  }
});

teste('exemplos: 10 produtos, 6 lojas, 5 fontes; nenhuma fonte começa como OK', () => {
  assert.strictEqual(ss.getSheetByName('PRODUTOS').getLastRow(), 11);
  assert.strictEqual(ss.getSheetByName('LOJAS').getLastRow(), 7);
  const f = ss.getSheetByName('FONTES');
  assert.strictEqual(f.getLastRow(), 6);
  const status = f.getRange(2, 8, 5, 1).getValues().map(l => l[0]);
  assert.ok(!status.includes('OK'), 'nenhuma fonte pode nascer OK');
});

teste('CONFIGURACOES com todas as chaves, sem repetição', () => {
  const c = ss.getSheetByName('CONFIGURACOES');
  assert.strictEqual(c.getLastRow(), 1 + R.RADAR_CONFIG_PADRAO.length);
});

teste('letras das colunas usadas no painel estão corretas', () => {
  assert.strictEqual(R.col_('OFERTAS', 'Classificação'), 'OFERTAS!R2:R');
  assert.strictEqual(R.col_('OFERTAS', 'Data/hora'), 'OFERTAS!B2:B');
  assert.strictEqual(R.col_('PRODUTOS', 'Ativo'), 'PRODUTOS!B2:B');
  assert.strictEqual(R.col_('FONTES', 'Status'), 'FONTES!H2:H');
  assert.strictEqual(R.col_('NOTIFICACOES', 'Status'), 'NOTIFICACOES!I2:I');
  assert.strictEqual(R.col_('LOGS', 'Nível'), 'LOGS!B2:B');
});

teste('fórmulas do painel: parênteses e aspas balanceados', () => {
  const p = ss.getSheetByName('PAINEL');
  const fs_ = Object.values(p.formulas);
  assert.ok(fs_.length >= 19, 'esperava 10 indicadores + 9 tabelas + data');
  for (const f of fs_) {
    let n = 0; for (const ch of f) { if (ch === '(') n++; if (ch === ')') n--; assert.ok(n >= 0, f); }
    assert.strictEqual(n, 0, 'parênteses: ' + f);
    assert.strictEqual((f.match(/"/g) || []).length % 2, 0, 'aspas: ' + f);
  }
  const q = fs_.find(f => f.includes("'EXCELENTE'"));
  assert.ok(q.includes('{OFERTAS!A1:U}') && q.includes('Col18'), q);
});

teste('rodar de novo não altera nem duplica nada', () => {
  ss.getSheetByName('PRODUTOS').getRange(2, 9).setValue(2199); // usuário mudou um preço-alvo
  const antes = JSON.stringify(ss.abas.filter(a => a.nome !== 'PAINEL').map(a => a.celulas));
  const rel2 = R.criarEstrutura();
  const depois = JSON.stringify(ss.abas.filter(a => a.nome !== 'PAINEL').map(a => a.celulas));
  assert.strictEqual(antes, depois);
  assert.ok(rel2.includes('PRODUTOS: já estava correta'), rel2);
  assert.strictEqual(ss.getSheetByName('PRODUTOS').getRange(2, 9).getValues()[0][0], 2199);
});

teste('coluna apagada por engano é recriada no final, sem mexer nos dados', () => {
  const lojas = ss.getSheetByName('LOJAS');
  lojas.getRange(1, 7).setValue(''); // some o cabeçalho "Observações"
  const rel3 = R.criarEstrutura();
  assert.ok(rel3.includes('LOJAS: colunas adicionadas: Observações'), rel3);
  assert.strictEqual(lojas.getRange(2, 1).getValues()[0][0], 'amazon');
});

teste('chave de configuração apagada é recriada, as outras ficam', () => {
  const c = ss.getSheetByName('CONFIGURACOES');
  c.getRange(3, 2).setValue('NAO'); // usuário mudou MODO_TESTE
  const total = c.getLastRow();
  c.getRange(total, 1, 1, 3).setValues([['', '', '']]); // apagou a última chave
  R.criarEstrutura();
  assert.strictEqual(c.getLastRow(), total);
  assert.strictEqual(c.getRange(3, 2).getValues()[0][0], 'NAO');
});

console.log(`\n${ok} testes passaram.`);
console.log('\nRelatório da 1ª execução:\n' + rel1);
