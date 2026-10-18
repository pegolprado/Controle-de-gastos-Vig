from __future__ import annotations

import secrets
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import audit
from ..config import APP_VERSION, RULES_VERSION
from ..db import get_db
from ..deps import CaseAccess, case_access, case_exporter, case_reviewer, case_writer, client_ip
from ..jobs import enqueue
from ..models import Alert, AlertRule, Job, Report, ReportReview, User
from ..services import alerts as alert_svc
from ..services import reports as report_svc
from ..services.analytics import EventFilter
from ..storage import get_storage, sha256_file
from .admin import job_out

router = APIRouter(prefix="/cases/{case_id}", tags=["outputs"])


# ------------------------------------------------------------------ alertas


@router.get("/alert-rules")
def rules(access: CaseAccess = Depends(case_access), db: Session = Depends(get_db)):
    alert_svc.ensure_default_rules(db, access.case.id, access.user.id) if access.can_write else None
    rows = db.execute(select(AlertRule).where(AlertRule.case_id == access.case.id).order_by(AlertRule.id)).scalars()
    return {
        "types": alert_svc.RULE_TYPES,
        "rules": [{"id": r.id, "name": r.name, "rule_type": r.rule_type, "params": r.params, "severity": r.severity, "active": r.active} for r in rows],
    }


class RuleIn(BaseModel):
    name: str = Field(min_length=3, max_length=200)
    rule_type: str
    params: dict = {}
    severity: str = "media"
    active: bool = True


@router.post("/alert-rules")
def create_rule(body: RuleIn, request: Request, access: CaseAccess = Depends(case_writer), db: Session = Depends(get_db)):
    if body.rule_type not in alert_svc.RULE_TYPES:
        raise HTTPException(422, "Tipo de regra inválido")
    r = AlertRule(case_id=access.case.id, created_by=access.user.id, **body.model_dump())
    db.add(r)
    db.commit()
    audit.log(db, "alerta.regra_criada", access.user, case_id=access.case.id, entity="alert_rule", entity_id=r.id, ip=client_ip(request), details=body.model_dump())
    return {"id": r.id}


@router.put("/alert-rules/{rid}")
def update_rule(rid: int, body: RuleIn, request: Request, access: CaseAccess = Depends(case_writer), db: Session = Depends(get_db)):
    r = db.get(AlertRule, rid)
    if not r or r.case_id != access.case.id:
        raise HTTPException(404)
    for k, v in body.model_dump().items():
        setattr(r, k, v)
    db.commit()
    audit.log(db, "alerta.regra_alterada", access.user, case_id=access.case.id, entity="alert_rule", entity_id=r.id, ip=client_ip(request), details=body.model_dump())
    return {"ok": True}


class RunIn(BaseModel):
    rule_ids: list[int] | None = None


@router.post("/alerts/run")
def run_alerts(body: RunIn, request: Request, access: CaseAccess = Depends(case_writer), db: Session = Depends(get_db)):
    job = enqueue(db, "run_alerts", {"rule_ids": body.rule_ids}, access.case.id, access.user.id)
    db.commit()
    audit.log(db, "alerta.execucao", access.user, case_id=access.case.id, entity="job", entity_id=job.id, ip=client_ip(request))
    return job_out(job)


@router.get("/alerts")
def list_alerts(access: CaseAccess = Depends(case_access), db: Session = Depends(get_db), status: str | None = None, severity: str | None = None):
    q = select(Alert).where(Alert.case_id == access.case.id)
    if status:
        q = q.where(Alert.review_status == status)
    if severity:
        q = q.where(Alert.severity == severity)
    rows = db.execute(q.order_by(Alert.id.desc()).limit(1000)).scalars()
    names = {u.id: u.name for u in db.execute(select(User)).scalars()}
    return [{"id": a.id, "rule_id": a.rule_id, "rule_type": a.rule_type, "title": a.title, "description": a.description, "params": a.params,
             "support_event_ids": a.support_event_ids, "support_count": a.support_count, "severity": a.severity, "review_status": a.review_status,
             "analyst_note": a.analyst_note, "reviewed_by": names.get(a.reviewed_by), "rules_version": a.rules_version,
             "created_at": a.created_at.isoformat()} for a in rows]


class ReviewAlertIn(BaseModel):
    review_status: str
    analyst_note: str | None = None


@router.put("/alerts/{aid}")
def review_alert(aid: int, body: ReviewAlertIn, request: Request, access: CaseAccess = Depends(case_reviewer), db: Session = Depends(get_db)):
    if body.review_status not in ("pendente", "em_analise", "relevante", "descartado"):
        raise HTTPException(422, "Situação inválida")
    a = db.get(Alert, aid)
    if not a or a.case_id != access.case.id:
        raise HTTPException(404)
    a.review_status, a.analyst_note, a.reviewed_by = body.review_status, body.analyst_note, access.user.id
    db.commit()
    audit.log(db, "alerta.revisado", access.user, case_id=access.case.id, entity="alert", entity_id=a.id, ip=client_ip(request), details={"status": body.review_status})
    return {"ok": True}


# ------------------------------------------------------------------ relatórios


class ReportIn(BaseModel):
    report_type: str = "cdr"
    fmt: str = "pdf"
    title: str | None = None
    filter: EventFilter = Field(default_factory=EventFilter)
    options: dict = {}


def report_out(r: Report, names: dict | None = None, reviews: list | None = None, job: Job | None = None) -> dict:
    return {
        "id": r.id, "code": r.code, "report_type": r.report_type, "fmt": r.fmt, "title": r.title, "status": r.status,
        "sha256": r.sha256, "size_bytes": r.size_bytes, "app_version": r.app_version, "rules_version": r.rules_version,
        "params": {k: v for k, v in (r.params or {}).items() if k != "manifest_key"}, "input_files": r.input_files,
        "created_by": (names or {}).get(r.created_by, r.created_by), "created_by_id": r.created_by,
        "created_at": r.created_at.isoformat() if r.created_at else None, "job": job_out(job) if job else None,
        "reviews": reviews or [],
    }


@router.post("/reports")
def create_report(body: ReportIn, request: Request, access: CaseAccess = Depends(case_writer), db: Session = Depends(get_db)):
    if body.report_type not in report_svc.SECTIONS:
        raise HTTPException(422, "Tipo de relatório inválido")
    if body.fmt not in report_svc.RENDERERS:
        raise HTTPException(422, "Formato inválido")
    if body.options.get("sections"):
        valid = set(report_svc.SECTIONS[body.report_type])
        body.options["sections"] = [s for s in body.options["sections"] if s in valid]
    titles = {"cdr": "Relatório de análise de bilhetagem", "erb": "Relatório de análise de ERB", "links": "Relatório de análise de vínculos", "full": "Relatório técnico completo"}
    code = f"REL-{datetime.now(UTC):%Y%m%d}-{secrets.token_hex(3).upper()}"
    rep = Report(case_id=access.case.id, code=code, report_type=body.report_type, fmt=body.fmt,
                 title=(body.title or titles[body.report_type])[:300],
                 params={"filters": body.filter.model_dump(mode="json", exclude_defaults=True), "options": body.options},
                 app_version=APP_VERSION, rules_version=RULES_VERSION, status="gerando", created_by=access.user.id)
    db.add(rep)
    db.flush()
    job = enqueue(db, "report", {"report_id": rep.id}, access.case.id, access.user.id)
    rep.job_id = job.id
    db.commit()
    audit.log(db, "relatorio.solicitado", access.user, case_id=access.case.id, entity="report", entity_id=rep.id, ip=client_ip(request),
              details={"code": code, "tipo": body.report_type, "formato": body.fmt})
    return report_out(rep, job=job)


@router.get("/reports")
def list_reports(access: CaseAccess = Depends(case_access), db: Session = Depends(get_db)):
    reps = db.execute(select(Report).where(Report.case_id == access.case.id).order_by(Report.id.desc())).scalars().all()
    names = {u.id: u.name for u in db.execute(select(User)).scalars()}
    jobs = {j.id: j for j in db.execute(select(Job).where(Job.id.in_([r.job_id for r in reps if r.job_id]))).scalars()}
    reviews: dict[int, list] = {}
    for rv in db.execute(select(ReportReview).where(ReportReview.report_id.in_([r.id for r in reps])).order_by(ReportReview.id)).scalars():
        reviews.setdefault(rv.report_id, []).append({"user": names.get(rv.user_id), "action": rv.action, "note": rv.note, "at": rv.created_at.isoformat()})
    return [report_out(r, names, reviews.get(r.id), jobs.get(r.job_id)) for r in reps]


def _get_report(db, access, rid) -> Report:
    r = db.get(Report, rid)
    if not r or r.case_id != access.case.id:
        raise HTTPException(404)
    return r


@router.get("/reports/{rid}/download")
def download(rid: int, request: Request, access: CaseAccess = Depends(case_exporter), db: Session = Depends(get_db)):
    r = _get_report(db, access, rid)
    if not r.storage_key:
        raise HTTPException(409, "Relatório ainda não gerado")
    path = get_storage().path(r.storage_key)
    if sha256_file(path) != r.sha256:
        audit.log(db, "relatorio.integridade_falhou", access.user, case_id=access.case.id, entity="report", entity_id=r.id, ip=client_ip(request))
        raise HTTPException(500, "Falha de integridade: o arquivo não confere com o hash registrado")
    audit.log(db, "relatorio.baixado", access.user, case_id=access.case.id, entity="report", entity_id=r.id, ip=client_ip(request))
    return FileResponse(path, filename=f"{r.code}.{r.fmt}", media_type=report_svc.MIME[r.fmt])


@router.get("/reports/{rid}/manifest")
def manifest(rid: int, access: CaseAccess = Depends(case_exporter), db: Session = Depends(get_db)):
    r = _get_report(db, access, rid)
    key = (r.params or {}).get("manifest_key")
    if not key:
        raise HTTPException(404)
    return FileResponse(get_storage().path(key), filename=f"{r.code}.manifesto.json", media_type="application/json")


@router.get("/reports/{rid}/verify")
def verify(rid: int, access: CaseAccess = Depends(case_access), db: Session = Depends(get_db)):
    r = _get_report(db, access, rid)
    if not r.storage_key:
        raise HTTPException(409)
    cur = sha256_file(get_storage().path(r.storage_key))
    return {"registered": r.sha256, "current": cur, "intact": cur == r.sha256}


class ReviewIn(BaseModel):
    action: str  # submeter | aprovar | devolver | comentar
    note: str | None = None


@router.post("/reports/{rid}/review")
def review(rid: int, body: ReviewIn, request: Request, access: CaseAccess = Depends(case_reviewer), db: Session = Depends(get_db)):
    r = _get_report(db, access, rid)
    act = body.action
    if act == "submeter":
        if not access.can_write or r.status not in ("rascunho", "devolvido"):
            raise HTTPException(409, "Somente rascunhos/devolvidos podem ser submetidos, por analistas")
        r.status = "em_revisao"
    elif act in ("aprovar", "devolver"):
        if r.status != "em_revisao":
            raise HTTPException(409, "O relatório não está em revisão")
        if r.created_by == access.user.id:
            raise HTTPException(403, "Segregação de funções: o autor não pode aprovar/devolver o próprio relatório")
        if act == "devolver" and not body.note:
            raise HTTPException(422, "Informe o motivo da devolução")
        r.status = "aprovado" if act == "aprovar" else "devolvido"
    elif act != "comentar":
        raise HTTPException(422, "Ação inválida")
    db.add(ReportReview(report_id=r.id, user_id=access.user.id, action=act, note=body.note))
    db.commit()
    audit.log(db, f"relatorio.{act}", access.user, case_id=access.case.id, entity="report", entity_id=r.id, ip=client_ip(request))
    return {"ok": True, "status": r.status}
