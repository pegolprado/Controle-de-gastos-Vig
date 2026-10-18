"""Fila de tarefas persistida no PostgreSQL.

Escolha: em vez de Celery+Redis, a fila usa a própria tabela `jobs` com
`SELECT … FOR UPDATE SKIP LOCKED`. Isso elimina um serviço extra (Redis) e mantém
estado, progresso, cancelamento e histórico transacionais e auditáveis no mesmo
banco. Vários workers podem rodar em paralelo com segurança.
"""
from __future__ import annotations

import logging
import os
import socket
import threading
import time
import traceback
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from .config import settings
from .db import SessionLocal
from .models import Job

log = logging.getLogger("atlas.jobs")

HANDLERS: dict[str, Callable[[JobContext], dict | None]] = {}
WORKER_ID = f"{socket.gethostname()}:{os.getpid()}"
STALE_AFTER = timedelta(minutes=5)


class Cancelled(Exception):
    pass


def handler(name: str):
    def deco(fn):
        HANDLERS[name] = fn
        return fn

    return deco


class JobContext:
    def __init__(self, job_id: int):
        self.job_id = job_id
        self.db: Session = SessionLocal()
        self.job: Job = self.db.get(Job, job_id)
        self._last = 0.0

    @property
    def params(self) -> dict:
        return self.job.params or {}

    def progress(self, processed: int, total: int | None = None, message: str | None = None, errors: int | None = None, force: bool = False) -> None:
        now = time.monotonic()
        if not force and now - self._last < 0.7:
            return
        self._last = now
        values = {"processed": processed, "heartbeat_at": datetime.now(UTC)}
        if total is not None:
            values["total"] = total
            values["progress"] = round(min(processed / total, 1.0), 4) if total else 0.0
        if message is not None:
            values["message"] = message
        if errors is not None:
            values["errors_count"] = errors
        with SessionLocal() as s:
            s.execute(update(Job).where(Job.id == self.job_id).values(**values))
            s.commit()
            cancel = s.execute(select(Job.cancel_requested).where(Job.id == self.job_id)).scalar()
        if cancel:
            raise Cancelled()

    def check_cancel(self) -> None:
        with SessionLocal() as s:
            if s.execute(select(Job.cancel_requested).where(Job.id == self.job_id)).scalar():
                raise Cancelled()

    def close(self) -> None:
        self.db.close()


def enqueue(db: Session, job_type: str, params: dict, case_id: int | None, user_id: int | None) -> Job:
    job = Job(type=job_type, params=params, case_id=case_id, created_by=user_id, status="queued")
    db.add(job)
    db.flush()
    return job


def claim_next(db: Session) -> Job | None:
    row = db.execute(
        select(Job)
        .where(Job.status == "queued")
        .order_by(Job.id)
        .with_for_update(skip_locked=True)
        .limit(1)
    ).scalar()
    if row is None:
        return None
    row.status = "running"
    row.started_at = datetime.now(UTC)
    row.heartbeat_at = row.started_at
    row.worker = WORKER_ID
    row.attempts += 1
    db.commit()
    return row


def requeue_stale(db: Session) -> int:
    """Retomada controlada: tarefas 'running' sem sinal de vida voltam para a fila
    (até 3 tentativas); depois falham com mensagem explícita."""
    limit = datetime.now(UTC) - STALE_AFTER
    stale = db.execute(
        select(Job).where(Job.status == "running", Job.heartbeat_at < limit).with_for_update(skip_locked=True)
    ).scalars().all()
    for j in stale:
        if j.attempts >= 3:
            j.status = "failed"
            j.message = "tarefa interrompida repetidamente (worker parou); verifique os registros"
            j.finished_at = datetime.now(UTC)
        else:
            j.status = "queued"
            j.message = "retomada após interrupção do worker"
    db.commit()
    return len(stale)


def run_job(job_id: int) -> None:
    from . import tasks  # noqa: F401  registra os handlers

    ctx = JobContext(job_id)
    job = ctx.job
    fn = HANDLERS.get(job.type)
    status, message, result = "done", None, {}
    try:
        if fn is None:
            raise RuntimeError(f"tipo de tarefa desconhecido: {job.type}")
        result = fn(ctx) or {}
    except Cancelled:
        status, message = "cancelled", "cancelada pelo usuário"
        _on_finish_hook(ctx, "cancelled")
    except Exception as e:  # noqa: BLE001
        log.exception("job %s falhou", job_id)
        status, message = "failed", f"{type(e).__name__}: {e}"
        result = {"trace": traceback.format_exc()[-4000:]}
        _on_finish_hook(ctx, "failed", message)
    finally:
        ctx.db.rollback()
        ctx.close()
    with SessionLocal() as s:
        values = {"status": status, "finished_at": datetime.now(UTC), "result": result}
        if message:
            values["message"] = message
        if status == "done":
            values["progress"] = 1.0
        s.execute(update(Job).where(Job.id == job_id).values(**values))
        s.commit()


FINISH_HOOKS: dict[str, Callable] = {}


def _on_finish_hook(ctx: JobContext, status: str, message: str | None = None) -> None:
    hook = FINISH_HOOKS.get(ctx.job.type)
    if hook:
        try:
            hook(ctx, status, message)
        except Exception:  # noqa: BLE001
            log.exception("hook de término falhou")


def worker_loop(stop: threading.Event | None = None, poll: float = 1.0) -> None:
    from . import tasks  # noqa: F401  registra handlers

    log.info("worker %s iniciado", WORKER_ID)
    last_stale = 0.0
    while not (stop and stop.is_set()):
        try:
            with SessionLocal() as db:
                if time.monotonic() - last_stale > 60:
                    requeue_stale(db)
                    last_stale = time.monotonic()
                job = claim_next(db)
            if job is None:
                time.sleep(poll)
                continue
            run_job(job.id)
        except Exception:  # noqa: BLE001
            log.exception("erro no laço do worker")
            time.sleep(poll * 3)


_embedded: threading.Thread | None = None
_stop = threading.Event()


def start_embedded_worker() -> None:
    global _embedded
    if not settings.embedded_worker or _embedded is not None:
        return
    _embedded = threading.Thread(target=worker_loop, args=(_stop,), daemon=True, name="atlas-worker")
    _embedded.start()


def stop_embedded_worker() -> None:
    _stop.set()
