import sqlite3

import pyotp
from conftest import PASSWORD, make_client

from app.config import settings
from app.db import Base


def test_unauthenticated_is_rejected():
    c = make_client()
    assert c.get("/api/auth/me").status_code == 401
    assert c.get("/api/admin/users").status_code == 401


def test_server_stores_only_users():
    """Por desenho, o banco do servidor não tem nenhuma tabela de arquivos, consultas ou auditoria."""
    assert set(Base.metadata.tables) == {"users", "password_reset_tokens"}
    path = settings.database_url.removeprefix("sqlite:///")
    names = {r[0] for r in sqlite3.connect(path).execute("select name from sqlite_master where type='table'")}
    assert names == {"users", "password_reset_tokens"}


def test_no_data_endpoints_and_body_limit(user):
    for path in ("/api/cases", "/api/files", "/api/events/search", "/api/audit", "/api/reports"):
        assert user.get(path).status_code in (404, 405)
    r = user.post("/api/auth/password/change", content=b"x" * 70_000, headers={"content-type": "application/json"})
    assert r.status_code == 413


def test_csrf_required(user):
    del user.headers["x-csrf-token"]
    assert user.post("/api/auth/logout").status_code == 403
    user.headers["x-csrf-token"] = "forjado"
    assert user.post("/api/auth/logout").status_code == 403


def test_login_lockout_and_generic_errors():
    c = make_client()
    r = c.post("/api/auth/login", json={"email": "naoexiste@teste.com.br", "password": "x"})
    assert r.status_code == 401 and r.json()["detail"] == "E-mail ou senha inválidos"
    for _ in range(3):
        assert c.post("/api/auth/login", json={"email": "bloqueio@teste.com.br", "password": "errada"}).status_code == 401
    assert c.post("/api/auth/login", json={"email": "bloqueio@teste.com.br", "password": PASSWORD}).status_code == 423


def test_logout_clears_site_data(user):
    r = user.post("/api/auth/logout")
    assert r.status_code == 200 and "storage" in r.headers["clear-site-data"]
    assert user.get("/api/auth/me").status_code == 401


def test_privilege_escalation_blocked(user):
    assert user.get("/api/admin/users").status_code == 403
    assert user.post("/api/admin/users", json={"email": "novo@teste.com.br", "name": "Novo", "role": "admin"}).status_code == 403
    me = user.get("/api/auth/me").json()
    assert user.patch(f"/api/admin/users/{me['id']}", json={"role": "admin"}).status_code == 403


def test_admin_user_lifecycle(admin):
    r = admin.post("/api/admin/users", json={"email": "temporario@teste.com.br", "name": "Temp", "can_export": False})
    assert r.status_code == 200 and "redefinir-senha?token=" in r.json()["activation_link"]
    token = r.json()["activation_link"].split("token=")[1]
    c = make_client()
    assert c.post("/api/auth/password/reset", json={"token": token, "password": "curta"}).status_code == 422
    assert c.post("/api/auth/password/reset", json={"token": token, "password": "NovaSenhaSegura2026"}).status_code == 200
    assert c.post("/api/auth/password/reset", json={"token": token, "password": "NovaSenhaSegura2026"}).status_code == 400
    assert c.post("/api/auth/login", json={"email": "temporario@teste.com.br", "password": "NovaSenhaSegura2026"}).status_code == 200
    me = c.get("/api/auth/me").json()
    assert me["can_export"] is False
    uid = r.json()["user"]["id"]
    admin.post(f"/api/admin/users/{uid}/revoke-sessions")
    assert c.get("/api/auth/me").status_code == 401
    assert admin.delete(f"/api/admin/users/{uid}").status_code == 200


def test_mfa_flow():
    c = make_client("outro@teste.com.br")
    secret = c.post("/api/auth/mfa/setup").json()["secret"]
    assert c.post("/api/auth/mfa/enable", json={"code": pyotp.TOTP(secret).now()}).status_code == 200
    c2 = make_client()
    assert c2.post("/api/auth/login", json={"email": "outro@teste.com.br", "password": PASSWORD}).json()["mfa_required"]
    assert c2.get("/api/auth/me").status_code == 401
    assert c2.post("/api/auth/mfa", json={"code": "000000"}).status_code == 401
    assert c2.post("/api/auth/mfa", json={"code": pyotp.TOTP(secret).now()}).status_code == 200
    assert c2.get("/api/auth/me").status_code == 200
    assert c2.post("/api/auth/mfa/disable", json={"password": PASSWORD, "code": pyotp.TOTP(secret).now()}).status_code == 200


def test_security_headers(user):
    r = user.get("/api/auth/me")
    assert r.headers["x-frame-options"] == "DENY" and r.headers["cache-control"] == "no-store"
