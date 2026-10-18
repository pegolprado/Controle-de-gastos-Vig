from __future__ import annotations

import csv
import io
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from .. import audit
from ..db import get_db
from ..deps import CaseAccess, case_access, case_exporter, case_writer, client_ip
from ..jobs import enqueue
from ..models import Annotation, ErbCell, Event, EventCorrection, SavedQuery, SourceFile, Target
from ..services import analytics as A
from ..services import assistant
from ..services import crossmatch as X
from ..services import importer
from ..services.normalize import EVENT_TYPES, dedup_hash, normalize_number, to_utc
from .admin import job_out

router = APIRouter(prefix="/cases/{case_id}", tags=["analysis"])


class SearchIn(BaseModel):
    filter: A.EventFilter = Field(default_factory=A.EventFilter)
    page: int = 1
    size: int = 50
    sort: str = "ts"
    order: str = "asc"


@router.get("/meta")
def meta(access: CaseAccess = Depends(case_access), db: Session = Depends(get_db)):
    c = access.case.id
    return {
        "event_types": EVENT_TYPES,
        "operators": [r[0] for r in db.execute(text("SELECT DISTINCT operator FROM events WHERE case_id = :c AND operator IS NOT NULL ORDER BY 1"), {"c": c})],
        "files": [{"id": f.id, "name": f.original_name, "kind": f.kind} for f in db.execute(select(SourceFile).where(SourceFile.case_id == c).order_by(SourceFile.id)).scalars()],
        "targets": [{"number": t.number_normalized, "label": t.label or t.internal_id} for t in db.execute(select(Target).where(Target.case_id == c).order_by(Target.id)).scalars()],
        "span": [str(x) if x else None for x in db.execute(text("SELECT min(ts_local), max(ts_local) FROM events WHERE case_id = :c"), {"c": c}).one()],
    }


@router.post("/events/search")
def search(body: SearchIn, access: CaseAccess = Depends(case_access), db: Session = Depends(get_db)):
    return A.list_events(db, access.case.id, body.filter, body.page, body.size, body.sort, body.order)


@router.get("/events/{eid}")
def event_detail(eid: int, request: Request, access: CaseAccess = Depends(case_access), db: Session = Depends(get_db)):
    e = db.get(Event, eid)
    if not e or e.case_id != access.case.id:
        raise HTTPException(404)
    f = db.get(SourceFile, e.file_id)
    cell = db.get(ErbCell, e.resolved_cell_id) if e.resolved_cell_id else None
    cands = []
    if e.resolution_candidates:
        cands = [{"id": c.id, "cell_key": c.cell_key, "site_name": c.site_name, "lat": c.lat, "lon": c.lon, "version_id": c.version_id}
                 for c in db.execute(select(ErbCell).where(ErbCell.id.in_(e.resolution_candidates))).scalars()]
    corrections = db.execute(select(EventCorrection).where(EventCorrection.event_id == e.id).order_by(EventCorrection.id)).scalars().all()
    data = {c.name: getattr(e, c.name) for c in Event.__table__.columns}
    data = {k: (v.isoformat() if isinstance(v, datetime) else v) for k, v in data.items()}
    audit.log(db, "evento.visualizado", access.user, case_id=access.case.id, entity="event", entity_id=e.id, ip=client_ip(request))
    return {
        "event": data,
        "file": {"id": f.id, "name": f.original_name, "sha256": f.sha256, "format": f.detected_format},
        "cell": {k: getattr(cell, k) for k in ("id", "cell_key", "site_name", "site_code", "address", "lat", "lon", "azimuth", "beamwidth", "tech", "operator", "version_id", "validation_status")} if cell else None,
        "candidates": cands,
        "corrections": [{"id": c.id, "field": c.field, "old": c.old_value, "new": c.new_value, "reason": c.reason, "revision": c.revision,
                         "user_id": c.user_id, "at": c.created_at.isoformat()} for c in corrections],
        "type_label": EVENT_TYPES.get(e.event_type, e.event_type),
    }


CORRECTABLE = {"event_type", "direction", "a_number", "b_number", "target_number", "other_number", "duration_s", "ts_local", "status"}


class CorrectionIn(BaseModel):
    field: str
    value: str | None
    reason: str = Field(min_length=5)


@router.post("/events/{eid}/correct")
def correct(eid: int, body: CorrectionIn, request: Request, access: CaseAccess = Depends(case_writer), db: Session = Depends(get_db)):
    """Correção manual: nova revisão auditável; valor original fica em `raw` e no histórico.
    Relatórios já emitidos não mudam (são arquivos congelados com hash)."""
    e = db.get(Event, eid)
    if not e or e.case_id != access.case.id:
        raise HTTPException(404)
    if body.field not in CORRECTABLE:
        raise HTTPException(422, "Campo não corrigível")
    old = getattr(e, body.field)
    val: object = body.value
    if body.field in ("a_number", "b_number", "target_number", "other_number"):
        val, _ = normalize_number(body.value)
    elif body.field == "duration_s":
        val = int(body.value) if body.value not in (None, "") else None
    elif body.field == "event_type":
        if body.value not in EVENT_TYPES:
            raise HTTPException(422, "Tipo inválido")
    elif body.field == "direction":
        if body.value not in ("out", "in", "unknown"):
            raise HTTPException(422, "Sentido inválido")
    elif body.field == "ts_local":
        try:
            val = datetime.fromisoformat(body.value)
        except (TypeError, ValueError) as ex:
            raise HTTPException(422, "Data/hora inválida (use AAAA-MM-DDTHH:MM:SS)") from ex
        e.ts_utc = to_utc(val, None, e.tz_name if e.tz_name and "/" in e.tz_name else "America/Sao_Paulo")
    e.revision += 1
    setattr(e, body.field, val)
    e.warnings = list(e.warnings or []) + [f"campo {body.field} corrigido manualmente (revisão {e.revision})"]
    e.dedup_hash = dedup_hash(e.target_number, e.a_number, e.b_number, e.ts_utc.isoformat() if e.ts_utc else None, e.duration_s, e.event_type, e.cell_key, e.ip)
    db.add(EventCorrection(event_id=e.id, case_id=e.case_id, field=body.field, old_value=None if old is None else str(old),
                           new_value=None if val is None else str(val), reason=body.reason, user_id=access.user.id, revision=e.revision))
    db.commit()
    importer.recompute_duplicates(db, access.case.id)
    db.commit()
    audit.log(db, "evento.corrigido", access.user, case_id=access.case.id, entity="event", entity_id=e.id, ip=client_ip(request),
              details={"campo": body.field, "revisao": e.revision, "motivo": body.reason})
    return {"ok": True, "revision": e.revision}


class ExportIn(BaseModel):
    filter: A.EventFilter = Field(default_factory=A.EventFilter)
    fmt: str = "csv"


@router.post("/events/export")
def export(body: ExportIn, request: Request, access: CaseAccess = Depends(case_exporter), db: Session = Depends(get_db)):
    cols = ["id", "ts_local", "tz_status", "tz_name", "event_type", "direction", "target_number", "other_number", "a_number", "b_number",
            "duration_s", "operator", "tech", "mcc", "mnc", "lac", "tac", "cell_id", "eci", "nci", "cgi", "erb_raw", "cell_key",
            "resolution_status", "cell_lat", "cell_lon", "imei", "ip", "file_id", "row_number", "page", "ts_original"]
    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    audit.log(db, "eventos.exportados", access.user, case_id=access.case.id, ip=client_ip(request),
              details={"formato": body.fmt, "filtros": body.filter.model_dump(mode="json", exclude_defaults=True)})
    header = f"# Exportação MARX · caso {access.case.code} · {stamp} UTC · por {access.user.email}" + (" · DEMONSTRAÇÃO" if access.case.is_demo else "")
    if body.fmt == "xlsx":
        from openpyxl import Workbook

        wb = Workbook(write_only=True)
        ws = wb.create_sheet("Eventos")
        ws.append([header])
        ws.append(cols)
        for r in A.iter_events(db, access.case.id, body.filter, limit=1_000_000):
            ws.append([r.get(c) for c in cols])
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                                 headers={"Content-Disposition": f'attachment; filename="{access.case.code}-eventos-{stamp}.xlsx"'})

    def gen():
        s = io.StringIO()
        w = csv.writer(s, delimiter=";")
        s.write("﻿" + header + "\n")
        w.writerow(cols)
        for i, r in enumerate(A.iter_events(db, access.case.id, body.filter, limit=5_000_000)):
            w.writerow([r.get(c) for c in cols])
            if i % 2000 == 0:
                yield s.getvalue()
                s.seek(0)
                s.truncate()
        yield s.getvalue()

    return StreamingResponse(gen(), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="{access.case.code}-eventos-{stamp}.csv"'})


# ------------------------------------------------------------------ consultas salvas


class SavedIn(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    filters: dict


@router.get("/saved-queries")
def saved(access: CaseAccess = Depends(case_access), db: Session = Depends(get_db)):
    rows = db.execute(select(SavedQuery).where(SavedQuery.case_id == access.case.id).order_by(SavedQuery.id.desc())).scalars()
    return [{"id": r.id, "name": r.name, "filters": r.filters, "user_id": r.user_id, "created_at": r.created_at.isoformat()} for r in rows]


@router.post("/saved-queries")
def save_query(body: SavedIn, access: CaseAccess = Depends(case_access), db: Session = Depends(get_db)):
    A.EventFilter(**body.filters)  # valida
    q = SavedQuery(case_id=access.case.id, user_id=access.user.id, name=body.name, filters=body.filters)
    db.add(q)
    db.commit()
    return {"id": q.id}


@router.delete("/saved-queries/{qid}")
def delete_query(qid: int, access: CaseAccess = Depends(case_access), db: Session = Depends(get_db)):
    q = db.get(SavedQuery, qid)
    if not q or q.case_id != access.case.id or (q.user_id != access.user.id and not access.can_write):
        raise HTTPException(404)
    db.delete(q)
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ análises


class FIn(BaseModel):
    filter: A.EventFilter = Field(default_factory=A.EventFilter)


@router.post("/analytics/summary")
def summary(body: FIn, access: CaseAccess = Depends(case_access), db: Session = Depends(get_db)):
    return A.summary(db, access.case.id, body.filter)


class ContactsIn(FIn):
    limit: int = 200


@router.post("/analytics/contacts")
def contacts(body: ContactsIn, access: CaseAccess = Depends(case_access), db: Session = Depends(get_db)):
    return A.contacts(db, access.case.id, body.filter, min(body.limit, 2000))


class PeriodsIn(FIn):
    period1: tuple[datetime, datetime]
    period2: tuple[datetime, datetime]


@router.post("/analytics/compare-periods")
def compare_periods(body: PeriodsIn, access: CaseAccess = Depends(case_access), db: Session = Depends(get_db)):
    return A.compare_periods(db, access.case.id, body.filter, body.period1, body.period2)


class NumbersIn(FIn):
    numbers: list[str]
    window_s: int = Field(default=300, ge=1, le=86400)
    same_cell: bool = False
    same_site_m: int | None = Field(default=None, ge=1, le=50000)


@router.post("/analytics/compare-numbers")
def compare_numbers(body: NumbersIn, access: CaseAccess = Depends(case_access), db: Session = Depends(get_db)):
    if len(body.numbers) < 2:
        raise HTTPException(422, "Selecione ao menos dois números")
    return A.compare_numbers(db, access.case.id, body.numbers, body.filter, body.window_s)


@router.post("/analytics/common-contacts")
def common_contacts(body: NumbersIn, access: CaseAccess = Depends(case_access), db: Session = Depends(get_db)):
    return A.common_contacts(db, access.case.id, body.numbers, body.filter)


@router.post("/analytics/coincidences")
def coincidences(body: NumbersIn, access: CaseAccess = Depends(case_access), db: Session = Depends(get_db)):
    return A.coincidences(db, access.case.id, body.numbers, body.filter, body.window_s, body.same_cell, limit=2000, same_site_m=body.same_site_m)


class GraphIn(FIn):
    center: str | None = None
    depth: int = Field(default=2, ge=1, le=4)
    min_events: int = Field(default=1, ge=1)
    reciprocal_only: bool = False


@router.post("/analytics/graph")
def graph(body: GraphIn, access: CaseAccess = Depends(case_access), db: Session = Depends(get_db)):
    return A.link_graph(db, access.case.id, body.filter, body.center, body.depth, body.min_events, body.reciprocal_only)


class TimelineIn(FIn):
    bucket: str = "day"
    gap_hours: float = 12
    page: int = 1
    size: int = 200


@router.post("/analytics/timeline")
def timeline(body: TimelineIn, access: CaseAccess = Depends(case_access), db: Session = Depends(get_db)):
    return A.timeline(db, access.case.id, body.filter, body.bucket, body.gap_hours, body.page, min(body.size, 1000))


class PatternsIn(FIn):
    z: float = 2.5


@router.post("/analytics/patterns")
def patterns(body: PatternsIn, access: CaseAccess = Depends(case_access), db: Session = Depends(get_db)):
    return A.patterns(db, access.case.id, body.filter, body.z)


# ------------------------------------------------------------------ ERB e geografia


@router.post("/erb/cells")
def erb_cells(body: FIn, access: CaseAccess = Depends(case_access), db: Session = Depends(get_db)):
    return A.cells(db, access.case.id, body.filter)


@router.post("/erb/cells-by-period")
def erb_by_period(body: PeriodsIn, access: CaseAccess = Depends(case_access), db: Session = Depends(get_db)):
    return A.cells_by_period(db, access.case.id, body.filter, body.period1, body.period2)


@router.get("/erb/registry")
def erb_registry(access: CaseAccess = Depends(case_access), db: Session = Depends(get_db), q: str | None = None,
                 version_id: int | None = None, status: str | None = None, page: int = 1, size: int = 50):
    return A.registry(db, access.case.id, q, version_id, status, max(page, 1), min(size, 500))


class ResolveIn(BaseModel):
    version_ids: list[int] | None = None


@router.post("/erb/resolve")
def erb_resolve(body: ResolveIn, request: Request, access: CaseAccess = Depends(case_writer), db: Session = Depends(get_db)):
    job = enqueue(db, "resolve_erb", {"version_ids": body.version_ids}, access.case.id, access.user.id)
    db.commit()
    audit.log(db, "erb.resolucao_iniciada", access.user, case_id=access.case.id, entity="job", entity_id=job.id, ip=client_ip(request), details={"versoes": body.version_ids})
    return job_out(job)


@router.get("/erb/runs")
def erb_runs(access: CaseAccess = Depends(case_access), db: Session = Depends(get_db)):
    rows = db.execute(text("SELECT r.id, r.params, r.result, r.rules_version, r.created_at, u.name AS user_name FROM resolution_runs r LEFT JOIN users u ON u.id = r.created_by WHERE r.case_id = :c ORDER BY r.id DESC LIMIT 20"), {"c": access.case.id}).mappings()
    return [{**dict(r), "created_at": r["created_at"].isoformat()} for r in rows]


class ManualIn(BaseModel):
    cell_key: str
    erb_cell_id: int | None = None  # None = marcar como não resolvida
    note: str = Field(min_length=5)


@router.post("/erb/manual")
def erb_manual(body: ManualIn, request: Request, access: CaseAccess = Depends(case_writer), db: Session = Depends(get_db)):
    """Revisão manual: o analista escolhe o candidato (ou confirma ausência).
    Fica marcado como manual e não é sobrescrito por novas execuções automáticas."""
    cell = None
    if body.erb_cell_id:
        cell = db.get(ErbCell, body.erb_cell_id)
        if not cell or cell.case_id != access.case.id:
            raise HTTPException(404, "Célula do cadastro não encontrada")
    n = db.execute(
        text("""UPDATE events SET resolved_cell_id = :cid, resolution_status = :st, resolution_rule = 'manual',
                       resolution_version_id = :ver, resolution_note = :note, resolution_manual = true
                 WHERE case_id = :c AND cell_key = :k"""),
        {"cid": cell.id if cell else None, "st": "exact" if cell else "none", "ver": cell.version_id if cell else None,
         "note": f"revisão manual: {body.note}", "c": access.case.id, "k": body.cell_key},
    ).rowcount
    db.commit()
    audit.log(db, "erb.revisao_manual", access.user, case_id=access.case.id, entity="cell_key", entity_id=body.cell_key, ip=client_ip(request),
              details={"erb_cell_id": body.erb_cell_id, "eventos": n, "nota": body.note})
    return {"ok": True, "events": n}


@router.post("/erb/manual/reset")
def erb_manual_reset(body: ManualIn, request: Request, access: CaseAccess = Depends(case_writer), db: Session = Depends(get_db)):
    n = db.execute(text("UPDATE events SET resolution_manual = false WHERE case_id = :c AND cell_key = :k"), {"c": access.case.id, "k": body.cell_key}).rowcount
    db.commit()
    audit.log(db, "erb.revisao_manual_desfeita", access.user, case_id=access.case.id, entity="cell_key", entity_id=body.cell_key, ip=client_ip(request), details={"eventos": n})
    return {"ok": True, "events": n}


@router.get("/erb/candidates")
def erb_candidates(cell_key: str, access: CaseAccess = Depends(case_access), db: Session = Depends(get_db)):
    """Candidatos do cadastro para uma chave de célula (para a revisão manual)."""
    parts = cell_key.split("|")
    ident = parts[-1] if parts else ""
    q = select(ErbCell).where(ErbCell.case_id == access.case.id)
    if ident[:1] in ("C", "E", "N") and ident[1:].isdigit():
        col = {"C": ErbCell.cell_id, "E": ErbCell.eci, "N": ErbCell.nci}[ident[0]]
        q = q.where(col == ident[1:])
    elif parts[0] == "CGI":
        q = q.where(ErbCell.cgi == "|".join(parts[1:]))
    elif parts[0] == "ERB":
        q = q.where((ErbCell.site_code.ilike("|".join(parts[1:]))) | (ErbCell.site_name.ilike("|".join(parts[1:]))))
    rows = db.execute(q.limit(50)).scalars()
    return [{"id": c.id, "cell_key": c.cell_key, "tech": c.tech, "mcc": c.mcc, "mnc": c.mnc, "lac": c.lac, "tac": c.tac, "site_name": c.site_name,
             "site_code": c.site_code, "lat": c.lat, "lon": c.lon, "azimuth": c.azimuth, "version_id": c.version_id, "operator": c.operator,
             "validation_status": c.validation_status} for c in rows]


@router.post("/geo/points")
def geo_points(body: FIn, access: CaseAccess = Depends(case_access), db: Session = Depends(get_db)):
    return A.geo_points(db, access.case.id, body.filter)


@router.post("/geo/sequence")
def geo_sequence(body: FIn, access: CaseAccess = Depends(case_access), db: Session = Depends(get_db)):
    return A.cell_sequence(db, access.case.id, body.filter)


# ------------------------------------------------------------------ cruzamento multifonte


class CrossIn(FIn):
    file_ids: list[int] = Field(default_factory=list)
    tol_s: int = Field(default=60, ge=0, le=3600)
    dur_tol_s: int = Field(default=5, ge=0, le=600)


@router.post("/crossmatch/validate")
def cross_validate(body: CrossIn, access: CaseAccess = Depends(case_access), db: Session = Depends(get_db)):
    return X.validate(db, access.case.id, body.file_ids)


@router.post("/crossmatch/reciprocal")
def cross_reciprocal(body: CrossIn, access: CaseAccess = Depends(case_access), db: Session = Depends(get_db)):
    f = body.filter
    if body.file_ids:
        f = f.model_copy(update={"file_ids": body.file_ids})
    return X.reciprocal_match(db, access.case.id, f, body.tol_s, body.dur_tol_s)


# ------------------------------------------------------------------ anotações e assistente


class AnnotationIn(BaseModel):
    ts_utc: datetime
    number: str | None = None
    text: str = Field(min_length=2, max_length=4000)


@router.post("/annotations")
def add_annotation(body: AnnotationIn, request: Request, access: CaseAccess = Depends(case_writer), db: Session = Depends(get_db)):
    a = Annotation(case_id=access.case.id, ts_utc=body.ts_utc, number=normalize_number(body.number)[0] if body.number else None, text=body.text, user_id=access.user.id)
    db.add(a)
    db.commit()
    audit.log(db, "anotacao.criada", access.user, case_id=access.case.id, entity="annotation", entity_id=a.id, ip=client_ip(request))
    return {"id": a.id}


@router.delete("/annotations/{aid}")
def del_annotation(aid: int, request: Request, access: CaseAccess = Depends(case_writer), db: Session = Depends(get_db)):
    a = db.get(Annotation, aid)
    if not a or a.case_id != access.case.id:
        raise HTTPException(404)
    db.delete(a)
    db.commit()
    audit.log(db, "anotacao.removida", access.user, case_id=access.case.id, entity="annotation", entity_id=aid, ip=client_ip(request))
    return {"ok": True}


class AskIn(BaseModel):
    question: str = Field(min_length=3, max_length=500)


@router.post("/assistant")
def ask(body: AskIn, request: Request, access: CaseAccess = Depends(case_access), db: Session = Depends(get_db)):
    targets = [t.number_normalized for t in db.execute(select(Target).where(Target.case_id == access.case.id).order_by(Target.id)).scalars()]
    audit.log(db, "assistente.consulta", access.user, case_id=access.case.id, ip=client_ip(request), details={"pergunta": body.question[:300]})
    return assistant.answer(db, access.case.id, body.question, targets)



class ExportLogIn(BaseModel):
    kind: str = Field(max_length=60)
    filters: dict = {}


@router.post("/exports/log")
def export_log(body: ExportLogIn, request: Request, access: CaseAccess = Depends(case_exporter), db: Session = Depends(get_db)):
    """Exportações geradas no navegador (grafo PNG/CSV) também ficam na trilha de auditoria;
    o próprio endpoint exige permissão de exportação."""
    audit.log(db, "exportacao.cliente", access.user, case_id=access.case.id, ip=client_ip(request), details={"tipo": body.kind, "filtros": body.filters})
    return {"ok": True}
