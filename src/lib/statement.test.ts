import { describe, expect, it } from 'vitest';
import { decodeStatement, descriptionKey, parseCSV, parseOFX, parseStatement, parseStatementAmount, parseStatementDate, statementRequestIds } from './statement';

const OFX = `OFXHEADER:100
DATA:OFXSGML
CHARSET:1252

<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<DTSTART>20261001000000[-3:BRT]
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261005000000[-3:BRT]
<TRNAMT>-52.90
<FITID>abc-1
<MEMO>Compra no débito - PADARIA &amp; CIA
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20261006
<TRNAMT>3500,00
<FITID>abc-2
<NAME>SALARIO
</STMTTRN>
<STMTTRN>
<DTPOSTED>20261007
<TRNAMT>0.00
<FITID>abc-3
<MEMO>Ajuste
</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

describe('extrato OFX', () => {
  it('lê data, valor com sinal, descrição e FITID; ignora valor zero', () => {
    const r = parseOFX(OFX);
    expect(r.lines).toEqual([
      { date: '2026-10-05', amount_cents: -5290, description: 'Compra no débito - PADARIA & CIA', bank_id: 'abc-1' },
      { date: '2026-10-06', amount_cents: 350000, description: 'SALARIO', bank_id: 'abc-2' },
    ]);
    expect(r.skipped).toBe(1);
  });

  it('reconhece OFX pelo conteúdo mesmo sem extensão', () => {
    expect(parseStatement('extrato.txt', OFX).format).toBe('ofx');
  });
});

describe('extrato CSV', () => {
  it('Nubank conta (vírgula, identificador)', () => {
    const csv = 'Data,Valor,Identificador,Descrição\n05/10/2026,-52.90,id-1,Compra no débito - Padaria\n06/10/2026,3500.00,id-2,"Transferência recebida, João"\n';
    const r = parseCSV(csv);
    expect(r.lines).toEqual([
      { date: '2026-10-05', amount_cents: -5290, description: 'Compra no débito - Padaria', bank_id: 'id-1' },
      { date: '2026-10-06', amount_cents: 350000, description: 'Transferência recebida, João', bank_id: 'id-2' },
    ]);
  });

  it('Itaú/BB (ponto e vírgula, vírgula decimal, linhas de saldo e cabeçalho com dados da conta)', () => {
    const csv = 'Agência: 1234 Conta: 5678-9\n\ndata;lançamento;ag./origem;valor\n01/10/2026;SALDO ANTERIOR;;1.000,00\n02/10/2026;PIX ENVIADO MARIA;;-1.234,56\n03/10/2026;RENDIMENTOS;;0,45\n';
    const r = parseCSV(csv);
    expect(r.lines.map((l) => [l.date, l.description, l.amount_cents])).toEqual([
      ['2026-10-02', 'PIX ENVIADO MARIA', -123456],
      ['2026-10-03', 'RENDIMENTOS', 45],
    ]);
    expect(r.skipped).toBe(1);
  });

  it('colunas separadas de crédito e débito', () => {
    const csv = 'Data;Histórico;Crédito (R$);Débito (R$)\n10/10/2026;Depósito;200,00;\n11/10/2026;Conta de luz;;R$ 150,30\n';
    expect(parseCSV(csv).lines.map((l) => l.amount_cents)).toEqual([20000, -15030]);
  });

  it('sem cabeçalho reconhecível explica o formato esperado', () => {
    expect(() => parseCSV('a;b;c\n1;2;3')).toThrow(/Data;Descrição;Valor/);
  });
});

describe('valores e datas de extrato', () => {
  it('valores', () => {
    expect(parseStatementAmount('-1.234,56')).toBe(-123456);
    expect(parseStatementAmount('R$ 10,00')).toBe(1000);
    expect(parseStatementAmount('- R$ 10,00')).toBe(-1000);
    expect(parseStatementAmount('(10,00)')).toBe(-1000);
    expect(parseStatementAmount('10,00 D')).toBe(-1000);
    expect(parseStatementAmount('10,00 C')).toBe(1000);
    expect(parseStatementAmount('+25.5')).toBe(2550);
    expect(parseStatementAmount('abc')).toBeNull();
  });
  it('datas', () => {
    expect(parseStatementDate('16/10/2026')).toBe('2026-10-16');
    expect(parseStatementDate('16/10/26')).toBe('2026-10-16');
    expect(parseStatementDate('2026-10-16T10:00:00')).toBe('2026-10-16');
    expect(parseStatementDate('20261016120000[-3:BRT]')).toBe('2026-10-16');
    expect(parseStatementDate('31/02/2026')).toBeNull();
  });
  it('arquivo em Windows-1252', () => {
    const bytes = new Uint8Array([0x44, 0x65, 0x73, 0x63, 0x72, 0x69, 0xe7, 0xe3, 0x6f]); // "Descrição"
    expect(decodeStatement(bytes.buffer)).toBe('Descrição');
  });
});

describe('chaves de importação', () => {
  it('são estáveis, diferenciam linhas iguais no mesmo dia e dependem da conta', async () => {
    const lines = [
      { date: '2026-10-05', amount_cents: -500, description: 'Café', bank_id: null },
      { date: '2026-10-05', amount_cents: -500, description: 'Café', bank_id: null },
      { date: '2026-10-06', amount_cents: -500, description: 'Café', bank_id: 'x' },
    ];
    const a = await statementRequestIds('acc-1', lines);
    const b = await statementRequestIds('acc-1', lines);
    const c = await statementRequestIds('acc-2', lines);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(3);
    expect(a[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(c[0]).not.toBe(a[0]);
  });
  it('descrição normalizada ignora datas, números e acentos', () => {
    expect(descriptionKey('Compra no débito 05/10 - PADARIA Pão 123')).toBe('compra no debito padaria pao');
  });
});
