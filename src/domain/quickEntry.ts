import { addDays, todayISO } from '@/lib/dates';
import type { PaymentMethod, TxKind } from '@/lib/types';

/**
 * Lançamento em linguagem natural: "gastei 42 reais no mercado", "recebi 3 mil de salário",
 * "uber 18,90 ontem", "tênis 600 em 3x no nubank". Tudo local, sem enviar o texto a ninguém.
 */
export interface QuickEntry {
  kind: TxKind;
  amount_cents: number | null;
  description: string;
  occurred_on: string;
  installments: number;
  payment_method: PaymentMethod | null;
  /** "no cartão / crédito" sem nome de cartão */
  credit: boolean;
  /** palavra que bateu com o nome de uma conta ou cartão */
  sourceName: string | null;
  /** nome de categoria sugerido pelas palavras (o formulário procura a categoria com esse nome) */
  categoryName: string | null;
}

const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const INCOME = /\b(recebi|ganhei|entrou|entraram|caiu|cairam|vendi|salario|pagamento recebido|reembolso|me pagou|me pagaram|rendimento|dividendo)/;
const EXPENSE_VERBS = /\b(gastei|paguei|comprei|pago|gasto|compra|conta de|torrei|saiu|sairam|debitou|transferi para)\b/;

const NUMBER_WORDS: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
  onze: 11, doze: 12, quinze: 15, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70,
  oitenta: 80, noventa: 90, cem: 100, cento: 100, duzentos: 200, trezentos: 300, quinhentos: 500,
};

/** palavras → categoria (nomes padrão do app; subcategoria quando existir) */
const CATEGORY_WORDS: Array<[RegExp, string]> = [
  [/\b(mercado|supermercado|feira|hortifruti|acougue|padaria|atacadao|assai|carrefour|extra|pao de acucar)\b/, 'Mercado'],
  [/\b(ifood|delivery|rappi|ze delivery|aiqfome)\b/, 'Delivery'],
  [/\b(restaurante|almoco|jantar|lanche|lanchonete|pizza|hamburguer|burger|sushi|cafe|cafeteria|bar|cerveja|mcdonalds|bk|marmita)\b/, 'Restaurantes'],
  [/\b(uber|99|taxi|cabify|indrive)\b/, 'Aplicativos'],
  [/\b(gasolina|combustivel|etanol|alcool|diesel|posto|abasteci)\b/, 'Combustível'],
  [/\b(onibus|metro|trem|passagem|bilhete unico|brt)\b/, 'Transporte público'],
  [/\b(oficina|mecanico|pneu|revisao|troca de oleo|lava jato|estacionamento|pedagio)\b/, 'Manutenção'],
  [/\b(aluguel)\b/, 'Aluguel'],
  [/\b(condominio)\b/, 'Condomínio'],
  [/\b(luz|energia|enel|cemig|copel|light|celpe|coelba)\b/, 'Energia'],
  [/\b(agua|sabesp|saneamento|copasa|cedae)\b/, 'Água'],
  [/\b(internet|wifi|fibra|vivo fibra|claro net)\b/, 'Internet'],
  [/\b(farmacia|remedio|drogaria|drogasil|pague menos)\b/, 'Farmácia'],
  [/\b(medico|consulta|dentista|exame|psicologo|terapia)\b/, 'Consultas'],
  [/\b(plano de saude|unimed|amil|hapvida|bradesco saude)\b/, 'Plano de saúde'],
  [/\b(netflix|spotify|disney|prime video|hbo|max|globoplay|youtube premium|deezer|paramount|apple tv)\b/, 'Streaming'],
  [/\b(academia|smartfit|smart fit|crossfit|bluefit)\b/, 'Academia'],
  [/\b(icloud|google one|chatgpt|office|microsoft 365|adobe|dropbox)\b/, 'Software'],
  [/\b(escola|faculdade|mensalidade escolar)\b/, 'Mensalidade'],
  [/\b(curso|udemy|alura)\b/, 'Cursos'],
  [/\b(livro|livraria)\b/, 'Livros'],
  [/\b(cinema|show|ingresso|teatro|evento)\b/, 'Cinema e eventos'],
  [/\b(viagem|hotel|pousada|airbnb|passagem aerea|aviao)\b/, 'Viagens'],
  [/\b(roupa|roupas|camisa|calca|tenis|sapato|vestido|renner|riachuelo|cea|shein|zara)\b/, 'Vestuário'],
  [/\b(celular|notebook|fone|eletronico|computador|tv|televisao)\b/, 'Eletrônicos'],
  [/\b(movel|moveis|decoracao|utensilio|leroy|tok stok|magalu|casas bahia)\b/, 'Casa'],
  [/\b(tarifa|anuidade|taxa bancaria|iof)\b/, 'Tarifas bancárias'],
  [/\b(ipva|iptu|imposto|darf|irpf)\b/, 'Impostos'],
  [/\b(salario|holerite|pagamento da empresa)\b/, 'Salário'],
  [/\b(freela|freelance|bico|servico extra)\b/, 'Freelance'],
  [/\b(vendi|venda)\b/, 'Vendas'],
  [/\b(dividendo|dividendos|jcp)\b/, 'Dividendos'],
  [/\b(rendimento|rendimentos|cdb|tesouro)\b/, 'Rendimentos'],
  [/\b(reembolso)\b/, 'Reembolsos'],
  [/\b(presente)\b/, 'Presentes'],
];

/** subcategoria → categoria principal (quando a pessoa não usa subcategorias) */
export const CATEGORY_PARENT: Record<string, string> = {
  Mercado: 'Alimentação', Restaurantes: 'Alimentação', Delivery: 'Alimentação',
  Aluguel: 'Moradia', Condomínio: 'Moradia', Energia: 'Moradia', Água: 'Moradia', Internet: 'Moradia',
  Combustível: 'Transporte', Aplicativos: 'Transporte', 'Transporte público': 'Transporte', Manutenção: 'Transporte',
  'Plano de saúde': 'Saúde', Farmácia: 'Saúde', Consultas: 'Saúde',
  Mensalidade: 'Educação', Cursos: 'Educação', Livros: 'Educação',
  Viagens: 'Lazer', 'Cinema e eventos': 'Lazer', Hobbies: 'Lazer',
  Streaming: 'Assinaturas', Software: 'Assinaturas', Academia: 'Assinaturas',
  Vestuário: 'Compras', Eletrônicos: 'Compras', Casa: 'Compras',
  'Tarifas bancárias': 'Impostos e taxas', Impostos: 'Impostos e taxas',
  Freelance: 'Renda extra', Vendas: 'Renda extra',
  Rendimentos: 'Investimentos', Dividendos: 'Investimentos',
  Reembolsos: 'Outras receitas', Presentes: 'Outras receitas',
};

const STOP = new Set([
  'gastei', 'paguei', 'comprei', 'recebi', 'ganhei', 'entrou', 'entraram', 'caiu', 'cairam', 'torrei', 'saiu', 'sairam', 'debitou', 'pago', 'gasto',
  'reais', 'real', 'r$', 'rs', 'conto', 'contos', 'pila', 'pilas', 'mil', 'centavos', 'e',
  'no', 'na', 'nos', 'nas', 'em', 'de', 'do', 'da', 'dos', 'das', 'com', 'pelo', 'pela', 'pro', 'pra', 'para', 'um', 'uma', 'o', 'a', 'os', 'as', 'meu', 'minha',
  'hoje', 'ontem', 'anteontem', 'dia', 'vezes', 'x', 'parcelado', 'parcelas', 'parcela', 'cartao', 'credito', 'debito', 'pix', 'dinheiro', 'boleto', 'via', 'agora', 'eu', 'me',
]);

function parseAmount(text: string): { cents: number | null; rest: string } {
  // 1.234,56 | 1234,56 | 42.50 | 42 | 2,5 mil | 3 mil | R$ 42
  const re = /(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)(\s*(?:mil|k)\b)?(?:\s*(?:reais|real|conto|contos|pila|pilas)\b)?(?:\s*e\s*(\d{1,2})\s*centavos?)?/;
  const candidates = [...text.matchAll(new RegExp(re.source, 'g'))].filter((m) => {
    // não confundir com parcelas (3x), datas (12/10) nem "dia 5"
    const after = text.slice(m.index! + m[0].length);
    const before = text.slice(0, m.index!);
    return !/^\s*(x\b|vezes|parcelas?)/.test(after) && !/^\/\d/.test(after) && !/\d\/$/.test(before) && !/\b(dia|em)\s*$/.test(before);
  });
  const m = candidates.find((c) => /r\$|reais|real|conto|pila|mil|k\b|[.,]/.test(c[0])) ?? candidates[0];
  if (m) {
    let raw = m[1]!;
    raw = /,\d{1,2}$/.test(raw) ? raw.replace(/\./g, '').replace(',', '.') : /\.\d{3}/.test(raw) ? raw.replace(/\./g, '') : raw.replace(',', '.');
    let value = Number(raw);
    if (m[2]) value *= 1000;
    let cents = Math.round(value * 100);
    if (m[3]) cents += Number(m[3]);
    return { cents: cents > 0 ? cents : null, rest: text.replace(m[0], ' ') };
  }
  // por extenso: "cinquenta reais", "duzentos e trinta"
  const words = text.match(/\b((?:(?:um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|quinze|vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa|cem|cento|duzentos|trezentos|quinhentos)(?:\s+e\s+)?)+)\s*(mil\s*)?(reais|real|conto|contos|pila)\b/);
  if (words) {
    const value = words[1]!.split(/\s+e\s+|\s+/).reduce((s, w) => s + (NUMBER_WORDS[w] ?? 0), 0) * (words[2] ? 1000 : 1);
    if (value > 0) return { cents: value * 100, rest: text.replace(words[0], ' ') };
  }
  return { cents: null, rest: text };
}

function parseDate(text: string, today: string): { date: string; rest: string } {
  if (/\banteontem\b/.test(text)) return { date: addDays(today, -2), rest: text.replace(/\banteontem\b/, ' ') };
  if (/\bontem\b/.test(text)) return { date: addDays(today, -1), rest: text.replace(/\bontem\b/, ' ') };
  const full = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (full) {
    const y = full[3] ? (full[3].length === 2 ? `20${full[3]}` : full[3]) : today.slice(0, 4);
    const d = `${y}-${full[2]!.padStart(2, '0')}-${full[1]!.padStart(2, '0')}`;
    if (!Number.isNaN(Date.parse(d))) return { date: !full[3] && d > today ? `${Number(y) - 1}${d.slice(4)}` : d, rest: text.replace(full[0], ' ') };
  }
  const day = text.match(/\bdia\s+(\d{1,2})\b/);
  if (day && Number(day[1]) >= 1 && Number(day[1]) <= 31) {
    const n = Number(day[1]);
    let d = `${today.slice(0, 8)}${String(n).padStart(2, '0')}`;
    if (d > today) {
      const prev = new Date(`${today.slice(0, 8)}01T12:00:00`);
      prev.setMonth(prev.getMonth() - 1);
      d = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-${String(n).padStart(2, '0')}`;
    }
    return { date: d, rest: text.replace(day[0], ' ') };
  }
  return { date: today, rest: text.replace(/\bhoje\b/, ' ') };
}

export function parseQuickEntry(input: string, sources: string[] = [], today: string = todayISO()): QuickEntry {
  let text = ` ${strip(input).replace(/[!?;]/g, ' ')} `;
  const kind: TxKind = INCOME.test(text) && !EXPENSE_VERBS.test(text.replace(/\bpagamento recebido\b/, '')) ? 'income' : 'expense';

  let installments = 1;
  const inst = text.match(/\b(?:em\s+)?(\d{1,2})\s*(?:x|vezes|parcelas)\b|\bparcelado em (\d{1,2})\b/);
  if (inst) {
    installments = Math.min(48, Math.max(1, Number(inst[1] ?? inst[2])));
    text = text.replace(inst[0], ' ');
  }

  const date = parseDate(text, today);
  text = date.rest;
  const amount = parseAmount(text);
  text = amount.rest;

  let payment_method: PaymentMethod | null = null;
  if (/\bpix\b/.test(text)) payment_method = 'pix';
  else if (/\bdebito\b/.test(text)) payment_method = 'debit';
  else if (/\b(dinheiro|especie)\b/.test(text)) payment_method = 'cash';
  else if (/\bboleto\b/.test(text)) payment_method = 'boleto';
  const credit = /\b(cartao|credito)\b/.test(text) && payment_method !== 'debit';

  const source = sources.find((s) => {
    const k = strip(s).trim();
    return k.length >= 3 && new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text);
  });
  if (source) text = text.replace(strip(source), ' ');

  const catHit = CATEGORY_WORDS.find(([re]) => re.test(text));
  const words = text.split(/\s+/).filter((w) => w && !STOP.has(w) && !/^\d+$/.test(w));
  const original = input.split(/\s+/).filter((w) => words.includes(strip(w).replace(/[!?;,.]/g, '')));
  const description = original.join(' ').replace(/[,.]$/, '').trim();

  return {
    kind,
    amount_cents: amount.cents,
    description: description ? description[0]!.toUpperCase() + description.slice(1) : catHit ? catHit[1] : '',
    occurred_on: date.date,
    installments,
    payment_method,
    credit,
    sourceName: source ?? null,
    categoryName: catHit?.[1] ?? null,
  };
}

/** Leitura de comprovante (texto do OCR): total, data e estabelecimento. */
export function parseReceiptText(text: string, today: string = todayISO()): { amount_cents: number | null; occurred_on: string | null; merchant: string | null } {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const money = (s: string) => {
    const m = s.match(/(\d{1,3}(?:\.\d{3})*,\d{2}|\d+\.\d{2})(?!\d)/g);
    if (!m) return null;
    const raw = m[m.length - 1]!;
    return Math.round(Number(raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw) * 100);
  };
  const totalRe = /(valor\s*(a\s*pagar|total|pago|da\s*compra)|total\s*(a\s*pagar|r\$|geral)?|vl\.?\s*total|valor\s*cobrado|valor)/i;
  let amount: number | null = null;
  for (const re of [/valor\s*a\s*pagar|total\s*a\s*pagar|valor\s*pago|valor\s*total/i, totalRe]) {
    for (let i = 0; i < lines.length && amount === null; i++) {
      if (!re.test(lines[i]!) || /troco|desconto|tribut|imposto|subtotal/i.test(lines[i]!)) continue;
      amount = money(lines[i]!) ?? (lines[i + 1] ? money(lines[i + 1]!) : null);
    }
    if (amount !== null) break;
  }
  if (amount === null) {
    const all = lines.map(money).filter((v): v is number => v !== null && v < 10_000_000);
    amount = all.length ? Math.max(...all) : null;
  }
  const dm = text.match(/\b(\d{2})[/.-](\d{2})[/.-](\d{2,4})\b/);
  let occurred_on: string | null = null;
  if (dm) {
    const y = dm[3]!.length === 2 ? `20${dm[3]}` : dm[3]!;
    const d = `${y}-${dm[2]}-${dm[1]}`;
    if (!Number.isNaN(Date.parse(d)) && d <= today && d > addDays(today, -400)) occurred_on = d;
  }
  const merchant =
    lines
      .slice(0, 6)
      .find((l) => /[a-z]{3,}/i.test(l) && !/cnpj|cpf|cupom|nota|documento|comprovante|danfe|nfc|extrato|via|ie:|endere|rua|av\.|fone|tel/i.test(l) && l.replace(/[^a-z]/gi, '').length >= 4)
      ?.replace(/\s{2,}/g, ' ')
      .slice(0, 60) ?? null;
  return { amount_cents: amount, occurred_on, merchant };
}
