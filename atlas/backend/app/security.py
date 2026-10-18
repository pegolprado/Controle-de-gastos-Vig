"""Senhas (Argon2id), sessão em cookie httpOnly assinado (JWT) e proteção CSRF."""
from __future__ import annotations

import hashlib
import hmac
import re
import secrets
from datetime import UTC, datetime, timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from .config import settings

_ph = PasswordHasher()  # Argon2id com parâmetros padrão recomendados

SESSION_COOKIE = "atlas_session"
CSRF_COOKIE = "atlas_csrf"
CSRF_HEADER = "x-csrf-token"


def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _ph.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


# Hash usado quando o e-mail não existe, para o tempo de resposta não revelar contas.
DUMMY_HASH = _ph.hash(secrets.token_urlsafe(16))


def password_problems(password: str) -> list[str]:
    problems = []
    if len(password) < 12:
        problems.append("mínimo de 12 caracteres")
    if not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
        problems.append("use letras e números")
    if password.lower() in {"senha123456789", "password12345", "123456789abc"}:
        problems.append("senha muito comum")
    return problems


def create_session_token(user_id: int, session_version: int, mfa_ok: bool) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "sv": session_version,
        "mfa": mfa_ok,
        "iat": int(now.timestamp()),
        "lat": int(now.timestamp()),  # última atividade (renovada a cada requisição)
        "exp": int((now + timedelta(minutes=settings.session_minutes)).timestamp()),
        "jti": secrets.token_hex(8),
    }
    return jwt.encode(payload, settings.secret_key, algorithm="HS256")


def refresh_activity(payload: dict) -> str:
    p = dict(payload)
    p["lat"] = int(datetime.now(UTC).timestamp())
    return jwt.encode(p, settings.secret_key, algorithm="HS256")


def decode_session_token(token: str) -> dict | None:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    idle = datetime.now(UTC).timestamp() - payload.get("lat", 0)
    if idle > settings.idle_minutes * 60:
        return None
    return payload


def new_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def csrf_matches(cookie_value: str | None, header_value: str | None) -> bool:
    if not cookie_value or not header_value:
        return False
    return hmac.compare_digest(cookie_value, header_value)


def token_digest(token: str) -> str:
    return hashlib.sha256((settings.secret_key + token).encode()).hexdigest()
