"""Handlers das tarefas assíncronas."""
from __future__ import annotations

from datetime import UTC, datetime

from . import audit
from .jobs import FINISH_HOOKS, JobContext, handler
from .models import Case, Import, Report, User
from .services import alerts as alert_svc
from .services import erb as erb_svc
from .services import importer
from .services import reports as report_svc
from .services.analytics import EventFilter
from .storage import get_storage


@handler("import")
def _import(ctx: JobContext) -> dict:
    imp = ctx.db.get(Import, ctx.params["import_id"])
    imp.status = "running"
    ctx.db.commit()
    if imp.kind == "erb_registry":
        res = importer.run_erb_import(ctx, imp)
    else:
        res = importer.run_cdr_import(ctx, imp)
    if ctx.params.get("auto_resolve", True):
        ctx.progress(0, None, "resolvendo identificadores de ERB", force=True)
        erb_svc.run_resolution(ctx.db, imp.case_id, None, ctx.job.created_by)
    ctx.progress(1, 1, "importação concluída", force=True)
    user = ctx.db.get(User, ctx.job.created_by) if ctx.job.created_by else None
    audit.log(ctx.db, "import.processado", user, case_id=imp.case_id, entity="import", entity_id=imp.id,
              details={k: v for k, v in res.items() if k != "trace"})
    return res


def _import_finished(ctx: JobContext, status: str, message: str | None = None) -> None:
    ctx.db.rollback()
    imp_id = ctx.params.get("import_id")
    if imp_id:
        importer.mark_import_finished(ctx.db, imp_id, status, message)


FINISH_HOOKS["import"] = _import_finished


@handler("resolve_erb")
def _resolve(ctx: JobContext) -> dict:
    return erb_svc.run_resolution(ctx.db, ctx.job.case_id, ctx.params.get("version_ids"), ctx.job.created_by,
                                  progress=lambda i, n: ctx.progress(i, n, "resolvendo células"))


@handler("run_alerts")
def _alerts(ctx: JobContext) -> dict:
    return alert_svc.run_rules(ctx.db, ctx.job.case_id, ctx.params.get("rule_ids"))


@handler("report")
def _report(ctx: JobContext) -> dict:
    db = ctx.db
    rep = db.get(Report, ctx.params["report_id"])
    case = db.get(Case, rep.case_id)
    user = db.get(User, rep.created_by)
    f = EventFilter(**(rep.params.get("filters") or {}))
    ctx.progress(1, 4, "coletando dados", force=True)
    data = report_svc.collect(db, case, rep.report_type, f, rep.params.get("options") or {}, user)
    ctx.progress(2, 4, "gerando arquivo", force=True)
    content = report_svc.RENDERERS[rep.fmt](data, rep)
    st = get_storage()
    key, sha, size = st.put_bytes("reports", content, suffix=f".{rep.fmt}")
    # manifesto congelado com os dados usados (para conferência e reprodução)
    report_svc_manifest = report_svc.render_json(data, rep)
    mkey, msha, _ = st.put_bytes("reports", report_svc_manifest, suffix=".manifest.json")
    rep.storage_key, rep.sha256, rep.size_bytes = key, sha, size
    rep.input_files = data["files"]
    rep.params = {**rep.params, "manifest_key": mkey, "manifest_sha256": msha, "generated_at": datetime.now(UTC).isoformat()}
    rep.status = "rascunho"
    db.commit()
    audit.log(db, "relatorio.gerado", user, case_id=case.id, entity="report", entity_id=rep.id,
              details={"code": rep.code, "fmt": rep.fmt, "sha256": sha})
    return {"report_id": rep.id, "sha256": sha, "size": size}


def _report_failed(ctx: JobContext, status: str, message: str | None = None) -> None:
    ctx.db.rollback()
    rep = ctx.db.get(Report, ctx.params.get("report_id"))
    if rep:
        rep.status = "falhou"
        ctx.db.commit()


FINISH_HOOKS["report"] = _report_failed


@handler("demo_seed")
def _demo(ctx: JobContext) -> dict:
    from .services import demo

    return demo.seed(ctx.db, ctx.job.created_by, ctx)
