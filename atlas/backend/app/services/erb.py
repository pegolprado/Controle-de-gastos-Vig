"""Motor de resolução de identificadores de célula contra o cadastro técnico.

Regras (aplicadas em ordem; a primeira que decide encerra):
  R1 id_completo   – tecnologia compatível + MCC + MNC + área (LAC/TAC) + CI/ECI/NCI → exata
  R2 cgi_exato     – CGI/ECGI/NCGI normalizado idêntico ao do cadastro → exata
  R3 id_sem_area   – CI/ECI/NCI + MCC/MNC (ou operadora) sem área no evento → provável
  R4 codigo_estacao– código/nome da estação informado no evento → provável (nível de estação)
Mais de um candidato com coordenadas diferentes → ambígua (lista de candidatos).
Nenhum candidato → "ERB não resolvida" com o motivo. Coordenadas NUNCA são
estimadas sem correspondência no cadastro.

Identificadores de tecnologias diferentes nunca são equiparados: CI (2G/3G),
ECI (4G) e NCI (5G) só se comparam com o mesmo tipo de identificador.
"""
from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from datetime import UTC, datetime

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from ..config import RULES_VERSION
from ..models import ErbCell, ErbRegistryVersion, ResolutionRun
from .normalize import haversine_m, split_cgi

SAME_SITE_M = 75.0


def _tech_ok(ev_tech: str | None, cell_tech: str | None, id_kind: str) -> bool:
    if id_kind == "eci":
        return cell_tech in (None, "4G")
    if id_kind == "nci":
        return cell_tech in (None, "5G")
    # CI: 2G e 3G têm espaços de identificadores distintos quando a tecnologia é conhecida
    if ev_tech and cell_tech:
        return ev_tech == cell_tech
    return cell_tech not in ("4G", "5G") or ev_tech in ("4G", "5G")


def _op_ok(ev_op: str | None, cell_op: str | None) -> bool:
    return not ev_op or not cell_op or ev_op.upper() == cell_op.upper()


def _pick_versions(cands: list[ErbCell], versions: dict[int, ErbRegistryVersion]) -> tuple[list[ErbCell], str | None]:
    """Quando a mesma célula aparece em várias versões, usa a mais recente e avisa se
    as coordenadas divergem."""
    by_identity = defaultdict(list)
    for c in cands:
        by_identity[(c.tech, c.mcc, c.mnc, c.lac, c.tac, c.cell_id, c.eci, c.nci, c.cgi, c.site_code, c.sector)].append(c)
    out, notes = [], []
    for group in by_identity.values():
        group.sort(key=lambda c: (versions[c.version_id].reference_date or datetime.min.date(), c.version_id), reverse=True)
        chosen = group[0]
        out.append(chosen)
        for other in group[1:]:
            if None not in (chosen.lat, chosen.lon, other.lat, other.lon):
                if haversine_m(chosen.lat, chosen.lon, other.lat, other.lon) > SAME_SITE_M:
                    notes.append(f"coordenadas divergentes entre versões {chosen.version_id} e {other.version_id} do cadastro")
    return out, ("; ".join(sorted(set(notes))) or None)


def _same_place(cells: list[ErbCell]) -> bool:
    pts = [(c.lat, c.lon) for c in cells if c.lat is not None and c.lon is not None]
    if len(pts) != len(cells) or not pts:
        return False
    return all(haversine_m(pts[0][0], pts[0][1], p[0], p[1]) <= SAME_SITE_M for p in pts[1:])


def resolve_signature(sig: dict, idx: dict, versions: dict) -> dict:
    tech, mcc, mnc, lac, tac = sig["tech"], sig["mcc"], sig["mnc"], sig["lac"], sig["tac"]
    cid, eci, nci, cgi, erb_raw, op = sig["cell_id"], sig["eci"], sig["nci"], sig["cgi"], sig["erb_raw"], sig["operator"]
    missing = []
    # Com MCC/MNC no próprio registro, a rede informada prevalece sobre a operadora
    # declarada para o arquivo (roaming nacional, compartilhamento de rede).
    file_op = op
    if mcc and mnc:
        op = None

    def finish(status, rule, cands, note=None):
        cands, vnote = _pick_versions(cands, versions) if cands else ([], None)
        onote = None
        if file_op and cands and all(c.operator and c.operator.upper() != file_op.upper() for c in cands):
            onote = f"célula de outra rede ({cands[0].operator}) no arquivo da {file_op}: verificar roaming/compartilhamento"
        notes = "; ".join(x for x in (note, vnote, onote) if x) or None
        if status in ("exact", "probable") and len(cands) > 1:
            if rule == "codigo_estacao" and _same_place(cands):
                # vários setores do mesmo local: resolve no nível da estação
                return {"status": "probable", "rule": rule, "cell": cands[0], "candidates": [c.id for c in cands],
                        "note": "resolvido no nível da estação (setor não identificado)" + (f"; {notes}" if notes else "")}
            return {"status": "ambiguous", "rule": rule, "cell": None, "candidates": [c.id for c in cands][:20],
                    "note": f"{len(cands)} células candidatas no cadastro" + (f"; {notes}" if notes else "")}
        return {"status": status, "rule": rule, "cell": cands[0] if cands else None, "candidates": [c.id for c in cands][:20], "note": notes}

    # R1 – identificador completo
    for kind, val in (("nci", nci), ("eci", eci), ("cell_id", cid)):
        if not val:
            continue
        pool = [c for c in idx[kind].get(val, []) if _tech_ok(tech, c.tech, kind) and _op_ok(op, c.operator)]
        if mcc and mnc and (lac or tac or kind in ("eci", "nci")):
            full = [
                c for c in pool
                if c.mcc == mcc and c.mnc == mnc
                and (kind != "cell_id" or (lac and c.lac == lac) or (tac and c.tac == tac))
                and (kind == "cell_id" or not tac or not c.tac or c.tac == tac)
            ]
            if full:
                return finish("exact", "id_completo", full)
        # R3 – sem área (ou sem MCC/MNC, desde que a operadora seja compatível)
        partial = [c for c in pool if (not mcc or not c.mcc or c.mcc == mcc) and (not mnc or not c.mnc or c.mnc == mnc)]
        if kind == "cell_id" and (lac or tac):
            partial = [c for c in partial if not (c.lac or c.tac) or (lac and c.lac == lac) or (tac and c.tac == tac)]
        if partial:
            if not mcc or not mnc:
                missing.append("MCC/MNC")
            if kind == "cell_id" and not (lac or tac):
                missing.append("LAC/TAC")
            return finish("probable", "id_sem_area", partial, f"identificador incompleto no evento (faltam {', '.join(missing) or 'componentes'})")
    # R2 – CGI
    if cgi:
        cgi_op = None if split_cgi(cgi) else op  # CGI separado já contém MCC/MNC
        cands = [c for c in idx["cgi"].get(cgi, []) if _op_ok(cgi_op, c.operator)]
        if cands:
            return finish("exact", "cgi_exato", cands)
    # R4 – código/nome da estação
    if erb_raw:
        key = erb_raw.strip().upper()
        cands = [c for c in idx["site"].get(key, []) if _op_ok(op, c.operator)]
        if cands:
            return finish("probable", "codigo_estacao", cands, "correspondência pelo código/nome da estação")
    if not any([cid, eci, nci, cgi, erb_raw]):
        reason = "evento sem identificador de célula"
    else:
        ident = cgi or nci or eci or cid or erb_raw
        reason = f"identificador {ident} não encontrado no cadastro técnico importado"
    return {"status": "none", "rule": "sem_correspondencia", "cell": None, "candidates": [], "note": f"ERB não resolvida: {reason}"}


def _cgi_from_parts(c: ErbCell) -> list[str]:
    out = []
    if c.cgi:
        out.append(c.cgi)
    if c.mcc and c.mnc:
        if c.cell_id and c.lac:
            out.append(f"{c.mcc}-{c.mnc}-{c.lac}-{c.cell_id}")
        if c.eci:
            out.append(f"{c.mcc}-{c.mnc}-{c.eci}")
        if c.nci:
            out.append(f"{c.mcc}-{c.mnc}-{c.nci}")
    return out


def build_index(db: Session, case_id: int, version_ids: list[int] | None) -> tuple[dict, dict]:
    q = select(ErbRegistryVersion).where(ErbRegistryVersion.case_id == case_id)
    if version_ids:
        q = q.where(ErbRegistryVersion.id.in_(version_ids))
    versions = {v.id: v for v in db.execute(q).scalars()}
    idx = {"cell_id": defaultdict(list), "eci": defaultdict(list), "nci": defaultdict(list), "cgi": defaultdict(list), "site": defaultdict(list)}
    if not versions:
        return idx, versions
    cells = db.execute(select(ErbCell).where(ErbCell.version_id.in_(list(versions)))).scalars()
    for c in cells:
        if c.cell_id:
            idx["cell_id"][c.cell_id].append(c)
        if c.eci:
            idx["eci"][c.eci].append(c)
        if c.nci:
            idx["nci"][c.nci].append(c)
        for k in _cgi_from_parts(c):
            idx["cgi"][k].append(c)
        for k in (c.site_code, c.site_name):
            if k:
                idx["site"][k.strip().upper()].append(c)
    return idx, versions


SIG_COLS = ("operator", "tech", "mcc", "mnc", "lac", "tac", "cell_id", "eci", "nci", "cgi", "erb_raw")
NULL_MARK = "\u2205"  # marcador de nulo usado igualmente no Python e no SQL
# Chave da assinatura calculada igual no Python e no SQL (junção por igualdade = hash join).
SIG_SQL = "md5(concat_ws('|', " + ", ".join(f"coalesce(e.{c}, '{NULL_MARK}')" for c in SIG_COLS) + "))"


def _sig_key(s) -> str:
    return hashlib.md5("|".join(NULL_MARK if s[c] is None else str(s[c]) for c in SIG_COLS).encode()).hexdigest()


def run_resolution(db: Session, case_id: int, version_ids: list[int] | None, user_id: int | None, progress=None) -> dict:
    idx, versions = build_index(db, case_id, version_ids)
    sigs = db.execute(
        text(
            f"""SELECT {', '.join(SIG_COLS)}, count(*) AS n FROM events
                 WHERE case_id = :c AND NOT resolution_manual
                 GROUP BY {', '.join(SIG_COLS)}"""
        ),
        {"c": case_id},
    ).mappings().all()
    stats = defaultdict(int)
    stats_events = defaultdict(int)
    rows = []
    for i, s in enumerate(sigs):
        if not any(s[k] for k in ("cell_id", "eci", "nci", "cgi", "erb_raw")):
            r = {"status": "none", "rule": "sem_identificador", "cell": None, "candidates": [], "note": "ERB não resolvida: evento sem identificador de célula"}
        elif not versions:
            r = {"status": "none", "rule": "sem_cadastro", "cell": None, "candidates": [], "note": "ERB não resolvida: nenhum cadastro técnico importado no caso"}
        else:
            r = resolve_signature(dict(s), idx, versions)
        cell = r["cell"]
        rows.append((_sig_key(s), cell.id if cell else None, r["status"], r["rule"], cell.version_id if cell else None, r["note"], json.dumps(r["candidates"])))
        stats[r["status"]] += 1
        stats_events[r["status"]] += s["n"]
        if progress and i % 200 == 0:
            progress(i, len(sigs))
    cur = db.connection().connection.driver_connection.cursor()
    cur.execute("CREATE TEMP TABLE IF NOT EXISTS _sig_res (k text PRIMARY KEY, cell int, st text, rule text, ver int, note text, cands jsonb) ON COMMIT DROP")
    cur.execute("TRUNCATE _sig_res")
    with cur.copy("COPY _sig_res (k, cell, st, rule, ver, note, cands) FROM STDIN") as cp:
        for row in rows:
            cp.write_row(row)
    db.execute(
        text(
            f"""UPDATE events e SET resolved_cell_id = r.cell, resolution_status = r.st, resolution_rule = r.rule,
                       resolution_version_id = r.ver, resolution_note = r.note, resolution_candidates = r.cands
                  FROM _sig_res r
                 WHERE e.case_id = :c AND NOT e.resolution_manual AND {SIG_SQL} = r.k"""
        ),
        {"c": case_id},
    )
    result = {
        "signatures": len(sigs),
        "by_status_signatures": dict(stats),
        "by_status_events": dict(stats_events),
        "versions": [{"id": v.id, "name": v.name, "reference_date": v.reference_date.isoformat() if v.reference_date else None} for v in versions.values()],
        "rules_version": RULES_VERSION,
        "finished_at": datetime.now(UTC).isoformat(),
    }
    db.add(ResolutionRun(case_id=case_id, params={"version_ids": version_ids}, result=result, rules_version=RULES_VERSION, created_by=user_id))
    db.commit()
    return result
