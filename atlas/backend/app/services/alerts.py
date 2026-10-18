"""Regras de alerta analítico.

Alertas apontam padrões que merecem revisão humana. Nunca classificam pessoas
como suspeitas ou culpadas.
"""
from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from ..config import RULES_VERSION
from ..models import Alert, AlertRule
from .analytics import EventFilter, _rows, coincidences, compare_periods, where
from .normalize import format_number

RULE_TYPES = {
    "volume_diario": {
        "label": "Quantidade de eventos acima de um limite (por número/dia)",
        "params": {"threshold": 50},
    },
    "mudanca_frequencia": {
        "label": "Mudança significativa na frequência de contatos entre períodos",
        "params": {"period1_from": None, "period1_to": None, "period2_from": None, "period2_to": None, "min_events": 5},
    },
    "faixa_horaria": {
        "label": "Eventos em faixa de horário acima de um limite (por número/dia)",
        "params": {"hour_from": 0, "hour_to": 5, "threshold": 5},
    },
    "mesma_celula_janela": {
        "label": "Registros de múltiplos números na mesma célula (ou mesmo local de estação) e janela temporal",
        "params": {"window_s": 600, "same_site_m": 200},
    },
    "divergencia_cadastro": {
        "label": "Divergência entre cadastros técnicos de ERB",
        "params": {},
    },
    "horario_inconsistente": {
        "label": "Registros com horários inconsistentes",
        "params": {},
    },
    "duplicidades": {
        "label": "Duplicidades suspeitas",
        "params": {"min": 1},
    },
}


def _fp(*parts) -> str:
    return hashlib.sha256(json.dumps(parts, default=str, sort_keys=True).encode()).hexdigest()


def _add(db: Session, rule: AlertRule, key, title: str, description: str, support: list[int], params: dict, existing: set) -> int:
    fp = _fp(rule.rule_type, rule.id, key)
    if fp in existing:
        return 0
    existing.add(fp)
    db.add(Alert(
        case_id=rule.case_id, rule_id=rule.id, rule_type=rule.rule_type, title=title[:300], description=description,
        params=params, support_event_ids=support[:500], support_count=len(support), severity=rule.severity,
        rules_version=RULES_VERSION, fingerprint=fp,
    ))
    return 1


def _dt(v):
    return datetime.fromisoformat(v) if v else None


def run_rules(db: Session, case_id: int, rule_ids: list[int] | None = None) -> dict:
    q = select(AlertRule).where(AlertRule.case_id == case_id, AlertRule.active)
    if rule_ids:
        q = q.where(AlertRule.id.in_(rule_ids))
    rules = db.execute(q).scalars().all()
    existing = set(db.execute(select(Alert.fingerprint).where(Alert.case_id == case_id)).scalars())
    created = {}
    base = EventFilter()
    w, p = where(case_id, base)
    for r in rules:
        n = 0
        prm = {**RULE_TYPES.get(r.rule_type, {}).get("params", {}), **(r.params or {})}
        if r.rule_type == "volume_diario":
            p2 = {**p, "th": int(prm["threshold"])}
            for row in _rows(db, f"""SELECT target_number, ts_local::date AS day, count(*) AS n, array_agg(id ORDER BY ts_local) AS ids
                                         FROM events e WHERE {w} GROUP BY 1, 2 HAVING count(*) > :th ORDER BY n DESC LIMIT 500""", p2):
                n += _add(db, r, (row["target_number"], str(row["day"])),
                          f"{row['n']} eventos de {format_number(row['target_number'])} em {row['day']:%d/%m/%Y}",
                          f"Quantidade diária acima do limite configurado ({prm['threshold']}).", row["ids"],
                          {"threshold": prm["threshold"], "number": row["target_number"], "day": str(row["day"])}, existing)
        elif r.rule_type == "faixa_horaria":
            hf, ht = int(prm["hour_from"]), int(prm["hour_to"])
            ff = base.model_copy(update={"hour_from": hf, "hour_to": ht})
            w2, p2 = where(case_id, ff)
            p2["th"] = int(prm["threshold"])
            for row in _rows(db, f"""SELECT target_number, ts_local::date AS day, count(*) AS n, array_agg(id ORDER BY ts_local) AS ids
                                         FROM events e WHERE {w2} GROUP BY 1, 2 HAVING count(*) >= :th ORDER BY n DESC LIMIT 500""", p2):
                n += _add(db, r, (row["target_number"], str(row["day"]), hf, ht),
                          f"{row['n']} eventos entre {hf}h e {ht}h — {format_number(row['target_number'])} em {row['day']:%d/%m/%Y}",
                          f"Eventos na faixa {hf:02d}h–{ht:02d}h (horário do documento) acima do limite ({prm['threshold']}).",
                          row["ids"], {**prm, "number": row["target_number"], "day": str(row["day"])}, existing)
        elif r.rule_type == "mudanca_frequencia":
            if not all(prm.get(k) for k in ("period1_from", "period1_to", "period2_from", "period2_to")):
                span = db.execute(text(f"SELECT min(ts_local), max(ts_local) FROM events e WHERE {w}"), p).one()
                if not span[0]:
                    continue
                mid = span[0] + (span[1] - span[0]) / 2
                p1, p2_ = (span[0], mid), (mid + timedelta(seconds=1), span[1])
            else:
                p1 = (_dt(prm["period1_from"]), _dt(prm["period1_to"]))
                p2_ = (_dt(prm["period2_from"]), _dt(prm["period2_to"]))
            res = compare_periods(db, case_id, base, p1, p2_)
            for it in res["items"]:
                if it["status"] in ("aumentou", "novo") and it["period2"] >= int(prm.get("min_events", 5)):
                    ids = [x["id"] for x in _rows(db, f"SELECT id FROM events e WHERE {w} AND target_number = :t AND other_number = :o AND ts_local BETWEEN :a AND :b ORDER BY ts_local LIMIT 500",
                                                    {**p, "t": it["target_number"], "o": it["other_number"], "a": p2_[0], "b": p2_[1]})]
                    n += _add(db, r, (it["target_number"], it["other_number"], str(p1), str(p2_)),
                              f"Contato {format_number(it['other_number'])} {it['status']} para {format_number(it['target_number'])}",
                              f"Taxa diária passou de {it['rate1_per_day']} para {it['rate2_per_day']} entre os períodos comparados.",
                              ids, {"period1": [str(x) for x in p1], "period2": [str(x) for x in p2_], **it}, existing)
        elif r.rule_type == "mesma_celula_janela":
            site_m = int(prm.get("same_site_m") or 0) or None
            res = coincidences(db, case_id, [], base, window_s=int(prm["window_s"]), same_cell=site_m is None, limit=2000, same_site_m=site_m)
            groups = {}
            for it in res["items"]:
                place = it["site1"] or it["cell1"]
                key = (place, it["number1"], it["number2"], it["ts1"][:10])
                groups.setdefault(key, []).extend([it["id1"], it["id2"]])
            where_txt = f"estações a até {site_m} m" if site_m else "mesma célula"
            for key, ids in groups.items():
                n += _add(db, r, key, f"{format_number(key[1])} e {format_number(key[2])} — {key[0]} — {key[3][8:10]}/{key[3][5:7]}/{key[3][:4]}",
                          f"Registros dos dois números ({where_txt}) em janela de até {prm['window_s']} s. Coincidência de registros de rede não indica presença física conjunta.",
                          sorted(set(ids)), {**prm, "place": key[0]}, existing)
        elif r.rule_type == "divergencia_cadastro":
            for row in _rows(db, "SELECT cell_key, count(*) AS n, array_agg(id) AS ids FROM erb_cells WHERE case_id = :c AND validation_status = 'conflito' GROUP BY 1", {"c": case_id}):
                n += _add(db, r, ("conflito", row["cell_key"]), f"Cadastro de ERB com coordenadas conflitantes: {row['cell_key']}",
                          f"{row['n']} linhas do cadastro com o mesmo identificador e coordenadas diferentes.", [], {"erb_cell_ids": row["ids"]}, existing)
            for row in _rows(db, f"SELECT resolution_note, count(*) AS n, array_agg(id) AS ids FROM events e WHERE {w} AND resolution_note LIKE '%divergentes entre versões%' GROUP BY 1", p):
                n += _add(db, r, ("versoes", row["resolution_note"]), "Coordenadas divergentes entre versões do cadastro",
                          row["resolution_note"], row["ids"], {}, existing)
        elif r.rule_type == "horario_inconsistente":
            checks = [
                ("futuro", "ts_utc > now()", "Registros com data/hora no futuro"),
                ("antigo", "ts_local < '2000-01-01'", "Registros com data anterior a 2000"),
                ("fuso", "tz_status = 'unknown'", "Registros com fuso horário desconhecido"),
            ]
            for key, cond, title in checks:
                ids = [x["id"] for x in _rows(db, f"SELECT id FROM events e WHERE {w} AND {cond} ORDER BY id LIMIT 500", p)]
                cnt = db.execute(text(f"SELECT count(*) FROM events e WHERE {w} AND {cond}"), p).scalar()
                if cnt:
                    n += _add(db, r, (key, cnt), f"{title}: {cnt}", "Verifique o fuso e o formato de data definidos na importação.", ids, {"count": cnt}, existing)
            oos = db.execute(text("SELECT count(*), array_agg(id) FILTER (WHERE true) FROM (SELECT id FROM events WHERE case_id = :c AND out_of_scope LIMIT 500) x"), {"c": case_id}).one()
            if oos[0]:
                n += _add(db, r, ("fora_periodo", oos[0]), f"Registros fora do período autorizado: {oos[0]}+",
                          "Esses registros ficam fora das análises por padrão. O aviso não amplia o escopo autorizado.", oos[1] or [], {}, existing)
        elif r.rule_type == "duplicidades":
            for row in _rows(db, """SELECT s.original_name, e.file_id, count(*) AS n, array_agg(e.id ORDER BY e.id) AS ids
                                      FROM events e JOIN source_files s ON s.id = e.file_id
                                     WHERE e.case_id = :c AND e.is_duplicate GROUP BY 1, 2 HAVING count(*) >= :m""",
                             {"c": case_id, "m": int(prm.get("min", 1))}):
                n += _add(db, r, (row["file_id"], row["n"]), f"{row['n']} registros duplicados em {row['original_name']}",
                          "Registros idênticos a outros já importados (não contabilizados nas estatísticas).", row["ids"], {"file_id": row["file_id"]}, existing)
        created[r.id] = n
    db.commit()
    return {"created": created, "rules": len(rules), "ran_at": datetime.now(UTC).isoformat()}


def ensure_default_rules(db: Session, case_id: int, user_id: int | None) -> None:
    if db.execute(select(AlertRule.id).where(AlertRule.case_id == case_id).limit(1)).scalar():
        return
    defaults = [
        ("Volume diário elevado", "volume_diario", {"threshold": 40}, "media"),
        ("Atividade de madrugada", "faixa_horaria", {"hour_from": 0, "hour_to": 5, "threshold": 5}, "baixa"),
        ("Mudança de frequência de contatos", "mudanca_frequencia", {"min_events": 5}, "media"),
        ("Números no mesmo local de estação (10 min)", "mesma_celula_janela", {"window_s": 600, "same_site_m": 200}, "media"),
        ("Divergência no cadastro de ERB", "divergencia_cadastro", {}, "alta"),
        ("Horários inconsistentes", "horario_inconsistente", {}, "alta"),
        ("Duplicidades", "duplicidades", {"min": 1}, "baixa"),
    ]
    for name, t, prm, sev in defaults:
        db.add(AlertRule(case_id=case_id, name=name, rule_type=t, params=prm, severity=sev, created_by=user_id))
    db.commit()
