"""Autenticação e autorização (verificadas sempre no servidor)."""
from __future__ import annotations

from datetime import UTC, datetime

from fastapi import Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db
from .models import User
from .security import SESSION_COOKIE, decode_session_token, refresh_activity


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "?"


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(SESSION_COOKIE, token, httponly=True, secure=settings.cookie_secure, samesite="strict",
                        max_age=settings.session_minutes * 60, path="/")


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
    if datetime.now(UTC).timestamp() - payload.get("lat", 0) > 60:
        set_session_cookie(response, refresh_activity(payload))
    return user


def require_admin(user: User = Depends(current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(403, "Permissão insuficiente")
    return user
