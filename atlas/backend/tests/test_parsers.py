"""Leitores de arquivo: separadores, codificações, cabeçalhos, formatos e arquivos inválidos."""
import io
import json
import zipfile
from pathlib import Path

import pytest

from app.parsers.archive import ArchiveError, safe_entries
from app.parsers.fields import suggest_mapping
from app.parsers.readers import ReadOptions, Table, sniff_format

HEADER = ["Número A", "Número B", "Data", "Hora", "Duração", "Tipo", "CI"]
ROWS = [
    ["(61) 99999-0001", "(61) 98888-0002", "01/03/2026", "10:00:00", "00:01:00", "Originada", "20001"],
    ["(61) 98888-0003", "(61) 99999-0001", "01/03/2026", "11:30:15", "00:00:35", "Recebida", "20002"],
]


def write(tmp_path: Path, name: str, data: bytes) -> Path:
    p = tmp_path / name
    p.write_bytes(data)
    return p


def table(p: Path, **opts) -> Table:
    return Table(p, sniff_format(p, p.name), ReadOptions(**opts))


@pytest.mark.parametrize("sep", [";", ",", "\t", "|"])
def test_csv_separators(tmp_path, sep):
    text = "\n".join(sep.join(r) for r in [HEADER] + ROWS)
    p = write(tmp_path, "x.csv", text.encode())
    t = table(p)
    assert t.info.delimiter == sep
    assert t.info.columns == HEADER
    rows = [r for _, r in t.rows()]
    assert rows[1]["Hora"] == "11:30:15"


@pytest.mark.parametrize("enc", ["cp1252", "utf-8-sig", "utf-16", "utf-8"])
def test_encodings(tmp_path, enc):
    text = "\r\n".join(";".join(r) for r in [HEADER] + ROWS)
    p = write(tmp_path, "x.csv", text.encode(enc))
    t = table(p)
    assert "Duração" in t.info.columns, (enc, t.info.columns)


def test_preamble_and_header_detection(tmp_path):
    text = "TIM S.A. - EXTRATO\nLinha: (61) 99999-0001;Período: março\n\n" + "\n".join(";".join(r) for r in [HEADER] + ROWS)
    t = table(write(tmp_path, "x.csv", text.encode()))
    assert t.info.header_row == 3
    assert any("TIM" in p for p in t.info.preamble)
    assert len(list(t.rows())) == 2


def test_missing_header_numbers_columns(tmp_path):
    text = "\n".join(";".join(r) for r in ROWS)
    t = table(write(tmp_path, "x.csv", text.encode()))
    assert t.info.columns[0] == "coluna_1"
    assert len(list(t.rows())) == 2
    t2 = table(write(tmp_path, "y.csv", text.encode()), header_row=-1)
    assert len(list(t2.rows())) == 2


def test_quoted_fields_and_unknown_columns(tmp_path):
    text = 'Data;Hora;Obs;Coluna Estranha\n01/03/2026;10:00:00;"texto; com separador";abc\n'
    t = table(write(tmp_path, "x.csv", text.encode()))
    r = next(t.rows())[1]
    assert r["Obs"] == "texto; com separador"
    m = suggest_mapping(t.info.columns)
    assert m == {"date": "Data", "time": "Hora"}


def test_empty_file(tmp_path):
    assert sniff_format(write(tmp_path, "v.csv", b""), "v.csv") == "empty"


def test_corrupted_xlsx(tmp_path):
    p = write(tmp_path, "c.xlsx", b"PK\x03\x04" + b"lixo" * 100)
    assert sniff_format(p, p.name) in ("unknown", "zip")


def test_xlsx_and_xls(tmp_path):
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.append(["Relatório de demonstração"])
    ws.append(HEADER)
    for r in ROWS:
        ws.append(r)
    b = io.BytesIO()
    wb.save(b)
    t = table(write(tmp_path, "a.xlsx", b.getvalue()))
    assert t.info.fmt == "xlsx" and t.info.columns == HEADER and len(list(t.rows())) == 2

    import datetime

    import xlwt

    book = xlwt.Workbook()
    sh = book.add_sheet("Extrato")
    for c, h in enumerate(HEADER):
        sh.write(0, c, h)
    style = xlwt.easyxf(num_format_str="DD/MM/YYYY")
    sh.write(1, 0, "(61) 99999-0001")
    sh.write(1, 2, datetime.datetime(2026, 3, 1), style)
    sh.write(1, 4, 60)
    b = io.BytesIO()
    book.save(b)
    t = table(write(tmp_path, "b.xls", b.getvalue()))
    assert t.info.fmt == "xls"
    rec = next(t.rows())[1]
    assert rec["Data"].startswith("2026-03-01") and rec["Duração"] == "60"


def test_fixed_width(tmp_path):
    fmt = "{:<20}{:<6}{:<16}{:>8}"
    lines = ["CABECALHO DO DOCUMENTO", "", fmt.format("DATA_HORA", "TIPO", "ORIGEM", "DURACAO")]
    lines += [fmt.format("20260301 101500", "MO", "61999990001", "60"), fmt.format("20260301 111500", "MT", "61988880002", "5")]
    p = write(tmp_path, "f.txt", "\n".join(lines).encode())
    assert sniff_format(p, p.name) == "fixed"
    t = table(p)
    assert t.info.columns == ["DATA_HORA", "TIPO", "ORIGEM", "DURACAO"]
    assert next(t.rows())[1]["DATA_HORA"] == "20260301 101500"


def test_json_and_xml_and_html(tmp_path):
    data = {"meta": {"op": "x"}, "registros": [{"data": "01/03/2026", "hora": "10:00", "origem": "61999990001", "extra": {"ci": 1}}]}
    t = table(write(tmp_path, "a.json", json.dumps(data).encode()))
    assert set(t.info.columns) >= {"data", "hora", "origem", "extra.ci"}
    xml = b"<?xml version='1.0'?><extrato><chamada id='1'><data>01/03/2026</data><hora>10:00</hora></chamada><chamada id='2'><data>02/03/2026</data><hora>11:00</hora></chamada></extrato>"
    t = table(write(tmp_path, "a.xml", xml))
    rows = [r for _, r in t.rows()]
    assert len(rows) == 2 and rows[1]["data"] == "02/03/2026" and rows[0]["@id"] == "1"
    html = "<html><body><p>Extrato</p><table><tr><th>Data</th><th>Hora</th></tr><tr><td>01/03/2026</td><td>10:00</td></tr></table></body></html>"
    t = table(write(tmp_path, "a.html", html.encode()))
    assert t.info.columns == ["Data", "Hora"] and len(list(t.rows())) == 1


def test_xml_external_entities_are_not_resolved(tmp_path):
    secret = tmp_path / "segredo.txt"
    secret.write_text("NAO-DEVE-APARECER")
    xml = f"<?xml version='1.0'?><!DOCTYPE r [<!ENTITY x SYSTEM 'file://{secret}'>]><r><a><v>&x;</v></a><a><v>2</v></a></r>"
    t = table(write(tmp_path, "x.xml", xml.encode()))
    assert all("NAO-DEVE-APARECER" not in json.dumps(r) for _, r in t.rows())


def _pdf_with_table(path: Path):
    from reportlab.lib.pagesizes import A4
    from reportlab.platypus import SimpleDocTemplate, Table as T

    SimpleDocTemplate(str(path), pagesize=A4).build([T([HEADER] + ROWS)])


def test_pdf_text(tmp_path):
    p = tmp_path / "t.pdf"
    _pdf_with_table(p)
    t = table(p)
    assert t.info.fmt == "pdf" and not t.info.ocr_used
    rows = [r for _, r in t.rows()]
    assert len(rows) == 2 and rows[0]["Data"] == "01/03/2026"


def test_pdf_scanned_needs_ocr(tmp_path):
    import shutil

    if not shutil.which("tesseract"):
        pytest.skip("tesseract não instalado")
    from PIL import Image, ImageDraw, ImageFont

    img = Image.new("RGB", (2400, 600), "white")
    d = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 44)
    except OSError:
        pytest.skip("fonte indisponível")
    for i, line in enumerate([("Data", "Hora", "Origem"), ("01/03/2026", "10:00:00", "61999990001"), ("02/03/2026", "11:30:00", "61988880002")]):
        for j, cell in enumerate(line):
            d.text((60 + j * 700, 60 + i * 140), cell, fill="black", font=font)
    p = tmp_path / "scan.pdf"
    img.save(p, "PDF", resolution=200)
    t = table(p)
    assert t.info.ocr_used
    rows = [(raw, r) for raw, r in t.rows()]
    assert len(rows) == 2
    assert rows[0][1]["Data"] == "01/03/2026"
    assert rows[0][0].confidence is not None and 0 < rows[0][0].confidence <= 1


def test_zip_safety(tmp_path):
    good = tmp_path / "ok.zip"
    with zipfile.ZipFile(good, "w") as z:
        z.writestr("a.csv", "x;y\n1;2\n")
        z.writestr("../../escape.csv", "x\n")
        z.writestr("__MACOSX/lixo", "x")
    names = [n for n, _ in safe_entries(good)]
    assert names == ["a.csv"]
    bomb = tmp_path / "bomb.zip"
    with zipfile.ZipFile(bomb, "w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr("b.csv", b"0" * (20 * 1024 * 1024))
    with pytest.raises(ArchiveError):
        list(safe_entries(bomb))
