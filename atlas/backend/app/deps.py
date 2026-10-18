"""Dependências de autenticação e autorização (verificadas sempre no servidor)."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from fastapi import Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db
from .models import AccessJustification, Case, CaseMember, User
from .security import SESSION_COOKIE, decode_session_token, refresh_activity

JUSTIFICATION_HOURS = 12


def client_ip(request: Request) -> str:
    # Atrás do proxy (Caddy) o IP real vem em X-Forwarded-For; uvicorn roda com --proxy-headers
    return request.client.host if request.client else "?"


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE, token, httponly=True, secure=settings.cookie_secure, samesite="strict",
        max_age=settings.session_minutes * 60, path="/",
    )


def current_user(request: Request, response: Response, db: Session = Depends(get_db)) -> User:
    token = request.cookies.get(SESSION_COOKIE)
    payload = decode_session_token(token) if token else None
    if not payload:
        raise HTTPException(401, "Sessão expirada ou inexistente")
    user = db.get(User, int(payload["sub"]))
    if not user or not user.is_active or user.session_version != payload.get("sv"):
        raise HTTPException(401, "Sessão inválida")
    if user.mfa_enabled and not payload.get("mfa"):
        raise HTTPException(401, "Verificação em duas etapas pendente")
    # renova a marca de atividade (expiração por inatividade)
    if datetime.now(UTC).timestamp() - payload.get("lat", 0) > 60:
        set_session_cookie(response, refresh_activity(payload))
    request.state.user = user
    return user


def require_role(*roles: str):
    def dep(user: User = Depends(current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(403, "Permissão insuficiente")
        return user

    return dep


require_admin = require_role("admin")


@dataclass
class CaseAccess:
    case: Case
    user: User
    role: str  # analyst | reviewer | viewer
    can_export: bool

    @property
    def can_write(self) -> bool:
        return self.role == "analyst"

    @property
    def can_review(self) -> bool:
        return self.role in ("analyst", "reviewer")


def _load_access(case_id: int, user: User, db: Session) -> CaseAccess:
    case = db.get(Case, case_id)
    if not case or case.organization_id != user.organization_id:
        raise HTTPException(404, "Caso não encontrado")
    m = db.get(CaseMember, (case_id, user.id))
    if m:
        role = m.role
        # o papel global limita o papel no caso (um "consulta" global não vira analista)
        if user.role == "viewer":
            role = "viewer"
        elif user.role == "reviewer" and role == "analyst":
            role = "reviewer"
        return CaseAccess(case, user, role, m.can_export and user.role != "viewer")
    if user.role == "admin" and user.admin_content_access:
        return CaseAccess(case, user, "viewer", False)
    raise HTTPException(404, "Caso não encontrado")  # não revela a existência do caso


def _check_justification(access: CaseAccess, request: Request, db: Session) -> None:
    if not access.case.require_justification:
        return
    if request.url.path.endswith("/justification"):
        return
    since = datetime.now(UTC) - timedelta(hours=JUSTIFICATION_HOURS)
    ok = db.execute(
        select(AccessJustification.id).where(
            AccessJustification.case_id == access.case.id,
            AccessJustification.user_id == access.user.id,
            AccessJustification.created_at >= since,
        ).limit(1)
    ).scalar()
    if not ok:
        raise HTTPException(428, "Este caso exige justificativa de acesso")


def case_access(case_id: int, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)) -> CaseAccess:
    access = _load_access(case_id, user, db)
    _check_justification(access, request, db)
    return access


def case_writer(access: CaseAccess = Depends(case_access)) -> CaseAccess:
    if not access.can_write:
        raise HTTPException(403, "Somente analistas do caso podem alterar dados")
    if access.case.status in ("arquivado", "encerrado"):
        raise HTTPException(409, "Caso encerrado/arquivado: reabra para alterar")
    return access


def case_reviewer(access: CaseAccess = Depends(case_access)) -> CaseAccess:
    if not access.can_review:
        raise HTTPException(403, "Somente analistas e revisores do caso")
    return access


def case_exporter(access: CaseAccess = Depends(case_access)) -> CaseAccess:
    if not access.can_export:
        raise HTTPException(403, "Exportação não autorizada para este usuário neste caso")
    return access
