from __future__ import annotations

import os
import secrets
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, EmailStr
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from .. import audit
from ..config import APP_VERSION, RULES_VERSION, settings
from ..db import get_db
from ..deps import client_ip, current_user, require_admin
from ..jobs import enqueue
from ..models import GLOBAL_ROLES, AuditLog, Case, CaseMember, Job, SystemSetting, User
from ..security import hash_password
from .auth import create_reset_link, user_out

router = APIRouter(tags=["admin"])


# ------------------------------------------------------------------ usuários


class UserIn(BaseModel):
    email: EmailStr
    name: str
    role: str = "analyst"
    admin_content_access: bool = False


@router.get("/admin/users")
def list_users(admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    users = db.execute(select(User).where(User.organization_id == admin.organization_id).order_by(User.name)).scalars().all()
    return [{**user_out(u), "is_active": u.is_active, "locked": bool(u.locked_until and u.locked_until > datetime.now(UTC)),
             "created_at": u.created_at.isoformat()} for u in users]


@router.post("/admin/users")
def create_user(body: UserIn, request: Request, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    if body.role not in GLOBAL_ROLES:
        raise HTTPException(422, "Perfil inválido")
    if db.execute(select(User.id).where(func.lower(User.email) == body.email.lower())).scalar():
        raise HTTPException(409, "E-mail já cadastrado")
    u = User(organization_id=admin.organization_id, email=body.email.lower(), name=body.name.strip(), role=body.role,
             password_hash=hash_password(secrets.token_urlsafe(24)), must_change_password=True,
             admin_content_access=body.admin_content_access and body.role == "admin")
    db.add(u)
    db.commit()
    link = create_reset_link(db, u, hours=72)
    audit.log(db, "usuario.criado", admin, entity="user", entity_id=u.id, ip=client_ip(request), details={"role": u.role})
    return {"user": user_out(u), "activation_link": link}


class UserPatch(BaseModel):
    name: str | None = None
    role: str | None = None
    is_active: bool | None = None
    admin_content_access: bool | None = None


@router.patch("/admin/users/{uid}")
def patch_user(uid: int, body: UserPatch, request: Request, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    u = db.get(User, uid)
    if not u or u.organization_id != admin.organization_id:
        raise HTTPException(404)
    changes = body.model_dump(exclude_none=True)
    if "role" in changes and changes["role"] not in GLOBAL_ROLES:
        raise HTTPException(422, "Perfil inválido")
    if u.id == admin.id and (changes.get("role", "admin") != "admin" or changes.get("is_active") is False):
        raise HTTPException(400, "Você não pode remover seu próprio acesso administrativo")
    for k, v in changes.items():
        setattr(u, k, v)
    if "is_active" in changes or "role" in changes:
        u.session_version += 1
    db.commit()
    audit.log(db, "usuario.permissoes_alteradas", admin, entity="user", entity_id=u.id, ip=client_ip(request), details=changes)
    return user_out(u)


@router.post("/admin/users/{uid}/reset-link")
def reset_link(uid: int, request: Request, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    u = db.get(User, uid)
    if not u or u.organization_id != admin.organization_id:
        raise HTTPException(404)
    link = create_reset_link(db, u, hours=24)
    audit.log(db, "usuario.link_redefinicao", admin, entity="user", entity_id=u.id, ip=client_ip(request))
    return {"link": link, "expires_hours": 24}


@router.post("/admin/users/{uid}/unlock")
def unlock(uid: int, request: Request, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    u = db.get(User, uid)
    if not u or u.organization_id != admin.organization_id:
        raise HTTPException(404)
    u.locked_until, u.failed_logins = None, 0
    db.commit()
    audit.log(db, "usuario.desbloqueado", admin, entity="user", entity_id=u.id, ip=client_ip(request))
    return {"ok": True}


@router.post("/admin/users/{uid}/revoke-sessions")
def revoke(uid: int, request: Request, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    u = db.get(User, uid)
    if not u or u.organization_id != admin.organization_id:
        raise HTTPException(404)
    u.session_version += 1
    db.commit()
    audit.log(db, "usuario.sessoes_encerradas", admin, entity="user", entity_id=u.id, ip=client_ip(request))
    return {"ok": True}


@router.get("/users/directory")
def directory(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Lista mínima (nome/e-mail/perfil) para adicionar membros a um caso."""
    rows = db.execute(select(User).where(User.organization_id == user.organization_id, User.is_active).order_by(User.name)).scalars()
    return [{"id": u.id, "name": u.name, "email": u.email, "role": u.role} for u in rows]


# ------------------------------------------------------------------ auditoria


@router.get("/audit")
def list_audit(
    user: User = Depends(current_user), db: Session = Depends(get_db),
    case_id: int | None = None, action: str | None = None, user_id: int | None = None,
    date_from: datetime | None = None, date_to: datetime | None = None,
    page: int = Query(1, ge=1), size: int = Query(50, ge=1, le=500),
):
    q = select(AuditLog)
    if user.role != "admin":
        # não administradores veem apenas a trilha dos casos de que participam
        member_cases = select(CaseMember.case_id).where(CaseMember.user_id == user.id)
        q = q.where(AuditLog.case_id.in_(member_cases))
        if case_id is None:
            pass
    if case_id:
        q = q.where(AuditLog.case_id == case_id)
    if action:
        q = q.where(AuditLog.action.ilike(f"%{action}%"))
    if user_id:
        q = q.where(AuditLog.user_id == user_id)
    if date_from:
        q = q.where(AuditLog.ts >= date_from)
    if date_to:
        q = q.where(AuditLog.ts <= date_to)
    total = db.execute(select(func.count()).select_from(q.subquery())).scalar()
    rows = db.execute(q.order_by(AuditLog.id.desc()).limit(size).offset((page - 1) * size)).scalars().all()
    return {
        "total": total,
        "items": [{"id": r.id, "ts": r.ts.isoformat(), "user_email": r.user_email, "action": r.action, "case_id": r.case_id,
                   "entity": r.entity, "entity_id": r.entity_id, "ip": r.ip, "details": r.details, "hash": r.hash} for r in rows],
    }


@router.get("/audit/verify")
def verify(admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    res = audit.verify_chain(db)
    audit.log(db, "auditoria.verificada", admin, details=res)
    return res


# ------------------------------------------------------------------ operação


def _dir_size(path) -> int:
    total = 0
    for root, _, files in os.walk(path):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(root, f))
            except OSError:
                pass
    return total


@router.get("/admin/status")
def status(admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    jobs = dict(db.execute(select(Job.status, func.count()).group_by(Job.status)).all())
    last_hb = db.execute(select(func.max(Job.heartbeat_at))).scalar()
    running = db.execute(select(Job).where(Job.status == "running")).scalars().all()
    recent_fail = db.execute(select(Job).where(Job.status == "failed").order_by(Job.id.desc()).limit(10)).scalars().all()
    db_size = db.execute(text("SELECT pg_database_size(current_database())")).scalar()
    biggest = db.execute(text("""SELECT relname, pg_total_relation_size(c.oid) AS bytes FROM pg_class c
                                   JOIN pg_namespace n ON n.oid = c.relnamespace
                                  WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY 2 DESC LIMIT 8""")).mappings().all()
    counts = db.execute(text("""SELECT (SELECT count(*) FROM cases) AS cases, (SELECT count(*) FROM events) AS events,
                                       (SELECT count(*) FROM source_files) AS files, (SELECT count(*) FROM users) AS users,
                                       (SELECT count(*) FROM reports) AS reports""")).mappings().one()
    return {
        "app_version": APP_VERSION, "rules_version": RULES_VERSION, "env": settings.env,
        "embedded_worker": settings.embedded_worker,
        "jobs": jobs, "worker_last_heartbeat": last_hb.isoformat() if last_hb else None,
        "running": [{"id": j.id, "type": j.type, "progress": j.progress, "message": j.message, "worker": j.worker,
                     "started_at": j.started_at.isoformat() if j.started_at else None} for j in running],
        "recent_failures": [{"id": j.id, "type": j.type, "message": j.message, "finished_at": j.finished_at.isoformat() if j.finished_at else None} for j in recent_fail],
        "database_bytes": db_size, "largest_tables": [dict(r) for r in biggest],
        "storage_bytes": _dir_size(settings.storage_dir), "counts": dict(counts),
        "limits": {"max_upload_mb": settings.max_upload_mb, "max_rows_per_import": settings.max_rows_per_import,
                   "session_minutes": settings.session_minutes, "idle_minutes": settings.idle_minutes},
    }


@router.get("/admin/jobs")
def all_jobs(admin: User = Depends(require_admin), db: Session = Depends(get_db), status: str | None = None, page: int = 1, size: int = 50):
    q = select(Job)
    if status:
        q = q.where(Job.status == status)
    rows = db.execute(q.order_by(Job.id.desc()).limit(size).offset((page - 1) * size)).scalars().all()
    return [job_out(j) for j in rows]


def job_out(j: Job) -> dict:
    return {"id": j.id, "case_id": j.case_id, "type": j.type, "status": j.status, "progress": j.progress, "total": j.total,
            "processed": j.processed, "errors_count": j.errors_count, "message": j.message, "attempts": j.attempts,
            "created_at": j.created_at.isoformat() if j.created_at else None,
            "started_at": j.started_at.isoformat() if j.started_at else None,
            "finished_at": j.finished_at.isoformat() if j.finished_at else None,
            "result": {k: v for k, v in (j.result or {}).items() if k != "trace"}, "cancel_requested": j.cancel_requested}


class SettingsIn(BaseModel):
    retention_days_default: int | None = None
    require_justification_default: bool | None = None
    institution_name: str | None = None


@router.get("/settings")
def get_settings(user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = db.get(SystemSetting, "general")
    return {
        **(s.value if s else {}),
        "map_tile_url": settings.map_tile_url, "map_attribution": settings.map_attribution,
        "app_version": APP_VERSION, "rules_version": RULES_VERSION, "smtp_configured": bool(settings.smtp_host),
    }


@router.put("/settings")
def put_settings(body: SettingsIn, request: Request, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    s = db.get(SystemSetting, "general") or SystemSetting(key="general", value={})
    s.value = {**(s.value or {}), **body.model_dump(exclude_none=True)}
    db.merge(s)
    db.commit()
    audit.log(db, "config.alterada", admin, ip=client_ip(request), details=body.model_dump(exclude_none=True))
    return s.value


@router.post("/admin/retention/apply")
def apply_retention(request: Request, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    """Lista casos cujo prazo de retenção venceu. A exclusão é feita caso a caso
    (com confirmação) para evitar descarte automático indevido."""
    today = datetime.now(UTC).date()
    due = db.execute(select(Case).where(Case.retention_until.is_not(None), Case.retention_until < today)).scalars().all()
    audit.log(db, "retencao.verificada", admin, ip=client_ip(request), details={"vencidos": [c.id for c in due]})
    return [{"id": c.id, "code": c.code, "title": c.title, "retention_until": c.retention_until.isoformat()} for c in due]


# ------------------------------------------------------------------ demonstração


@router.post("/demo/seed")
def demo_seed(request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if user.role not in ("admin", "analyst"):
        raise HTTPException(403, "Somente administradores e analistas")
    job = enqueue(db, "demo_seed", {}, None, user.id)
    db.commit()
    audit.log(db, "demo.criada", user, ip=client_ip(request), entity="job", entity_id=job.id)
    return job_out(job)


@router.delete("/demo")
def demo_clear(request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if user.role not in ("admin", "analyst"):
        raise HTTPException(403)
    from ..storage import get_storage

    cases = db.execute(select(Case).where(Case.is_demo, Case.organization_id == user.organization_id)).scalars().all()
    st = get_storage()
    removed = []
    for c in cases:
        keys = db.execute(text("SELECT storage_key FROM source_files WHERE case_id = :c UNION ALL SELECT storage_key FROM reports WHERE case_id = :c AND storage_key IS NOT NULL"), {"c": c.id}).scalars().all()
        db.delete(c)
        db.commit()
        for k in keys:
            st.delete(k)
        removed.append(c.code)
    audit.log(db, "demo.removida", user, ip=client_ip(request), details={"cases": removed})
    return {"removed": removed}


@router.get("/health")
def health(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    stale = db.execute(select(func.count()).select_from(Job).where(Job.status == "running", Job.heartbeat_at < datetime.now(UTC) - timedelta(minutes=5))).scalar()
    return {"ok": True, "version": APP_VERSION, "stale_jobs": stale}
