"""Configuração lida de variáveis de ambiente (nunca de arquivos versionados)."""
from __future__ import annotations

import os
import secrets
from dataclasses import dataclass, field
from pathlib import Path

APP_VERSION = "1.0.0"
# Versão das regras analíticas (normalização, deduplicação, resolução de ERB,
# estatísticas). Toda alteração de regra que mude resultados incrementa este valor,
# e cada importação/relatório registra a versão usada.
RULES_VERSION = "2026.10-1"


def _bool(name: str, default: bool) -> bool:
    v = os.getenv(name)
    if v is None:
        return default
    return v.strip().lower() in {"1", "true", "yes", "sim", "on"}


@dataclass
class Settings:
    env: str = field(default_factory=lambda: os.getenv("ATLAS_ENV", "development"))
    database_url: str = field(
        default_factory=lambda: os.getenv(
            "DATABASE_URL", "postgresql+psycopg://postgres@localhost:5432/atlas"
        )
    )
    secret_key: str = field(default_factory=lambda: os.getenv("SECRET_KEY", ""))
    storage_dir: Path = field(
        default_factory=lambda: Path(os.getenv("STORAGE_DIR", "./data/storage")).resolve()
    )
    public_url: str = field(default_factory=lambda: os.getenv("PUBLIC_URL", "http://localhost:5173"))
    session_minutes: int = field(default_factory=lambda: int(os.getenv("SESSION_MINUTES", "480")))
    idle_minutes: int = field(default_factory=lambda: int(os.getenv("IDLE_MINUTES", "60")))
    cookie_secure: bool = field(default_factory=lambda: _bool("COOKIE_SECURE", False))
    max_upload_mb: int = field(default_factory=lambda: int(os.getenv("MAX_UPLOAD_MB", "300")))
    max_zip_entries: int = field(default_factory=lambda: int(os.getenv("MAX_ZIP_ENTRIES", "200")))
    max_zip_ratio: int = field(default_factory=lambda: int(os.getenv("MAX_ZIP_RATIO", "100")))
    max_unzipped_mb: int = field(default_factory=lambda: int(os.getenv("MAX_UNZIPPED_MB", "2000")))
    max_rows_per_import: int = field(
        default_factory=lambda: int(os.getenv("MAX_ROWS_PER_IMPORT", "20000000"))
    )
    job_timeout_minutes: int = field(default_factory=lambda: int(os.getenv("JOB_TIMEOUT_MINUTES", "240")))
    login_max_attempts: int = field(default_factory=lambda: int(os.getenv("LOGIN_MAX_ATTEMPTS", "5")))
    login_lock_minutes: int = field(default_factory=lambda: int(os.getenv("LOGIN_LOCK_MINUTES", "15")))
    smtp_host: str = field(default_factory=lambda: os.getenv("SMTP_HOST", ""))
    smtp_port: int = field(default_factory=lambda: int(os.getenv("SMTP_PORT", "587")))
    smtp_user: str = field(default_factory=lambda: os.getenv("SMTP_USER", ""))
    smtp_password: str = field(default_factory=lambda: os.getenv("SMTP_PASSWORD", ""))
    smtp_from: str = field(default_factory=lambda: os.getenv("SMTP_FROM", ""))
    # Worker embutido: em desenvolvimento a API também processa a fila.
    # Em produção roda um processo "worker" separado (docker-compose.prod.yml).
    embedded_worker: bool = field(default_factory=lambda: _bool("EMBEDDED_WORKER", True))
    retention_days: int = field(default_factory=lambda: int(os.getenv("RETENTION_DAYS", "0")))
    map_tile_url: str = field(
        default_factory=lambda: os.getenv(
            "MAP_TILE_URL", "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        )
    )
    map_attribution: str = field(
        default_factory=lambda: os.getenv(
            "MAP_ATTRIBUTION", "&copy; colaboradores do OpenStreetMap"
        )
    )

    def __post_init__(self) -> None:
        if not self.secret_key:
            if self.env == "production":
                raise RuntimeError("SECRET_KEY é obrigatória em produção")
            # Chave efêmera em desenvolvimento: sessões caem ao reiniciar.
            self.secret_key = secrets.token_urlsafe(48)
        self.storage_dir.mkdir(parents=True, exist_ok=True)


settings = Settings()
