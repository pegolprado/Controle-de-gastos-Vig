from __future__ import annotations

import secrets
import smtplib
import threading
import time
from collections import defaultdict, deque
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage

import pyotp
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field, EmailStr
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..deps import client_ip, current_user, set_session_cookie
from ..models import PasswordResetToken, User
from ..security import (
    CSRF_COOKIE,
    DUMMY_HASH,
    SESSION_COOKIE,
    create_session_token,
    decode_session_token,
    hash_password,
    new_csrf_token,
    password_problems,
    token_digest,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])

# Limite de falhas por IP mantido só em memória (não é gravado em disco).
_IP_WINDOW = 15 * 60
_IP_MAX_FAILS = 30
_ip_fails: dict[str, deque] = defaultdict(deque)
_ip_lock = threading.Lock()


def _ip_blocked(ip: str) -> bool:
    now = time.monotonic()
    with _ip_lock:
        q = _ip_fails[ip]
        while q and now - q[0] > _IP_WINDOW:
            q.popleft()
        return len(q) >= _IP_MAX_FAILS


def _ip_fail(ip: str) -> None:
    with _ip_lock:
        _ip_fails[ip].append(time.monotonic())


def user_out(u: User) -> dict:
    return {"id": u.id, "email": u.email, "name": u.name, "role": u.role, "mfa_enabled": u.mfa_enabled,
            "must_change_password": u.must_change_password, "can_export": u.can_export}


@router.get("/csrf")
def csrf(response: Response, request: Request):
    token = request.cookies.get(CSRF_COOKIE) or new_csrf_token()
    response.set_cookie(CSRF_COOKIE, token, httponly=False, secure=settings.cookie_secure, samesite="strict", path="/")
    return {"csrf": token}


class LoginIn(BaseModel):
    email: str = Field(max_length=320)
    password: str = Field(max_length=512)


@router.post("/login")
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    ip = client_ip(request)
    if _ip_blocked(ip):
        raise HTTPException(429, "Muitas tentativas. Aguarde alguns minutos.")
    user = db.execute(select(User).where(func.lower(User.email) == body.email.lower().strip())).scalar()
    now = datetime.now(UTC)
    if user and user.locked_until and user.locked_until.replace(tzinfo=UTC) > now:
        raise HTTPException(423, "Conta bloqueada temporariamente por tentativas inválidas")
    ok = verify_password(user.password_hash if user else DUMMY_HASH, body.password) and bool(user) and user.is_active
    if not ok:
        _ip_fail(ip)
        if user:
            user.failed_logins += 1
            if user.failed_logins >= settings.login_max_attempts:
                user.locked_until = now + timedelta(minutes=settings.login_lock_minutes)
                user.failed_logins = 0
            db.commit()
        raise HTTPException(401, "E-mail ou senha inválidos")
    user.failed_logins = 0
    user.locked_until = None
    db.commit()
    set_session_cookie(response, create_session_token(user.id, user.session_version, mfa_ok=not user.mfa_enabled))
    return {"user": user_out(user), "mfa_required": user.mfa_enabled}


class MfaIn(BaseModel):
    code: str


@router.post("/mfa")
def mfa_verify(body: MfaIn, request: Request, response: Response, db: Session = Depends(get_db)):
    token = request.cookies.get(SESSION_COOKIE)
    payload = decode_session_token(token) if token else None
    if not payload:
        raise HTTPException(401, "Sessão expirada")
    user = db.get(User, int(payload["sub"]))
    if not user or not user.mfa_enabled or not user.mfa_secret:
        raise HTTPException(400, "Verificação em duas etapas não está ativa")
    if not pyotp.TOTP(user.mfa_secret).verify(body.code.strip(), valid_window=1):
        _ip_fail(client_ip(request))
        user.failed_logins += 1
        if user.failed_logins >= settings.login_max_attempts:
            user.locked_until = datetime.now(UTC) + timedelta(minutes=settings.login_lock_minutes)
            user.session_version += 1
        db.commit()
        raise HTTPException(401, "Código inválido")
    user.failed_logins = 0
    db.commit()
    set_session_cookie(response, create_session_token(user.id, user.session_version, mfa_ok=True))
    return {"user": user_out(user)}


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(SESSION_COOKIE, path="/")
    # instrui o navegador a apagar cache, cookies e armazenamento do site
    response.headers["Clear-Site-Data"] = '"cache", "cookies", "storage"'
    return {"ok": True}


@router.get("/me")
def me(user: User = Depends(current_user)):
    return {**user_out(user), "idle_minutes": settings.idle_minutes}


def _send_mail(to: str, subject: str, body: str) -> bool:
    if not settings.smtp_host:
        return False
    msg = EmailMessage()
    msg["From"] = settings.smtp_from or settings.smtp_user
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as s:
        s.starttls()
        if settings.smtp_user:
            s.login(settings.smtp_user, settings.smtp_password)
        s.send_message(msg)
    return True


def create_reset_link(db: Session, user: User, hours: int = 2) -> str:
    raw = secrets.token_urlsafe(32)
    db.add(PasswordResetToken(user_id=user.id, token_hash=token_digest(raw), expires_at=datetime.now(UTC) + timedelta(hours=hours)))
    db.commit()
    return f"{settings.public_url.rstrip('/')}/redefinir-senha?token={raw}"


class ForgotIn(BaseModel):
    email: EmailStr


@router.post("/password/forgot")
def forgot(body: ForgotIn, db: Session = Depends(get_db)):
    user = db.execute(select(User).where(func.lower(User.email) == body.email.lower())).scalar()
    if user and user.is_active and settings.smtp_host:
        link = create_reset_link(db, user)
        try:
            _send_mail(user.email, "MARX — redefinição de senha",
                       f"Olá, {user.name}.\n\nPara definir uma nova senha, acesse (válido por 2 horas):\n{link}\n\nSe você não pediu, ignore esta mensagem.")
        except Exception:  # noqa: BLE001
            pass
    return {"ok": True, "message": "Se o e-mail estiver cadastrado, as instruções foram enviadas. Sem envio de e-mail configurado, peça ao administrador um link de redefinição."}


class ResetIn(BaseModel):
    token: str
    password: str


@router.post("/password/reset")
def reset(body: ResetIn, db: Session = Depends(get_db)):
    t = db.execute(select(PasswordResetToken).where(PasswordResetToken.token_hash == token_digest(body.token))).scalar()
    if not t or t.expires_at.replace(tzinfo=UTC) < datetime.now(UTC):
        raise HTTPException(400, "Link inválido ou expirado")
    probs = password_problems(body.password)
    if probs:
        raise HTTPException(422, "Senha fraca: " + ", ".join(probs))
    user = db.get(User, t.user_id)
    user.password_hash = hash_password(body.password)
    user.must_change_password = False
    user.session_version += 1
    user.failed_logins = 0
    user.locked_until = None
    db.delete(t)  # link de uso único: apagado após o uso
    db.commit()
    return {"ok": True}


class ChangeIn(BaseModel):
    current: str
    new: str


@router.post("/password/change")
def change(body: ChangeIn, response: Response, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if not verify_password(user.password_hash, body.current):
        raise HTTPException(400, "Senha atual incorreta")
    probs = password_problems(body.new)
    if probs:
        raise HTTPException(422, "Senha fraca: " + ", ".join(probs))
    user.password_hash = hash_password(body.new)
    user.must_change_password = False
    user.session_version += 1
    db.commit()
    set_session_cookie(response, create_session_token(user.id, user.session_version, mfa_ok=True))
    return {"ok": True}


@router.post("/mfa/setup")
def mfa_setup(user: User = Depends(current_user), db: Session = Depends(get_db)):
    if user.mfa_enabled:
        raise HTTPException(400, "Já ativa")
    user.mfa_secret = pyotp.random_base32()
    db.commit()
    return {"secret": user.mfa_secret, "otpauth": pyotp.TOTP(user.mfa_secret).provisioning_uri(name=user.email, issuer_name="MARX")}


@router.post("/mfa/enable")
def mfa_enable(body: MfaIn, response: Response, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if not user.mfa_secret or not pyotp.TOTP(user.mfa_secret).verify(body.code.strip(), valid_window=1):
        raise HTTPException(400, "Código inválido")
    user.mfa_enabled = True
    db.commit()
    set_session_cookie(response, create_session_token(user.id, user.session_version, mfa_ok=True))
    return {"ok": True}


class MfaDisableIn(BaseModel):
    password: str
    code: str


@router.post("/mfa/disable")
def mfa_disable(body: MfaDisableIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if not verify_password(user.password_hash, body.password) or not pyotp.TOTP(user.mfa_secret or "").verify(body.code.strip(), valid_window=1):
        raise HTTPException(400, "Senha ou código inválido")
    user.mfa_enabled = False
    user.mfa_secret = None
    db.commit()
    return {"ok": True}
