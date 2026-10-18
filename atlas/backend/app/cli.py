"""Comandos de operação.

  python -m app.cli create-admin --email x@dominio --name "Nome"   (pede a senha)
"""
from __future__ import annotations

import argparse
import getpass
import os
import sys

from sqlalchemy import func, select

from .db import SessionLocal, init_db
from .models import User
from .security import hash_password, password_problems


def create_admin(email: str, name: str, password: str | None) -> None:
    password = password or os.getenv("MARX_ADMIN_PASSWORD") or getpass.getpass("Senha do administrador: ")
    probs = password_problems(password)
    if probs:
        sys.exit("Senha fraca: " + ", ".join(probs))
    init_db()
    with SessionLocal() as db:
        u = db.execute(select(User).where(func.lower(User.email) == email.lower())).scalar()
        if u:
            u.password_hash, u.role, u.is_active = hash_password(password), "admin", True
            u.session_version += 1
        else:
            u = User(email=email.lower(), name=name, role="admin", password_hash=hash_password(password))
            db.add(u)
        db.commit()
        print(f"administrador pronto: {u.email}")


def main() -> None:
    p = argparse.ArgumentParser(prog="marx")
    sub = p.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("create-admin")
    a.add_argument("--email", required=True)
    a.add_argument("--name", default="Administrador")
    a.add_argument("--password")
    args = p.parse_args()
    if args.cmd == "create-admin":
        create_admin(args.email, args.name, args.password)


if __name__ == "__main__":
    main()
