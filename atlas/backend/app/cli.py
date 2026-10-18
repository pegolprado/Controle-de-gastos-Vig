"""Comandos de operação.

  python -m app.cli create-admin --email x@dominio --name "Nome"   (pede a senha)
  python -m app.cli seed-demo --email x@dominio
  python -m app.cli verify-audit
  python -m app.cli worker
"""
from __future__ import annotations

import argparse
import getpass
import os
import sys

from sqlalchemy import func, select

from . import audit
from .db import SessionLocal
from .models import Organization, User
from .security import hash_password, password_problems


def create_admin(email: str, name: str, password: str | None, org: str) -> None:
    password = password or os.getenv("ATLAS_ADMIN_PASSWORD") or getpass.getpass("Senha do administrador: ")
    probs = password_problems(password)
    if probs:
        sys.exit("Senha fraca: " + ", ".join(probs))
    with SessionLocal() as db:
        o = db.execute(select(Organization).where(Organization.name == org)).scalar()
        if not o:
            o = Organization(name=org)
            db.add(o)
            db.flush()
        u = db.execute(select(User).where(func.lower(User.email) == email.lower())).scalar()
        if u:
            u.password_hash, u.role, u.is_active = hash_password(password), "admin", True
            u.session_version += 1
        else:
            u = User(organization_id=o.id, email=email.lower(), name=name, role="admin", password_hash=hash_password(password))
            db.add(u)
        db.commit()
        audit.log(db, "usuario.admin_cli", u, entity="user", entity_id=u.id)
        print(f"administrador pronto: {u.email} (id {u.id})")


def main() -> None:
    p = argparse.ArgumentParser(prog="atlas")
    sub = p.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("create-admin")
    a.add_argument("--email", required=True)
    a.add_argument("--name", default="Administrador")
    a.add_argument("--password")
    a.add_argument("--org", default=os.getenv("ATLAS_ORG_NAME", "Organização"))
    s = sub.add_parser("seed-demo")
    s.add_argument("--email", required=True)
    sub.add_parser("verify-audit")
    sub.add_parser("worker")
    args = p.parse_args()
    if args.cmd == "create-admin":
        create_admin(args.email, args.name, args.password, args.org)
    elif args.cmd == "seed-demo":
        from .services.demo import _NullCtx, seed

        with SessionLocal() as db:
            u = db.execute(select(User).where(func.lower(User.email) == args.email.lower())).scalar()
            if not u:
                sys.exit("usuário não encontrado")
            print(seed(db, u.id, _NullCtx(db)))
    elif args.cmd == "verify-audit":
        with SessionLocal() as db:
            print(audit.verify_chain(db))
    elif args.cmd == "worker":
        import logging

        from .jobs import worker_loop

        logging.basicConfig(level=logging.INFO)
        worker_loop()


if __name__ == "__main__":
    main()
