from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from .. import audit
from ..db import get_db
from ..deps import CaseAccess, case_access, case_writer, client_ip, current_user
from ..models import CASE_ROLES, AccessJustification, Case, CaseMember, Target, User
from ..services.normalize import normalize_number
from ..storage import get_storage

router = APIRouter(tags=["cases"])

STATUSES = ("aberto", "em_analise", "em_revisao", "concluido", "arquivado", "encerrado")


def case_out(c: Case, role: str | None = None, stats: dict | None = None) -> dict:
    return {
        "id": c.id, "code": c.code, "title": c.title, "process_number": c.process_number, "unit": c.unit,
        "responsible_user_id": c.responsible_user_id,
        "period_start": c.period_start.isoformat() if c.period_start else None,
        "period_end": c.period_end.isoformat() if c.period_end else None,
        "description": c.description, "status": c.status, "access_level": c.access_level,
        "authorized_docs": c.authorized_docs, "notes": c.notes, "require_justification": c.require_justification,
        "retention_until": c.retention_until.isoformat() if c.retention_until else None,
        "is_demo": c.is_demo, "created_at": c.created_at.isoformat() if c.created_at else None,
        "my_role": role, "stats": stats or {},
    }


def _stats(db: Session, case_ids: list[int]) -> dict[int, dict]:
    if not case_ids:
        return {}
    rows = db.execute(
        text(
            """SELECT c.id,
                      (SELECT count(*) FROM targets t WHERE t.case_id = c.id) AS targets,
                      (SELECT count(*) FROM source_files s WHERE s.case_id = c.id) AS files,
                      (SELECT count(*) FROM source_files s WHERE s.case_id = c.id AND s.status = 'processado') AS files_processed,
                      (SELECT count(*) FROM events e WHERE e.case_id = c.id) AS events,
                      (SELECT count(*) FROM imports i WHERE i.case_id = c.id AND i.status IN ('draft','queued','running')) AS imports_pending,
                      (SELECT count(*) FROM alerts a WHERE a.case_id = c.id AND a.review_status = 'pendente') AS alerts_pending,
                      (SELECT count(*) FROM reports r WHERE r.case_id = c.id) AS reports,
                      (SELECT count(*) FROM erb_cells x WHERE x.case_id = c.id) AS erb_cells,
                      (SELECT count(*) FROM jobs j WHERE j.case_id = c.id AND j.status IN ('queued','running')) AS jobs_active
                 FROM cases c WHERE c.id = ANY(:ids)"""
        ),
        {"ids": case_ids},
    ).mappings()
    return {r["id"]: dict(r) for r in rows}


def accessible_cases(db: Session, user: User) -> list[tuple[Case, str]]:
    q = (
        select(Case, CaseMember.role)
        .join(CaseMember, (CaseMember.case_id == Case.id) & (CaseMember.user_id == user.id), isouter=True)
        .where(Case.organization_id == user.organization_id)
        .order_by(Case.updated_at.desc())
    )
    out = []
    for c, role in db.execute(q).all():
        if role:
            out.append((c, "viewer" if user.role == "viewer" else ("reviewer" if user.role == "reviewer" and role == "analyst" else role)))
        elif user.role == "admin" and user.admin_content_access:
            out.append((c, "viewer"))
    return out


@router.get("/cases")
def list_cases(user: User = Depends(current_user), db: Session = Depends(get_db)):
    cases = accessible_cases(db, user)
    stats = _stats(db, [c.id for c, _ in cases])
    return [case_out(c, r, stats.get(c.id)) for c, r in cases]


@router.get("/dashboard")
def dashboard(user: User = Depends(current_user), db: Session = Depends(get_db)):
    cases = accessible_cases(db, user)
    ids = [c.id for c, _ in cases]
    stats = _stats(db, ids)
    agg = {k: sum(s.get(k, 0) for s in stats.values()) for k in ("files", "files_processed", "events", "imports_pending", "alerts_pending", "reports", "erb_cells", "jobs_active", "targets")}
    agg["cases"] = len(cases)
    agg["cases_open"] = sum(1 for c, _ in cases if c.status not in ("arquivado", "encerrado", "concluido"))
    recent = [case_out(c, r, stats.get(c.id)) for c, r in cases[:6]]
    return {"totals": agg, "recent_cases": recent, "role": user.role}


class CaseIn(BaseModel):
    title: str = Field(min_length=3, max_length=300)
    process_number: str | None = None
    unit: str | None = None
    responsible_user_id: int | None = None
    period_start: date | None = None
    period_end: date | None = None
    description: str | None = None
    status: str = "aberto"
    access_level: str = "restrito"
    authorized_docs: str | None = None
    notes: str | None = None
    require_justification: bool = False
    retention_until: date | None = None


@router.post("/cases")
def create_case(body: CaseIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if user.role not in ("admin", "analyst"):
        raise HTTPException(403, "Somente analistas criam casos")
    if body.period_start and body.period_end and body.period_end < body.period_start:
        raise HTTPException(422, "Período final anterior ao inicial")
    seq = db.execute(text("SELECT count(*) FROM cases WHERE NOT is_demo")).scalar() + 1
    code = f"ATL-{date.today():%Y}-{seq:04d}"
    while db.execute(select(Case.id).where(Case.code == code)).scalar():
        seq += 1
        code = f"ATL-{date.today():%Y}-{seq:04d}"
    c = Case(organization_id=user.organization_id, code=code, created_by=user.id, **body.model_dump())
    if c.status not in STATUSES:
        c.status = "aberto"
    c.responsible_user_id = c.responsible_user_id or user.id
    db.add(c)
    db.flush()
    db.add(CaseMember(case_id=c.id, user_id=user.id, role="analyst", can_export=True))
    db.commit()
    audit.log(db, "caso.criado", user, case_id=c.id, entity="case", entity_id=c.id, ip=client_ip(request), details={"code": code})
    return case_out(c, "analyst")


@router.get("/cases/{case_id}")
def get_case(request: Request, access: CaseAccess = Depends(case_access), db: Session = Depends(get_db)):
    audit.log(db, "caso.acessado", access.user, case_id=access.case.id, entity="case", entity_id=access.case.id, ip=client_ip(request))
    out = case_out(access.case, access.role, _stats(db, [access.case.id]).get(access.case.id))
    out["can_export"] = access.can_export
    return out


@router.put("/cases/{case_id}")
def update_case(body: CaseIn, request: Request, case_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    from ..deps import _load_access

    access = _load_access(case_id, user, db)
    if not access.can_write:
        raise HTTPException(403, "Somente analistas do caso")
    if body.status not in STATUSES:
        raise HTTPException(422, "Situação inválida")
    before = case_out(access.case)
    for k, v in body.model_dump().items():
        setattr(access.case, k, v)
    db.commit()
    changed = {k: v for k, v in case_out(access.case).items() if before.get(k) != v and k not in ("stats",)}
    audit.log(db, "caso.alterado", user, case_id=case_id, entity="case", entity_id=case_id, ip=client_ip(request), details={"campos": list(changed)})
    return case_out(access.case, access.role)


class DeleteIn(BaseModel):
    confirm_code: str
    reason: str = Field(min_length=10)


@router.post("/cases/{case_id}/delete")
def delete_case(body: DeleteIn, request: Request, access: CaseAccess = Depends(case_writer), db: Session = Depends(get_db)):
    """Exclusão autorizada: exige digitar o código do caso e justificar; é auditada."""
    if body.confirm_code != access.case.code:
        raise HTTPException(400, "Código de confirmação não confere")
    case = access.case
    keys = db.execute(text("SELECT storage_key FROM source_files WHERE case_id = :c UNION ALL SELECT storage_key FROM reports WHERE case_id = :c AND storage_key IS NOT NULL"), {"c": case.id}).scalars().all()
    code = case.code
    db.delete(case)
    db.commit()
    st = get_storage()
    for k in keys:
        st.delete(k)
    audit.log(db, "caso.excluido", access.user, case_id=case.id, entity="case", entity_id=case.id, ip=client_ip(request),
              details={"code": code, "motivo": body.reason, "arquivos_removidos": len(keys)})
    return {"ok": True}


class JustIn(BaseModel):
    justification: str = Field(min_length=10, max_length=2000)


@router.post("/cases/{case_id}/justification")
def justify(body: JustIn, request: Request, access: CaseAccess = Depends(case_access), db: Session = Depends(get_db)):
    db.add(AccessJustification(case_id=access.case.id, user_id=access.user.id, justification=body.justification))
    db.commit()
    audit.log(db, "caso.justificativa_acesso", access.user, case_id=access.case.id, ip=client_ip(request), details={"justificativa": body.justification[:300]})
    return {"ok": True}


# ------------------------------------------------------------------ membros


@router.get("/cases/{case_id}/members")
def members(access: CaseAccess = Depends(case_access), db: Session = Depends(get_db)):
    rows = db.execute(select(CaseMember, User).join(User, User.id == CaseMember.user_id).where(CaseMember.case_id == access.case.id)).all()
    return [{"user_id": u.id, "name": u.name, "email": u.email, "global_role": u.role, "role": m.role, "can_export": m.can_export} for m, u in rows]


class MemberIn(BaseModel):
    user_id: int
    role: str = "viewer"
    can_export: bool = False


@router.post("/cases/{case_id}/members")
def add_member(body: MemberIn, request: Request, access: CaseAccess = Depends(case_writer), db: Session = Depends(get_db)):
    if body.role not in CASE_ROLES:
        raise HTTPException(422, "Papel inválido")
    u = db.get(User, body.user_id)
    if not u or u.organization_id != access.user.organization_id:
        raise HTTPException(404, "Usuário não encontrado")
    m = db.get(CaseMember, (access.case.id, u.id)) or CaseMember(case_id=access.case.id, user_id=u.id)
    m.role, m.can_export = body.role, body.can_export
    db.merge(m)
    db.commit()
    audit.log(db, "caso.membro_definido", access.user, case_id=access.case.id, entity="user", entity_id=u.id, ip=client_ip(request), details={"role": body.role, "can_export": body.can_export})
    return {"ok": True}


@router.delete("/cases/{case_id}/members/{user_id}")
def remove_member(user_id: int, request: Request, access: CaseAccess = Depends(case_writer), db: Session = Depends(get_db)):
    m = db.get(CaseMember, (access.case.id, user_id))
    if not m:
        raise HTTPException(404)
    analysts = db.execute(select(func.count()).select_from(CaseMember).where(CaseMember.case_id == access.case.id, CaseMember.role == "analyst")).scalar()
    if m.role == "analyst" and analysts <= 1:
        raise HTTPException(400, "O caso precisa de ao menos um analista")
    db.delete(m)
    db.commit()
    audit.log(db, "caso.membro_removido", access.user, case_id=access.case.id, entity="user", entity_id=user_id, ip=client_ip(request))
    return {"ok": True}


# ------------------------------------------------------------------ alvos


class TargetIn(BaseModel):
    number_original: str = Field(min_length=3, max_length=64)
    operator: str | None = None
    internal_id: str | None = None
    label: str | None = None
    period_start: date | None = None
    period_end: date | None = None
    source: str | None = None
    notes: str | None = None
    validation_status: str = "pendente"


def target_out(t: Target) -> dict:
    return {
        "id": t.id, "number_normalized": t.number_normalized, "number_original": t.number_original, "operator": t.operator,
        "internal_id": t.internal_id, "label": t.label, "period_start": t.period_start.isoformat() if t.period_start else None,
        "period_end": t.period_end.isoformat() if t.period_end else None, "source": t.source, "notes": t.notes,
        "validation_status": t.validation_status,
    }


@router.get("/cases/{case_id}/targets")
def list_targets(access: CaseAccess = Depends(case_access), db: Session = Depends(get_db)):
    ts = db.execute(select(Target).where(Target.case_id == access.case.id).order_by(Target.id)).scalars().all()
    counts = dict(db.execute(text("SELECT target_number, count(*) FROM events WHERE case_id = :c AND NOT is_duplicate GROUP BY 1"), {"c": access.case.id}).all())
    return [{**target_out(t), "events": counts.get(t.number_normalized, 0)} for t in ts]


def _validate_target(body: TargetIn, case: Case) -> tuple[str, list[str]]:
    norm, warnings = normalize_number(body.number_original)
    if not norm or not norm.startswith("+"):
        raise HTTPException(422, "Número inválido: informe com DDD (ex.: (61) 99999-0000)")
    if body.period_start and body.period_end and body.period_end < body.period_start:
        raise HTTPException(422, "Período final anterior ao inicial")
    if case.period_start and body.period_start and body.period_start < case.period_start:
        warnings.append("período do alvo começa antes do período autorizado do caso — o aviso não amplia o escopo")
    if case.period_end and body.period_end and body.period_end > case.period_end:
        warnings.append("período do alvo termina depois do período autorizado do caso — o aviso não amplia o escopo")
    return norm, warnings


@router.post("/cases/{case_id}/targets")
def create_target(body: TargetIn, request: Request, access: CaseAccess = Depends(case_writer), db: Session = Depends(get_db)):
    norm, warnings = _validate_target(body, access.case)
    if db.execute(select(Target.id).where(Target.case_id == access.case.id, Target.number_normalized == norm)).scalar():
        raise HTTPException(409, "Número já cadastrado no caso")
    t = Target(case_id=access.case.id, number_normalized=norm, **body.model_dump())
    db.add(t)
    db.commit()
    audit.log(db, "alvo.cadastrado", access.user, case_id=access.case.id, entity="target", entity_id=t.id, ip=client_ip(request))
    return {**target_out(t), "warnings": warnings}


@router.put("/cases/{case_id}/targets/{tid}")
def update_target(tid: int, body: TargetIn, request: Request, access: CaseAccess = Depends(case_writer), db: Session = Depends(get_db)):
    t = db.get(Target, tid)
    if not t or t.case_id != access.case.id:
        raise HTTPException(404)
    norm, warnings = _validate_target(body, access.case)
    for k, v in body.model_dump().items():
        setattr(t, k, v)
    t.number_normalized = norm
    db.commit()
    audit.log(db, "alvo.alterado", access.user, case_id=access.case.id, entity="target", entity_id=t.id, ip=client_ip(request))
    return {**target_out(t), "warnings": warnings}


@router.delete("/cases/{case_id}/targets/{tid}")
def delete_target(tid: int, request: Request, access: CaseAccess = Depends(case_writer), db: Session = Depends(get_db)):
    t = db.get(Target, tid)
    if not t or t.case_id != access.case.id:
        raise HTTPException(404)
    db.delete(t)
    db.commit()
    audit.log(db, "alvo.removido", access.user, case_id=access.case.id, entity="target", entity_id=tid, ip=client_ip(request))
    return {"ok": True}
