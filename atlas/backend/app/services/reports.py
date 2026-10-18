"""Gerador de relatórios técnicos rastreáveis (PDF, XLSX, CSV, JSON, HTML).

O relatório é um retrato congelado: os dados são coletados no momento da geração,
gravados num manifesto JSON e no arquivo final, cujo SHA-256 fica registrado.
Correções posteriores em registros não alteram relatórios já emitidos.
"""
from __future__ import annotations

import csv
import html
import io
import json
import math
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import APP_VERSION, RULES_VERSION
from ..models import Case, ErbRegistryVersion, Import, Report, ResolutionRun, SourceFile, Target, User
from . import analytics as A
from .normalize import EVENT_TYPES, format_number

LIMITATIONS = [
    "Os resultados refletem exclusivamente os registros contidos nos arquivos fornecidos e importados; ausência de registro não significa ausência de comunicação.",
    "A ERB/célula registrada em um evento não comprova a posição exata do aparelho ou da pessoa. Coordenadas indicadas são da estação, e setores são representações esquemáticas, não cobertura real comprovada.",
    "Frequência de comunicação, contatos em comum e coincidências temporais são observações estatísticas e não constituem, isoladamente, prova de vínculo pessoal, de presença física conjunta ou de participação em fato ilícito.",
    "Horários são exibidos conforme o documento de origem. Eventos com fuso horário não confirmado estão sinalizados e devem ser interpretados com cautela em comparações entre fontes.",
    "Registros duplicados e fora do período autorizado foram excluídos das estatísticas, salvo indicação em contrário nos critérios.",
    "Hashes SHA-256 verificam a integridade dos arquivos recebidos, mas não comprovam, por si sós, a autenticidade da origem.",
]

SECTIONS = {
    "cdr": ["escopo", "fontes", "metodologia", "estatisticas", "graficos", "contatos", "eventos", "limitacoes", "rastreabilidade"],
    "erb": ["escopo", "fontes", "cadastro", "resolucao", "celulas", "mapa", "sequencia", "inconsistencias", "limitacoes", "rastreabilidade"],
    "links": ["escopo", "fontes", "vinculos", "grafo", "contatos_comuns", "limitacoes", "rastreabilidade"],
}
SECTIONS["full"] = list(dict.fromkeys(SECTIONS["cdr"] + SECTIONS["erb"] + SECTIONS["links"]))


def collect(db: Session, case: Case, report_type: str, f: A.EventFilter, opts: dict, user: User) -> dict:
    sections = opts.get("sections") or SECTIONS[report_type]
    max_events = int(opts.get("max_events", 2000))
    data: dict = {"sections": sections}
    data["case"] = {
        "id": case.id, "code": case.code, "title": case.title, "process_number": case.process_number, "unit": case.unit,
        "period_start": case.period_start.isoformat() if case.period_start else None,
        "period_end": case.period_end.isoformat() if case.period_end else None,
        "description": case.description, "authorized_docs": case.authorized_docs, "is_demo": case.is_demo,
    }
    data["targets"] = [
        {"number": t.number_normalized, "original": t.number_original, "operator": t.operator, "label": t.label,
         "internal_id": t.internal_id, "period": [t.period_start.isoformat() if t.period_start else None, t.period_end.isoformat() if t.period_end else None]}
        for t in db.execute(select(Target).where(Target.case_id == case.id)).scalars()
    ]
    summ = A.summary(db, case.id, f)
    data["summary"] = summ
    file_ids = [s["id"] for s in summ["sources"]]
    files = db.execute(select(SourceFile).where(SourceFile.case_id == case.id)).scalars().all()
    used = [x for x in files if x.id in file_ids or (report_type in ("erb", "full") and x.kind == "erb_registry")]
    data["files"] = [
        {"id": x.id, "name": x.original_name, "sha256": x.sha256, "size": x.size_bytes, "format": x.detected_format,
         "kind": x.kind, "operator": x.operator_declared or x.operator_detected, "received_at": x.uploaded_at.isoformat()}
        for x in used
    ]
    imps = db.execute(select(Import).where(Import.case_id == case.id, Import.status == "done")).scalars().all()
    data["imports"] = [
        {"id": i.id, "file_id": i.file_id, "kind": i.kind, "mapping": i.mapping,
         "options": {k: v for k, v in (i.options or {}).items() if not k.startswith("_")},
         "rows_total": i.rows_total, "rows_ok": i.rows_ok, "rows_error": i.rows_error, "rows_duplicate": i.rows_duplicate,
         "rows_out_of_scope": i.rows_out_of_scope, "rules_version": i.rules_version}
        for i in imps if i.file_id in {x["id"] for x in data["files"]}
    ]
    if report_type in ("cdr", "full"):
        data["contacts"] = A.contacts(db, case.id, f, limit=100)
        if "eventos" in sections:
            data["events"] = list(A.iter_events(db, case.id, f, limit=max_events))
            data["events_truncated"] = summ["totals"]["events"] > max_events
    if report_type in ("erb", "full"):
        data["cells"] = A.cells(db, case.id, f, limit=300)
        data["registry_versions"] = [
            {"id": v.id, "name": v.name, "operator": v.operator, "reference_date": v.reference_date.isoformat() if v.reference_date else None, "rows": v.rows}
            for v in db.execute(select(ErbRegistryVersion).where(ErbRegistryVersion.case_id == case.id)).scalars()
        ]
        run = db.execute(select(ResolutionRun).where(ResolutionRun.case_id == case.id).order_by(ResolutionRun.id.desc())).scalar()
        data["resolution_run"] = {"id": run.id, "result": run.result, "created_at": run.created_at.isoformat()} if run else None
        data["geo"] = A.geo_points(db, case.id, f)
        data["sequence"] = A.cell_sequence(db, case.id, f, limit=500)
        reg = A.registry(db, case.id, None, None, None, 1, 1)
        data["registry_status"] = reg["status_counts"]
    if report_type in ("links", "full"):
        data["graph"] = A.link_graph(db, case.id, f, center=opts.get("center"), depth=int(opts.get("depth", 2)), min_events=int(opts.get("min_events", 1)), max_edges=400)
        nums = A._norm_list(f.targets or f.numbers) or [t["number"] for t in data["targets"]]
        data["common"] = A.common_contacts(db, case.id, nums, f)
    data["criteria"] = A.criteria(f)
    data["limitations"] = LIMITATIONS
    data["generated"] = {
        "at": datetime.now(UTC).isoformat(), "by": user.name, "by_email": user.email,
        "app_version": APP_VERSION, "rules_version": RULES_VERSION,
    }
    return data


# ================================================================== PDF


def _fonts():
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont

    base = Path("/usr/share/fonts/truetype/dejavu")
    try:
        if "DejaVu" not in pdfmetrics.getRegisteredFontNames():
            pdfmetrics.registerFont(TTFont("DejaVu", str(base / "DejaVuSans.ttf")))
            pdfmetrics.registerFont(TTFont("DejaVu-Bold", str(base / "DejaVuSans-Bold.ttf")))
            pdfmetrics.registerFont(TTFont("DejaVuMono", str(base / "DejaVuSansMono.ttf")))
        return "DejaVu", "DejaVu-Bold", "DejaVuMono"
    except Exception:  # noqa: BLE001
        return "Helvetica", "Helvetica-Bold", "Courier"


def _fmt_dt(v: str | None) -> str:
    if not v:
        return "—"
    try:
        d = datetime.fromisoformat(v)
        return d.strftime("%d/%m/%Y %H:%M:%S") if (d.hour or d.minute or d.second or "T" in v or " " in v) else d.strftime("%d/%m/%Y")
    except ValueError:
        return v


def _dur(s) -> str:
    if s is None:
        return "—"
    s = int(s)
    return f"{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}"


def render_pdf(data: dict, report: Report) -> bytes:
    from reportlab.graphics.charts.barcharts import VerticalBarChart
    from reportlab.graphics.shapes import Circle, Drawing, Line, Rect, String, Wedge
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_CENTER
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import (
        KeepTogether,
        PageBreak,
        Paragraph,
        SimpleDocTemplate,
        Spacer,
        Table,
        TableStyle,
    )

    font, bold, mono = _fonts()
    navy = colors.HexColor("#0b1220")
    blue = colors.HexColor("#2f6fdf")
    teal = colors.HexColor("#14b8a6")
    grey = colors.HexColor("#5b6578")
    ss = getSampleStyleSheet()
    st = {
        "title": ParagraphStyle("t", parent=ss["Title"], fontName=bold, fontSize=22, leading=28, textColor=navy, alignment=TA_CENTER),
        "sub": ParagraphStyle("s", parent=ss["Normal"], fontName=font, fontSize=11, leading=15, textColor=grey, alignment=TA_CENTER),
        "h1": ParagraphStyle("h1", parent=ss["Heading1"], fontName=bold, fontSize=14, leading=18, textColor=blue, spaceBefore=10, spaceAfter=6),
        "h2": ParagraphStyle("h2", parent=ss["Heading2"], fontName=bold, fontSize=11, leading=14, textColor=navy, spaceBefore=6, spaceAfter=4),
        "p": ParagraphStyle("p", parent=ss["Normal"], fontName=font, fontSize=9, leading=12.5),
        "small": ParagraphStyle("sm", parent=ss["Normal"], fontName=font, fontSize=7.5, leading=10, textColor=grey),
        "mono": ParagraphStyle("m", parent=ss["Normal"], fontName=mono, fontSize=7, leading=9),
        "cell": ParagraphStyle("c", parent=ss["Normal"], fontName=font, fontSize=7, leading=8.5),
    }
    case = data["case"]
    gen = data["generated"]

    def P(t, s="p"):
        return Paragraph(html.escape(str(t)).replace("\n", "<br/>"), st[s])

    def table(rows, widths=None, header=True, font_size=7):
        t = Table([[c if not isinstance(c, str) else Paragraph(html.escape(c), st["cell"]) for c in r] for r in rows], colWidths=widths, repeatRows=1 if header else 0)
        style = [
            ("FONT", (0, 0), (-1, -1), font, font_size),
            ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#c9d2e3")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f3f6fb")]),
        ]
        if header:
            style += [("BACKGROUND", (0, 0), (-1, 0), navy), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white)]
        t.setStyle(TableStyle(style))
        return t

    def header_row(cells):
        return [Paragraph(f"<font color='white'><b>{html.escape(c)}</b></font>", st["cell"]) for c in cells]

    def on_page(canvas, doc):
        canvas.saveState()
        w, h = A4
        canvas.setFillColor(navy)
        canvas.rect(0, h - 14 * mm, w, 14 * mm, stroke=0, fill=1)
        canvas.setFillColor(colors.white)
        canvas.setFont(bold, 9)
        canvas.drawString(15 * mm, h - 9 * mm, "iaMARX · TELECOM INTELLIGENCE")
        canvas.setFont(font, 8)
        canvas.drawRightString(w - 15 * mm, h - 9 * mm, f"Caso {case['code']} · Relatório {report.code}")
        canvas.setFillColor(grey)
        canvas.setFont(font, 7)
        canvas.drawString(15 * mm, 9 * mm, f"Gerado em {_fmt_dt(gen['at'][:19])} UTC por {gen['by']} · v{gen['app_version']} · regras {gen['rules_version']}")
        canvas.drawRightString(w - 15 * mm, 9 * mm, f"Página {doc.page}")
        if case.get("is_demo"):
            canvas.setFillColor(colors.Color(0.9, 0.3, 0.2, alpha=0.12))
            canvas.setFont(bold, 60)
            canvas.translate(w / 2, h / 2)
            canvas.rotate(35)
            canvas.drawCentredString(0, 0, "DEMONSTRAÇÃO")
        canvas.restoreState()

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm, topMargin=20 * mm, bottomMargin=16 * mm,
                            title=report.title, author=gen["by"], subject=f"Caso {case['code']}")
    W = A4[0] - 30 * mm
    story = []
    # ---------------- capa
    story += [Spacer(1, 45 * mm), P("iaMARX · TELECOM INTELLIGENCE", "sub"), Spacer(1, 6 * mm), Paragraph(html.escape(report.title), st["title"]), Spacer(1, 4 * mm)]
    story.append(P(f"Caso {case['code']} — {case['title']}", "sub"))
    if case.get("process_number"):
        story.append(P(f"Referência processual: {case['process_number']}", "sub"))
    story += [Spacer(1, 20 * mm)]
    cover = [
        ["Relatório", report.code], ["Tipo", {"cdr": "Bilhetagem", "erb": "ERB", "links": "Vínculos", "full": "Completo"}[report.report_type]],
        ["Unidade", case.get("unit") or "—"], ["Responsável pela análise", gen["by"]],
        ["Data de geração", _fmt_dt(gen["at"][:19]) + " UTC"], ["Versão do sistema / regras", f"{gen['app_version']} / {gen['rules_version']}"],
    ]
    if case.get("is_demo"):
        cover.append(["Natureza dos dados", "DEMONSTRAÇÃO — dados sintéticos, sem valor investigativo"])
    story.append(table(cover, [55 * mm, W - 55 * mm], header=False, font_size=9))
    story.append(PageBreak())
    # ---------------- sumário
    names = {
        "escopo": "Identificação e escopo", "fontes": "Arquivos utilizados", "metodologia": "Metodologia de importação",
        "estatisticas": "Estatísticas principais", "graficos": "Distribuição temporal", "contatos": "Contatos mais frequentes",
        "eventos": "Tabela de eventos", "cadastro": "Cadastro técnico de ERB", "resolucao": "Critérios de correspondência de ERB",
        "celulas": "Eventos por célula", "mapa": "Representação esquemática das estações", "sequencia": "Sequência temporal de células",
        "inconsistencias": "Inconsistências", "vinculos": "Relacionamentos documentados", "grafo": "Grafo de contatos",
        "contatos_comuns": "Contatos em comum", "limitacoes": "Limitações dos dados", "rastreabilidade": "Rastreabilidade",
    }
    secs = data["sections"]
    story.append(Paragraph("Sumário", st["h1"]))
    for i, s in enumerate(secs, 1):
        story.append(P(f"{i}. {names.get(s, s)}"))
    story.append(Spacer(1, 6 * mm))
    num = {s: i for i, s in enumerate(secs, 1)}

    def H(s):
        return Paragraph(f"{num[s]}. {html.escape(names[s])}", st["h1"])

    tot = data["summary"]["totals"]
    for s in secs:
        if s == "escopo":
            story.append(H(s))
            rows = [["Caso", f"{case['code']} — {case['title']}"], ["Período autorizado", f"{_fmt_dt(case['period_start'])} a {_fmt_dt(case['period_end'])}"],
                    ["Documentos de referência", case.get("authorized_docs") or "—"], ["Descrição", case.get("description") or "—"]]
            story.append(table(rows, [45 * mm, W - 45 * mm], header=False))
            story.append(Spacer(1, 3 * mm))
            story.append(Paragraph("Números analisados", st["h2"]))
            rows = [header_row(["Número", "Original", "Identificação", "Operadora informada", "Período"])]
            for t in data["targets"]:
                rows.append([format_number(t["number"]), t["original"], t["label"] or t["internal_id"] or "—", t["operator"] or "—",
                             f"{_fmt_dt(t['period'][0])} a {_fmt_dt(t['period'][1])}"])
            story.append(table(rows, [30 * mm, 30 * mm, 45 * mm, 30 * mm, W - 135 * mm]))
            story.append(P(f"Critérios: {json.dumps(data['criteria']['filters'], ensure_ascii=False) or 'sem filtros adicionais'}", "small"))
        elif s == "fontes":
            story.append(H(s))
            rows = [header_row(["#", "Arquivo", "Tipo", "Operadora", "Formato", "SHA-256"])]
            for x in data["files"]:
                rows.append([str(x["id"]), x["name"], "cadastro ERB" if x["kind"] == "erb_registry" else "bilhetagem", x["operator"] or "—", x["format"], Paragraph(x["sha256"], st["mono"])])
            story.append(table(rows, [8 * mm, 50 * mm, 22 * mm, 20 * mm, 14 * mm, W - 114 * mm]))
        elif s == "metodologia":
            story.append(H(s))
            story.append(P("Cada arquivo foi preservado sem alterações (SHA-256 calculado no recebimento) e processado a partir de uma cópia de leitura. As colunas foram associadas aos campos padronizados conforme o mapeamento abaixo, confirmado pelo analista. Valores originais permanecem armazenados junto aos normalizados."))
            for i in data["imports"]:
                if i["kind"] != "cdr":
                    continue
                story.append(Paragraph(f"Importação #{i['id']} (arquivo #{i['file_id']})", st["h2"]))
                mp = ", ".join(f"{k} ← “{v}”" for k, v in i["mapping"].items() if v)
                o = i["options"]
                story.append(P(f"Mapeamento: {mp}", "small"))
                story.append(P(f"Fuso: {o.get('tz_mode', 'unknown')} ({o.get('tz_name') or 'não informado'}) · formato de data: {o.get('date_format') or o.get('datetime_format') or 'automático'} · "
                               f"linhas: {i['rows_total']} lidas, {i['rows_ok']} aceitas, {i['rows_error']} rejeitadas, {i['rows_duplicate']} duplicadas, {i['rows_out_of_scope']} fora do período · regras {i['rules_version']}", "small"))
        elif s == "estatisticas":
            story.append(H(s))
            rows = [
                ["Eventos considerados", f"{tot['events']}"], ["Chamadas de voz", f"{tot['calls']} (sem duração: {tot['zero_duration_calls']})"],
                ["SMS", f"{tot['sms']}"], ["Sessões de dados", f"{tot['data_sessions']}"],
                ["Originados / recebidos", f"{tot['outgoing']} / {tot['incoming']}"],
                ["Duração total das chamadas", _dur(tot["call_seconds"])], ["Duração média / mediana (chamadas > 0 s)", f"{_dur(tot['call_avg'])} / {_dur(tot['call_median'])}"],
                ["Dias com atividade", f"{tot['active_days']}"], ["Contatos distintos", f"{tot['distinct_contacts']}"],
                ["Células distintas", f"{tot['distinct_cells']}"], ["IMEIs distintos", f"{tot['distinct_imeis']}"],
                ["Primeiro / último evento", f"{_fmt_dt(tot['first_event'])} / {_fmt_dt(tot['last_event'])}"],
                ["Eventos com fuso não confirmado", f"{tot['tz_not_confirmed']}"],
                ["Excluídos: duplicados / fora do período", f"{data['summary']['excluded']['duplicates']} / {data['summary']['excluded']['out_of_scope']}"],
            ]
            story.append(table(rows, [80 * mm, W - 80 * mm], header=False, font_size=8))
            story.append(P(data["summary"]["criteria"].get("duration_rule", ""), "small"))
            rows = [header_row(["Tipo de evento", "Quantidade"])] + [[r["label"], str(r["n"])] for r in data["summary"]["by_type"]]
            story.append(Spacer(1, 3 * mm))
            story.append(table(rows, [90 * mm, 30 * mm]))
        elif s == "graficos":
            story.append(H(s))
            for title, series, keyf, labf in (
                ("Eventos por hora do dia (horário do documento)", data["summary"]["by_hour"], "hour", lambda r: f"{r['hour']:02d}"),
                ("Eventos por dia da semana", data["summary"]["by_weekday"], "weekday", lambda r: ["", "seg", "ter", "qua", "qui", "sex", "sáb", "dom"][r["weekday"]]),
            ):
                if not series:
                    continue
                d = Drawing(W, 55 * mm)
                ch = VerticalBarChart()
                ch.x, ch.y, ch.width, ch.height = 10 * mm, 8 * mm, W - 20 * mm, 40 * mm
                ch.data = [[r["n"] for r in series]]
                ch.categoryAxis.categoryNames = [labf(r) for r in series]
                ch.categoryAxis.labels.fontName = font
                ch.categoryAxis.labels.fontSize = 6
                ch.valueAxis.labels.fontName = font
                ch.valueAxis.labels.fontSize = 6
                ch.bars[0].fillColor = blue
                ch.bars[0].strokeColor = None
                d.add(ch)
                d.add(String(0, 52 * mm, title, fontName=bold, fontSize=8, fillColor=navy))
                story.append(d)
            days = data["summary"]["by_day"]
            if days:
                d = Drawing(W, 50 * mm)
                maxn = max(r["n"] for r in days) or 1
                bw = (W - 10 * mm) / len(days)
                for i, r in enumerate(days):
                    hgt = (r["n"] / maxn) * 38 * mm
                    d.add(Rect(5 * mm + i * bw, 6 * mm, max(bw - 0.5, 0.4), hgt, fillColor=teal, strokeColor=None))
                d.add(String(0, 47 * mm, f"Eventos por dia — {_fmt_dt(days[0]['day'])} a {_fmt_dt(days[-1]['day'])} (máx. {maxn}/dia)", fontName=bold, fontSize=8, fillColor=navy))
                story.append(d)
        elif s == "contatos" and data.get("contacts"):
            story.append(H(s))
            rows = [header_row(["Alvo", "Interlocutor", "Eventos", "Dias", "Orig.", "Rec.", "Chamadas", "SMS", "Duração", "Primeiro", "Último"])]
            for r in data["contacts"]["items"][:60]:
                rows.append([format_number(r["target_number"]), format_number(r["other_number"]), str(r["events"]), str(r["days"]), str(r["outgoing"]), str(r["incoming"]),
                             str(r["calls"]), str(r["sms"]), _dur(r["call_seconds"]), _fmt_dt(r["first_event"]), _fmt_dt(r["last_event"])])
            story.append(table(rows, [24 * mm, 24 * mm, 12 * mm, 10 * mm, 10 * mm, 10 * mm, 13 * mm, 10 * mm, 15 * mm, 21 * mm, W - 149 * mm]))
            story.append(P(data["contacts"]["criteria"]["note"], "small"))
        elif s == "eventos" and data.get("events") is not None:
            story.append(H(s))
            if data.get("events_truncated"):
                story.append(P(f"Exibidos os primeiros {len(data['events'])} eventos de {tot['events']}. A relação completa acompanha a exportação XLSX/CSV.", "small"))
            rows = [header_row(["ID", "Data/hora", "Fuso", "Tipo", "Origem", "Destino", "Dur.", "Célula", "Fonte"])]
            for e in data["events"]:
                rows.append([str(e["id"]), _fmt_dt(e["ts_local"]), {"confirmed": "conf.", "assumed": "pres.", "unknown": "desc."}.get(e["tz_status"], ""),
                             EVENT_TYPES.get(e["event_type"], e["event_type"]), format_number(e["a_number"]), format_number(e["b_number"]),
                             _dur(e["duration_s"]), e["cell_key"] or "—", f"#{e['file_id']} l.{e['row_number'] or '?'}" + (f" p.{e['page']}" if e.get("page") else "")])
            story.append(table(rows, [12 * mm, 26 * mm, 10 * mm, 24 * mm, 24 * mm, 24 * mm, 13 * mm, 32 * mm, W - 165 * mm], font_size=6.5))
        elif s == "cadastro" and data.get("registry_versions") is not None:
            story.append(H(s))
            rows = [header_row(["Versão", "Nome", "Operadora", "Data de referência", "Linhas"])]
            for v in data["registry_versions"]:
                rows.append([str(v["id"]), v["name"], v["operator"] or "—", _fmt_dt(v["reference_date"]), str(v["rows"])])
            story.append(table(rows, [15 * mm, 70 * mm, 25 * mm, 30 * mm, W - 140 * mm]))
            if data.get("registry_status"):
                story.append(P("Situação das linhas do cadastro: " + ", ".join(f"{r['validation_status']}: {r['n']}" for r in data["registry_status"]), "small"))
        elif s == "resolucao" and "cells" in data:
            story.append(H(s))
            from .erb import __doc__ as erbdoc

            story.append(P((erbdoc or "").strip(), "small"))
            run = data.get("resolution_run")
            if run:
                r = run["result"]
                story.append(P(f"Última execução: {_fmt_dt(run['created_at'][:19])} · assinaturas de célula avaliadas: {r.get('signatures')} · eventos por resultado: "
                               + ", ".join(f"{k}: {v}" for k, v in (r.get("by_status_events") or {}).items())))
            else:
                story.append(P("A resolução de ERB não foi executada neste caso."))
        elif s == "celulas" and data.get("cells"):
            story.append(H(s))
            rows = [header_row(["Célula (chave)", "Eventos", "Números", "Resolução", "Estação", "Lat", "Lon", "Az.", "Primeiro", "Último"])]
            for c in data["cells"]["items"][:80]:
                rows.append([c["cell_key"], str(c["events"]), str(c["numbers"]), c["resolution_status"] or "pendente", c["site_name"] or c["site_code"] or "—",
                             f"{c['lat']:.5f}" if c["lat"] is not None else "—", f"{c['lon']:.5f}" if c["lon"] is not None else "—",
                             f"{c['azimuth']:.0f}" if c["azimuth"] is not None else "—", _fmt_dt(c["first_event"]), _fmt_dt(c["last_event"])])
            story.append(table(rows, [36 * mm, 12 * mm, 12 * mm, 16 * mm, 26 * mm, 16 * mm, 16 * mm, 8 * mm, 20 * mm, W - 162 * mm], font_size=6))
            story.append(P(data["cells"]["criteria"]["limit_note"], "small"))
        elif s == "mapa" and data.get("geo"):
            pts = data["geo"]["registry_points"] + data["geo"]["document_points"]
            story.append(H(s))
            if not pts:
                story.append(P("Não há coordenadas válidas resolvidas para os eventos selecionados."))
            else:
                size = min(W, 150 * mm)
                d = Drawing(size, size)
                lats = [p["lat"] for p in pts]
                lons = [p["lon"] for p in pts]
                la0, la1, lo0, lo1 = min(lats), max(lats), min(lons), max(lons)
                span = max(la1 - la0, (lo1 - lo0) * math.cos(math.radians((la0 + la1) / 2)), 0.002)
                maxe = max(p["events"] for p in pts)
                d.add(Rect(0, 0, size, size, fillColor=colors.HexColor("#f3f6fb"), strokeColor=colors.HexColor("#c9d2e3")))

                def xy(lat, lon):
                    x = 10 + (lon - lo0) * math.cos(math.radians((la0 + la1) / 2)) / span * (size - 20)
                    y = 10 + (lat - la0) / span * (size - 20)
                    return x, y

                for p in pts:
                    x, y = xy(p["lat"], p["lon"])
                    r = 2 + 8 * math.sqrt(p["events"] / maxe)
                    if p.get("azimuth") is not None:
                        bw = p.get("beamwidth") or 65
                        a0 = 90 - p["azimuth"] - bw / 2
                        d.add(Wedge(x, y, r * 2.2, a0, a0 + bw, fillColor=colors.Color(0.18, 0.43, 0.87, alpha=0.18), strokeColor=None))
                    d.add(Circle(x, y, r, fillColor=colors.Color(0.08, 0.72, 0.65, alpha=0.7), strokeColor=navy, strokeWidth=0.3))
                d.add(Line(size - 30, 15, size - 30, 30, strokeColor=navy))
                d.add(String(size - 33, 32, "N", fontName=bold, fontSize=8))
                story.append(d)
                story.append(P(f"Representação esquemática sem escala cartográfica: {len(pts)} pontos; área do círculo proporcional à quantidade de eventos; cunhas indicam o azimute declarado do setor (abertura padrão de 65° quando não informada). "
                               + data["geo"]["criteria"]["limit_note"], "small"))
        elif s == "sequencia" and data.get("sequence"):
            story.append(H(s))
            seq = data["sequence"]["items"][:200]
            rows = [header_row(["Data/hora", "Número", "Tipo", "Célula", "Estação", "Intervalo", "Fonte coord."])]
            for r in seq:
                rows.append([_fmt_dt(r["ts_local"]), format_number(r["target_number"]), EVENT_TYPES.get(r["event_type"], r["event_type"]), r["cell_key"] or "—",
                             r["site_name"] or "—", _dur(r["interval_s"]) if r["interval_s"] is not None else "—", r["coord_source"] or "sem coordenada"])
            story.append(table(rows, [28 * mm, 26 * mm, 24 * mm, 40 * mm, 26 * mm, 16 * mm, W - 160 * mm], font_size=6.5))
            story.append(P(data["sequence"]["criteria"]["note"], "small"))
        elif s == "inconsistencias" and "cells" in data:
            story.append(H(s))
            res = {r["status"]: r["n"] for r in data["cells"]["resolution"]}
            story.append(P(f"Eventos por resultado de resolução: {', '.join(f'{k}: {v}' for k, v in res.items()) or '—'}. Eventos sem identificador de célula: {data['cells']['events_without_cell']}."))
            unresolved = [c for c in data["cells"]["items"] if c["resolution_status"] in ("none", "ambiguous", None)]
            if unresolved:
                rows = [header_row(["Célula", "Eventos", "Situação", "Motivo"])]
                for c in unresolved[:60]:
                    rows.append([c["cell_key"], str(c["events"]), c["resolution_status"] or "pendente", c["resolution_note"] or "—"])
                story.append(table(rows, [45 * mm, 15 * mm, 20 * mm, W - 80 * mm]))
        elif s == "vinculos" and data.get("graph"):
            story.append(H(s))
            g = data["graph"]
            rows = [header_row(["Número 1", "Número 2", "Eventos", "Dias", "1→2", "2→1", "Recíproca", "Duração", "Primeiro", "Último", "Arquivos"])]
            for e in g["edges"][:80]:
                rows.append([format_number(e["n1"]), format_number(e["n2"]), str(e["events"]), str(e["days"]), str(e["n1_to_n2"]), str(e["n2_to_n1"]),
                             "sim" if e["reciprocal"] else "não", _dur(e["call_seconds"]), _fmt_dt(e["first_event"]), _fmt_dt(e["last_event"]), ", ".join(f"#{x}" for x in e["file_ids"])])
            story.append(table(rows, [24 * mm, 24 * mm, 12 * mm, 10 * mm, 9 * mm, 9 * mm, 13 * mm, 15 * mm, 20 * mm, 20 * mm, W - 156 * mm], font_size=6.3))
            story.append(P(g["criteria"]["note"], "small"))
        elif s == "grafo" and data.get("graph"):
            story.append(H(s))
            g = data["graph"]
            nodes = sorted(g["nodes"], key=lambda n: (not n["is_target"], -n["events"]))[:60]
            ids = {n["id"] for n in nodes}
            size = min(W, 160 * mm)
            d = Drawing(size, size)
            cx = cy = size / 2
            tg = [n for n in nodes if n["is_target"]]
            ot = [n for n in nodes if not n["is_target"]]
            pos = {}
            for i, n in enumerate(tg):
                ang = 2 * math.pi * i / max(len(tg), 1)
                rr = 0 if len(tg) == 1 else size * 0.16
                pos[n["id"]] = (cx + rr * math.cos(ang), cy + rr * math.sin(ang))
            for i, n in enumerate(ot):
                ang = 2 * math.pi * i / max(len(ot), 1)
                pos[n["id"]] = (cx + size * 0.42 * math.cos(ang), cy + size * 0.42 * math.sin(ang))
            maxe = max((e["events"] for e in g["edges"]), default=1)
            for e in g["edges"]:
                if e["n1"] in ids and e["n2"] in ids:
                    (x1, y1), (x2, y2) = pos[e["n1"]], pos[e["n2"]]
                    d.add(Line(x1, y1, x2, y2, strokeColor=teal if e["reciprocal"] else colors.HexColor("#9aa7bd"), strokeWidth=0.4 + 2.5 * e["events"] / maxe))
            for n in nodes:
                x, y = pos[n["id"]]
                d.add(Circle(x, y, 6 if n["is_target"] else 3.5, fillColor=blue if n["is_target"] else (colors.HexColor("#f59e0b") if n["common_to_targets"] > 1 else colors.HexColor("#cbd5e1")), strokeColor=navy, strokeWidth=0.4))
                d.add(String(x + 5, y + 4, format_number(n["id"]) + (f" ({n['label']})" if n.get("label") else ""), fontName=font, fontSize=5))
            story.append(d)
            story.append(P("Azul: números alvo; âmbar: contatos em comum a dois ou mais alvos; linhas verde-água: comunicação nos dois sentidos; espessura proporcional à quantidade de eventos.", "small"))
        elif s == "contatos_comuns" and data.get("common"):
            story.append(H(s))
            c = data["common"]
            nums = c["numbers"]
            rows = [header_row(["Contato"] + [format_number(n) for n in nums] + ["Total"])]
            for r in c["shared"][:60]:
                rows.append([format_number(r["contact"])] + [str(r["per_number"].get(n, {}).get("n", 0)) for n in nums] + [str(r["total"])])
            if len(rows) == 1:
                story.append(P("Nenhum contato em comum entre os números analisados no período e filtros selecionados."))
            else:
                wcol = (W - 40 * mm) / (len(nums) + 1)
                story.append(table(rows, [30 * mm] + [wcol] * (len(nums) + 1)))
        elif s == "limitacoes":
            story.append(H(s))
            for lim in data["limitations"]:
                story.append(P("• " + lim))
        elif s == "rastreabilidade":
            story.append(H(s))
            rows = [
                ["Identificador do relatório", report.code], ["Data de geração (UTC)", gen["at"]], ["Responsável", f"{gen['by']} <{gen['by_email']}>"],
                ["Versão do sistema", gen["app_version"]], ["Versão das regras analíticas", gen["rules_version"]],
                ["Filtros e parâmetros", json.dumps(data["criteria"]["filters"], ensure_ascii=False) or "{}"],
                ["Duplicidades", data["criteria"]["duplicates"]], ["Fora do período", data["criteria"]["out_of_scope"]],
                ["Hash do relatório", "SHA-256 do arquivo final registrado no histórico de relatórios (calculado após a geração; não pode constar no próprio arquivo)"],
            ]
            story.append(table(rows, [45 * mm, W - 45 * mm], header=False))
            story.append(Spacer(1, 2 * mm))
            rows = [header_row(["Arquivo de entrada", "SHA-256"])] + [[f"#{x['id']} {x['name']}", Paragraph(x["sha256"], st["mono"])] for x in data["files"]]
            story.append(KeepTogether(table(rows, [60 * mm, W - 60 * mm])))
    doc.build(story, onFirstPage=on_page, onLaterPages=on_page)
    return buf.getvalue()


# ================================================================== XLSX / CSV / JSON / HTML


def render_xlsx(data: dict, report: Report) -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill

    wb = Workbook()
    head_font = Font(bold=True, color="FFFFFF")
    head_fill = PatternFill("solid", fgColor="0B1220")

    def sheet(title, header, rows):
        ws = wb.create_sheet(title)
        ws.append(header)
        for c in ws[1]:
            c.font, c.fill = head_font, head_fill
        for r in rows:
            ws.append([("" if v is None else v) for v in r])
        ws.freeze_panes = "A2"
        for col in ws.columns:
            ws.column_dimensions[col[0].column_letter].width = min(max(len(str(c.value or "")) for c in col[:200]) + 2, 60)
        return ws

    ws = wb.active
    ws.title = "Resumo"
    case, gen = data["case"], data["generated"]
    meta = [("Relatório", report.code), ("Título", report.title), ("Caso", f"{case['code']} — {case['title']}"), ("Gerado em (UTC)", gen["at"]),
            ("Responsável", gen["by"]), ("Versão sistema/regras", f"{gen['app_version']} / {gen['rules_version']}"),
            ("Filtros", json.dumps(data["criteria"]["filters"], ensure_ascii=False)), ("Duplicidades", data["criteria"]["duplicates"]),
            ("Fora do período", data["criteria"]["out_of_scope"])]
    if case.get("is_demo"):
        meta.insert(0, ("ATENÇÃO", "DEMONSTRAÇÃO — dados sintéticos"))
    for k, v in meta:
        ws.append([k, v])
    ws.append([])
    for k, v in data["summary"]["totals"].items():
        ws.append([k, v])
    ws.column_dimensions["A"].width = 32
    ws.column_dimensions["B"].width = 80
    sheet("Fontes", ["ID", "Arquivo", "Tipo", "Operadora", "Formato", "Tamanho", "SHA-256", "Recebido em"],
          [[x["id"], x["name"], x["kind"], x["operator"], x["format"], x["size"], x["sha256"], x["received_at"]] for x in data["files"]])
    if data.get("contacts"):
        sheet("Contatos", ["Alvo", "Interlocutor", "Eventos", "Dias", "Originados", "Recebidos", "Chamadas", "SMS", "Duração (s)", "Primeiro", "Último", "Recíproco"],
              [[r["target_number"], r["other_number"], r["events"], r["days"], r["outgoing"], r["incoming"], r["calls"], r["sms"], r["call_seconds"], r["first_event"], r["last_event"], "sim" if r["reciprocal"] else "não"] for r in data["contacts"]["items"]])
    if data.get("events") is not None:
        cols = ["id", "ts_local", "tz_status", "tz_name", "event_type", "direction", "target_number", "other_number", "a_number", "b_number", "duration_s",
                "operator", "tech", "mcc", "mnc", "lac", "tac", "cell_id", "eci", "nci", "cgi", "erb_raw", "cell_key", "resolution_status", "cell_lat", "cell_lon",
                "imei", "ip", "file_id", "row_number", "page", "ts_original"]
        sheet("Eventos", cols, [[e.get(c) if not isinstance(e.get(c), list) else "; ".join(map(str, e.get(c))) for c in cols] for e in data["events"]])
    if data.get("graph"):
        sheet("Vínculos", ["Número 1", "Número 2", "Eventos", "Dias", "1→2", "2→1", "Recíproca", "Duração (s)", "Primeiro", "Último", "Arquivos"],
              [[e["n1"], e["n2"], e["events"], e["days"], e["n1_to_n2"], e["n2_to_n1"], "sim" if e["reciprocal"] else "não", e["call_seconds"], e["first_event"], e["last_event"], ", ".join(map(str, e["file_ids"]))] for e in data["graph"]["edges"]])
    if data.get("cells"):
        sheet("ERB", ["Célula", "Eventos", "Números", "Resolução", "Regra", "Estação", "Código", "Lat", "Lon", "Azimute", "Primeiro", "Último", "Observação"],
              [[c["cell_key"], c["events"], c["numbers"], c["resolution_status"], c["resolution_rule"], c["site_name"], c["site_code"], c["lat"], c["lon"], c["azimuth"], c["first_event"], c["last_event"], c["resolution_note"]] for c in data["cells"]["items"]])
    sheet("Critérios e limites", ["Item", "Descrição"],
          [["Filtros", json.dumps(data["criteria"]["filters"], ensure_ascii=False)], ["Regras", data["criteria"]["rules_version"]]] + [["Limitação", x] for x in data["limitations"]])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def render_csv(data: dict, report: Report) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";")
    w.writerow([f"# Relatório {report.code} · caso {data['case']['code']} · gerado {data['generated']['at']} · regras {data['generated']['rules_version']}"
                + (" · DEMONSTRAÇÃO" if data["case"].get("is_demo") else "")])
    w.writerow([f"# Filtros: {json.dumps(data['criteria']['filters'], ensure_ascii=False)}"])
    if data.get("events") is not None:
        cols = ["id", "ts_local", "tz_status", "event_type", "target_number", "other_number", "a_number", "b_number", "duration_s", "operator", "cell_key",
                "resolution_status", "cell_lat", "cell_lon", "imei", "ip", "file_id", "row_number", "page"]
        w.writerow(cols)
        for e in data["events"]:
            w.writerow([e.get(c) for c in cols])
    elif data.get("graph"):
        w.writerow(["n1", "n2", "events", "days", "n1_to_n2", "n2_to_n1", "reciprocal", "call_seconds", "first_event", "last_event"])
        for e in data["graph"]["edges"]:
            w.writerow([e["n1"], e["n2"], e["events"], e["days"], e["n1_to_n2"], e["n2_to_n1"], e["reciprocal"], e["call_seconds"], e["first_event"], e["last_event"]])
    elif data.get("cells"):
        w.writerow(["cell_key", "events", "numbers", "resolution_status", "site_name", "lat", "lon", "azimuth"])
        for c in data["cells"]["items"]:
            w.writerow([c["cell_key"], c["events"], c["numbers"], c["resolution_status"], c["site_name"], c["lat"], c["lon"], c["azimuth"]])
    return ("﻿" + buf.getvalue()).encode("utf-8")


def render_json(data: dict, report: Report) -> bytes:
    payload = {"report": {"code": report.code, "title": report.title, "type": report.report_type}, **data}
    return json.dumps(payload, ensure_ascii=False, indent=1, default=str).encode("utf-8")


def render_html(data: dict, report: Report) -> bytes:
    e = html.escape
    case, gen, tot = data["case"], data["generated"], data["summary"]["totals"]

    def tbl(header, rows):
        h = "".join(f"<th>{e(str(x))}</th>" for x in header)
        b = "".join("<tr>" + "".join(f"<td>{e('' if c is None else str(c))}</td>" for c in r) + "</tr>" for r in rows)
        return f"<table><thead><tr>{h}</tr></thead><tbody>{b}</tbody></table>"

    def bars(series, key, label):
        if not series:
            return ""
        mx = max(r["n"] for r in series) or 1
        w = 600 / len(series)
        rects = "".join(
            f'<rect x="{i * w + 1:.1f}" y="{120 - r["n"] / mx * 110:.1f}" width="{max(w - 2, 1):.1f}" height="{r["n"] / mx * 110:.1f}" fill="#2f6fdf"><title>{e(label(r))}: {r["n"]}</title></rect>'
            for i, r in enumerate(series)
        )
        return f'<svg viewBox="0 0 600 125" class="chart" role="img">{rects}</svg>'

    parts = [f"<h1>{e(report.title)}</h1><p class='meta'>Caso {e(case['code'])} — {e(case['title'])} · Relatório {e(report.code)} · gerado em {e(gen['at'][:19])} UTC por {e(gen['by'])} · v{e(gen['app_version'])} · regras {e(gen['rules_version'])}</p>"]
    if case.get("is_demo"):
        parts.append("<p class='demo'>DEMONSTRAÇÃO — dados sintéticos, sem valor investigativo</p>")
    parts.append("<h2>Arquivos utilizados</h2>" + tbl(["#", "Arquivo", "Tipo", "Operadora", "SHA-256"], [[x["id"], x["name"], x["kind"], x["operator"], x["sha256"]] for x in data["files"]]))
    parts.append("<h2>Estatísticas</h2>" + tbl(["Indicador", "Valor"], [[k, v] for k, v in tot.items()]))
    parts.append("<h3>Eventos por hora</h3>" + bars(data["summary"]["by_hour"], "hour", lambda r: f"{r['hour']}h"))
    parts.append("<h3>Eventos por dia</h3>" + bars(data["summary"]["by_day"], "day", lambda r: r["day"]))
    if data.get("contacts"):
        parts.append("<h2>Contatos mais frequentes</h2>" + tbl(["Alvo", "Interlocutor", "Eventos", "Dias", "Orig.", "Rec.", "Duração (s)"],
                     [[format_number(r["target_number"]), format_number(r["other_number"]), r["events"], r["days"], r["outgoing"], r["incoming"], r["call_seconds"]] for r in data["contacts"]["items"][:100]]))
    if data.get("graph"):
        parts.append("<h2>Vínculos documentados</h2>" + tbl(["Número 1", "Número 2", "Eventos", "Dias", "Recíproca"],
                     [[format_number(x["n1"]), format_number(x["n2"]), x["events"], x["days"], "sim" if x["reciprocal"] else "não"] for x in data["graph"]["edges"][:200]]))
    if data.get("cells"):
        parts.append("<h2>Células</h2>" + tbl(["Célula", "Eventos", "Resolução", "Estação", "Lat", "Lon"],
                     [[c["cell_key"], c["events"], c["resolution_status"], c["site_name"], c["lat"], c["lon"]] for c in data["cells"]["items"][:200]]))
    if data.get("events") is not None:
        parts.append("<h2>Eventos</h2>" + tbl(["ID", "Data/hora", "Fuso", "Tipo", "Origem", "Destino", "Dur.", "Célula", "Arquivo/linha"],
                     [[x["id"], x["ts_local"], x["tz_status"], EVENT_TYPES.get(x["event_type"], x["event_type"]), format_number(x["a_number"]), format_number(x["b_number"]), x["duration_s"], x["cell_key"], f"#{x['file_id']}/{x['row_number']}"] for x in data["events"][:2000]]))
    parts.append("<h2>Limitações</h2><ul>" + "".join(f"<li>{e(x)}</li>" for x in data["limitations"]) + "</ul>")
    parts.append("<h2>Rastreabilidade</h2>" + tbl(["Item", "Valor"], [["Filtros", json.dumps(data["criteria"]["filters"], ensure_ascii=False)], ["Duplicidades", data["criteria"]["duplicates"]], ["Fora do período", data["criteria"]["out_of_scope"]]]))
    css = """body{font:14px/1.5 system-ui,sans-serif;margin:24px auto;max-width:1100px;padding:0 16px;color:#0b1220;background:#fff}
h1{color:#0b1220}h2{color:#2f6fdf;border-bottom:1px solid #c9d2e3;padding-bottom:4px;margin-top:28px}.meta{color:#5b6578}
.demo{background:#fde8e4;color:#9a2b17;padding:8px 12px;border-radius:6px;font-weight:700}
table{border-collapse:collapse;width:100%;font-size:12px;margin:8px 0}th{background:#0b1220;color:#fff;text-align:left}
th,td{border:1px solid #c9d2e3;padding:4px 6px;vertical-align:top;word-break:break-word}tr:nth-child(even) td{background:#f3f6fb}
.chart{width:100%;max-width:700px;height:auto;background:#f3f6fb;border-radius:6px}"""
    doc = f"<!doctype html><html lang='pt-BR'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><meta name='robots' content='noindex'><title>{e(report.code)}</title><style>{css}</style></head><body>{''.join(parts)}</body></html>"
    return doc.encode("utf-8")


RENDERERS = {"pdf": render_pdf, "xlsx": render_xlsx, "csv": render_csv, "json": render_json, "html": render_html}
MIME = {"pdf": "application/pdf", "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "csv": "text/csv; charset=utf-8",
        "json": "application/json", "html": "text/html; charset=utf-8"}
