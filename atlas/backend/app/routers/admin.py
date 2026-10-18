from __future__ import annotations

import secrets
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from ..config import APP_VERSION, settings
from ..db import get_db
from ..deps import current_user, require_admin
from ..models import ROLES, User
from ..security import hash_password
from .auth import create_reset_link, user_out

router = APIRouter(tags=["admin"])


class UserIn(BaseModel):
    email: EmailStr
    name: str
    role: str = "user"
    can_export: bool = True


@router.get("/admin/users")
def list_users(admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    now = datetime.now(UTC)
    return [{**user_out(u), "is_active": u.is_active,
             "locked": bool(u.locked_until and u.locked_until.replace(tzinfo=UTC) > now)}
            for u in db.execute(select(User).order_by(User.name)).scalars()]


@router.post("/admin/users")
def create_user(body: UserIn, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    if body.role not in ROLES:
        raise HTTPException(422, "Perfil inválido")
    if db.execute(select(User.id).where(func.lower(User.email) == body.email.lower())).scalar():
        raise HTTPException(409, "E-mail já cadastrado")
    u = User(email=body.email.lower(), name=body.name.strip(), role=body.role, can_export=body.can_export,
             password_hash=hash_password(secrets.token_urlsafe(24)), must_change_password=True)
    db.add(u)
    db.commit()
    return {"user": user_out(u), "activation_link": create_reset_link(db, u, hours=72)}


class UserPatch(BaseModel):
    name: str | None = None
    role: str | None = None
    is_active: bool | None = None
    can_export: bool | None = None


def _get(db, uid) -> User:
    u = db.get(User, uid)
    if not u:
        raise HTTPException(404)
    return u


@router.patch("/admin/users/{uid}")
def patch_user(uid: int, body: UserPatch, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    u = _get(db, uid)
    changes = body.model_dump(exclude_none=True)
    if "role" in changes and changes["role"] not in ROLES:
        raise HTTPException(422, "Perfil inválido")
    if u.id == admin.id and (changes.get("role", "admin") != "admin" or changes.get("is_active") is False):
        raise HTTPException(400, "Você não pode remover seu próprio acesso administrativo")
    for k, v in changes.items():
        setattr(u, k, v)
    if {"is_active", "role", "can_export"} & changes.keys():
        u.session_version += 1
    db.commit()
    return user_out(u)


@router.delete("/admin/users/{uid}")
def delete_user(uid: int, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    u = _get(db, uid)
    if u.id == admin.id:
        raise HTTPException(400, "Você não pode excluir a si mesmo")
    db.delete(u)
    db.commit()
    return {"ok": True}


@router.post("/admin/users/{uid}/reset-link")
def reset_link(uid: int, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    return {"link": create_reset_link(db, _get(db, uid), hours=24), "expires_hours": 24}


@router.post("/admin/users/{uid}/unlock")
def unlock(uid: int, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    u = _get(db, uid)
    u.locked_until, u.failed_logins = None, 0
    db.commit()
    return {"ok": True}


@router.post("/admin/users/{uid}/revoke-sessions")
def revoke(uid: int, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    u = _get(db, uid)
    u.session_version += 1
    db.commit()
    return {"ok": True}


@router.get("/settings")
def get_settings(user: User = Depends(current_user)):
    return {"map_tile_url": settings.map_tile_url, "map_attribution": settings.map_attribution,
            "app_version": APP_VERSION, "smtp_configured": bool(settings.smtp_host), "idle_minutes": settings.idle_minutes}


@router.get("/health")
def health(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    return {"ok": True, "version": APP_VERSION}
