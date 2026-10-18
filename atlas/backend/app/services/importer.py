"""Importação universal: análise do arquivo, prévia normalizada e processamento em lote."""
from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from datetime import UTC, date, datetime
from pathlib import Path

from sqlalchemy import delete, insert, select, text, update
from sqlalchemy.orm import Session

from ..config import RULES_VERSION, settings
from ..models import Case, ErbCell, ErbRegistryVersion, Event, Import, ImportIssue, LayoutProfile, SourceFile, Target
from ..parsers.fields import CDR_FIELDS, ERB_FIELDS, suggest_mapping
from ..parsers.readers import ReadOptions, Table
from ..parsers.text import norm_header
from ..storage import get_storage
from . import normalize as N

BATCH = 5000
MAX_ISSUES_STORED = 20000

EVENT_COPY_COLUMNS = [
    "case_id", "import_id", "file_id", "file_sha256", "row_number", "page", "operator", "event_type", "direction",
    "a_number", "b_number", "a_raw", "b_raw", "target_number", "other_number", "ts_original", "ts_utc", "ts_local",
    "tz_name", "tz_status", "duration_s", "status", "tech", "mcc", "mnc", "lac", "tac", "cell_id", "eci", "nci", "cgi",
    "erb_raw", "cell_key", "lat", "lon", "azimuth", "imei", "imsi", "ip", "bytes_up", "bytes_down", "raw", "warnings",
    "confidence", "dedup_hash", "is_duplicate", "out_of_scope", "resolution_manual", "revision",
]


def layout_signature(columns: list[str]) -> str:
    return hashlib.sha1("|".join(norm_header(c) for c in columns).encode()).hexdigest()


def file_path(f: SourceFile) -> Path:
    return get_storage().path(f.storage_key)


def open_table(f: SourceFile, read_opts: dict | None) -> Table:
    return Table(file_path(f), f.detected_format, ReadOptions.from_dict(read_opts))


# ------------------------------------------------------------------ análise


def analyze(db: Session, f: SourceFile, kind: str, read_opts: dict | None, org_id: int) -> dict:
    table = open_table(f, read_opts)
    info = table.info
    sample = table.sample(25)
    columns = info.columns
    sig = layout_signature(columns)
    profile = db.execute(
        select(LayoutProfile)
        .where(LayoutProfile.organization_id == org_id, LayoutProfile.signature == sig, LayoutProfile.kind == kind)
        .order_by(LayoutProfile.id.desc())
    ).scalar()
    suggested = suggest_mapping(columns, kind)
    mapping = dict(profile.mapping) if profile else suggested

    mnc_col = mapping.get("mnc")
    sample_mnc = [r.get(mnc_col, "") for r in sample] if mnc_col else []
    cgi_col = mapping.get("cgi")
    if not sample_mnc and cgi_col:
        sample_mnc = [N.split_cgi(N.normalize_cgi(r.get(cgi_col))).get("mnc", "") for r in sample]
    operator = N.detect_operator(f.original_name, info.preamble, columns, sample_mnc)

    formats = detect_formats(sample, mapping)
    # números do cabeçalho do documento que coincidem com alvos do caso
    targets = db.execute(select(Target).where(Target.case_id == f.case_id)).scalars().all()
    pre_text = " ".join(info.preamble)
    pre_numbers = {N.normalize_number(m)[0] for m in re.findall(r"\(?\+?\d[\d\s().-]{7,}\d", pre_text)}
    target_hint = [t.number_normalized for t in targets if t.number_normalized in pre_numbers]
    type_values: list[str] = []
    if kind == "cdr" and mapping.get("event_type"):
        type_values = sorted({r.get(mapping["event_type"], "") for r in sample if r.get(mapping["event_type"])})

    return {
        "table": info.to_dict(),
        "columns": columns,
        "sample": sample,
        "signature": sig,
        "profile": {"id": profile.id, "name": profile.name, "options": profile.options} if profile else None,
        "suggested_mapping": mapping,
        "fields": {k: v["label"] for k, v in (CDR_FIELDS if kind == "cdr" else ERB_FIELDS).items()},
        "operator_detection": operator,
        "formats": formats,
        "target_hint": target_hint,
        "event_type_values": type_values,
        "event_types": N.EVENT_TYPES,
    }


def detect_formats(sample: list[dict], mapping: dict) -> dict:
    out = {}
    for field, cands in (("date", N.DATE_FORMATS), ("time", N.TIME_FORMATS), ("datetime", N.DATETIME_FORMATS)):
        col = mapping.get(field)
        if not col:
            continue
        vals = [str(r.get(col, "")) for r in sample]
        if field == "date":
            vals = [v[:10] if re.fullmatch(r"\d{4}-\d{2}-\d{2} 00:00:00", v) else v for v in vals]
        if field == "time":
            vals = [v[11:] if re.fullmatch(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}", v) else v for v in vals]
        fmt, rate, ambiguous = N.detect_format(vals, cands)
        out[field] = {"format": fmt, "rate": round(rate, 3), "ambiguous": ambiguous}
    return out


# ------------------------------------------------------------------ normalização de linha


class RowNormalizer:
    def __init__(self, mapping: dict, options: dict, case: Case, targets: list[Target], file: SourceFile):
        self.m = {k: v for k, v in (mapping or {}).items() if v}
        self.o = options or {}
        self.case = case
        self.file = file
        self.targets = {t.number_normalized: t for t in targets}
        self.file_target = self.o.get("target_number") or None
        self.tz_mode = self.o.get("tz_mode", "unknown")
        self.tz_name = self.o.get("tz_name") or "America/Sao_Paulo"
        self.hex_ids = bool(self.o.get("hex_ids"))
        self.value_map = self.o.get("value_map") or {}
        self.default_type = self.o.get("default_event_type") or None
        self.declared = {k: self.o.get(f"default_{k}") for k in ("mcc", "mnc", "tech")}
        self.operator = self.o.get("operator") or file.operator_declared or None

    def g(self, rec: dict, field: str) -> str | None:
        col = self.m.get(field)
        if not col:
            return None
        v = rec.get(col)
        return v.strip() if isinstance(v, str) and v.strip() else None

    def __call__(self, raw, rec: dict) -> tuple[dict | None, list[tuple[str, str, str, str]]]:
        """Retorna (evento, problemas[(severidade, código, campo, mensagem)])."""
        issues: list[tuple[str, str, str, str]] = []
        warns: list[str] = []

        def warn(code, field, msg, sev="warning"):
            issues.append((sev, code, field, msg))
            if sev == "warning":
                warns.append(msg)

        # --- números
        a_raw, b_raw = self.g(rec, "a_number"), self.g(rec, "b_number")
        tgt_raw, oth_raw = self.g(rec, "target_number"), self.g(rec, "other_number")
        a, wa = N.normalize_number(a_raw)
        b, wb = N.normalize_number(b_raw)
        tnum, wt = N.normalize_number(tgt_raw)
        onum, wo = N.normalize_number(oth_raw)
        for w in wa + wb + wt + wo:
            if "não reconhecido" in w:
                warn("numero_formato", "numero", w)

        # --- tipo e sentido
        et, direction, recognized = N.classify_event(self.g(rec, "event_type"), self.g(rec, "direction"), self.value_map, self.default_type)
        if not recognized:
            warn("tipo_nao_reconhecido", "event_type", f"tipo de evento não reconhecido: {self.g(rec, 'event_type')!r}")

        target = tnum or self.file_target
        if not target:
            if a in self.targets:
                target = a
            elif b in self.targets:
                target = b
        # reconstrução A/B a partir de alvo + interlocutor + sentido (somente com sentido conhecido)
        if not a and not b and target and onum:
            if direction == "out":
                a, b = target, onum
            elif direction == "in":
                a, b = onum, target
            else:
                warn("sentido_desconhecido", "direction", "sentido não informado: origem/destino não definidos")
        other = onum
        if not other:
            if target and a == target:
                other = b
            elif target and b == target:
                other = a
        if target and a and b and target not in (a, b) and not tnum:
            warn("alvo_ausente", "target_number", "o número alvo do arquivo não aparece como origem nem destino")
        if direction == "unknown" and target and a and b:
            direction = "out" if a == target else "in" if b == target else "unknown"
            if et == "voz" and direction != "unknown":
                et = "voz_originada" if direction == "out" else "voz_recebida"
            elif et == "sms" and direction != "unknown":
                et = "sms_enviado" if direction == "out" else "sms_recebido"

        # --- data e hora
        dt_raw, d_raw, t_raw = self.g(rec, "datetime"), self.g(rec, "date"), self.g(rec, "time")
        local, offset, err = N.parse_local_datetime(
            d_raw, t_raw, dt_raw, self.o.get("date_format"), self.o.get("time_format"), self.o.get("datetime_format")
        )
        tz_raw = self.g(rec, "timezone")
        if tz_raw and not offset:
            m = re.search(r"([+-])\s*(\d{1,2})(?::?(\d{2}))?", tz_raw)
            if m:
                offset = f"{m.group(1)}{int(m.group(2)):02d}:{m.group(3) or '00'}"
            elif tz_raw.strip().upper() in ("UTC", "GMT", "Z"):
                offset = "Z"
        ts_utc = None
        tz_status = self.tz_mode
        tz_name = self.tz_name
        if local is None:
            warn("data_invalida", "datetime", err or "data/hora ausente", sev="error")
            return None, issues
        if err:
            warn("data_parcial", "datetime", err)
        if offset:
            ts_utc = N.to_utc(local, offset, None)
            tz_status, tz_name = "confirmed", f"UTC{offset if offset != 'Z' else '+00:00'}"
        else:
            ts_utc = N.to_utc(local, None, self.tz_name)
            if self.tz_mode == "unknown":
                tz_name = None
        ts_original = " ".join(x for x in (dt_raw, d_raw, t_raw, tz_raw) if x)

        # --- duração
        dur, derr = N.parse_duration(self.g(rec, "duration"), self.o.get("duration_unit", "s"))
        if derr:
            warn("duracao_invalida", "duration", derr)

        # --- rede / célula
        tech = N.normalize_tech(self.g(rec, "tech")) or N.normalize_tech(self.declared.get("tech"))
        mcc = N.normalize_id(self.g(rec, "mcc")) or self.declared.get("mcc") or None
        mnc_raw = self.g(rec, "mnc")
        mnc = mnc_raw.strip().zfill(2) if mnc_raw and mnc_raw.strip().isdigit() else (mnc_raw or self.declared.get("mnc") or None)
        lac = N.normalize_id(self.g(rec, "lac"), self.hex_ids)
        tac = N.normalize_id(self.g(rec, "tac"), self.hex_ids)
        cid = N.normalize_id(self.g(rec, "cell_id"), self.hex_ids)
        eci = N.normalize_id(self.g(rec, "eci"), self.hex_ids)
        nci = N.normalize_id(self.g(rec, "nci"), self.hex_ids)
        cgi = N.normalize_cgi(self.g(rec, "cgi"))
        erb_raw = self.g(rec, "erb_raw")
        if cgi and not (mcc and mnc and (cid or eci or nci)):
            parts = N.split_cgi(cgi)
            if parts:
                mcc = mcc or parts.get("mcc")
                mnc = mnc or parts.get("mnc")
        if self.declared.get("mcc") and not self.g(rec, "mcc"):
            warns.append("MCC declarado no assistente")
        if self.declared.get("mnc") and not mnc_raw:
            warns.append("MNC declarado no assistente")
        cell_key = N.build_cell_key(tech, mcc, mnc, lac, tac, cid, eci, nci, cgi, erb_raw)

        lat, le = N.parse_coord(self.g(rec, "lat"), "latitude")
        lon, lo = N.parse_coord(self.g(rec, "lon"), "longitude")
        for e in (le, lo):
            if e:
                warn("coordenada", "lat/lon", e)
        ci = N.coords_issue(lat, lon)
        if ci:
            warn("coordenada", "lat/lon", ci)
            if "0,0" in ci:
                lat = lon = None
        az = None
        az_raw = self.g(rec, "azimuth")
        if az_raw:
            try:
                az = float(az_raw.replace(",", "."))
                if not 0 <= az <= 360:
                    warn("azimute", "azimuth", f"azimute fora de 0–360: {az_raw}")
                    az = None
            except ValueError:
                warn("azimute", "azimuth", f"azimute não reconhecido: {az_raw!r}")

        # --- escopo autorizado
        out_of_scope = False
        d = local.date()
        if self.case.period_start and d < self.case.period_start or self.case.period_end and d > self.case.period_end:
            out_of_scope = True
            warn("fora_periodo_caso", "datetime", "evento fora do período autorizado do caso")
        t = self.targets.get(target or "")
        if t and ((t.period_start and d < t.period_start) or (t.period_end and d > t.period_end)):
            out_of_scope = True
            warn("fora_periodo_alvo", "datetime", "evento fora do período pertinente ao alvo")
        if target and self.targets and target not in self.targets:
            warn("alvo_nao_cadastrado", "target_number", "número alvo não cadastrado no caso")

        conf = raw.confidence if raw.confidence is not None else 1.0
        if raw.confidence is not None and raw.confidence < 0.8:
            warn("ocr_baixa_confianca", "*", f"linha obtida por OCR com confiança {raw.confidence:.0%} — revisar")

        ev = {
            "row_number": raw.row_number,
            "page": raw.page,
            "operator": self.operator,
            "event_type": et,
            "direction": direction,
            "a_number": a,
            "b_number": b,
            "a_raw": (a_raw or tgt_raw)[:80] if (a_raw or tgt_raw) else None,
            "b_raw": (b_raw or oth_raw)[:80] if (b_raw or oth_raw) else None,
            "target_number": target,
            "other_number": other,
            "ts_original": ts_original[:80],
            "ts_utc": ts_utc,
            "ts_local": local,
            "tz_name": tz_name,
            "tz_status": tz_status,
            "duration_s": dur,
            "status": (self.g(rec, "status") or None),
            "tech": tech,
            "mcc": mcc,
            "mnc": mnc,
            "lac": lac,
            "tac": tac,
            "cell_id": cid,
            "eci": eci,
            "nci": nci,
            "cgi": cgi,
            "erb_raw": erb_raw[:120] if erb_raw else None,
            "cell_key": cell_key,
            "lat": lat,
            "lon": lon,
            "azimuth": az,
            "imei": re.sub(r"\D", "", self.g(rec, "imei") or "")[:20] or None,
            "imsi": re.sub(r"\D", "", self.g(rec, "imsi") or "")[:20] or None,
            "ip": (self.g(rec, "ip") or None),
            "bytes_up": N.parse_int(self.g(rec, "bytes_up")),
            "bytes_down": N.parse_int(self.g(rec, "bytes_down")),
            "raw": rec,
            "warnings": warns,
            "confidence": conf,
            "out_of_scope": out_of_scope,
        }
        ev["dedup_hash"] = N.dedup_hash(target, a, b, ts_utc.isoformat(), dur, et, cell_key, ev["ip"])
        return ev, issues


def preview(db: Session, imp: Import, n: int = 300) -> dict:
    f = db.get(SourceFile, imp.file_id)
    case = db.get(Case, imp.case_id)
    targets = db.execute(select(Target).where(Target.case_id == imp.case_id)).scalars().all()
    table = open_table(f, imp.options.get("read"))
    rows_out, counts, issue_list = [], Counter(), []
    if imp.kind == "cdr":
        norm = RowNormalizer(imp.mapping, imp.options, case, targets, f)
        total = 0
        types = Counter()
        for raw, rec in table.rows():
            total += 1
            ev, issues = norm(raw, rec)
            for sev, code, field, msg in issues:
                counts[(sev, code)] += 1
                if len(issue_list) < 200:
                    issue_list.append({"row": raw.row_number, "page": raw.page, "severity": sev, "code": code, "field": field, "message": msg})
            if ev:
                types[ev["event_type"]] += 1
                if len(rows_out) < 50:
                    rows_out.append({k: (v.isoformat() if isinstance(v, datetime) else v) for k, v in ev.items() if k not in ("raw",)})
            if total >= n:
                break
        missing = [f for f in ("date", "datetime") if f in imp.mapping and imp.mapping[f]]
        required_problems = []
        if not missing:
            required_problems.append("mapeie a data/hora (campo único ou data + horário)")
        if not any(imp.mapping.get(k) for k in ("a_number", "b_number", "target_number", "other_number")) and not imp.options.get("target_number"):
            required_problems.append("mapeie ao menos um número ou informe o número alvo do arquivo")
        return {
            "rows": rows_out,
            "checked": total,
            "issues": issue_list,
            "issue_counts": [{"severity": k[0], "code": k[1], "count": v} for k, v in counts.most_common()],
            "event_types": dict(types),
            "required_problems": required_problems,
        }
    # cadastro de ERB
    total = 0
    for raw, rec in table.rows():
        total += 1
        cell, issues = normalize_erb_row(imp.mapping, imp.options, raw, rec)
        for sev, code, field, msg in issues:
            counts[(sev, code)] += 1
            if len(issue_list) < 200:
                issue_list.append({"row": raw.row_number, "severity": sev, "code": code, "field": field, "message": msg})
        if cell and len(rows_out) < 50:
            rows_out.append({k: v for k, v in cell.items() if k != "raw"})
        if total >= n:
            break
    required_problems = []
    if not any(imp.mapping.get(k) for k in ("cell_id", "eci", "nci", "cgi", "site_code")):
        required_problems.append("mapeie ao menos um identificador (CI, ECI, NCI, CGI ou código da estação)")
    return {
        "rows": rows_out,
        "checked": total,
        "issues": issue_list,
        "issue_counts": [{"severity": k[0], "code": k[1], "count": v} for k, v in counts.most_common()],
        "required_problems": required_problems,
    }


# ------------------------------------------------------------------ execução


def _copy_events(conn, rows: list[dict], base: dict) -> None:
    cur = conn.cursor()
    cols = ", ".join(EVENT_COPY_COLUMNS)
    with cur.copy(f"COPY events ({cols}) FROM STDIN") as cp:
        for ev in rows:
            rec = {**base, **ev}
            rec["raw"] = json.dumps(ev["raw"], ensure_ascii=False, default=str)
            rec["warnings"] = json.dumps(ev["warnings"], ensure_ascii=False)
            rec["is_duplicate"] = False
            rec["resolution_manual"] = False
            rec["revision"] = 0
            cp.write_row([rec.get(c) for c in EVENT_COPY_COLUMNS])


def recompute_duplicates(db: Session, case_id: int) -> int:
    res = db.execute(
        text(
            """
            UPDATE events e
               SET is_duplicate = (e.id <> f.first_id),
                   duplicate_of = NULLIF(f.first_id, e.id)
              FROM (SELECT dedup_hash, min(id) AS first_id FROM events WHERE case_id = :c GROUP BY dedup_hash) f
             WHERE e.case_id = :c AND e.dedup_hash = f.dedup_hash
               AND (e.is_duplicate IS DISTINCT FROM (e.id <> f.first_id)
                    OR e.duplicate_of IS DISTINCT FROM NULLIF(f.first_id, e.id))
            """
        ),
        {"c": case_id},
    )
    return res.rowcount or 0


def run_cdr_import(ctx, imp: Import) -> dict:
    db = ctx.db
    f = db.get(SourceFile, imp.file_id)
    case = db.get(Case, imp.case_id)
    targets = db.execute(select(Target).where(Target.case_id == imp.case_id)).scalars().all()
    # retomada idempotente: remove o que uma execução anterior interrompida tenha gravado
    db.execute(delete(Event).where(Event.import_id == imp.id))
    db.execute(delete(ImportIssue).where(ImportIssue.import_id == imp.id))
    db.commit()

    table = open_table(f, imp.options.get("read"))
    norm = RowNormalizer(imp.mapping, imp.options, case, targets, f)
    base = {"case_id": imp.case_id, "import_id": imp.id, "file_id": f.id, "file_sha256": f.sha256}
    est_total = int(imp.options.get("_estimated_rows") or 0)
    counts = Counter()
    issue_counter = Counter()
    batch: list[dict] = []
    issues_batch: list[dict] = []
    stored_issues = 0
    total = 0
    types = Counter()
    raw_conn = db.connection().connection.driver_connection  # psycopg na mesma transação
    for raw, rec in table.rows():
        total += 1
        if total > settings.max_rows_per_import:
            raise RuntimeError(f"arquivo excede o limite de {settings.max_rows_per_import} linhas por importação")
        ev, issues = norm(raw, rec)
        row_has_warning = False
        for sev, code, field, msg in issues:
            issue_counter[(sev, code)] += 1
            row_has_warning = row_has_warning or sev == "warning"
            if stored_issues < MAX_ISSUES_STORED:
                stored_issues += 1
                issues_batch.append({
                    "import_id": imp.id, "row_number": raw.row_number, "page": raw.page, "field": field,
                    "severity": sev, "code": code, "message": msg,
                    "raw": rec if sev == "error" else None,
                })
        if ev is None:
            counts["error"] += 1
        else:
            counts["ok"] += 1
            types[ev["event_type"]] += 1
            if row_has_warning:
                counts["warning"] += 1
            if ev["out_of_scope"]:
                counts["out_of_scope"] += 1
            batch.append(ev)
        if len(batch) >= BATCH:
            _copy_events(raw_conn, batch, base)
            batch.clear()
            if issues_batch:
                db.execute(insert(ImportIssue), issues_batch)
                issues_batch.clear()
            db.commit()
            ctx.progress(total, max(est_total, total), f"{total:,} linhas processadas".replace(",", "."), errors=counts["error"])
    if batch:
        _copy_events(raw_conn, batch, base)
    if issues_batch:
        db.execute(insert(ImportIssue), issues_batch)
    db.commit()
    ctx.check_cancel()
    ctx.progress(total, total, "marcando duplicidades", force=True)
    recompute_duplicates(db, imp.case_id)
    dup = db.execute(text("SELECT count(*) FROM events WHERE import_id = :i AND is_duplicate"), {"i": imp.id}).scalar()
    summary = {
        "event_types": dict(types),
        "issues": [{"severity": k[0], "code": k[1], "count": v} for k, v in issue_counter.most_common()],
        "issues_stored": stored_issues,
        "dedup_rule": "mesmo alvo, origem, destino, data/hora UTC, duração, tipo, célula e IP",
    }
    span = db.execute(
        text("SELECT min(ts_local), max(ts_local) FROM events WHERE import_id = :i"), {"i": imp.id}
    ).one()
    summary["period"] = [span[0].isoformat() if span[0] else None, span[1].isoformat() if span[1] else None]
    imp.rows_total, imp.rows_ok, imp.rows_error = total, counts["ok"], counts["error"]
    imp.rows_warning, imp.rows_duplicate, imp.rows_out_of_scope = counts["warning"], dup, counts["out_of_scope"]
    imp.summary = summary
    imp.status = "done"
    imp.finished_at = datetime.now(UTC)
    f.status = "processado"
    db.commit()
    return {"import_id": imp.id, "rows": total, "ok": counts["ok"], "errors": counts["error"], "duplicates": dup}


# ------------------------------------------------------------------ cadastro de ERB


def normalize_erb_row(mapping: dict, options: dict, raw, rec: dict) -> tuple[dict | None, list]:
    m = {k: v for k, v in (mapping or {}).items() if v}
    hex_ids = bool(options.get("hex_ids"))
    issues = []
    notes = []

    def g(field):
        col = m.get(field)
        v = rec.get(col) if col else None
        return v.strip() if isinstance(v, str) and v.strip() else None

    tech = N.normalize_tech(g("tech")) or N.normalize_tech(options.get("default_tech"))
    mcc = N.normalize_id(g("mcc")) or options.get("default_mcc") or None
    mnc_raw = g("mnc")
    mnc = mnc_raw.zfill(2) if mnc_raw and mnc_raw.isdigit() else (mnc_raw or options.get("default_mnc") or None)
    lac, tac = N.normalize_id(g("lac"), hex_ids), N.normalize_id(g("tac"), hex_ids)
    cid, eci, nci = N.normalize_id(g("cell_id"), hex_ids), N.normalize_id(g("eci"), hex_ids), N.normalize_id(g("nci"), hex_ids)
    cgi = N.normalize_cgi(g("cgi"))
    if cgi and not (mcc and mnc):
        parts = N.split_cgi(cgi)
        mcc = mcc or parts.get("mcc")
        mnc = mnc or parts.get("mnc")
    site_code = g("site_code")
    if not any([cid, eci, nci, cgi, site_code]):
        issues.append(("error", "sem_identificador", "cell_id", "linha sem identificador de célula ou estação"))
        return None, issues
    lat, le = N.parse_coord(g("lat"), "latitude")
    lon, lo = N.parse_coord(g("lon"), "longitude")
    status = "ok"
    for e in (le, lo):
        if e:
            issues.append(("warning", "coordenada", "lat/lon", e))
            notes.append(e)
    ci = N.coords_issue(lat, lon)
    if ci:
        issues.append(("warning", "coordenada", "lat/lon", ci))
        notes.append(ci)
        status = "coordenada_invalida" if "0,0" in ci else "verificar"
        if "0,0" in ci:
            lat = lon = None
    if lat is None or lon is None:
        status = "sem_coordenada" if status == "ok" else status
    az = None
    if g("azimuth"):
        try:
            az = float(g("azimuth").replace(",", "."))
            if not 0 <= az <= 360:
                issues.append(("warning", "azimute", "azimuth", f"azimute fora de 0–360: {g('azimuth')}"))
                notes.append("azimute inválido")
                az = None
        except ValueError:
            issues.append(("warning", "azimute", "azimuth", f"azimute não reconhecido: {g('azimuth')!r}"))
    bw = None
    if g("beamwidth"):
        try:
            bw = float(g("beamwidth").replace(",", "."))
        except ValueError:
            pass
    h = None
    if g("height_m"):
        try:
            h = float(g("height_m").replace(",", "."))
        except ValueError:
            pass
    op = (g("operator") or options.get("operator") or None)
    op = op.upper() if op else None
    return {
        "row_number": raw.row_number,
        "operator": op,
        "tech": tech,
        "mcc": mcc,
        "mnc": mnc,
        "lac": lac,
        "tac": tac,
        "cell_id": cid,
        "eci": eci,
        "nci": nci,
        "cgi": cgi,
        "cell_key": N.build_cell_key(tech, mcc, mnc, lac, tac, cid, eci, nci, cgi, None if (cid or eci or nci or cgi) else site_code),
        "site_code": site_code,
        "site_name": g("site_name"),
        "address": g("address"),
        "lat": lat,
        "lon": lon,
        "azimuth": az,
        "beamwidth": bw,
        "sector": g("sector"),
        "height_m": h,
        "validation_status": status,
        "validation_notes": notes,
        "raw": rec,
    }, issues


def run_erb_import(ctx, imp: Import) -> dict:
    db = ctx.db
    f = db.get(SourceFile, imp.file_id)
    old = db.execute(select(ErbRegistryVersion).where(ErbRegistryVersion.import_id == imp.id)).scalars().all()
    for v in old:
        db.delete(v)
    db.execute(delete(ImportIssue).where(ImportIssue.import_id == imp.id))
    db.commit()
    ref = imp.options.get("reference_date")
    version = ErbRegistryVersion(
        case_id=imp.case_id, import_id=imp.id, file_id=f.id,
        operator=(imp.options.get("operator") or f.operator_declared or None),
        name=imp.options.get("version_name") or f.original_name,
        reference_date=date.fromisoformat(ref) if ref else None,
    )
    db.add(version)
    db.flush()
    table = open_table(f, imp.options.get("read"))
    counts, issue_counter = Counter(), Counter()
    batch, issues_batch = [], []
    total = 0
    for raw, rec in table.rows():
        total += 1
        cell, issues = normalize_erb_row(imp.mapping, imp.options, raw, rec)
        for sev, code, field, msg in issues:
            issue_counter[(sev, code)] += 1
            if len(issues_batch) < MAX_ISSUES_STORED:
                issues_batch.append({"import_id": imp.id, "row_number": raw.row_number, "field": field, "severity": sev, "code": code, "message": msg, "raw": rec if sev == "error" else None})
        if cell is None:
            counts["error"] += 1
            continue
        counts["ok"] += 1
        if issues:
            counts["warning"] += 1
        batch.append({**cell, "case_id": imp.case_id, "version_id": version.id})
        if len(batch) >= 2000:
            db.execute(insert(ErbCell), batch)
            batch.clear()
            ctx.progress(total, None, f"{total} linhas do cadastro")
    if batch:
        db.execute(insert(ErbCell), batch)
    if issues_batch:
        db.execute(insert(ImportIssue), issues_batch)
    db.flush()
    # mesma célula com coordenadas diferentes dentro da mesma versão = conflito
    conflicts = db.execute(
        text(
            """
            UPDATE erb_cells c SET validation_status = 'conflito',
                   validation_notes = c.validation_notes || '["identificador repetido com coordenadas diferentes"]'::jsonb
              FROM (SELECT cell_key FROM erb_cells WHERE version_id = :v AND cell_key IS NOT NULL
                     GROUP BY cell_key HAVING count(DISTINCT (round(lat::numeric, 4), round(lon::numeric, 4))) > 1) d
             WHERE c.version_id = :v AND c.cell_key = d.cell_key
            """
        ),
        {"v": version.id},
    ).rowcount
    version.rows = counts["ok"]
    imp.rows_total, imp.rows_ok, imp.rows_error, imp.rows_warning = total, counts["ok"], counts["error"], counts["warning"]
    imp.summary = {
        "version_id": version.id,
        "conflicts": conflicts,
        "issues": [{"severity": k[0], "code": k[1], "count": v} for k, v in issue_counter.most_common()],
    }
    imp.status = "done"
    imp.finished_at = datetime.now(UTC)
    f.status = "processado"
    db.commit()
    return {"import_id": imp.id, "version_id": version.id, "rows": total, "ok": counts["ok"], "conflicts": conflicts}


def mark_import_finished(db: Session, import_id: int, status: str, message: str | None = None) -> None:
    db.execute(update(Import).where(Import.id == import_id).values(status=status, summary={"error": message} if message else {}))
    db.commit()
