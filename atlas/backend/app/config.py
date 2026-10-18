"""Configuração lida de variáveis de ambiente (nunca de arquivos versionados).

O servidor do MARX guarda SOMENTE a lista de usuários. Arquivos, consultas e
resultados são processados no navegador de cada usuário e nunca chegam aqui.
"""
from __future__ import annotations

import os
import secrets
from dataclasses import dataclass, field
from pathlib import Path

APP_VERSION = "2.0.0"


def _bool(name: str, default: bool) -> bool:
    v = os.getenv(name)
    if v is None:
        return default
    return v.strip().lower() in {"1", "true", "yes", "sim", "on"}


@dataclass
class Settings:
    env: str = field(default_factory=lambda: os.getenv("MARX_ENV", "development"))
    database_url: str = field(default_factory=lambda: os.getenv("DATABASE_URL", "sqlite:///./data/marx-usuarios.db"))
    secret_key: str = field(default_factory=lambda: os.getenv("SECRET_KEY", ""))
    public_url: str = field(default_factory=lambda: os.getenv("PUBLIC_URL", "http://localhost:5173"))
    session_minutes: int = field(default_factory=lambda: int(os.getenv("SESSION_MINUTES", "480")))
    idle_minutes: int = field(default_factory=lambda: int(os.getenv("IDLE_MINUTES", "30")))
    cookie_secure: bool = field(default_factory=lambda: _bool("COOKIE_SECURE", False))
    login_max_attempts: int = field(default_factory=lambda: int(os.getenv("LOGIN_MAX_ATTEMPTS", "5")))
    login_lock_minutes: int = field(default_factory=lambda: int(os.getenv("LOGIN_LOCK_MINUTES", "15")))
    smtp_host: str = field(default_factory=lambda: os.getenv("SMTP_HOST", ""))
    smtp_port: int = field(default_factory=lambda: int(os.getenv("SMTP_PORT", "587")))
    smtp_user: str = field(default_factory=lambda: os.getenv("SMTP_USER", ""))
    smtp_password: str = field(default_factory=lambda: os.getenv("SMTP_PASSWORD", ""))
    smtp_from: str = field(default_factory=lambda: os.getenv("SMTP_FROM", ""))
    map_tile_url: str = field(default_factory=lambda: os.getenv("MAP_TILE_URL", "https://tile.openstreetmap.org/{z}/{x}/{y}.png"))
    map_attribution: str = field(default_factory=lambda: os.getenv("MAP_ATTRIBUTION", "&copy; colaboradores do OpenStreetMap"))

    def __post_init__(self) -> None:
        if not self.secret_key:
            if self.env == "production":
                raise RuntimeError("SECRET_KEY é obrigatória em produção")
            self.secret_key = secrets.token_urlsafe(48)
        if self.database_url.startswith("sqlite:///"):
            Path(self.database_url.removeprefix("sqlite:///")).parent.mkdir(parents=True, exist_ok=True)


settings = Settings()
