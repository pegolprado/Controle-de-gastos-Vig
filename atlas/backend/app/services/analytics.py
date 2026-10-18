"""Consultas analíticas calculadas no servidor (PostgreSQL).

Toda resposta traz `criteria` (filtros e regras aplicadas) para que o resultado
possa ser reproduzido e aberto até os registros que o sustentam.
"""
from __future__ import annotations

import math
import statistics
from collections import defaultdict
from datetime import date, datetime, timedelta

from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..config import RULES_VERSION
from .normalize import EVENT_TYPES, normalize_number

VOICE_TYPES = ("voz_originada", "voz_recebida", "voz", "desvio")
SMS_TYPES = ("sms_enviado", "sms_recebido", "sms")


class EventFilter(BaseModel):
    numbers: list[str] = Field(default_factory=list)
    targets: list[str] = Field(default_factory=list)
    others: list[str] = Field(default_factory=list)
    event_types: list[str] = Field(default_factory=list)
    operators: list[str] = Field(default_factory=list)
    date_from: datetime | None = None
    date_to: datetime | None = None
    hour_from: int | None = Field(default=None, ge=0, le=23)
    hour_to: int | None = Field(default=None, ge=0, le=23)
    weekdays: list[int] = Field(default_factory=list)  # 1=segunda … 7=domingo
    dur_min: int | None = None
    dur_max: int | None = None
    cell_keys: list[str] = Field(default_factory=list)
    file_ids: list[int] = Field(default_factory=list)
    import_ids: list[int] = Field(default_factory=list)
    event_ids: list[int] = Field(default_factory=list)
    resolution: list[str] = Field(default_factory=list)
    tz_status: list[str] = Field(default_factory=list)
    only_clean: bool = False
    min_confidence: float | None = None
    include_duplicates: bool = False
    include_out_of_scope: bool = False
    imei: str | None = None
    ip: str | None = None


def _norm_list(nums: list[str]) -> list[str]:
    out = []
    for n in nums:
        v, _ = normalize_number(n)
        if v:
            out.append(v)
    return out


def where(case_id: int, f: EventFilter, a: str = "e") -> tuple[str, dict]:
    c = [f"{a}.case_id = :case_id"]
    p: dict = {"case_id": case_id}
    if not f.include_duplicates:
        c.append(f"NOT {a}.is_duplicate")
    if not f.include_out_of_scope:
        c.append(f"NOT {a}.out_of_scope")
    if f.numbers:
        p["numbers"] = _norm_list(f.numbers)
        c.append(f"({a}.target_number = ANY(:numbers) OR {a}.a_number = ANY(:numbers) OR {a}.b_number = ANY(:numbers))")
    if f.targets:
        p["targets"] = _norm_list(f.targets)
        c.append(f"{a}.target_number = ANY(:targets)")
    if f.others:
        p["others"] = _norm_list(f.others)
        c.append(f"{a}.other_number = ANY(:others)")
    if f.event_types:
        p["event_types"] = f.event_types
        c.append(f"{a}.event_type = ANY(:event_types)")
    if f.operators:
        p["operators"] = [o.upper() for o in f.operators]
        c.append(f"upper({a}.operator) = ANY(:operators)")
    if f.date_from:
        p["date_from"] = f.date_from.replace(tzinfo=None)
        c.append(f"{a}.ts_local >= :date_from")
    if f.date_to:
        dt = f.date_to.replace(tzinfo=None)
        if dt.hour == 0 and dt.minute == 0 and dt.second == 0:
            dt = dt + timedelta(days=1) - timedelta(microseconds=1)
        p["date_to"] = dt
        c.append(f"{a}.ts_local <= :date_to")
    if f.hour_from is not None and f.hour_to is not None:
        p["hf"], p["ht"] = f.hour_from, f.hour_to
        if f.hour_from <= f.hour_to:
            c.append(f"extract(hour from {a}.ts_local) BETWEEN :hf AND :ht")
        else:  # faixa que atravessa a meia-noite (ex.: 22h–5h)
            c.append(f"(extract(hour from {a}.ts_local) >= :hf OR extract(hour from {a}.ts_local) <= :ht)")
    if f.weekdays:
        p["weekdays"] = f.weekdays
        c.append(f"extract(isodow from {a}.ts_local)::int = ANY(:weekdays)")
    if f.dur_min is not None:
        p["dur_min"] = f.dur_min
        c.append(f"{a}.duration_s >= :dur_min")
    if f.dur_max is not None:
        p["dur_max"] = f.dur_max
        c.append(f"{a}.duration_s <= :dur_max")
    if f.cell_keys:
        p["cell_keys"] = f.cell_keys
        c.append(f"{a}.cell_key = ANY(:cell_keys)")
    if f.file_ids:
        p["file_ids"] = f.file_ids
        c.append(f"{a}.file_id = ANY(:file_ids)")
    if f.import_ids:
        p["import_ids"] = f.import_ids
        c.append(f"{a}.import_id = ANY(:import_ids)")
    if f.event_ids:
        p["event_ids"] = f.event_ids
        c.append(f"{a}.id = ANY(:event_ids)")
    if f.resolution:
        p["resolution"] = f.resolution
        if "pending" in f.resolution:
            c.append(f"({a}.resolution_status = ANY(:resolution) OR {a}.resolution_status IS NULL)")
        else:
            c.append(f"{a}.resolution_status = ANY(:resolution)")
    if f.tz_status:
        p["tz_status"] = f.tz_status
        c.append(f"{a}.tz_status = ANY(:tz_status)")
    if f.only_clean:
        c.append(f"jsonb_array_length({a}.warnings) = 0")
    if f.min_confidence is not None:
        p["min_conf"] = f.min_confidence
        c.append(f"{a}.confidence >= :min_conf")
    if f.imei:
        p["imei"] = f.imei.strip()
        c.append(f"{a}.imei = :imei")
    if f.ip:
        p["ip"] = f.ip.strip()
        c.append(f"{a}.ip = :ip")
    return " AND ".join(c), p


def criteria(f: EventFilter, **extra) -> dict:
    d = f.model_dump(mode="json", exclude_defaults=True)
    return {
        "filters": d,
        "rules_version": RULES_VERSION,
        "duplicates": "incluídos" if f.include_duplicates else "excluídos (mesmo alvo, origem, destino, data/hora, duração, tipo, célula e IP)",
        "out_of_scope": "incluídos" if f.include_out_of_scope else "excluídos (fora do período autorizado do caso/alvo)",
        "hours": "horário local conforme o documento de origem",
        **extra,
    }


def _rows(db: Session, sql: str, p: dict) -> list[dict]:
    return [dict(r) for r in db.execute(text(sql), p).mappings().all()]


def _iso(v):
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    return v


def _clean(rows: list[dict]) -> list[dict]:
    return [{k: _iso(v) for k, v in r.items()} for r in rows]


# ---------------------------------------------------------------- explorador


SORTABLE = {
    "ts": "e.ts_local", "duration": "e.duration_s", "type": "e.event_type", "a": "e.a_number",
    "b": "e.b_number", "target": "e.target_number", "cell": "e.cell_key", "id": "e.id",
}

EVENT_COLUMNS = """e.id, e.ts_local, e.ts_utc, e.tz_status, e.tz_name, e.ts_original, e.event_type, e.direction,
  e.target_number, e.other_number, e.a_number, e.b_number, e.duration_s, e.status, e.operator, e.tech, e.mcc, e.mnc,
  e.lac, e.tac, e.cell_id, e.eci, e.nci, e.cgi, e.erb_raw, e.cell_key, e.imei, e.ip, e.lat, e.lon,
  e.resolution_status, e.resolution_rule, e.resolution_note, e.resolved_cell_id, e.file_id, e.import_id,
  e.row_number, e.page, e.warnings, e.confidence, e.is_duplicate, e.duplicate_of, e.out_of_scope, e.revision,
  c.lat AS cell_lat, c.lon AS cell_lon, c.azimuth AS cell_azimuth, c.site_name AS cell_site, c.site_code AS cell_site_code"""


def list_events(db: Session, case_id: int, f: EventFilter, page: int = 1, size: int = 50, sort: str = "ts", order: str = "asc") -> dict:
    w, p = where(case_id, f)
    col = SORTABLE.get(sort, "e.ts_local")
    direction = "DESC" if order == "desc" else "ASC"
    size = max(1, min(size, 1000))
    p.update(limit=size, offset=(max(page, 1) - 1) * size)
    total = db.execute(text(f"SELECT count(*) FROM events e WHERE {w}"), p).scalar()
    rows = _rows(
        db,
        f"""SELECT {EVENT_COLUMNS} FROM events e LEFT JOIN erb_cells c ON c.id = e.resolved_cell_id
            WHERE {w} ORDER BY {col} {direction} NULLS LAST, e.id {direction} LIMIT :limit OFFSET :offset""",
        p,
    )
    return {"total": total, "page": page, "size": size, "items": _clean(rows), "criteria": criteria(f)}


def iter_events(db: Session, case_id: int, f: EventFilter, limit: int = 1_000_000):
    w, p = where(case_id, f)
    p["limit"] = limit
    res = db.execute(
        text(f"SELECT {EVENT_COLUMNS} FROM events e LEFT JOIN erb_cells c ON c.id = e.resolved_cell_id WHERE {w} ORDER BY e.ts_local, e.id LIMIT :limit"),
        p,
        execution_options={"stream_results": True, "yield_per": 5000},
    )
    for r in res.mappings():
        yield {k: _iso(v) for k, v in dict(r).items()}


# ---------------------------------------------------------------- estatísticas


def summary(db: Session, case_id: int, f: EventFilter) -> dict:
    w, p = where(case_id, f)
    p["voice"] = list(VOICE_TYPES)
    base = db.execute(
        text(
            f"""SELECT count(*) AS events,
                   count(*) FILTER (WHERE event_type = ANY(:voice)) AS calls,
                   count(*) FILTER (WHERE event_type LIKE 'sms%') AS sms,
                   count(*) FILTER (WHERE event_type = 'dados') AS data_sessions,
                   count(*) FILTER (WHERE direction = 'out') AS outgoing,
                   count(*) FILTER (WHERE direction = 'in') AS incoming,
                   count(*) FILTER (WHERE event_type = ANY(:voice) AND coalesce(duration_s,0) = 0) AS zero_duration_calls,
                   sum(duration_s) FILTER (WHERE event_type = ANY(:voice)) AS call_seconds,
                   avg(duration_s) FILTER (WHERE event_type = ANY(:voice) AND duration_s > 0) AS call_avg,
                   percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_s) FILTER (WHERE event_type = ANY(:voice) AND duration_s > 0) AS call_median,
                   count(DISTINCT ts_local::date) AS active_days,
                   count(DISTINCT other_number) AS distinct_contacts,
                   count(DISTINCT cell_key) AS distinct_cells,
                   count(DISTINCT imei) AS distinct_imeis,
                   min(ts_local) AS first_event, max(ts_local) AS last_event,
                   count(*) FILTER (WHERE tz_status <> 'confirmed') AS tz_not_confirmed,
                   count(*) FILTER (WHERE jsonb_array_length(warnings) > 0) AS with_warnings
              FROM events e WHERE {w}"""
        ),
        p,
    ).mappings().one()
    out = {k: _iso(v) for k, v in dict(base).items()}
    for k in ("call_avg", "call_median"):
        out[k] = round(out[k], 1) if out[k] is not None else None
    by_type = _rows(db, f"SELECT event_type, count(*) AS n FROM events e WHERE {w} GROUP BY 1 ORDER BY 2 DESC", p)
    for r in by_type:
        r["label"] = EVENT_TYPES.get(r["event_type"], r["event_type"])
    by_hour = _rows(db, f"SELECT extract(hour from ts_local)::int AS hour, count(*) AS n FROM events e WHERE {w} GROUP BY 1 ORDER BY 1", p)
    by_wd = _rows(db, f"SELECT extract(isodow from ts_local)::int AS weekday, count(*) AS n FROM events e WHERE {w} GROUP BY 1 ORDER BY 1", p)
    by_day = _rows(
        db,
        f"""SELECT ts_local::date AS day, count(*) AS n,
                   count(*) FILTER (WHERE event_type = ANY(:voice)) AS calls,
                   count(*) FILTER (WHERE event_type LIKE 'sms%') AS sms,
                   count(*) FILTER (WHERE event_type = 'dados') AS data
              FROM events e WHERE {w} GROUP BY 1 ORDER BY 1""",
        p,
    )
    gaps = db.execute(
        text(
            f"""SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY gap) AS median_gap, avg(gap) AS avg_gap, max(gap) AS max_gap
                  FROM (SELECT extract(epoch from ts_utc - lag(ts_utc) OVER (PARTITION BY target_number ORDER BY ts_utc)) AS gap
                          FROM events e WHERE {w}) g WHERE gap IS NOT NULL"""
        ),
        p,
    ).mappings().one()
    hidden_w, hidden_p = where(case_id, f.model_copy(update={"include_duplicates": True, "include_out_of_scope": True}))
    hidden = db.execute(
        text(f"SELECT count(*) FILTER (WHERE is_duplicate) AS duplicates, count(*) FILTER (WHERE out_of_scope) AS out_of_scope FROM events e WHERE {hidden_w}"),
        hidden_p,
    ).mappings().one()
    files = _rows(
        db,
        f"""SELECT s.id, s.original_name, s.sha256, count(*) AS n FROM events e JOIN source_files s ON s.id = e.file_id
             WHERE {w} GROUP BY s.id ORDER BY s.id""",
        p,
    )
    return {
        "totals": out,
        "by_type": by_type,
        "by_hour": by_hour,
        "by_weekday": by_wd,
        "by_day": _clean(by_day),
        "intervals_s": {k: (round(v, 1) if v is not None else None) for k, v in dict(gaps).items()},
        "excluded": dict(hidden),
        "sources": files,
        "criteria": criteria(
            f,
            duration_rule="durações somadas apenas para chamadas de voz; SMS e dados não entram no total de duração",
            interval_rule="intervalo entre eventos consecutivos do mesmo número alvo (UTC)",
        ),
    }


def contacts(db: Session, case_id: int, f: EventFilter, limit: int = 200) -> dict:
    w, p = where(case_id, f)
    p["voice"] = list(VOICE_TYPES)
    p["limit"] = limit
    rows = _rows(
        db,
        f"""SELECT e.target_number, e.other_number,
                   count(*) AS events,
                   count(DISTINCT ts_local::date) AS days,
                   count(*) FILTER (WHERE direction = 'out') AS outgoing,
                   count(*) FILTER (WHERE direction = 'in') AS incoming,
                   count(*) FILTER (WHERE event_type = ANY(:voice)) AS calls,
                   count(*) FILTER (WHERE event_type LIKE 'sms%') AS sms,
                   coalesce(sum(duration_s) FILTER (WHERE event_type = ANY(:voice)), 0) AS call_seconds,
                   min(ts_local) AS first_event, max(ts_local) AS last_event,
                   count(DISTINCT extract(hour from ts_local)) AS distinct_hours,
                   array_agg(DISTINCT file_id) AS file_ids
              FROM events e WHERE {w} AND other_number IS NOT NULL
             GROUP BY 1, 2 ORDER BY events DESC, days DESC LIMIT :limit""",
        p,
    )
    for r in rows:
        r["reciprocal"] = r["outgoing"] > 0 and r["incoming"] > 0
        span = (r["last_event"] - r["first_event"]).days + 1 if r["first_event"] else 1
        r["regularity"] = round(r["days"] / span, 3) if span else None
    return {
        "items": _clean(rows),
        "criteria": criteria(
            f,
            note="frequência de comunicação, isoladamente, não comprova vínculo pessoal nem participação em fato ilícito",
            regularity="dias com contato ÷ dias entre o primeiro e o último contato",
        ),
    }


def compare_periods(db: Session, case_id: int, f: EventFilter, p1: tuple[datetime, datetime], p2: tuple[datetime, datetime]) -> dict:
    def per(period):
        ff = f.model_copy(update={"date_from": period[0], "date_to": period[1]})
        w, p = where(case_id, ff)
        rows = _rows(db, f"SELECT target_number, other_number, count(*) AS n, count(DISTINCT ts_local::date) AS days FROM events e WHERE {w} AND other_number IS NOT NULL GROUP BY 1,2", p)
        days = max(((ff.date_to or datetime.now()) - (ff.date_from or datetime.now())).days + 1, 1)
        return {(r["target_number"], r["other_number"]): r for r in rows}, days

    a, da = per(p1)
    b, db_ = per(p2)
    items = []
    for key in set(a) | set(b):
        na = a.get(key, {}).get("n", 0)
        nb = b.get(key, {}).get("n", 0)
        ra, rb = na / da, nb / db_
        if na == 0:
            status = "novo"
        elif nb == 0:
            status = "deixou de ocorrer"
        elif rb >= ra * 1.5:
            status = "aumentou"
        elif rb <= ra / 1.5:
            status = "reduziu"
        else:
            status = "estável"
        items.append({
            "target_number": key[0], "other_number": key[1], "period1": na, "period2": nb,
            "rate1_per_day": round(ra, 3), "rate2_per_day": round(rb, 3),
            "days1": a.get(key, {}).get("days", 0), "days2": b.get(key, {}).get("days", 0), "status": status,
        })
    items.sort(key=lambda r: abs(r["rate2_per_day"] - r["rate1_per_day"]), reverse=True)
    return {
        "items": items[:500],
        "period1": [p1[0].isoformat(), p1[1].isoformat(), da],
        "period2": [p2[0].isoformat(), p2[1].isoformat(), db_],
        "criteria": criteria(f, rule="taxas normalizadas por dia; variação ≥ 1,5× = aumento/redução"),
    }


def compare_numbers(db: Session, case_id: int, numbers: list[str], f: EventFilter, window_s: int = 300) -> dict:
    nums = _norm_list(numbers)
    per = []
    for n in nums:
        ff = f.model_copy(update={"targets": [n]})
        s = summary(db, case_id, ff)
        per.append({
            "number": n, "totals": s["totals"], "by_hour": s["by_hour"], "by_weekday": s["by_weekday"],
        })
    cc = common_contacts(db, case_id, nums, f)
    w, p = where(case_id, f)
    p["nums"] = nums
    shared_cells = _rows(
        db,
        f"""SELECT e.cell_key, count(DISTINCT target_number) AS numbers, count(*) AS events,
                   jsonb_object_agg(target_number, cnt) AS per_number,
                   max(c.site_name) AS site_name, max(c.lat) AS lat, max(c.lon) AS lon
              FROM (SELECT cell_key, target_number, count(*) AS cnt, max(resolved_cell_id) AS rc
                      FROM events e WHERE {w} AND target_number = ANY(:nums) AND cell_key IS NOT NULL
                     GROUP BY 1, 2) e LEFT JOIN erb_cells c ON c.id = e.rc
             GROUP BY e.cell_key HAVING count(DISTINCT target_number) > 1 ORDER BY events DESC LIMIT 200""",
        p,
    )
    coin = coincidences(db, case_id, nums, f, window_s=window_s, same_cell=False, limit=200)
    direct = _rows(
        db,
        f"""SELECT a_number, b_number, count(*) AS n, min(ts_local) AS first_event, max(ts_local) AS last_event
              FROM events e WHERE {w} AND a_number = ANY(:nums) AND b_number = ANY(:nums) AND a_number <> b_number
             GROUP BY 1, 2""",
        p,
    )
    return {
        "numbers": nums,
        "per_number": per,
        "common_contacts": cc,
        "shared_cells": shared_cells,
        "direct_contacts": _clean(direct),
        "coincidences": coin,
        "criteria": criteria(f, window_s=window_s, note="compatibilidade temporal ou de célula não indica presença física conjunta"),
    }


def common_contacts(db: Session, case_id: int, numbers: list[str], f: EventFilter) -> dict:
    nums = _norm_list(numbers)
    w, p = where(case_id, f)
    p["nums"] = nums
    rows = _rows(
        db,
        f"""SELECT other_number, target_number, count(*) AS n, count(DISTINCT ts_local::date) AS days,
                   min(ts_local) AS first_event, max(ts_local) AS last_event
              FROM events e WHERE {w} AND target_number = ANY(:nums) AND other_number IS NOT NULL
             GROUP BY 1, 2""",
        p,
    )
    by_contact: dict[str, dict] = defaultdict(dict)
    for r in rows:
        by_contact[r["other_number"]][r["target_number"]] = {
            "n": r["n"], "days": r["days"], "first": _iso(r["first_event"]), "last": _iso(r["last_event"])
        }
    shared = []
    exclusive = defaultdict(list)
    for contact, per in by_contact.items():
        if contact in nums:
            continue
        if len(per) > 1:
            shared.append({"contact": contact, "per_number": per, "numbers": len(per), "total": sum(x["n"] for x in per.values())})
        else:
            (only,) = per.keys()
            exclusive[only].append({"contact": contact, **per[only]})
    shared.sort(key=lambda r: (r["numbers"], r["total"]), reverse=True)
    for k in exclusive:
        exclusive[k].sort(key=lambda r: r["n"], reverse=True)
        exclusive[k] = exclusive[k][:50]
    return {"numbers": nums, "shared": shared[:500], "exclusive": dict(exclusive), "criteria": criteria(f)}


def coincidences(db: Session, case_id: int, numbers: list[str], f: EventFilter, window_s: int = 300, same_cell: bool = False,
                 limit: int = 1000, same_site_m: int | None = None) -> dict:
    """Pares de eventos de números diferentes em janela temporal. Opcionalmente na
    mesma célula (mesma chave) ou em estações a até `same_site_m` metros (útil quando
    operadoras diferentes compartilham a mesma torre)."""
    nums = _norm_list(numbers)
    w1, p = where(case_id, f, "e1")
    w2, _ = where(case_id, f, "e2")
    p.update(nums=nums, win=window_s, limit=limit, site_m=same_site_m or 0)
    cell_cond = "AND e1.cell_key = e2.cell_key AND e1.cell_key IS NOT NULL" if same_cell else ""
    dist = ("6371000 * sqrt(power(radians(c2.lat - c1.lat), 2) + "
            "power(radians(c2.lon - c1.lon) * cos(radians((c1.lat + c2.lat) / 2)), 2))")
    site_cond = f"AND c1.lat IS NOT NULL AND c2.lat IS NOT NULL AND {dist} <= :site_m" if same_site_m else ""
    num_cond = "AND e1.target_number = ANY(:nums) AND e2.target_number = ANY(:nums)" if nums else "AND e1.target_number IS NOT NULL"
    rows = _rows(
        db,
        f"""SELECT e1.id AS id1, e2.id AS id2, e1.target_number AS number1, e2.target_number AS number2,
                   e1.ts_local AS ts1, e2.ts_local AS ts2, e1.event_type AS type1, e2.event_type AS type2,
                   e1.cell_key AS cell1, e2.cell_key AS cell2,
                   abs(extract(epoch from e2.ts_utc - e1.ts_utc))::int AS delta_s,
                   (e1.cell_key = e2.cell_key) AS same_cell,
                   CASE WHEN c1.lat IS NOT NULL AND c2.lat IS NOT NULL THEN round(({dist})::numeric)::int END AS distance_m,
                   c1.site_name AS site1, c2.site_name AS site2,
                   e1.tz_status AS tz1, e2.tz_status AS tz2
              FROM events e1 JOIN events e2
                ON e2.case_id = e1.case_id
               AND e2.ts_utc BETWEEN e1.ts_utc - make_interval(secs => :win) AND e1.ts_utc + make_interval(secs => :win)
               AND e2.target_number > e1.target_number
              LEFT JOIN erb_cells c1 ON c1.id = e1.resolved_cell_id
              LEFT JOIN erb_cells c2 ON c2.id = e2.resolved_cell_id
             WHERE {w1} AND {w2} {num_cond} {cell_cond} {site_cond}
             ORDER BY e1.ts_utc LIMIT :limit""",
        p,
    )
    for r in rows:
        r["tz_mixed"] = r["tz1"] != r["tz2"] or r["tz1"] != "confirmed"
    return {
        "items": _clean(rows),
        "truncated": len(rows) >= limit,
        "criteria": criteria(
            f, window_s=window_s, same_cell=same_cell, same_site_m=same_site_m,
            classification="coincidência temporal observada — não indica que os titulares estavam juntos fisicamente",
            distance="distância entre as coordenadas cadastradas das estações (não entre aparelhos)",
        ),
    }


# ---------------------------------------------------------------- vínculos


def link_graph(db: Session, case_id: int, f: EventFilter, center: str | None = None, depth: int = 2, min_events: int = 1, reciprocal_only: bool = False, max_edges: int = 3000) -> dict:
    w, p = where(case_id, f)
    p.update(min_events=min_events, max_edges=max_edges, voice=list(VOICE_TYPES))
    edges = _rows(
        db,
        f"""SELECT least(a_number, b_number) AS n1, greatest(a_number, b_number) AS n2,
                   count(*) AS events, count(DISTINCT ts_local::date) AS days,
                   count(*) FILTER (WHERE a_number = least(a_number, b_number)) AS n1_to_n2,
                   count(*) FILTER (WHERE a_number = greatest(a_number, b_number)) AS n2_to_n1,
                   coalesce(sum(duration_s) FILTER (WHERE event_type = ANY(:voice)), 0) AS call_seconds,
                   min(ts_local) AS first_event, max(ts_local) AS last_event,
                   array_agg(DISTINCT file_id) AS file_ids
              FROM events e WHERE {w} AND a_number IS NOT NULL AND b_number IS NOT NULL AND a_number <> b_number
             GROUP BY 1, 2 HAVING count(*) >= :min_events ORDER BY events DESC LIMIT :max_edges""",
        p,
    )
    for e in edges:
        e["reciprocal"] = e["n1_to_n2"] > 0 and e["n2_to_n1"] > 0
    if reciprocal_only:
        edges = [e for e in edges if e["reciprocal"]]
    if center:
        c, _ = normalize_number(center)
        adj = defaultdict(set)
        for e in edges:
            adj[e["n1"]].add(e["n2"])
            adj[e["n2"]].add(e["n1"])
        keep = {c}
        frontier = {c}
        for _ in range(max(depth, 1)):
            frontier = {n for x in frontier for n in adj[x]} - keep
            keep |= frontier
        edges = [e for e in edges if e["n1"] in keep and e["n2"] in keep]
    targets = {r["number_normalized"]: r for r in _rows(db, "SELECT number_normalized, label, internal_id FROM targets WHERE case_id = :c", {"c": case_id})}
    deg = defaultdict(int)
    weight = defaultdict(int)
    for e in edges:
        for n in (e["n1"], e["n2"]):
            deg[n] += 1
            weight[n] += e["events"]
    nodes = []
    for n in deg:
        t = targets.get(n)
        nodes.append({
            "id": n, "is_target": t is not None,
            "label": (t["label"] or t["internal_id"]) if t else None,
            "degree": deg[n], "events": weight[n],
        })
    # contatos em comum entre alvos (nós ligados a 2+ alvos)
    target_neighbors = defaultdict(set)
    for e in edges:
        if e["n1"] in targets:
            target_neighbors[e["n2"]].add(e["n1"])
        if e["n2"] in targets:
            target_neighbors[e["n1"]].add(e["n2"])
    for node in nodes:
        node["common_to_targets"] = len(target_neighbors.get(node["id"], ())) if not node["is_target"] else 0
    return {
        "nodes": nodes,
        "edges": _clean(edges),
        "truncated": len(edges) >= max_edges,
        "criteria": criteria(
            f, center=center, depth=depth, min_events=min_events, reciprocal_only=reciprocal_only,
            note="conexões representam registros documentados de comunicação, não prova de vínculo pessoal ou associação",
        ),
    }


# ---------------------------------------------------------------- linha do tempo


def timeline(db: Session, case_id: int, f: EventFilter, bucket: str = "day", gap_hours: float = 12, page: int = 1, size: int = 200) -> dict:
    w, p = where(case_id, f)
    trunc = "hour" if bucket == "hour" else "day"
    buckets = _rows(
        db,
        f"""SELECT date_trunc('{trunc}', ts_local) AS bucket, target_number, count(*) AS n
              FROM events e WHERE {w} GROUP BY 1, 2 ORDER BY 1""",
        p,
    )
    p["gap"] = gap_hours * 3600
    gaps = _rows(
        db,
        f"""SELECT target_number, prev_ts AS gap_start, ts_local AS gap_end, round(gap / 3600.0, 1) AS hours
              FROM (SELECT target_number, ts_local, lag(ts_local) OVER (PARTITION BY target_number ORDER BY ts_local) AS prev_ts,
                           extract(epoch from ts_local - lag(ts_local) OVER (PARTITION BY target_number ORDER BY ts_local)) AS gap
                      FROM events e WHERE {w}) g
             WHERE gap >= :gap ORDER BY gap DESC LIMIT 100""",
        p,
    )
    events = list_events(db, case_id, f, page=page, size=size, sort="ts", order="asc")
    ann = _rows(
        db,
        "SELECT a.id, a.ts_utc, a.number, a.text, u.name AS author, a.created_at FROM annotations a JOIN users u ON u.id = a.user_id WHERE a.case_id = :c ORDER BY a.ts_utc",
        {"c": case_id},
    )
    peak = sorted(buckets, key=lambda r: r["n"], reverse=True)[:10]
    return {
        "buckets": _clean(buckets),
        "peaks": _clean(peak),
        "gaps": _clean(gaps),
        "events": events,
        "annotations": _clean(ann),
        "criteria": criteria(f, bucket=bucket, gap_hours=gap_hours, tz_note="eventos com fuso não confirmado são sinalizados individualmente"),
    }


# ---------------------------------------------------------------- ERB / geografia


def cells(db: Session, case_id: int, f: EventFilter, limit: int = 500) -> dict:
    w, p = where(case_id, f)
    p["limit"] = limit
    rows = _rows(
        db,
        f"""SELECT e.cell_key, count(*) AS events, count(DISTINCT e.target_number) AS numbers,
                   array_agg(DISTINCT e.target_number) AS target_numbers,
                   min(e.ts_local) AS first_event, max(e.ts_local) AS last_event,
                   max(e.resolution_status) AS resolution_status, max(e.resolution_rule) AS resolution_rule,
                   max(e.resolution_note) AS resolution_note,
                   max(e.resolved_cell_id) AS cell_id_ref, max(e.tech) AS tech, max(e.operator) AS operator,
                   max(c.site_name) AS site_name, max(c.site_code) AS site_code, max(c.lat) AS lat, max(c.lon) AS lon,
                   max(c.azimuth) AS azimuth, max(c.beamwidth) AS beamwidth, max(c.address) AS address, max(c.version_id) AS version_id
              FROM events e LEFT JOIN erb_cells c ON c.id = e.resolved_cell_id
             WHERE {w} AND e.cell_key IS NOT NULL
             GROUP BY e.cell_key ORDER BY events DESC LIMIT :limit""",
        p,
    )
    res = _rows(
        db,
        f"SELECT coalesce(resolution_status, 'pendente') AS status, count(*) AS n FROM events e WHERE {w} GROUP BY 1",
        p,
    )
    no_id = db.execute(text(f"SELECT count(*) FROM events e WHERE {w} AND cell_key IS NULL"), p).scalar()
    return {
        "items": _clean(rows),
        "resolution": res,
        "events_without_cell": no_id,
        "criteria": criteria(f, limit_note="a ERB registrada não comprova a posição exata do aparelho ou da pessoa"),
    }


def cells_by_period(db: Session, case_id: int, f: EventFilter, p1, p2) -> dict:
    def per(period):
        ff = f.model_copy(update={"date_from": period[0], "date_to": period[1]})
        w, p = where(case_id, ff)
        return {r["cell_key"]: r["n"] for r in _rows(db, f"SELECT cell_key, count(*) AS n FROM events e WHERE {w} AND cell_key IS NOT NULL GROUP BY 1", p)}

    a, b = per(p1), per(p2)
    items = [{"cell_key": k, "period1": a.get(k, 0), "period2": b.get(k, 0),
              "status": "só período 1" if k not in b else "só período 2" if k not in a else "ambos"}
             for k in set(a) | set(b)]
    items.sort(key=lambda r: r["period1"] + r["period2"], reverse=True)
    return {"items": items[:500], "criteria": criteria(f)}


def registry(db: Session, case_id: int, q: str | None, version_id: int | None, status: str | None, page: int, size: int) -> dict:
    cond = ["c.case_id = :c"]
    p: dict = {"c": case_id, "limit": size, "offset": (page - 1) * size}
    if q:
        cond.append("(c.cell_key ILIKE :q OR c.site_name ILIKE :q OR c.site_code ILIKE :q OR c.cgi ILIKE :q OR c.address ILIKE :q OR c.cell_id = :qq OR c.eci = :qq)")
        p["q"] = f"%{q}%"
        p["qq"] = q
    if version_id:
        cond.append("c.version_id = :v")
        p["v"] = version_id
    if status:
        cond.append("c.validation_status = :st")
        p["st"] = status
    w = " AND ".join(cond)
    total = db.execute(text(f"SELECT count(*) FROM erb_cells c WHERE {w}"), p).scalar()
    rows = _rows(
        db,
        f"""SELECT c.*, v.name AS version_name, v.reference_date,
                   (SELECT count(*) FROM events e WHERE e.resolved_cell_id = c.id) AS events
              FROM erb_cells c JOIN erb_registry_versions v ON v.id = c.version_id
             WHERE {w} ORDER BY c.id LIMIT :limit OFFSET :offset""",
        p,
    )
    for r in rows:
        r.pop("raw", None)
    versions = _rows(db, "SELECT v.*, s.original_name, s.sha256 FROM erb_registry_versions v LEFT JOIN source_files s ON s.id = v.file_id WHERE v.case_id = :c ORDER BY v.id", {"c": case_id})
    status_counts = _rows(db, "SELECT validation_status, count(*) AS n FROM erb_cells WHERE case_id = :c GROUP BY 1", {"c": case_id})
    return {"total": total, "items": _clean(rows), "versions": _clean(versions), "status_counts": status_counts}


def geo_points(db: Session, case_id: int, f: EventFilter) -> dict:
    w, p = where(case_id, f)
    cells_rows = _rows(
        db,
        f"""SELECT c.id AS cell_ref, c.lat, c.lon, c.azimuth, c.beamwidth, c.site_name, c.site_code, c.tech, c.operator,
                   c.cell_key, c.address, c.version_id, count(*) AS events,
                   array_agg(DISTINCT e.target_number) AS numbers, min(e.ts_local) AS first_event, max(e.ts_local) AS last_event,
                   max(e.resolution_status) AS resolution_status
              FROM events e JOIN erb_cells c ON c.id = e.resolved_cell_id
             WHERE {w} AND c.lat IS NOT NULL AND c.lon IS NOT NULL
             GROUP BY c.id ORDER BY events DESC LIMIT 5000""",
        p,
    )
    provided = _rows(
        db,
        f"""SELECT round(e.lat::numeric, 5)::float AS lat, round(e.lon::numeric, 5)::float AS lon, max(e.azimuth) AS azimuth,
                   e.cell_key, count(*) AS events, array_agg(DISTINCT e.target_number) AS numbers,
                   min(e.ts_local) AS first_event, max(e.ts_local) AS last_event
              FROM events e WHERE {w} AND e.lat IS NOT NULL AND e.lon IS NOT NULL AND e.resolved_cell_id IS NULL
             GROUP BY 1, 2, e.cell_key ORDER BY events DESC LIMIT 5000""",
        p,
    )
    unresolved = db.execute(text(f"SELECT count(*) FROM events e WHERE {w} AND e.resolved_cell_id IS NULL AND e.lat IS NULL"), p).scalar()
    return {
        "registry_points": _clean(cells_rows),
        "document_points": _clean(provided),
        "events_without_coordinates": unresolved,
        "criteria": criteria(
            f,
            source="coordenadas do cadastro técnico importado (pontos de estação) ou informadas no próprio documento",
            limit_note="a coordenada é da estação/antena, não a localização do aparelho; setores são representações esquemáticas",
        ),
    }


def cell_sequence(db: Session, case_id: int, f: EventFilter, limit: int = 5000) -> dict:
    w, p = where(case_id, f)
    p["limit"] = limit
    rows = _rows(
        db,
        f"""SELECT e.id, e.ts_local, e.tz_status, e.target_number, e.event_type, e.cell_key, e.file_id, e.row_number,
                   coalesce(c.lat, e.lat) AS lat, coalesce(c.lon, e.lon) AS lon, coalesce(c.azimuth, e.azimuth) AS azimuth,
                   c.beamwidth, c.site_name, e.resolution_status,
                   CASE WHEN c.id IS NOT NULL THEN 'cadastro' WHEN e.lat IS NOT NULL THEN 'documento' END AS coord_source
              FROM events e LEFT JOIN erb_cells c ON c.id = e.resolved_cell_id
             WHERE {w} AND e.cell_key IS NOT NULL ORDER BY e.ts_utc, e.id LIMIT :limit""",
        p,
    )
    prev = None
    for r in rows:
        r["interval_s"] = int((r["ts_local"] - prev).total_seconds()) if prev else None
        r["cell_changed"] = None
        prev = r["ts_local"]
    for i in range(1, len(rows)):
        rows[i]["cell_changed"] = rows[i]["cell_key"] != rows[i - 1]["cell_key"]
    return {
        "items": _clean(rows),
        "truncated": len(rows) >= limit,
        "criteria": criteria(f, note="sequência de registros de rede; não representa trajeto físico, velocidade ou permanência"),
    }


# ---------------------------------------------------------------- padrões


def patterns(db: Session, case_id: int, f: EventFilter, z: float = 2.5) -> dict:
    s = summary(db, case_id, f)
    hours = {r["hour"]: r["n"] for r in s["by_hour"]}
    hv = [hours.get(h, 0) for h in range(24)]
    mean_h = statistics.mean(hv) if hv else 0
    sd_h = statistics.pstdev(hv) if len(hv) > 1 else 0
    hour_peaks = [{"hour": h, "n": hv[h], "z": round((hv[h] - mean_h) / sd_h, 2)} for h in range(24) if sd_h and (hv[h] - mean_h) / sd_h >= 1.5]
    days = s["by_day"]
    dv = [d["n"] for d in days]
    mean_d = statistics.mean(dv) if dv else 0
    sd_d = statistics.pstdev(dv) if len(dv) > 1 else 0
    day_anomalies = [
        {"day": d["day"], "n": d["n"], "z": round((d["n"] - mean_d) / sd_d, 2)}
        for d in days if sd_d and abs(d["n"] - mean_d) / sd_d >= z
    ]
    # dias sem registros dentro do intervalo observado
    gaps_days = []
    if days:
        present = {d["day"] for d in days}
        d0 = date.fromisoformat(days[0]["day"][:10])
        d1 = date.fromisoformat(days[-1]["day"][:10])
        cur = d0
        while cur <= d1:
            if cur.isoformat() not in {x[:10] for x in present}:
                gaps_days.append(cur.isoformat())
            cur += timedelta(days=1)
    # variação de contatos distintos por semana
    w, p = where(case_id, f)
    weekly = _clean(_rows(
        db,
        f"""SELECT date_trunc('week', ts_local)::date AS week, count(*) AS events, count(DISTINCT other_number) AS contacts
              FROM events e WHERE {w} GROUP BY 1 ORDER BY 1""",
        p,
    ))
    p["z"] = z
    unusual_intervals = _clean(_rows(
        db,
        f"""WITH g AS (
              SELECT id, target_number, ts_local,
                     extract(epoch from ts_utc - lag(ts_utc) OVER (PARTITION BY target_number ORDER BY ts_utc)) AS gap
                FROM events e WHERE {w})
            SELECT g.id, g.target_number, g.ts_local, round(g.gap)::int AS gap_s
              FROM g JOIN (SELECT target_number, avg(gap) AS m, stddev_pop(gap) AS sd FROM g WHERE gap IS NOT NULL GROUP BY 1) st
                ON st.target_number IS NOT DISTINCT FROM g.target_number
             WHERE st.sd > 0 AND (g.gap - st.m) / st.sd >= :z ORDER BY g.gap DESC LIMIT 50""",
        p,
    ))
    return {
        "hour_peaks": hour_peaks,
        "day_anomalies": day_anomalies,
        "days_without_events": gaps_days[:366],
        "weekly": weekly,
        "unusual_intervals": unusual_intervals,
        "stats": {"hour_mean": round(mean_h, 2), "hour_sd": round(sd_h, 2), "day_mean": round(mean_d, 2), "day_sd": round(sd_d, 2)},
        "criteria": criteria(
            f, z_threshold=z,
            method="z-score = (valor − média) ÷ desvio-padrão populacional; picos horários com z ≥ 1,5; dias anômalos com |z| ≥ limiar",
            note="padrões estatísticos indicam pontos para revisão, não conclusões",
        ),
    }


def safe_float(v):
    return None if v is None or (isinstance(v, float) and math.isnan(v)) else v
