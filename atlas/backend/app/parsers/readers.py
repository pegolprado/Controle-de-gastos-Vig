"""Leitores de arquivos tabulares.

Cada formato produz linhas cruas (número da linha/página de origem + células em
texto). A detecção de cabeçalho é comum a todos. Nada é convertido aqui: datas,
números e identificadores continuam como texto até a etapa de normalização.
"""
from __future__ import annotations

import csv
import io
import json
import re
import zipfile
from collections import Counter
from collections.abc import Iterator
from dataclasses import asdict, dataclass, field
from pathlib import Path

from .fields import header_score
from .text import cell_to_str

csv.field_size_limit(10 * 1024 * 1024)

PREVIEW_SCAN_ROWS = 60


@dataclass
class ReadOptions:
    encoding: str | None = None
    delimiter: str | None = None
    header_row: int | None = None  # índice (0-based) entre as linhas cruas; -1 = sem cabeçalho
    sheet: str | None = None
    fixed_widths: list[int] | None = None  # posições iniciais das colunas (largura fixa)
    ocr: bool = True
    ocr_lang: str = "por"

    @classmethod
    def from_dict(cls, d: dict | None) -> ReadOptions:
        d = d or {}
        return cls(**{k: d[k] for k in cls.__dataclass_fields__ if k in d})


@dataclass
class RawRow:
    row_number: int  # linha no arquivo (1-based) ou índice do registro
    cells: list[str]
    page: int | None = None
    confidence: float | None = None  # confiança do OCR (0–1), quando aplicável


@dataclass
class TableInfo:
    fmt: str
    encoding: str | None = None
    delimiter: str | None = None
    sheet: str | None = None
    sheets: list[str] = field(default_factory=list)
    header_row: int = -1
    columns: list[str] = field(default_factory=list)
    preamble: list[str] = field(default_factory=list)
    pages: int | None = None
    ocr_used: bool = False
    ocr_confidence: float | None = None
    fixed_widths: list[int] | None = None
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


# ---------------------------------------------------------------- detecção


def sniff_format(path: Path, name: str = "") -> str:
    with open(path, "rb") as f:
        head = f.read(8192)
    if head.startswith(b"PK\x03\x04") or head.startswith(b"PK\x05\x06"):
        try:
            with zipfile.ZipFile(path) as z:
                names = z.namelist()
            if "xl/workbook.xml" in names:
                return "xlsx"
        except zipfile.BadZipFile:
            return "unknown"
        return "zip"
    if head.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"):
        return "xls"
    if head.startswith(b"%PDF"):
        return "pdf"
    if not head.strip():
        return "empty"
    if b"\x00" in head[:2048] and not (head.startswith(b"\xff\xfe") or head.startswith(b"\xfe\xff")):
        return "unknown"
    text = _decode_sample(head)
    stripped = text.lstrip("﻿ \r\n\t")
    low = stripped[:500].lower()
    if low.startswith("<!doctype html") or low.startswith("<html") or "<table" in low:
        return "html"
    if stripped.startswith("<"):
        return "xml"
    if stripped.startswith("{") or stripped.startswith("["):
        return "json"
    lines = [ln for ln in text.splitlines() if ln.strip()][:50]
    if _sniff_delimiter(lines):
        return "csv"
    if _infer_fixed_widths(lines):
        return "fixed"
    return "txt"


def _decode_sample(data: bytes) -> str:
    for enc in ("utf-8-sig", "utf-16"):
        if enc == "utf-16" and not (data.startswith(b"\xff\xfe") or data.startswith(b"\xfe\xff")):
            continue
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            # amostra pode cortar um caractere multibyte no fim
            try:
                return data[:-3].decode(enc)
            except UnicodeDecodeError:
                pass
    return data.decode("cp1252", errors="replace")


def detect_encoding(path: Path) -> str:
    with open(path, "rb") as f:
        data = f.read(512 * 1024)
    if data.startswith(b"\xef\xbb\xbf"):
        return "utf-8-sig"
    if data.startswith(b"\xff\xfe") or data.startswith(b"\xfe\xff"):
        return "utf-16"
    try:
        data.decode("utf-8")
        return "utf-8"
    except UnicodeDecodeError as e:
        # corte no meio de um caractere no fim da amostra ainda é UTF-8
        if e.start >= len(data) - 3:
            return "utf-8"
    try:
        from charset_normalizer import from_bytes

        best = from_bytes(data).best()
        if best and best.encoding:
            enc = best.encoding.lower()
            # Planilhas brasileiras "latin-1" quase sempre são cp1252 (aspas, travessão)
            return "cp1252" if enc in {"latin_1", "iso8859_1", "iso-8859-1"} else enc
    except Exception:  # noqa: BLE001
        pass
    return "cp1252"


def _sniff_delimiter(lines: list[str]) -> str | None:
    best, best_score = None, 0.0
    for d in (";", "\t", ",", "|"):
        counts = [_count_outside_quotes(ln, d) for ln in lines]
        counts = [c for c in counts if c > 0]
        if len(counts) < max(1, len(lines) // 2):
            continue
        mode, freq = Counter(counts).most_common(1)[0]
        consistency = freq / len(counts)
        score = consistency * min(mode, 30) * (len(counts) / max(len(lines), 1))
        if consistency >= 0.6 and score > best_score:
            best, best_score = d, score
    return best


def _count_outside_quotes(line: str, d: str) -> int:
    n, inq = 0, False
    for ch in line:
        if ch == '"':
            inq = not inq
        elif ch == d and not inq:
            n += 1
    return n


def _infer_fixed_widths(lines: list[str]) -> list[int] | None:
    """Encontra colunas de espaço comuns às linhas longas e deduz o início das colunas."""
    if len(lines) < 3:
        return None
    maxlen = max(len(ln.rstrip()) for ln in lines)
    body = [ln.rstrip("\r\n") for ln in lines if len(ln.rstrip()) >= maxlen * 0.7]
    if len(body) < 3 or maxlen < 10:
        return None
    width = max(len(ln) for ln in body)
    is_space = []
    first = body[0]  # provável cabeçalho: limites de coluna não podem cortar seus nomes
    for i in range(width):
        spaces = sum(1 for ln in body if i >= len(ln) or ln[i] == " ")
        is_space.append(spaces / len(body) >= 0.95 and (i >= len(first) or first[i] == " "))
    starts = []
    for i in range(width):
        if not is_space[i] and (i == 0 or is_space[i - 1]):
            starts.append(i)
    # exige separação de pelo menos 2 espaços em algum ponto e ≥ 3 colunas
    return starts if len(starts) >= 3 else None


# ---------------------------------------------------------------- leitores crus


def _rows_csv(path: Path, opts: ReadOptions, info: TableInfo) -> Iterator[RawRow]:
    enc = opts.encoding or detect_encoding(path)
    info.encoding = enc
    with open(path, encoding=enc, errors="replace", newline="") as f:
        if opts.delimiter:
            delim = opts.delimiter
        else:
            sample = [ln for ln in (f.readline() for _ in range(200)) if ln.strip()]
            delim = _sniff_delimiter(sample[:80]) or ";"
            f.seek(0)
        info.delimiter = delim
        reader = csv.reader(f, delimiter=delim)
        for i, row in enumerate(reader, start=1):
            yield RawRow(i, [c.strip() for c in row])


def _rows_fixed(path: Path, opts: ReadOptions, info: TableInfo) -> Iterator[RawRow]:
    enc = opts.encoding or detect_encoding(path)
    info.encoding = enc
    widths = opts.fixed_widths
    if not widths:
        with open(path, encoding=enc, errors="replace") as f:
            sample = [ln for ln in (f.readline() for _ in range(300)) if ln.strip()]
        widths = _infer_fixed_widths(sample) or [0]
    info.fixed_widths = widths
    bounds = list(zip(widths, widths[1:] + [None], strict=False))
    with open(path, encoding=enc, errors="replace") as f:
        for i, line in enumerate(f, start=1):
            line = line.rstrip("\r\n")
            yield RawRow(i, [line[a:b].strip() if b else line[a:].strip() for a, b in bounds])


def _rows_txt(path: Path, opts: ReadOptions, info: TableInfo) -> Iterator[RawRow]:
    enc = opts.encoding or detect_encoding(path)
    info.encoding = enc
    with open(path, encoding=enc, errors="replace") as f:
        for i, line in enumerate(f, start=1):
            line = line.rstrip("\r\n")
            yield RawRow(i, [c.strip() for c in re.split(r"\s{2,}|\t", line.strip())])


def _rows_xlsx(path: Path, opts: ReadOptions, info: TableInfo) -> Iterator[RawRow]:
    from openpyxl import load_workbook

    fh = open(path, "rb")  # objeto de arquivo: a chave de armazenamento não tem extensão
    wb = load_workbook(fh, read_only=True, data_only=True)
    try:
        info.sheets = wb.sheetnames
        ws = wb[opts.sheet] if opts.sheet and opts.sheet in wb.sheetnames else _largest_sheet_xlsx(wb)
        info.sheet = ws.title
        for i, row in enumerate(ws.iter_rows(values_only=True), start=1):
            yield RawRow(i, [cell_to_str(v) for v in row])
    finally:
        wb.close()
        fh.close()


def _largest_sheet_xlsx(wb):
    best, best_n = wb.worksheets[0], -1
    for ws in wb.worksheets:
        n = ws.max_row or 0
        if n > best_n:
            best, best_n = ws, n
    return best


def _rows_xls(path: Path, opts: ReadOptions, info: TableInfo) -> Iterator[RawRow]:
    import xlrd

    book = xlrd.open_workbook(str(path), on_demand=True)
    try:
        info.sheets = book.sheet_names()
        if opts.sheet and opts.sheet in info.sheets:
            sh = book.sheet_by_name(opts.sheet)
        else:
            sh = max((book.sheet_by_index(i) for i in range(book.nsheets)), key=lambda s: s.nrows)
        info.sheet = sh.name
        for r in range(sh.nrows):
            cells = []
            for c in range(sh.ncols):
                cell = sh.cell(r, c)
                if cell.ctype == xlrd.XL_CELL_DATE:
                    try:
                        cells.append(cell_to_str(xlrd.xldate.xldate_as_datetime(cell.value, book.datemode)))
                    except Exception:  # noqa: BLE001
                        cells.append(cell_to_str(cell.value))
                else:
                    cells.append(cell_to_str(cell.value))
            yield RawRow(r + 1, cells)
    finally:
        book.release_resources()


def _records_to_rows(records: list[dict], info: TableInfo) -> Iterator[RawRow]:
    cols: list[str] = []
    seen = set()
    for rec in records:
        for k in rec:
            if k not in seen:
                seen.add(k)
                cols.append(k)
    yield RawRow(0, cols)
    for i, rec in enumerate(records, start=1):
        yield RawRow(i, [cell_to_str(rec.get(c)) for c in cols])


def _flatten(obj: dict, prefix: str = "") -> dict:
    out = {}
    for k, v in obj.items():
        key = f"{prefix}{k}"
        if isinstance(v, dict):
            out.update(_flatten(v, key + "."))
        elif isinstance(v, list):
            out[key] = json.dumps(v, ensure_ascii=False)
        else:
            out[key] = v
    return out


def _find_record_list(obj) -> list | None:
    if isinstance(obj, list) and obj and all(isinstance(x, dict) for x in obj[:50]):
        return obj
    best = None
    if isinstance(obj, dict):
        for v in obj.values():
            cand = _find_record_list(v)
            if cand and (best is None or len(cand) > len(best)):
                best = cand
    return best


def _rows_json(path: Path, opts: ReadOptions, info: TableInfo) -> Iterator[RawRow]:
    enc = opts.encoding or detect_encoding(path)
    info.encoding = enc
    with open(path, encoding=enc) as f:
        data = json.load(f)
    records = _find_record_list(data)
    if records is None:
        info.warnings.append("JSON sem lista de registros reconhecível")
        return
    yield from _records_to_rows([_flatten(r) for r in records], info)


def _rows_xml(path: Path, opts: ReadOptions, info: TableInfo) -> Iterator[RawRow]:
    from lxml import etree

    # 1ª passada: elemento repetido mais frequente com filhos = registro
    counts: Counter = Counter()
    parser_kwargs = {"resolve_entities": False, "no_network": True, "huge_tree": False}
    for _, el in etree.iterparse(str(path), events=("end",), **parser_kwargs):
        if len(el):
            counts[(el.getparent().tag if el.getparent() is not None else None, el.tag)] += 1
    if not counts:
        info.warnings.append("XML sem registros repetidos")
        return
    (_, record_tag), _ = counts.most_common(1)[0]
    records = []
    for _, el in etree.iterparse(str(path), events=("end",), tag=record_tag, **parser_kwargs):
        rec = {f"@{k}": v for k, v in el.attrib.items()}
        for child in el:
            if isinstance(child.tag, str):
                tag = etree.QName(child).localname
                rec[tag] = (child.text or "").strip()
                for k, v in child.attrib.items():
                    rec[f"{tag}@{k}"] = v
        records.append(rec)
        el.clear()
    info.warnings.append(f"registros lidos do elemento <{etree.QName(record_tag).localname}>")
    yield from _records_to_rows(records, info)


def _rows_html(path: Path, opts: ReadOptions, info: TableInfo) -> Iterator[RawRow]:
    from lxml import html as lhtml

    enc = opts.encoding or detect_encoding(path)
    info.encoding = enc
    with open(path, "rb") as f:
        doc = lhtml.fromstring(f.read().decode(enc, errors="replace"))
    tables = doc.xpath("//table")
    if not tables:
        info.warnings.append("HTML sem tabelas")
        return
    table = max(tables, key=lambda t: len(t.xpath(".//tr")))
    pre = doc.xpath("//body//text()[not(ancestor::table)]")
    info.preamble = [t.strip() for t in pre if t.strip()][:30]
    for i, tr in enumerate(table.xpath(".//tr"), start=1):
        yield RawRow(i, [" ".join(td.text_content().split()) for td in tr.xpath("./th|./td")])


def _rows_pdf(path: Path, opts: ReadOptions, info: TableInfo) -> Iterator[RawRow]:
    import pdfplumber

    n = 0
    confidences = []
    with pdfplumber.open(str(path)) as pdf:
        info.pages = len(pdf.pages)
        for pno, page in enumerate(pdf.pages, start=1):
            text = page.extract_text() or ""
            if len(text.strip()) >= 20:
                tables = page.extract_tables()
                if tables:
                    for t in tables:
                        for row in t:
                            n += 1
                            yield RawRow(n, [cell_to_str(c).replace("\n", " ") for c in row], page=pno, confidence=1.0)
                else:
                    # sem tabela com bordas: separa colunas pelos espaços largos entre palavras
                    for cells in _pdf_word_lines(page):
                        n += 1
                        yield RawRow(n, cells, page=pno, confidence=1.0)
            elif opts.ocr:
                rows, conf = _ocr_page(page, opts.ocr_lang, info)
                if conf is not None:
                    confidences.append(conf)
                for cells, c in rows:
                    n += 1
                    yield RawRow(n, cells, page=pno, confidence=c)
            else:
                info.warnings.append(f"página {pno} sem texto extraível (OCR desativado)")
    if confidences:
        info.ocr_confidence = round(sum(confidences) / len(confidences), 3)


def _pdf_word_lines(page) -> list[list[str]]:
    words = page.extract_words(keep_blank_chars=False, use_text_flow=False, x_tolerance=1.5)
    if not words:
        return []
    char_w = sorted((w["x1"] - w["x0"]) / max(len(w["text"]), 1) for w in words)[len(words) // 2]
    threshold = max(4.5, char_w * 1.15)
    lines: list[list[dict]] = []
    for w in sorted(words, key=lambda w: (round(w["top"]), w["x0"])):
        if lines and abs(lines[-1][0]["top"] - w["top"]) <= 2.5:
            lines[-1].append(w)
        else:
            lines.append([w])
    out = []
    for ln in lines:
        ln.sort(key=lambda w: w["x0"])
        cells, cur, last = [], [], None
        for w in ln:
            if last is not None and w["x0"] - last > threshold:
                cells.append(" ".join(cur))
                cur = []
            cur.append(w["text"])
            last = w["x1"]
        cells.append(" ".join(cur))
        out.append(cells)
    return out


def _ocr_page(page, lang: str, info: TableInfo):
    try:
        import pytesseract
    except ImportError:
        info.warnings.append("OCR indisponível: pacote pytesseract não instalado")
        return [], None
    info.ocr_used = True
    try:
        img = page.to_image(resolution=300).original
        data = pytesseract.image_to_data(img, lang=lang, output_type=pytesseract.Output.DICT)
    except Exception as e:  # noqa: BLE001
        info.warnings.append(f"OCR falhou na página {page.page_number}: {e}")
        return [], None
    lines: dict[tuple, list] = {}
    for i, word in enumerate(data["text"]):
        if not word.strip():
            continue
        key = (data["block_num"][i], data["par_num"][i], data["line_num"][i])
        lines.setdefault(key, []).append((data["left"][i], data["width"][i], word, float(data["conf"][i])))
    out = []
    all_conf = []
    for key in sorted(lines, key=lambda k: min(w[0] for w in lines[k]) * 0 + k[0] * 10000 + k[1] * 100 + k[2]):
        words = sorted(lines[key])
        # nova célula quando o espaço entre palavras é grande (> 2,5× a altura média de um espaço)
        cells, cur, last_end = [], [], None
        for left, width, word, _ in words:
            if last_end is not None and left - last_end > 35:
                cells.append(" ".join(cur))
                cur = []
            cur.append(word)
            last_end = left + width
        if cur:
            cells.append(" ".join(cur))
        confs = [w[3] for w in words if w[3] >= 0]
        c = (sum(confs) / len(confs) / 100) if confs else 0.0
        all_conf.extend(confs)
        out.append((cells, round(c, 3)))
    mean = (sum(all_conf) / len(all_conf) / 100) if all_conf else None
    return out, mean


READERS = {
    "csv": _rows_csv,
    "fixed": _rows_fixed,
    "txt": _rows_txt,
    "xlsx": _rows_xlsx,
    "xls": _rows_xls,
    "json": _rows_json,
    "xml": _rows_xml,
    "html": _rows_html,
    "pdf": _rows_pdf,
}

SUPPORTED_TABULAR = set(READERS)


# ---------------------------------------------------------------- tabela


def detect_header(rows: list[RawRow]) -> int:
    best_i, best_s = -1, 0.0
    for i, r in enumerate(rows[:PREVIEW_SCAN_ROWS]):
        s = header_score(r.cells)
        if s > best_s + 0.01:
            best_i, best_s = i, s
    if best_s >= 3:  # ao menos um sinônimo reconhecido
        return best_i
    # sem sinônimos: primeira linha com a maior quantidade de células de texto
    for i, r in enumerate(rows[:PREVIEW_SCAN_ROWS]):
        non_empty = [c for c in r.cells if c.strip()]
        if len(non_empty) >= 2 and all(not re.fullmatch(r"[\d\s.,:/+-]+", c) for c in non_empty):
            return i
    return -1


def _dedupe_columns(cols: list[str]) -> list[str]:
    out, seen = [], Counter()
    for i, c in enumerate(cols):
        name = c.strip() or f"coluna_{i + 1}"
        seen[name] += 1
        out.append(name if seen[name] == 1 else f"{name}_{seen[name]}")
    return out


class Table:
    """Tabela lógica: informa colunas e itera registros como dicionários."""

    def __init__(self, path: Path, fmt: str, opts: ReadOptions | None = None):
        if fmt not in READERS:
            raise ValueError(f"formato não suportado para leitura tabular: {fmt}")
        self.path = path
        self.fmt = fmt
        self.opts = opts or ReadOptions()
        self.info = TableInfo(fmt=fmt)
        self._prepare()

    def _raw(self) -> Iterator[RawRow]:
        return READERS[self.fmt](self.path, self.opts, self.info)

    def _prepare(self) -> None:
        head: list[RawRow] = []
        it = self._raw()
        for r in it:
            head.append(r)
            if len(head) >= PREVIEW_SCAN_ROWS:
                break
        if self.opts.header_row is not None:
            hdr = self.opts.header_row
        elif self.fmt in ("json", "xml"):
            hdr = 0  # a primeira linha sintética contém os nomes dos campos
        else:
            hdr = detect_header(head)
        self.info.header_row = hdr
        if hdr >= 0 and hdr < len(head):
            self.info.columns = _dedupe_columns(head[hdr].cells)
            preamble = [" ".join(c for c in r.cells if c) for r in head[:hdr]]
            self.info.preamble = (self.info.preamble or []) + [p for p in preamble if p.strip()]
        else:
            width = max((len(r.cells) for r in head), default=0)
            self.info.columns = [f"coluna_{i + 1}" for i in range(width)]
            if head:
                self.info.warnings.append("cabeçalho não identificado; colunas numeradas")

    def rows(self) -> Iterator[tuple[RawRow, dict[str, str]]]:
        cols = self.info.columns
        hdr = self.info.header_row
        header_cells = None
        for i, r in enumerate(self._raw()):
            if i <= hdr:
                if i == hdr:
                    header_cells = [c.strip() for c in r.cells]
                continue
            if not any(c.strip() for c in r.cells):
                continue
            # cabeçalho repetido (comum em PDFs e relatórios paginados)
            if header_cells and [c.strip() for c in r.cells] == header_cells:
                continue
            rec = {}
            for j, c in enumerate(r.cells):
                if j < len(cols):
                    rec[cols[j]] = c
                elif c.strip():
                    rec[f"__extra_{j + 1}"] = c
            yield r, rec

    def sample(self, n: int = 20) -> list[dict]:
        out = []
        for r, rec in self.rows():
            out.append({"_row": r.row_number, "_page": r.page, "_conf": r.confidence, **rec})
            if len(out) >= n:
                break
        return out


def read_text_head(path: Path, nbytes: int = 65536) -> str:
    with open(path, "rb") as f:
        return _decode_sample(f.read(nbytes))


def bytes_io(data: bytes) -> io.BytesIO:
    return io.BytesIO(data)
