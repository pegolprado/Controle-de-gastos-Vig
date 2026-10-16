/**
 * Leitura de extratos bancários (OFX e CSV) exportados pelos bancos brasileiros.
 * Só converte o arquivo em linhas; quem decide o que gravar é a tela de importação.
 */
import { parseBRL } from './money';
import { isValidISO, type ISODate } from './dates';

export interface StatementLine {
  date: ISODate;
  description: string;
  /** centavos com sinal: negativo = saída, positivo = entrada */
  amount_cents: number;
  /** identificador do banco (FITID no OFX, "Identificador" no CSV do Nubank), quando existe */
  bank_id: string | null;
}

export interface ParsedStatement {
  format: 'ofx' | 'csv';
  lines: StatementLine[];
  /** linhas ignoradas (saldo, cabeçalhos repetidos, valores inválidos) */
  skipped: number;
}

export const MAX_STATEMENT_LINES = 3000;

/** Decodifica o arquivo: UTF-8 quando válido, senão Windows-1252 (padrão de vários bancos). */
export function decodeStatement(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

const strip = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

function cleanDescription(s: string): string {
  const text = s
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return (text || 'Sem descrição').slice(0, 140);
}

/** "16/10/2026", "16/10/26", "16-10-2026", "2026-10-16" ou "20261016…" → ISO */
export function parseStatementDate(text: string): ISODate | null {
  const t = text.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return isValidISO(`${m[1]}-${m[2]}-${m[3]}`) ? `${m[1]}-${m[2]}-${m[3]}` : null;
  m = /^(\d{2})[/.-](\d{2})[/.-](\d{2}|\d{4})$/.exec(t.split(' ')[0] ?? '');
  if (m) {
    const y = m[3]!.length === 2 ? `20${m[3]}` : m[3];
    const iso = `${y}-${m[2]}-${m[1]}`;
    return isValidISO(iso) ? iso : null;
  }
  m = /^(\d{4})(\d{2})(\d{2})/.exec(t);
  if (m) {
    const iso = `${m[1]}-${m[2]}-${m[3]}`;
    return isValidISO(iso) ? iso : null;
  }
  return null;
}

/** Valor como os bancos escrevem: "-1.234,56", "1234.56", "R$ 10,00", "(10,00)", "10,00 D". */
export function parseStatementAmount(text: string): number | null {
  let t = text.trim();
  if (!t) return null;
  let negative = false;
  if (/^\(.*\)$/.test(t)) {
    negative = true;
    t = t.slice(1, -1);
  }
  const suffix = /\s*([DC])$/i.exec(t);
  if (suffix) {
    if (suffix[1]!.toUpperCase() === 'D') negative = true;
    t = t.slice(0, suffix.index);
  }
  t = t.replace(/^R\$\s*/i, '').replace(/^([-−+])\s*R\$\s*/i, '$1').replace(/\s/g, '');
  if (t.startsWith('+')) t = t.slice(1);
  const cents = parseBRL(t);
  if (cents === null) return null;
  return negative ? -Math.abs(cents) : cents;
}

// ---------------------------------------------------------------- OFX

function ofxField(block: string, tag: string): string {
  const m = new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i').exec(block);
  return m?.[1]?.trim() ?? '';
}

export function parseOFX(text: string): ParsedStatement {
  const lines: StatementLine[] = [];
  let skipped = 0;
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  for (const raw of blocks) {
    const block = raw.split(/<\/STMTTRN>/i)[0] ?? raw;
    const date = parseStatementDate(ofxField(block, 'DTPOSTED'));
    const amount = parseStatementAmount(ofxField(block, 'TRNAMT'));
    if (!date || amount === null || amount === 0) {
      skipped++;
      continue;
    }
    const memo = ofxField(block, 'MEMO');
    const name = ofxField(block, 'NAME');
    const description = memo && name && !strip(memo).includes(strip(name)) ? `${name} - ${memo}` : memo || name;
    lines.push({ date, amount_cents: amount, description: cleanDescription(description), bank_id: ofxField(block, 'FITID') || null });
  }
  return { format: 'ofx', lines, skipped };
}

// ---------------------------------------------------------------- CSV

function splitCSVLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

interface Columns {
  date: number;
  description: number;
  amount: number;
  credit: number;
  debit: number;
  id: number;
}

function findColumns(header: string[]): Columns | null {
  const h = header.map(strip);
  const find = (re: RegExp, except: number[] = []) => h.findIndex((c, i) => !except.includes(i) && re.test(c));
  const date = find(/^(data|date|dt)\b/);
  if (date < 0) return null;
  const amount = find(/^(valor|amount|quantia|montante)\b(?!.*(dolar|usd|us\$))/, [date]);
  const credit = find(/(credito|entrada)/, [date, amount]);
  const debit = find(/(debito|saida)/, [date, amount]);
  if (amount < 0 && credit < 0 && debit < 0) return null;
  const id = find(/^(identificador|id|fitid|codigo da transacao)$/, [date, amount]);
  const description = find(/(descri|histor|lancamento|title|titulo|estabelecimento|memo|detalhe|favorecido)/, [date, amount, credit, debit, id]);
  return { date, description, amount, credit, debit, id };
}

export function parseCSV(text: string): ParsedStatement {
  const rows = text.split(/\r?\n/).filter((l) => l.trim());
  // procura o cabeçalho nas primeiras linhas (alguns bancos colocam nome/agência antes)
  let cols: Columns | null = null;
  let sep = ';';
  let start = 0;
  for (let i = 0; i < Math.min(rows.length, 20) && !cols; i++) {
    const line = rows[i]!;
    const counts = [';', ',', '\t'].map((s) => [s, splitCSVLine(line, s).length] as const).sort((a, b) => b[1] - a[1]);
    for (const [s] of counts) {
      const c = findColumns(splitCSVLine(line, s));
      if (c) {
        cols = c;
        sep = s;
        start = i + 1;
        break;
      }
    }
  }
  if (!cols) throw new Error('Não encontramos as colunas de data e valor neste CSV. Ele precisa ter um cabeçalho como "Data;Descrição;Valor".');

  const lines: StatementLine[] = [];
  let skipped = 0;
  for (const row of rows.slice(start)) {
    const cells = splitCSVLine(row, sep);
    const date = parseStatementDate(cells[cols.date] ?? '');
    const description = cols.description >= 0 ? (cells[cols.description] ?? '') : '';
    let amount: number | null = null;
    if (cols.amount >= 0) amount = parseStatementAmount(cells[cols.amount] ?? '');
    if (amount === null && (cols.credit >= 0 || cols.debit >= 0)) {
      const c = cols.credit >= 0 ? parseStatementAmount(cells[cols.credit] ?? '') : null;
      const d = cols.debit >= 0 ? parseStatementAmount(cells[cols.debit] ?? '') : null;
      if (c) amount = Math.abs(c);
      else if (d) amount = -Math.abs(d);
    }
    if (!date || amount === null || amount === 0 || /^saldo\b/.test(strip(description))) {
      skipped++;
      continue;
    }
    const bankId = cols.id >= 0 ? cells[cols.id] || null : null;
    lines.push({ date, amount_cents: amount, description: cleanDescription(description), bank_id: bankId });
  }
  return { format: 'csv', lines, skipped };
}

export function parseStatement(fileName: string, text: string): ParsedStatement {
  const isOFX = /\.(ofx|qfx)$/i.test(fileName) || /<OFX>|OFXHEADER/i.test(text.slice(0, 2000));
  const parsed = isOFX ? parseOFX(text) : parseCSV(text);
  if (parsed.lines.length > MAX_STATEMENT_LINES) {
    throw new Error(`O arquivo tem ${parsed.lines.length} lançamentos. Importe no máximo ${MAX_STATEMENT_LINES} por vez (exporte um período menor).`);
  }
  return parsed;
}

/**
 * Chave de idempotência estável por linha: reimportar o mesmo extrato (ou um período
 * que se sobrepõe) nunca duplica lançamentos. Linhas idênticas no mesmo dia são
 * diferenciadas pela ordem em que aparecem.
 */
export async function statementRequestIds(accountId: string, lines: StatementLine[]): Promise<string[]> {
  const seen = new Map<string, number>();
  const ids: string[] = [];
  for (const l of lines) {
    const base = l.bank_id ? `id|${l.bank_id}` : `row|${l.date}|${l.amount_cents}|${strip(l.description)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const data = new TextEncoder().encode(`finance-mv-import|${accountId}|${base}|${l.bank_id ? 1 : n}`);
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', data)).slice(0, 16);
    hash[6] = (hash[6]! & 0x0f) | 0x50; // versão 5 (baseado em nome)
    hash[8] = (hash[8]! & 0x3f) | 0x80;
    const h = [...hash].map((x) => x.toString(16).padStart(2, '0')).join('');
    ids.push(`${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`);
  }
  return ids;
}

/** Normaliza a descrição para reaproveitar a categoria de lançamentos parecidos. */
export function descriptionKey(s: string): string {
  return strip(s)
    .replace(/\d{2}\/\d{2}(\/\d{2,4})?/g, '')
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
