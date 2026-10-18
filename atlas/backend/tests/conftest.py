"""Fixtures: banco PostgreSQL de teste recriado a cada sessão e clientes autenticados.

Defina TEST_DATABASE_URL (padrão: postgresql+psycopg://postgres@localhost:5432/atlas_test).
"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ["DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL", "postgresql+psycopg://postgres@localhost:5432/atlas_test")
os.environ["STORAGE_DIR"] = tempfile.mkdtemp(prefix="atlas-test-")
os.environ["EMBEDDED_WORKER"] = "false"
os.environ["SECRET_KEY"] = "teste-" + "x" * 40
os.environ["LOGIN_MAX_ATTEMPTS"] = "3"

import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import select, text  # noqa: E402

from app.db import SessionLocal, engine  # noqa: E402
from app.jobs import run_job  # noqa: E402
from app.models import Job, Organization, User  # noqa: E402
from app.security import hash_password  # noqa: E402

PASSWORD = "SenhaDeTeste2026"


@pytest.fixture(scope="session", autouse=True)
def database():
    with engine.begin() as c:
        c.execute(text("DROP SCHEMA public CASCADE; CREATE SCHEMA public;"))
    cfg = Config(str(ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(ROOT / "alembic"))
    command.upgrade(cfg, "head")
    with SessionLocal() as db:
        org = Organization(name="Org Teste")
        other = Organization(name="Outra Org")
        db.add_all([org, other])
        db.flush()
        for email, role, oid in (
            ("admin@teste.com.br", "admin", org.id), ("analista@teste.com.br", "analyst", org.id),
            ("analista2@teste.com.br", "analyst", org.id), ("revisor@teste.com.br", "reviewer", org.id),
            ("consulta@teste.com.br", "viewer", org.id), ("externo@outra.com.br", "analyst", other.id),
            ("bloqueio@teste.com.br", "analyst", org.id),
        ):
            db.add(User(organization_id=oid, email=email, name=email.split("@")[0].title(), role=role, password_hash=hash_password(PASSWORD)))
        db.commit()
    yield


def make_client(email: str | None = None) -> TestClient:
    from app.main import app

    c = TestClient(app)
    tok = c.get("/api/auth/csrf").json()["csrf"]
    c.headers["x-csrf-token"] = tok
    if email:
        r = c.post("/api/auth/login", json={"email": email, "password": PASSWORD})
        assert r.status_code == 200, r.text
    return c


@pytest.fixture
def admin():
    return make_client("admin@teste.com.br")


@pytest.fixture
def analyst():
    return make_client("analista@teste.com.br")


@pytest.fixture
def analyst2():
    return make_client("analista2@teste.com.br")


@pytest.fixture
def reviewer():
    return make_client("revisor@teste.com.br")


@pytest.fixture
def viewer():
    return make_client("consulta@teste.com.br")


@pytest.fixture
def outsider():
    return make_client("externo@outra.com.br")


def drain_jobs() -> list[Job]:
    """Executa a fila de forma síncrona (o worker real faz o mesmo em segundo plano)."""
    done = []
    while True:
        with SessionLocal() as db:
            from app.jobs import claim_next

            job = claim_next(db)
        if not job:
            break
        run_job(job.id)
        with SessionLocal() as db:
            done.append(db.get(Job, job.id))
    return done


def user_id(email: str) -> int:
    with SessionLocal() as db:
        return db.execute(select(User.id).where(User.email == email)).scalar()
