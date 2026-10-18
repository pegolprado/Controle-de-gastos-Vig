from __future__ import annotations

import secrets
import smtplib
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage

import pyotp
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import audit
from ..config import settings
from ..db import get_db
from ..deps import client_ip, current_user, set_session_cookie
from ..models import LoginAttempt, PasswordResetToken, User
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

IP_WINDOW_MIN = 15
IP_MAX_FAILS = 30


def user_out(u: User) -> dict:
    return {
        "id": u.id, "email": u.email, "name": u.name, "role": u.role, "mfa_enabled": u.mfa_enabled,
        "must_change_password": u.must_change_password, "admin_content_access": u.admin_content_access,
        "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None,
    }


@router.get("/csrf")
def csrf(response: Response, request: Request):
    token = request.cookies.get(CSRF_COOKIE) or new_csrf_token()
    response.set_cookie(CSRF_COOKIE, token, httponly=False, secure=settings.cookie_secure, samesite="strict", path="/")
    return {"csrf": token}


class LoginIn(BaseModel):
    email: EmailStr
    password: str


@router.post("/login")
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    ip = client_ip(request)
    since = datetime.now(UTC) - timedelta(minutes=IP_WINDOW_MIN)
    fails_ip = db.execute(
        select(func.count()).select_from(LoginAttempt).where(LoginAttempt.ip == ip, ~LoginAttempt.success, LoginAttempt.created_at >= since)
    ).scalar()
    if fails_ip >= IP_MAX_FAILS:
        raise HTTPException(429, "Muitas tentativas. Aguarde alguns minutos.")
    email = body.email.lower().strip()
    user = db.execute(select(User).where(func.lower(User.email) == email)).scalar()
    now = datetime.now(UTC)
    if user and user.locked_until and user.locked_until > now:
        db.add(LoginAttempt(ip=ip, email=email, success=False))
        db.commit()
        raise HTTPException(423, "Conta bloqueada temporariamente por tentativas inválidas")
    ok = verify_password(user.password_hash if user else DUMMY_HASH, body.password) and bool(user) and user.is_active
    db.add(LoginAttempt(ip=ip, email=email, success=ok))
    if not ok:
        if user:
            user.failed_logins += 1
            if user.failed_logins >= settings.login_max_attempts:
                user.locked_until = now + timedelta(minutes=settings.login_lock_minutes)
                user.failed_logins = 0
                audit.log(db, "auth.bloqueio", user, ip=ip, commit=False)
        audit.log(db, "auth.login_falhou", None, ip=ip, details={"email_hash": token_digest(email)[:16]}, commit=False)
        db.commit()
        raise HTTPException(401, "E-mail ou senha inválidos")
    user.failed_logins = 0
    user.locked_until = None
    user.last_login_at = now
    token = create_session_token(user.id, user.session_version, mfa_ok=not user.mfa_enabled)
    set_session_cookie(response, token)
    audit.log(db, "auth.login", user, ip=ip, details={"mfa_pending": user.mfa_enabled})
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
        user.failed_logins += 1
        if user.failed_logins >= settings.login_max_attempts:
            user.locked_until = datetime.now(UTC) + timedelta(minutes=settings.login_lock_minutes)
            user.session_version += 1
        db.commit()
        audit.log(db, "auth.mfa_falhou", user, ip=client_ip(request))
        raise HTTPException(401, "Código inválido")
    user.failed_logins = 0
    db.commit()
    set_session_cookie(response, create_session_token(user.id, user.session_version, mfa_ok=True))
    audit.log(db, "auth.mfa_ok", user, ip=client_ip(request))
    return {"user": user_out(user)}


@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    token = request.cookies.get(SESSION_COOKIE)
    payload = decode_session_token(token) if token else None
    if payload:
        user = db.get(User, int(payload["sub"]))
        audit.log(db, "auth.logout", user, ip=client_ip(request))
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"ok": True}


@router.get("/me")
def me(user: User = Depends(current_user)):
    return user_out(user)


class ForgotIn(BaseModel):
    email: EmailStr


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


@router.post("/password/forgot")
def forgot(body: ForgotIn, request: Request, db: Session = Depends(get_db)):
    user = db.execute(select(User).where(func.lower(User.email) == body.email.lower())).scalar()
    sent = False
    if user and user.is_active:
        link = create_reset_link(db, user)
        try:
            sent = _send_mail(user.email, "MARX — redefinição de senha",
                              f"Olá, {user.name}.\n\nPara definir uma nova senha, acesse (válido por 2 horas):\n{link}\n\nSe você não pediu, ignore esta mensagem.")
        except Exception:  # noqa: BLE001
            sent = False
        audit.log(db, "auth.recuperacao_solicitada", user, ip=client_ip(request), details={"email_enviado": sent})
    # resposta idêntica exista ou não a conta
    return {"ok": True, "message": "Se o e-mail estiver cadastrado, as instruções foram enviadas. Sem e-mail configurado, peça ao administrador um link de redefinição."}


class ResetIn(BaseModel):
    token: str
    password: str


@router.post("/password/reset")
def reset(body: ResetIn, request: Request, db: Session = Depends(get_db)):
    t = db.execute(select(PasswordResetToken).where(PasswordResetToken.token_hash == token_digest(body.token))).scalar()
    if not t or t.used_at or t.expires_at < datetime.now(UTC):
        raise HTTPException(400, "Link inválido ou expirado")
    probs = password_problems(body.password)
    if probs:
        raise HTTPException(422, "Senha fraca: " + ", ".join(probs))
    user = db.get(User, t.user_id)
    user.password_hash = hash_password(body.password)
    user.must_change_password = False
    user.session_version += 1  # encerra sessões abertas
    user.failed_logins = 0
    user.locked_until = None
    t.used_at = datetime.now(UTC)
    db.commit()
    audit.log(db, "auth.senha_redefinida", user, ip=client_ip(request))
    return {"ok": True}


class ChangeIn(BaseModel):
    current: str
    new: str


@router.post("/password/change")
def change(body: ChangeIn, request: Request, response: Response, user: User = Depends(current_user), db: Session = Depends(get_db)):
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
    audit.log(db, "auth.senha_alterada", user, ip=client_ip(request))
    return {"ok": True}


@router.post("/mfa/setup")
def mfa_setup(user: User = Depends(current_user), db: Session = Depends(get_db)):
    if user.mfa_enabled:
        raise HTTPException(400, "Já ativa")
    user.mfa_secret = pyotp.random_base32()
    db.commit()
    uri = pyotp.TOTP(user.mfa_secret).provisioning_uri(name=user.email, issuer_name="MARX")
    return {"secret": user.mfa_secret, "otpauth": uri}


@router.post("/mfa/enable")
def mfa_enable(body: MfaIn, request: Request, response: Response, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if not user.mfa_secret or not pyotp.TOTP(user.mfa_secret).verify(body.code.strip(), valid_window=1):
        raise HTTPException(400, "Código inválido")
    user.mfa_enabled = True
    db.commit()
    set_session_cookie(response, create_session_token(user.id, user.session_version, mfa_ok=True))
    audit.log(db, "auth.mfa_ativada", user, ip=client_ip(request))
    return {"ok": True}


class MfaDisableIn(BaseModel):
    password: str
    code: str


@router.post("/mfa/disable")
def mfa_disable(body: MfaDisableIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if not verify_password(user.password_hash, body.password) or not pyotp.TOTP(user.mfa_secret or "").verify(body.code.strip(), valid_window=1):
        raise HTTPException(400, "Senha ou código inválido")
    user.mfa_enabled = False
    user.mfa_secret = None
    db.commit()
    audit.log(db, "auth.mfa_desativada", user, ip=client_ip(request))
    return {"ok": True}
