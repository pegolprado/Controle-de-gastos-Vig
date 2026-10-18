import io
import zipfile

from conftest import PASSWORD, make_client

from app.audit import verify_chain
from app.db import SessionLocal


def test_unauthenticated_is_rejected():
    c = make_client()
    assert c.get("/api/cases").status_code == 401
    assert c.get("/api/dashboard").status_code == 401
    assert c.post("/api/cases", json={"title": "x" * 5}).status_code == 401


def test_csrf_required(analyst):
    del analyst.headers["x-csrf-token"]
    r = analyst.post("/api/cases", json={"title": "Sem CSRF"})
    assert r.status_code == 403 and "CSRF" in r.text
    analyst.headers["x-csrf-token"] = "forjado"
    assert analyst.post("/api/cases", json={"title": "CSRF forjado"}).status_code == 403


def test_login_lockout_and_generic_errors():
    c = make_client()
    r = c.post("/api/auth/login", json={"email": "naoexiste@teste.com.br", "password": "x"})
    assert r.status_code == 401 and r.json()["detail"] == "E-mail ou senha inválidos"
    for _ in range(3):
        assert c.post("/api/auth/login", json={"email": "bloqueio@teste.com.br", "password": "errada"}).status_code == 401
    r = c.post("/api/auth/login", json={"email": "bloqueio@teste.com.br", "password": PASSWORD})
    assert r.status_code == 423


def test_privilege_escalation_blocked(analyst, viewer):
    assert analyst.get("/api/admin/users").status_code == 403
    assert analyst.post("/api/admin/users", json={"email": "novo@teste.com.br", "name": "Novo", "role": "admin"}).status_code == 403
    assert viewer.post("/api/cases", json={"title": "Consulta não cria"}).status_code == 403
    me = analyst.get("/api/auth/me").json()
    assert analyst.patch(f"/api/admin/users/{me['id']}", json={"role": "admin"}).status_code == 403


def test_admin_user_lifecycle_and_session_revocation(admin):
    r = admin.post("/api/admin/users", json={"email": "temporario@teste.com.br", "name": "Temp", "role": "analyst"})
    assert r.status_code == 200 and "redefinir-senha?token=" in r.json()["activation_link"]
    token = r.json()["activation_link"].split("token=")[1]
    c = make_client()
    assert c.post("/api/auth/password/reset", json={"token": token, "password": "curta"}).status_code == 422
    assert c.post("/api/auth/password/reset", json={"token": token, "password": "NovaSenhaSegura2026"}).status_code == 200
    assert c.post("/api/auth/password/reset", json={"token": token, "password": "NovaSenhaSegura2026"}).status_code == 400  # uso único
    assert c.post("/api/auth/login", json={"email": "temporario@teste.com.br", "password": "NovaSenhaSegura2026"}).status_code == 200
    assert c.get("/api/auth/me").status_code == 200
    uid = r.json()["user"]["id"]
    admin.post(f"/api/admin/users/{uid}/revoke-sessions")
    assert c.get("/api/auth/me").status_code == 401


def test_mfa_flow(admin):
    import pyotp

    c = make_client("revisor@teste.com.br")
    secret = c.post("/api/auth/mfa/setup").json()["secret"]
    assert c.post("/api/auth/mfa/enable", json={"code": pyotp.TOTP(secret).now()}).status_code == 200
    c2 = make_client()
    r = c2.post("/api/auth/login", json={"email": "revisor@teste.com.br", "password": PASSWORD})
    assert r.json()["mfa_required"]
    assert c2.get("/api/cases").status_code == 401
    assert c2.post("/api/auth/mfa", json={"code": "000000"}).status_code == 401
    assert c2.post("/api/auth/mfa", json={"code": pyotp.TOTP(secret).now()}).status_code == 200
    assert c2.get("/api/cases").status_code == 200
    assert c2.post("/api/auth/mfa/disable", json={"password": PASSWORD, "code": pyotp.TOTP(secret).now()}).status_code == 200


def test_injection_attempts_are_inert(analyst):
    cid = analyst.post("/api/cases", json={"title": "Injeção"}).json()["id"]
    r = analyst.post(f"/api/cases/{cid}/events/search", json={"filter": {"numbers": ["1; DROP TABLE events; --"], "operators": ["' OR 1=1 --"]},
                                                             "sort": "ts; DROP TABLE users", "order": "desc; --"})
    assert r.status_code == 200 and r.json()["total"] == 0
    r = analyst.post(f"/api/cases/{cid}/events/search", json={"filter": {"hour_from": 99}})
    assert r.status_code == 422
    assert analyst.get("/api/cases").status_code == 200


def test_upload_validation(analyst):
    cid = analyst.post("/api/cases", json={"title": "Uploads"}).json()["id"]
    r = analyst.post(f"/api/cases/{cid}/files", files={"files": ("malware.exe", io.BytesIO(b"MZ..."))})
    assert r.status_code == 415
    r = analyst.post(f"/api/cases/{cid}/files", files={"files": ("vazio.csv", io.BytesIO(b""))})
    assert r.status_code == 422
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("../../../etc/passwd.csv", "x;y\n")
        z.writestr("ok.csv", "Data;Hora\n01/03/2026;10:00\n")
    r = analyst.post(f"/api/cases/{cid}/files", files={"files": ("pacote.zip", io.BytesIO(buf.getvalue()))})
    names = [f["original_name"] for f in r.json()]
    assert names == ["pacote.zip", "pacote.zip/ok.csv"]
    # arquivo de outro caso não é acessível por id
    other = analyst.post("/api/cases", json={"title": "Outro caso"}).json()["id"]
    fid = r.json()[1]["id"]
    assert analyst.get(f"/api/cases/{other}/files/{fid}/download").status_code == 404
    assert analyst.get(f"/api/cases/{cid}/files/{fid}/verify").json()["intact"]


def test_original_files_are_read_only_on_disk(analyst):
    import os

    from app.models import SourceFile
    from app.storage import get_storage

    cid = analyst.post("/api/cases", json={"title": "Somente leitura"}).json()["id"]
    f = analyst.post(f"/api/cases/{cid}/files", files={"files": ("a.csv", io.BytesIO(b"Data;Hora\n01/03/2026;10:00\n"))}).json()[0]
    with SessionLocal() as db:
        sf = db.get(SourceFile, f["id"])
        mode = os.stat(get_storage().path(sf.storage_key)).st_mode & 0o777
    assert mode == 0o400


def test_security_headers_and_audit_chain(analyst):
    r = analyst.get("/api/cases")
    assert r.headers["x-frame-options"] == "DENY" and r.headers["cache-control"] == "no-store"
    with SessionLocal() as db:
        assert verify_chain(db)["ok"]
