"""Dados de DEMONSTRAÇÃO (sintéticos).

Gera arquivos em layouts diferentes e os processa pelo mesmo fluxo usado em casos
reais (armazenamento com hash → análise → mapeamento → importação → resolução de
ERB → alertas). Números, células e coordenadas são fictícios. Tudo fica num caso
marcado `is_demo`, que pode ser apagado sem afetar casos reais.

Layouts "estilo TIM/Vivo/Claro" aqui são INVENTADOS para exercitar o importador;
não reproduzem os layouts reais das operadoras.
"""
from __future__ import annotations

import csv
import io
import json
import random
from datetime import date, datetime, timedelta

from openpyxl import Workbook
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import RULES_VERSION
from ..models import Case, CaseMember, Import, SourceFile, Target, User
from ..parsers.fields import suggest_mapping
from ..storage import get_storage
from . import alerts as alert_svc
from . import erb as erb_svc
from . import importer

DEMO_PREFIX = "DEMO-"
T_A, T_B, T_C = "+5561900000001", "+5561900000002", "+5561900000003"
CENTER = (-15.79, -47.88)


def _num(i: int) -> str:
    return f"+55619{80000000 + i:08d}"


def _local(n: str) -> str:
    return f"({n[3:5]}) {n[5:10]}-{n[10:]}"


OPS = {"TIM": "02", "VIVO": "11", "CLARO": "05"}
N_SITES = 10


def _cells(rng: random.Random):
    """Estações fictícias compartilhadas pelas três operadoras (mesma torre),
    cada operadora com uma célula 3G (LAC+CI) e uma 4G (TAC+ECI)."""
    cells = []
    for s in range(N_SITES):
        lat = round(CENTER[0] + rng.uniform(-0.09, 0.09), 6)
        lon = round(CENTER[1] + rng.uniform(-0.09, 0.09), 6)
        for oi, (op, mnc) in enumerate(OPS.items()):
            for tech in ("3G", "4G"):
                g3 = tech == "3G"
                cells.append({
                    "idx": len(cells), "site_idx": s, "op": op, "tech": tech, "mcc": "724", "mnc": mnc,
                    "lac": str(1100 + s // 4) if g3 else "", "tac": "" if g3 else str(5100 + s // 4),
                    "ci": str(20000 + s * 10 + oi) if g3 else "", "eci": "" if g3 else str(256 * (3000 + s) + oi + 1),
                    "site": f"DEMO-SITE-{s + 1:02d}", "name": f"ERB Demonstração {s + 1:02d}", "lat": lat, "lon": lon,
                    "az": oi * 120 + 30, "bw": 65,
                })
    return cells


def _pick(cells: list, op: str, site: int, techs: tuple[str, ...], rng: random.Random) -> dict:
    tech = rng.choice(techs)
    return next(c for c in cells if c["op"] == op and c["site_idx"] == site and c["tech"] == tech)


def _events(rng: random.Random, target: str, cells: list, contacts: list[str], start: date, days: int, peers: dict[str, float],
            op: str, home: int, work: int, techs: tuple[str, ...]):
    evs = []
    weights = [1 / (k + 1) ** 0.9 for k in range(len(contacts))]
    for d in range(days):
        day = start + timedelta(days=d)
        n = rng.randint(18, 45) if day.weekday() < 5 else rng.randint(6, 20)
        if d == 17:
            n += 70  # pico atípico
        for _ in range(n):
            hour = rng.choices(range(24), weights=[1, 1, 1, 1, 1, 1, 2, 4, 7, 8, 8, 8, 9, 8, 8, 8, 8, 8, 7, 6, 5, 4, 3, 2])[0]
            ts = datetime(day.year, day.month, day.day, hour, rng.randint(0, 59), rng.randint(0, 59))
            r = rng.random()
            peer = None
            for p, prob in peers.items():
                if rng.random() < prob:
                    peer = p
                    break
            other = peer or rng.choices(contacts, weights=weights)[0]
            kind = "dados" if r < 0.12 else ("sms" if r < 0.30 else "voz")
            out = rng.random() < 0.55
            dur = 0 if kind == "sms" else (rng.randint(60, 7200) if kind == "dados" else (0 if rng.random() < 0.07 else int(rng.expovariate(1 / 95)) + 3))
            r2 = rng.random()
            site = rng.randrange(N_SITES) if r2 < 0.15 else (work if 8 <= hour < 18 and day.weekday() < 5 else home)
            cell = _pick(cells, op, site, techs, rng)
            evs.append({"ts": ts, "kind": kind, "out": out, "other": other if kind != "dados" else None, "dur": dur, "cell": cell,
                        "imei": "35" + "".join(str((ord(target[-1]) + k) % 10) for k in range(13)), "ip": f"10.{rng.randint(0, 255)}.{rng.randint(0, 255)}.{rng.randint(1, 254)}" if kind == "dados" else ""})
    return sorted(evs, key=lambda e: e["ts"])


def _mirror(evs_from: list, owner: str, target: str, rng: random.Random) -> list:
    """Registros recíprocos: o que o alvo A falou com B aparece também na bilhetagem de B."""
    out = []
    for e in evs_from:
        if e["other"] == target and e["kind"] != "dados":
            skew = rng.choice([0, 0, 0, 1, 2]) if e["kind"] == "voz" else rng.choice([0, 1, 3])
            out.append({**e, "ts": e["ts"] + timedelta(seconds=skew), "out": not e["out"], "other": owner, "dur": e["dur"] + rng.choice([0, 0, 1])})
    return out


def build_files(rng: random.Random):
    cells = _cells(rng)
    contacts = [_num(i) for i in range(1, 60)]
    start = date(2026, 3, 1)
    common = contacts[:6]
    a = _events(rng, T_A, cells, common + contacts[6:28], start, 31, {T_B: 0.06, T_C: 0.02}, "TIM", 0, 3, ("3G",))
    b = _events(rng, T_B, cells, common + contacts[20:44], start, 31, {T_C: 0.03}, "VIVO", 1, 3, ("3G", "4G"))
    c = _events(rng, T_C, cells, common + contacts[36:59], start, 31, {}, "CLARO", 5, 6, ("4G",))
    # registros recíprocos: a célula é a da rede de quem registrou (mesmo local, outra operadora)
    b += [{**e, "cell": _pick(cells, "VIVO", e["cell"]["site_idx"], ("3G", "4G"), rng)} for e in _mirror(a, T_A, T_B, rng)]
    c += [{**e, "cell": _pick(cells, "CLARO", e["cell"]["site_idx"], ("4G",), rng)} for e in _mirror(a, T_A, T_C, rng)]
    c += [{**e, "cell": _pick(cells, "CLARO", e["cell"]["site_idx"], ("4G",), rng)} for e in _mirror(b, T_B, T_C, rng)]
    b.sort(key=lambda e: e["ts"])
    c.sort(key=lambda e: e["ts"])

    # ---- Arquivo 1: CSV ';' cp1252 com preâmbulo (layout fictício "estilo TIM")
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";", lineterminator="\r\n")
    w.writerow(["TIM S.A. - EXTRATO DE CHAMADAS - DOCUMENTO DE DEMONSTRAÇÃO (DADOS SINTÉTICOS)"])
    w.writerow([f"Linha: {_local(T_A)}", "Período: 01/03/2026 a 31/03/2026"])
    w.writerow([])
    w.writerow(["Número A", "Número B", "Data", "Hora", "Duração", "Tipo", "Tecnologia", "MCC", "MNC", "LAC", "CI", "IMEI"])
    rows = []
    for e in a:
        if e["kind"] == "dados":
            continue
        cell = e["cell"]  # layout com LAC/CI (3G)
        tipo = {("voz", True): "Originada", ("voz", False): "Recebida", ("sms", True): "SMS Originado", ("sms", False): "SMS Recebido"}[(e["kind"], e["out"])]
        num_a, num_b = (_local(T_A), _local(e["other"])) if e["out"] else (_local(e["other"]), _local(T_A))
        rows.append([num_a, num_b, e["ts"].strftime("%d/%m/%Y"), e["ts"].strftime("%H:%M:%S"),
                     f"{e['dur'] // 3600:02d}:{e['dur'] % 3600 // 60:02d}:{e['dur'] % 60:02d}", tipo,
                     "UMTS", cell["mcc"], cell["mnc"], cell["lac"], cell["ci"], e["imei"]])
    # linhas problemáticas propositais
    rows.insert(5, rows[5])  # duplicidade
    rows.insert(40, rows[40])
    rows.append([_local(T_A), _local(contacts[2]), "31/02/2026", "10:00:00", "00:01:00", "Originada", "UMTS", "724", "02", "1100", "20001", ""])
    rows.append([_local(T_A), _local(contacts[3]), "28/02/2026", "23:10:00", "00:00:40", "Originada", "UMTS", "724", "02", "1100", "20001", ""])
    rows.append([_local(T_A), _local(contacts[4]), "15/03/2026", "25:61:00", "abc", "Originada", "UMTS", "724", "02", "1100", "29999", ""])
    # CI sem LAC/MCC/MNC: casa com duas células do cadastro (mesmo CI em LACs diferentes) → ambígua
    rows.append([_local(T_A), _local(contacts[5]), "16/03/2026", "11:11:11", "00:02:10", "Originada", "", "", "", "", "20000", ""])
    for r in rows:
        w.writerow(r)
    f1 = ("DEMO_TIM_extrato_alvoA.csv", buf.getvalue().encode("cp1252"))

    # ---- Arquivo 2: XLSX com data/hora ISO e fuso (layout fictício "estilo Vivo")
    wb = Workbook()
    ws = wb.active
    ws.title = "Extrato"
    ws.append(["TELEFÔNICA BRASIL (VIVO) — RELATÓRIO DE DEMONSTRAÇÃO — DADOS SINTÉTICOS"])
    ws.append([])
    ws.append(["Data/Hora Início", "Linha", "Interlocutor", "Sentido", "Serviço", "Duração (s)", "CGI", "IP", "Upload", "Download"])
    for e in b:
        cell = e["cell"]
        cgi = f"{cell['mcc']}-{cell['mnc']}-{cell['lac']}-{cell['ci']}" if cell["tech"] != "4G" else f"{cell['mcc']}-{cell['mnc']}-{cell['eci']}"
        serv = {"voz": "Voz", "sms": "SMS", "dados": "Dados"}[e["kind"]]
        ws.append([e["ts"].strftime("%Y-%m-%dT%H:%M:%S") + "-03:00", T_B[3:], e["other"][3:] if e["other"] else "",
                   ("Sainte" if e["out"] else "Entrante") if e["kind"] != "dados" else "", serv, e["dur"], cgi, e["ip"],
                   rng.randint(1000, 900000) if e["kind"] == "dados" else "", rng.randint(1000, 9000000) if e["kind"] == "dados" else ""])
    xb = io.BytesIO()
    wb.save(xb)
    f2 = ("DEMO_VIVO_extrato_alvoB.xlsx", xb.getvalue())

    # ---- Arquivo 3: TXT de largura fixa sem fuso (layout fictício "estilo Claro")
    lines = ["CLARO S.A. EXTRATO DEMONSTRACAO (SINTETICO)", ""]
    fmt = "{:<20}{:<8}{:<16}{:<16}{:>8}  {:<5}{:<5}{:<8}{:<12}"
    lines.append(fmt.format("DATA_HORA", "TIPO", "ORIGEM", "DESTINO", "DURACAO", "MCC", "MNC", "TAC", "ECI"))
    for e in c:
        if e["kind"] == "dados":
            continue
        cell = e["cell"]  # layout com TAC/ECI (4G)
        tipo = ("MO" if e["out"] else "MT") + ("-SMS" if e["kind"] == "sms" else "")
        o, d = (T_C[3:], e["other"][3:]) if e["out"] else (e["other"][3:], T_C[3:])
        lines.append(fmt.format(e["ts"].strftime("%Y%m%d %H%M%S"), tipo, o, d, str(e["dur"]), cell["mcc"], cell["mnc"],
                                cell["tac"], cell["eci"]))
    f3 = ("DEMO_CLARO_extrato_alvoC.txt", ("\n".join(lines) + "\n").encode("utf-8"))

    # ---- Cadastro de ERB (versão atual) com problemas propositais
    def reg_rows(cs, shift=0.0):
        out = []
        for i, cell in enumerate(cs):
            out.append([cell["op"], cell["tech"], cell["mcc"], cell["mnc"], cell["lac"], cell["tac"], cell["ci"], cell["eci"], cell["site"],
                         cell["name"], f"Endereço fictício {cell['site_idx'] + 1}, Brasília-DF", f"{cell['lat'] + shift:.6f}".replace(".", ","),
                         f"{cell['lon'] + shift:.6f}".replace(".", ","), cell["az"], cell["bw"]])
        return out

    def find(op, site, tech):
        return next(c for c in cells if c["op"] == op and c["site_idx"] == site and c["tech"] == tech)

    header = ["Operadora", "Tecnologia", "MCC", "MNC", "LAC", "TAC", "CI", "ECI", "Código ERB", "Nome ERB", "Endereço", "Latitude", "Longitude", "Azimute", "Abertura"]
    missing = find("VIVO", 4, "3G")  # ausente do cadastro → "ERB não resolvida"
    current = reg_rows([c for c in cells if c is not missing])
    bad = cells.index(find("TIM", 9, "3G")) - (1 if cells.index(find("TIM", 9, "3G")) > cells.index(missing) else 0)
    current[bad][11], current[bad][12] = "0", "0"  # coordenada inválida
    conflict = list(reg_rows([find("CLARO", 8, "4G")])[0])  # mesmo identificador, outra coordenada → conflito
    conflict[11] = f"{find('CLARO', 8, '4G')['lat'] + 0.05:.6f}".replace(".", ",")
    current.append(conflict)
    twin = list(reg_rows([find("TIM", 0, "3G")])[0])  # mesmo CI em outra LAC (célula legítima distinta)
    twin[4], twin[8], twin[9] = "1105", "DEMO-SITE-90", "ERB Demonstração 90"
    twin[11] = f"{CENTER[0] + 0.12:.6f}".replace(".", ",")
    current.append(twin)
    buf = io.StringIO()
    csv.writer(buf, delimiter=";", lineterminator="\n").writerows([header] + current)
    f4 = ("DEMO_cadastro_ERB_2026-03.csv", buf.getvalue().encode("utf-8"))
    old = reg_rows([c for c in cells if c["site_idx"] in (0, 1)], shift=0.004)  # versão antiga com coordenadas deslocadas
    buf = io.StringIO()
    csv.writer(buf, delimiter=";", lineterminator="\n").writerows([header] + old)
    f5 = ("DEMO_cadastro_ERB_2025-12.csv", buf.getvalue().encode("utf-8"))
    return f1, f2, f3, f4, f5


def _store(db: Session, case: Case, name: str, content: bytes, kind: str, operator: str | None, user_id: int | None) -> SourceFile:
    from ..parsers.readers import sniff_format

    key, sha, size = get_storage().put_bytes("originals", content)
    fmt = sniff_format(get_storage().path(key), name)
    sf = SourceFile(case_id=case.id, original_name=name, size_bytes=size, sha256=sha, detected_format=fmt, storage_key=key,
                    kind=kind, operator_declared=operator, uploaded_by=user_id, meta={"demo": True})
    db.add(sf)
    db.flush()
    return sf


def seed(db: Session, user_id: int | None, ctx=None) -> dict:
    rng = random.Random(20260301)
    user = db.get(User, user_id) if user_id else None
    n = len(db.execute(select(Case.id).where(Case.is_demo)).scalars().all()) + 1
    case = Case(
        organization_id=user.organization_id if user else 1, code=f"{DEMO_PREFIX}{n:04d}",
        title="Operação Exemplo — DEMONSTRAÇÃO (dados sintéticos)", process_number="0000000-00.0000.0.00.0000 (fictício)",
        unit="Unidade de demonstração", responsible_user_id=user_id, period_start=date(2026, 3, 1), period_end=date(2026, 3, 31),
        description="Caso de demonstração com dados 100% sintéticos para validar o fluxo completo da plataforma.",
        authorized_docs="Documento fictício de demonstração", is_demo=True, created_by=user_id,
    )
    db.add(case)
    db.flush()
    if user_id:
        db.add(CaseMember(case_id=case.id, user_id=user_id, role="analyst", can_export=True))
    for num, op, label in ((T_A, "TIM", "Alvo A (fictício)"), (T_B, "VIVO", "Alvo B (fictício)"), (T_C, "CLARO", "Alvo C (fictício)")):
        db.add(Target(case_id=case.id, number_normalized=num, number_original=_local(num), operator=op, label=label,
                      internal_id=label.split(" (")[0], source="demonstração", validation_status="validado"))
    db.commit()
    f1, f2, f3, f4, f5 = build_files(rng)
    plan = [
        (f5, "erb_registry", None, {"reference_date": "2025-12-01", "version_name": "Cadastro DEMO dez/2025"}),
        (f4, "erb_registry", None, {"reference_date": "2026-03-01", "version_name": "Cadastro DEMO mar/2026"}),
        (f1, "cdr", "TIM", {"target_number": T_A, "tz_mode": "assumed", "tz_name": "America/Sao_Paulo"}),
        (f2, "cdr", "VIVO", {"target_number": T_B, "tz_mode": "confirmed", "tz_name": "America/Sao_Paulo"}),
        (f3, "cdr", "CLARO", {"target_number": T_C, "tz_mode": "unknown", "default_event_type": "voz",
                              "value_map": {"MO": "voz_originada", "MT": "voz_recebida", "MO-SMS": "sms_enviado", "MT-SMS": "sms_recebido"}}),
    ]
    results = []
    for (name, content), kind, op, opts in plan:
        sf = _store(db, case, name, content, kind, op, user_id)
        table = importer.open_table(sf, {})
        mapping = suggest_mapping(table.info.columns, "cdr" if kind == "cdr" else "erb")
        if kind == "cdr" and "ECI" in table.info.columns:
            mapping["eci"] = "ECI"
        options = {"operator": op, "read": {}, **opts}
        imp = Import(case_id=case.id, file_id=sf.id, kind=kind, mapping=mapping, options=options, status="running",
                     rules_version=RULES_VERSION, created_by=user_id)
        db.add(imp)
        db.commit()
        if ctx is not None:
            ctx.progress(len(results), len(plan), f"importando {name}", force=True)
        res = importer.run_erb_import(ctx, imp) if kind == "erb_registry" else importer.run_cdr_import(ctx, imp)
        results.append({"file": name, **res})
    erb_svc.run_resolution(db, case.id, None, user_id)
    alert_svc.ensure_default_rules(db, case.id, user_id)
    alert_svc.run_rules(db, case.id)
    return {"case_id": case.id, "code": case.code, "imports": json.loads(json.dumps(results, default=str))}


class _NullCtx:
    """Contexto mínimo para executar o seed fora da fila (scripts e testes)."""

    def __init__(self, db):
        self.db = db

    def progress(self, *a, **k):
        pass

    def check_cancel(self):
        pass
