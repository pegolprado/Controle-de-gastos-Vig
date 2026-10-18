"""Trilha de auditoria encadeada por hash.

Os detalhes registram identificadores e parâmetros, nunca o conteúdo integral de
registros telefônicos ou dados pessoais.
"""
from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from .models import AuditLog, User

GENESIS = "0" * 64
_SENSITIVE_KEYS = {"password", "senha", "token", "mfa_code", "secret", "raw", "a_number", "b_number"}


def _scrub(details: dict) -> dict:
    out = {}
    for k, v in (details or {}).items():
        if k.lower() in _SENSITIVE_KEYS:
            out[k] = "[omitido]"
        elif isinstance(v, dict):
            out[k] = _scrub(v)
        elif isinstance(v, str) and len(v) > 500:
            out[k] = v[:500] + "…"
        else:
            out[k] = v
    return out


def _digest(prev_hash: str, ts: str, user_id, action, case_id, entity, entity_id, details) -> str:
    material = json.dumps(
        [prev_hash, ts, user_id, action, case_id, entity, entity_id, details],
        sort_keys=True,
        ensure_ascii=False,
        default=str,
    )
    return hashlib.sha256(material.encode()).hexdigest()


def log(
    db: Session,
    action: str,
    user: User | None = None,
    *,
    case_id: int | None = None,
    entity: str | None = None,
    entity_id: object = None,
    ip: str | None = None,
    details: dict | None = None,
    commit: bool = True,
) -> None:
    # Serializa a escrita da trilha para manter o encadeamento consistente.
    db.execute(text("SELECT pg_advisory_xact_lock(424242)"))
    prev = db.execute(select(AuditLog.hash).order_by(AuditLog.id.desc()).limit(1)).scalar()
    prev_hash = prev or GENESIS
    ts = datetime.now(UTC)
    d = _scrub(details or {})
    eid = None if entity_id is None else str(entity_id)
    uid = user.id if user else None
    h = _digest(prev_hash, ts.isoformat(), uid, action, case_id, entity, eid, d)
    db.add(
        AuditLog(
            ts=ts,
            user_id=uid,
            user_email=user.email if user else None,
            action=action,
            case_id=case_id,
            entity=entity,
            entity_id=eid,
            ip=ip,
            details=d,
            prev_hash=prev_hash,
            hash=h,
        )
    )
    db.flush()  # a próxima entrada na mesma transação precisa enxergar este hash
    if commit:
        db.commit()


def verify_chain(db: Session, limit: int | None = None) -> dict:
    """Recalcula a cadeia e aponta a primeira linha adulterada, se houver."""
    q = select(AuditLog).order_by(AuditLog.id)
    prev = GENESIS
    checked = 0
    for row in db.execute(q).scalars():
        expected = _digest(
            prev, row.ts.astimezone(UTC).isoformat(), row.user_id, row.action, row.case_id,
            row.entity, row.entity_id, row.details,
        )
        if row.prev_hash != prev or row.hash != expected:
            return {"ok": False, "checked": checked, "broken_at": row.id}
        prev = row.hash
        checked += 1
        if limit and checked >= limit:
            break
    return {"ok": True, "checked": checked, "broken_at": None}
