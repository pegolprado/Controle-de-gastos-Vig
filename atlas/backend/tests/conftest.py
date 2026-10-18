"""Fixtures: banco SQLite temporário (apenas usuários) e clientes autenticados."""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
_tmp = tempfile.mkdtemp(prefix="marx-test-")
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/usuarios.db"
os.environ["SECRET_KEY"] = "teste-" + "x" * 40
os.environ["LOGIN_MAX_ATTEMPTS"] = "3"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.db import SessionLocal, init_db  # noqa: E402
from app.models import User  # noqa: E402
from app.security import hash_password  # noqa: E402

PASSWORD = "SenhaDeTeste2026"


@pytest.fixture(scope="session", autouse=True)
def database():
    init_db()
    with SessionLocal() as db:
        for email, role in (("admin@teste.com.br", "admin"), ("usuario@teste.com.br", "user"),
                            ("outro@teste.com.br", "user"), ("bloqueio@teste.com.br", "user")):
            db.add(User(email=email, name=email.split("@")[0].title(), role=role, password_hash=hash_password(PASSWORD)))
        db.commit()
    yield


def make_client(email: str | None = None) -> TestClient:
    from app.main import app

    c = TestClient(app)
    c.headers["x-csrf-token"] = c.get("/api/auth/csrf").json()["csrf"]
    if email:
        r = c.post("/api/auth/login", json={"email": email, "password": PASSWORD})
        assert r.status_code == 200, r.text
    return c


@pytest.fixture
def admin():
    return make_client("admin@teste.com.br")


@pytest.fixture
def user():
    return make_client("usuario@teste.com.br")
