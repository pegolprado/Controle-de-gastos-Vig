"""Cruzamento multifonte: validação prévia e correspondência de registros recíprocos.

Exemplo: a chamada A→B aparece na bilhetagem de A (originada) e na de B (recebida),
possivelmente fornecidas por operadoras diferentes. O cruzamento procura, para cada
registro de A cujo interlocutor também é alvo com dados no caso, o registro
correspondente na bilhetagem do interlocutor.

Classificação:
  exata     – mesmo instante (±1 s) e mesma duração (±1 s)
  provável  – dentro da tolerância de tempo e de duração configuradas, candidato único
  ambígua   – mais de um candidato dentro da tolerância
  ausente   – nenhum candidato, embora o interlocutor tenha registros no período
"""
from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session

from .analytics import EventFilter, _clean, _rows, criteria, where


def validate(db: Session, case_id: int, file_ids: list[int]) -> dict:
    p = {"c": case_id, "files": file_ids or [0]}
    fcond = "AND e.file_id = ANY(:files)" if file_ids else ""
    per_file = _rows(
        db,
        f"""SELECT s.id AS file_id, s.original_name, s.sha256, s.operator_declared, s.detected_format,
                   count(e.id) AS events,
                   count(*) FILTER (WHERE e.tz_status = 'confirmed') AS tz_confirmed,
                   count(*) FILTER (WHERE e.tz_status = 'assumed') AS tz_assumed,
                   count(*) FILTER (WHERE e.tz_status = 'unknown') AS tz_unknown,
                   count(*) FILTER (WHERE e.is_duplicate) AS duplicates,
                   count(*) FILTER (WHERE e.out_of_scope) AS out_of_scope,
                   count(*) FILTER (WHERE jsonb_array_length(e.warnings) > 0) AS with_warnings,
                   count(*) FILTER (WHERE e.other_number IS NOT NULL AND e.other_number NOT LIKE '+%') AS non_e164_numbers,
                   count(*) FILTER (WHERE e.cell_key IS NULL) AS without_cell,
                   min(e.ts_local) AS first_event, max(e.ts_local) AS last_event,
                   array_agg(DISTINCT e.target_number) AS targets
              FROM source_files s JOIN events e ON e.file_id = s.id
             WHERE s.case_id = :c {fcond}
             GROUP BY s.id ORDER BY s.id""",
        p,
    )
    checks = []
    tz_kinds = {k for r in per_file for k in ("confirmed", "assumed", "unknown") if r[f"tz_{k}"]}
    checks.append({
        "check": "Fuso horário",
        "ok": tz_kinds <= {"confirmed"},
        "detail": "todos confirmados" if tz_kinds <= {"confirmed"} else f"há horários {', '.join(sorted(tz_kinds))}: comparações temporais entre arquivos com fusos diferentes ou desconhecidos exigem cautela",
    })
    non_e164 = sum(r["non_e164_numbers"] for r in per_file)
    checks.append({"check": "Normalização dos números", "ok": non_e164 == 0,
                   "detail": "todos no formato E.164" if non_e164 == 0 else f"{non_e164} registros com números curtos/sem DDD ou formato não reconhecido"})
    dups = sum(r["duplicates"] for r in per_file)
    checks.append({"check": "Duplicidades", "ok": dups == 0, "detail": f"{dups} registros duplicados (excluídos do cruzamento)"})
    oos = sum(r["out_of_scope"] for r in per_file)
    checks.append({"check": "Período autorizado", "ok": oos == 0, "detail": f"{oos} registros fora do período autorizado (excluídos)"})
    periods = [(r["first_event"], r["last_event"]) for r in per_file if r["first_event"]]
    overlap = None
    if len(periods) > 1:
        start = max(p[0] for p in periods)
        end = min(p[1] for p in periods)
        overlap = (start, end) if start <= end else None
    checks.append({"check": "Sobreposição de períodos", "ok": overlap is not None or len(periods) <= 1,
                   "detail": f"período comum: {overlap[0]:%d/%m/%Y} a {overlap[1]:%d/%m/%Y}" if overlap else ("um único arquivo" if len(periods) <= 1 else "arquivos sem período em comum")})
    checks.append({"check": "Proveniência", "ok": all(r["sha256"] for r in per_file),
                   "detail": "todos os arquivos com SHA-256 registrado no recebimento"})
    warn = sum(r["with_warnings"] for r in per_file)
    checks.append({"check": "Qualidade", "ok": warn == 0, "detail": f"{warn} registros com alertas de validação"})
    return {"files": _clean(per_file), "checks": checks}


def reciprocal_match(db: Session, case_id: int, f: EventFilter, tol_s: int = 60, dur_tol_s: int = 5, limit: int = 500) -> dict:
    w, p = where(case_id, f, "e1")
    p.update(tol=tol_s, dtol=dur_tol_s, limit=limit)
    sql = f"""
    WITH cover AS (
        SELECT target_number, min(ts_utc) AS t0, max(ts_utc) AS t1
          FROM events WHERE case_id = :case_id AND NOT is_duplicate AND target_number IS NOT NULL GROUP BY 1
    ), base AS (
        SELECT e1.*,
               CASE WHEN e1.event_type LIKE 'voz%' OR e1.event_type = 'desvio' THEN 'voz'
                    WHEN e1.event_type LIKE 'sms%' THEN 'sms' ELSE e1.event_type END AS fam
          FROM events e1 JOIN cover cv ON cv.target_number = e1.other_number
         WHERE {w} AND e1.target_number IS NOT NULL AND e1.other_number IS NOT NULL
           AND e1.target_number < e1.other_number
           AND e1.ts_utc BETWEEN cv.t0 - make_interval(secs => :tol) AND cv.t1 + make_interval(secs => :tol)
           AND e1.event_type IN ('voz_originada','voz_recebida','voz','sms_enviado','sms_recebido','sms','desvio')
    ), m AS (
        SELECT b.id, b.target_number, b.other_number, b.ts_local, b.event_type, b.duration_s, b.file_id,
               c.n, c.ids, c.best_delta, c.best_dur_diff, c.files
          FROM base b
          LEFT JOIN LATERAL (
              SELECT count(*) AS n,
                     array_agg(e2.id ORDER BY abs(extract(epoch from e2.ts_utc - b.ts_utc))) AS ids,
                     min(abs(extract(epoch from e2.ts_utc - b.ts_utc))) AS best_delta,
                     min(abs(coalesce(e2.duration_s, -1) - coalesce(b.duration_s, -1))) AS best_dur_diff,
                     array_agg(DISTINCT e2.file_id) AS files
                FROM events e2
               WHERE e2.case_id = b.case_id AND e2.target_number = b.other_number AND e2.other_number = b.target_number
                 AND NOT e2.is_duplicate AND e2.file_id <> b.file_id
                 AND e2.ts_utc BETWEEN b.ts_utc - make_interval(secs => :tol) AND b.ts_utc + make_interval(secs => :tol)
                 AND (CASE WHEN e2.event_type LIKE 'voz%' OR e2.event_type = 'desvio' THEN 'voz'
                           WHEN e2.event_type LIKE 'sms%' THEN 'sms' ELSE e2.event_type END) = b.fam
                 AND (b.duration_s IS NULL OR e2.duration_s IS NULL OR abs(e2.duration_s - b.duration_s) <= :dtol)
          ) c ON true
    )
    SELECT *, CASE
                WHEN coalesce(n, 0) = 0 THEN 'ausente'
                WHEN n > 1 THEN 'ambigua'
                WHEN best_delta <= 1 AND coalesce(best_dur_diff, 0) <= 1 THEN 'exata'
                ELSE 'provavel' END AS match_class
      FROM m
    """
    totals = _rows(db, f"SELECT match_class, count(*) AS n FROM ({sql}) x GROUP BY 1", p)
    items = _rows(db, f"SELECT * FROM ({sql}) x ORDER BY ts_local LIMIT :limit", p)
    return {
        "totals": {r["match_class"]: r["n"] for r in totals},
        "items": _clean(items),
        "criteria": criteria(
            f, time_tolerance_s=tol_s, duration_tolerance_s=dur_tol_s,
            scope="somente registros de voz/SMS entre dois alvos com dados no caso, dentro do período coberto pelo interlocutor",
            classes="exata: ±1 s e mesma duração; provável: candidato único na tolerância; ambígua: múltiplos candidatos; ausente: nenhum",
        ),
    }
