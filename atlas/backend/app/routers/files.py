from __future__ import annotations

from pathlib import PurePosixPath

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import delete, func, select, text
from sqlalchemy.orm import Session

from .. import audit
from ..config import RULES_VERSION, settings
from ..db import get_db
from ..deps import CaseAccess, _load_access, case_access, case_exporter, case_writer, client_ip, current_user
from ..jobs import enqueue
from ..models import Event, Import, ImportIssue, Job, LayoutProfile, SourceFile, User
from ..parsers.archive import ArchiveError, safe_entries
from ..parsers.readers import SUPPORTED_TABULAR, sniff_format
from ..services import importer
from ..storage import get_storage
from .admin import job_out

router = APIRouter(tags=["files"])

ALLOWED_EXT = {".csv", ".txt", ".tsv", ".xls", ".xlsx", ".xml", ".json", ".zip", ".pdf", ".html", ".htm", ".dat", ".prn"}


def file_out(f: SourceFile) -> dict:
    return {
        "id": f.id, "parent_id": f.parent_id, "original_name": f.original_name, "size_bytes": f.size_bytes, "sha256": f.sha256,
        "detected_format": f.detected_format, "kind": f.kind, "operator_declared": f.operator_declared,
        "operator_detected": f.operator_detected, "operator_confidence": f.operator_confidence, "status": f.status,
        "uploaded_at": f.uploaded_at.isoformat() if f.uploaded_at else None, "meta": f.meta or {},
    }


def _register(db: Session, access: CaseAccess, name: str, key: str, sha: str, size: int, kind: str, operator: str | None, parent: int | None, ip: str) -> list[dict]:
    st = get_storage()
    path = st.path(key)
    fmt = sniff_format(path, name)
    dup = db.execute(select(SourceFile).where(SourceFile.case_id == access.case.id, SourceFile.sha256 == sha)).scalars().first()
    f = SourceFile(case_id=access.case.id, parent_id=parent, original_name=name, size_bytes=size, sha256=sha, detected_format=fmt,
                   storage_key=key, kind=kind, operator_declared=operator or None, uploaded_by=access.user.id,
                   status="recebido" if fmt in SUPPORTED_TABULAR or fmt == "zip" else "nao_suportado",
                   meta={"duplicate_of": dup.id} if dup else {})
    db.add(f)
    db.flush()
    out = [file_out(f)]
    audit.log(db, "arquivo.recebido", access.user, case_id=access.case.id, entity="file", entity_id=f.id, ip=ip,
              details={"nome": name, "sha256": sha, "bytes": size, "formato": fmt, "duplicado_de": dup.id if dup else None}, commit=False)
    if fmt == "zip":
        try:
            import zipfile

            with zipfile.ZipFile(path) as z:
                for entry_name, info in safe_entries(path):
                    with z.open(info) as src:
                        ckey, csha, csize = st.put_stream("originals", src, settings.max_upload_mb * 1024 * 1024)
                    out += _register(db, access, f"{name}/{PurePosixPath(entry_name).name}", ckey, csha, csize, kind, operator, f.id, ip)
            f.status = "expandido"
        except ArchiveError as e:
            f.status = "rejeitado"
            f.meta = {**f.meta, "error": str(e)}
    return out


@router.post("/cases/{case_id}/files")
async def upload(request: Request, access: CaseAccess = Depends(case_writer), db: Session = Depends(get_db),
                 files: list[UploadFile] = File(...), kind: str = Form("cdr"), operator: str | None = Form(None)):
    if kind not in ("cdr", "erb_registry", "other"):
        raise HTTPException(422, "Tipo inválido")
    st = get_storage()
    out = []
    ip = client_ip(request)
    for up in files:
        name = PurePosixPath(up.filename or "arquivo").name[:400]
        ext = "." + name.rsplit(".", 1)[-1].lower() if "." in name else ""
        if ext and ext not in ALLOWED_EXT:
            raise HTTPException(415, f"Extensão não permitida: {ext}")
        try:
            key, sha, size = st.put_stream("originals", up.file, settings.max_upload_mb * 1024 * 1024)
        except ValueError as e:
            raise HTTPException(413, str(e)) from e
        if size == 0:
            st.delete(key)
            raise HTTPException(422, f"Arquivo vazio: {name}")
        out += _register(db, access, name, key, sha, size, kind, operator, None, ip)
    db.commit()
    return out


@router.get("/cases/{case_id}/files")
def list_files(access: CaseAccess = Depends(case_access), db: Session = Depends(get_db)):
    fs = db.execute(select(SourceFile).where(SourceFile.case_id == access.case.id).order_by(SourceFile.id)).scalars().all()
    ev = dict(db.execute(text("SELECT file_id, count(*) FROM events WHERE case_id = :c GROUP BY 1"), {"c": access.case.id}).all())
    imps = db.execute(select(Import).where(Import.case_id == access.case.id).order_by(Import.id)).scalars().all()
    by_file: dict[int, list] = {}
    for i in imps:
        by_file.setdefault(i.file_id, []).append({"id": i.id, "status": i.status, "kind": i.kind, "rows_ok": i.rows_ok})
    return [{**file_out(f), "events": ev.get(f.id, 0), "imports": by_file.get(f.id, [])} for f in fs]


@router.get("/cases/{case_id}/files/{fid}/download")
def download(fid: int, request: Request, access: CaseAccess = Depends(case_exporter), db: Session = Depends(get_db)):
    f = db.get(SourceFile, fid)
    if not f or f.case_id != access.case.id:
        raise HTTPException(404)
    audit.log(db, "arquivo.baixado", access.user, case_id=access.case.id, entity="file", entity_id=f.id, ip=client_ip(request))
    return FileResponse(get_storage().path(f.storage_key), filename=PurePosixPath(f.original_name).name, media_type="application/octet-stream")


@router.get("/cases/{case_id}/files/{fid}/verify")
def verify_file(fid: int, access: CaseAccess = Depends(case_access), db: Session = Depends(get_db)):
    from ..storage import sha256_file

    f = db.get(SourceFile, fid)
    if not f or f.case_id != access.case.id:
        raise HTTPException(404)
    current = sha256_file(get_storage().path(f.storage_key))
    return {"registered": f.sha256, "current": current, "intact": current == f.sha256}


@router.delete("/cases/{case_id}/files/{fid}")
def delete_file(fid: int, request: Request, reason: str = Query(..., min_length=5), access: CaseAccess = Depends(case_writer), db: Session = Depends(get_db)):
    f = db.get(SourceFile, fid)
    if not f or f.case_id != access.case.id:
        raise HTTPException(404)
    children = db.execute(select(SourceFile).where(SourceFile.parent_id == f.id)).scalars().all()
    keys = [f.storage_key] + [c.storage_key for c in children]
    for c in children:
        db.delete(c)
    db.delete(f)
    db.commit()
    for k in keys:
        get_storage().delete(k)
    importer.recompute_duplicates(db, access.case.id)
    db.commit()
    audit.log(db, "arquivo.excluido", access.user, case_id=access.case.id, entity="file", entity_id=fid, ip=client_ip(request),
              details={"nome": f.original_name, "sha256": f.sha256, "motivo": reason})
    return {"ok": True}


# ------------------------------------------------------------------ importação


class AnalyzeIn(BaseModel):
    kind: str = "cdr"
    read: dict = {}


@router.post("/cases/{case_id}/files/{fid}/analyze")
def analyze(fid: int, body: AnalyzeIn, access: CaseAccess = Depends(case_writer), db: Session = Depends(get_db)):
    f = db.get(SourceFile, fid)
    if not f or f.case_id != access.case.id:
        raise HTTPException(404)
    if f.detected_format not in SUPPORTED_TABULAR:
        raise HTTPException(422, f"Formato '{f.detected_format}' não é tabular ou não é suportado")
    try:
        res = importer.analyze(db, f, body.kind, body.read, access.user.organization_id)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(422, f"Não foi possível ler o arquivo: {type(e).__name__}: {e}") from e
    det = res["operator_detection"]
    f.operator_detected, f.operator_confidence = det["operator"], det["confidence"]
    f.kind = body.kind
    f.meta = {**(f.meta or {}), "table": {k: v for k, v in res["table"].items() if k != "preamble"}}
    db.commit()
    return res


class ImportIn(BaseModel):
    file_id: int
    kind: str = "cdr"
    mapping: dict[str, str | None]
    options: dict = {}
    save_profile: str | None = None


@router.post("/cases/{case_id}/imports")
def create_import(body: ImportIn, request: Request, access: CaseAccess = Depends(case_writer), db: Session = Depends(get_db)):
    f = db.get(SourceFile, body.file_id)
    if not f or f.case_id != access.case.id:
        raise HTTPException(404, "Arquivo não encontrado")
    mapping = {k: v for k, v in body.mapping.items() if v}
    imp = Import(case_id=access.case.id, file_id=f.id, kind=body.kind, mapping=mapping, options=body.options,
                 status="draft", rules_version=RULES_VERSION, created_by=access.user.id)
    db.add(imp)
    if body.options.get("operator"):
        f.operator_declared = body.options["operator"]
    if body.save_profile:
        table = importer.open_table(f, body.options.get("read"))
        db.add(LayoutProfile(organization_id=access.user.organization_id, name=body.save_profile[:200], kind=body.kind,
                             operator=body.options.get("operator"), signature=importer.layout_signature(table.info.columns),
                             columns=table.info.columns, mapping=mapping,
                             options={k: v for k, v in body.options.items() if k not in ("target_number",)}, created_by=access.user.id))
    db.commit()
    audit.log(db, "importacao.configurada", access.user, case_id=access.case.id, entity="import", entity_id=imp.id, ip=client_ip(request),
              details={"file_id": f.id, "mapping": mapping})
    return import_out(imp)


def import_out(i: Import, job: Job | None = None) -> dict:
    return {
        "id": i.id, "file_id": i.file_id, "kind": i.kind, "mapping": i.mapping, "options": i.options, "status": i.status,
        "rows_total": i.rows_total, "rows_ok": i.rows_ok, "rows_error": i.rows_error, "rows_warning": i.rows_warning,
        "rows_duplicate": i.rows_duplicate, "rows_out_of_scope": i.rows_out_of_scope, "rules_version": i.rules_version,
        "summary": i.summary, "job_id": i.job_id, "created_at": i.created_at.isoformat() if i.created_at else None,
        "finished_at": i.finished_at.isoformat() if i.finished_at else None, "job": job_out(job) if job else None,
    }


def _get_import(db, access, iid) -> Import:
    imp = db.get(Import, iid)
    if not imp or imp.case_id != access.case.id:
        raise HTTPException(404)
    return imp


@router.put("/cases/{case_id}/imports/{iid}")
def update_import(iid: int, body: ImportIn, access: CaseAccess = Depends(case_writer), db: Session = Depends(get_db)):
    imp = _get_import(db, access, iid)
    if imp.status != "draft":
        raise HTTPException(409, "Importação já processada: crie uma nova para reprocessar")
    imp.mapping = {k: v for k, v in body.mapping.items() if v}
    imp.options = body.options
    db.commit()
    return import_out(imp)


@router.post("/cases/{case_id}/imports/{iid}/preview")
def preview(iid: int, access: CaseAccess = Depends(case_writer), db: Session = Depends(get_db)):
    imp = _get_import(db, access, iid)
    try:
        return importer.preview(db, imp)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(422, f"Falha na prévia: {type(e).__name__}: {e}") from e


@router.post("/cases/{case_id}/imports/{iid}/run")
def run_import(iid: int, request: Request, access: CaseAccess = Depends(case_writer), db: Session = Depends(get_db)):
    imp = _get_import(db, access, iid)
    if imp.status not in ("draft", "failed", "cancelled"):
        raise HTTPException(409, f"Importação em estado '{imp.status}'")
    pv = importer.preview(db, imp, n=50)
    if pv["required_problems"]:
        raise HTTPException(422, "; ".join(pv["required_problems"]))
    f = db.get(SourceFile, imp.file_id)
    imp.options = {**imp.options, "_estimated_rows": max(int(f.size_bytes / 90), 1)}
    job = enqueue(db, "import", {"import_id": imp.id}, access.case.id, access.user.id)
    imp.job_id, imp.status = job.id, "queued"
    f.status = "em_processamento"
    db.commit()
    audit.log(db, "importacao.iniciada", access.user, case_id=access.case.id, entity="import", entity_id=imp.id, ip=client_ip(request))
    return import_out(imp, job)


@router.get("/cases/{case_id}/imports")
def list_imports(access: CaseAccess = Depends(case_access), db: Session = Depends(get_db)):
    imps = db.execute(select(Import).where(Import.case_id == access.case.id).order_by(Import.id.desc())).scalars().all()
    jobs = {j.id: j for j in db.execute(select(Job).where(Job.id.in_([i.job_id for i in imps if i.job_id]))).scalars()}
    files = {f.id: f.original_name for f in db.execute(select(SourceFile).where(SourceFile.case_id == access.case.id)).scalars()}
    return [{**import_out(i, jobs.get(i.job_id)), "file_name": files.get(i.file_id)} for i in imps]


@router.get("/cases/{case_id}/imports/{iid}")
def get_import(iid: int, access: CaseAccess = Depends(case_access), db: Session = Depends(get_db)):
    imp = _get_import(db, access, iid)
    job = db.get(Job, imp.job_id) if imp.job_id else None
    return import_out(imp, job)


@router.get("/cases/{case_id}/imports/{iid}/issues")
def issues(iid: int, access: CaseAccess = Depends(case_access), db: Session = Depends(get_db),
           severity: str | None = None, code: str | None = None, page: int = 1, size: int = 100):
    imp = _get_import(db, access, iid)
    q = select(ImportIssue).where(ImportIssue.import_id == imp.id)
    if severity:
        q = q.where(ImportIssue.severity == severity)
    if code:
        q = q.where(ImportIssue.code == code)
    total = db.execute(select(func.count()).select_from(q.subquery())).scalar()
    rows = db.execute(q.order_by(ImportIssue.row_number, ImportIssue.id).limit(min(size, 500)).offset((page - 1) * size)).scalars().all()
    return {"total": total, "items": [{"row": r.row_number, "page": r.page, "field": r.field, "severity": r.severity, "code": r.code,
                                        "message": r.message, "raw": r.raw} for r in rows]}


@router.post("/cases/{case_id}/imports/{iid}/discard")
def discard(iid: int, request: Request, access: CaseAccess = Depends(case_writer), db: Session = Depends(get_db)):
    """Descarta o resultado de uma importação (para reprocessar com outro mapeamento).
    O arquivo original permanece preservado."""
    imp = _get_import(db, access, iid)
    if imp.status in ("queued", "running"):
        raise HTTPException(409, "Cancele a tarefa antes de descartar")
    n = db.execute(delete(Event).where(Event.import_id == imp.id)).rowcount
    db.execute(text("DELETE FROM erb_registry_versions WHERE import_id = :i"), {"i": imp.id})
    imp.status = "superseded"
    db.commit()
    importer.recompute_duplicates(db, access.case.id)
    db.commit()
    audit.log(db, "importacao.descartada", access.user, case_id=access.case.id, entity="import", entity_id=imp.id, ip=client_ip(request), details={"eventos_removidos": n})
    return {"ok": True, "events_removed": n}


@router.get("/layouts")
def layouts(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.execute(select(LayoutProfile).where(LayoutProfile.organization_id == user.organization_id).order_by(LayoutProfile.id.desc())).scalars()
    return [{"id": p.id, "name": p.name, "kind": p.kind, "operator": p.operator, "columns": p.columns, "mapping": p.mapping,
             "created_at": p.created_at.isoformat() if p.created_at else None} for p in rows]


@router.delete("/layouts/{pid}")
def delete_layout(pid: int, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = db.get(LayoutProfile, pid)
    if not p or p.organization_id != user.organization_id:
        raise HTTPException(404)
    if user.role not in ("admin", "analyst"):
        raise HTTPException(403)
    db.delete(p)
    db.commit()
    audit.log(db, "layout.removido", user, entity="layout", entity_id=pid, ip=client_ip(request))
    return {"ok": True}


# ------------------------------------------------------------------ tarefas


@router.get("/cases/{case_id}/jobs")
def case_jobs(access: CaseAccess = Depends(case_access), db: Session = Depends(get_db), limit: int = 30):
    rows = db.execute(select(Job).where(Job.case_id == access.case.id).order_by(Job.id.desc()).limit(limit)).scalars().all()
    return [job_out(j) for j in rows]


@router.get("/jobs/{jid}")
def get_job(jid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    j = db.get(Job, jid)
    if not j:
        raise HTTPException(404)
    if j.case_id:
        _load_access(j.case_id, user, db)
    elif j.created_by != user.id and user.role != "admin":
        raise HTTPException(404)
    return job_out(j)


@router.post("/cases/{case_id}/jobs/{jid}/cancel")
def cancel_job(jid: int, request: Request, access: CaseAccess = Depends(case_writer), db: Session = Depends(get_db)):
    j = db.get(Job, jid)
    if not j or j.case_id != access.case.id:
        raise HTTPException(404)
    if j.status == "queued":
        j.status, j.message = "cancelled", "cancelada antes de iniciar"
        if j.type == "import":
            imp = db.get(Import, j.params.get("import_id"))
            if imp:
                imp.status = "cancelled"
    elif j.status == "running":
        j.cancel_requested = True
    db.commit()
    audit.log(db, "tarefa.cancelada", access.user, case_id=access.case.id, entity="job", entity_id=j.id, ip=client_ip(request))
    return job_out(j)

