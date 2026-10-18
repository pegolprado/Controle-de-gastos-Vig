"""Modelo de dados. As migrações Alembic em alembic/versions são a fonte do schema."""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base

# Papéis globais: admin | analyst | reviewer | viewer
# Papéis por caso: analyst | reviewer | viewer
GLOBAL_ROLES = ("admin", "analyst", "reviewer", "viewer")
CASE_ROLES = ("analyst", "reviewer", "viewer")


class Organization(Base):
    __tablename__ = "organizations"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey("organizations.id"))
    email: Mapped[str] = mapped_column(String(254), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    password_hash: Mapped[str] = mapped_column(String(300))
    role: Mapped[str] = mapped_column(String(20), default="analyst")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Separação de funções: admin sem acesso automático ao conteúdo dos casos.
    admin_content_access: Mapped[bool] = mapped_column(Boolean, default=False)
    mfa_secret: Mapped[str | None] = mapped_column(String(64), nullable=True)
    mfa_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    failed_logins: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False)
    session_version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    token_hash: Mapped[str] = mapped_column(String(128), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class LoginAttempt(Base):
    __tablename__ = "login_attempts"
    id: Mapped[int] = mapped_column(primary_key=True)
    ip: Mapped[str] = mapped_column(String(64), index=True)
    email: Mapped[str] = mapped_column(String(254))
    success: Mapped[bool] = mapped_column(Boolean)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class Case(Base):
    __tablename__ = "cases"
    id: Mapped[int] = mapped_column(primary_key=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey("organizations.id"))
    code: Mapped[str] = mapped_column(String(40), unique=True)
    title: Mapped[str] = mapped_column(String(300))
    process_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    unit: Mapped[str | None] = mapped_column(String(200), nullable=True)
    responsible_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    period_start: Mapped[date | None] = mapped_column(Date, nullable=True)
    period_end: Mapped[date | None] = mapped_column(Date, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="aberto")
    access_level: Mapped[str] = mapped_column(String(20), default="restrito")
    authorized_docs: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    require_justification: Mapped[bool] = mapped_column(Boolean, default=False)
    retention_until: Mapped[date | None] = mapped_column(Date, nullable=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class CaseMember(Base):
    __tablename__ = "case_members"
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    role: Mapped[str] = mapped_column(String(20), default="viewer")
    can_export: Mapped[bool] = mapped_column(Boolean, default=False)
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AccessJustification(Base):
    __tablename__ = "access_justifications"
    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    justification: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Target(Base):
    __tablename__ = "targets"
    __table_args__ = (UniqueConstraint("case_id", "number_normalized"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"), index=True)
    number_normalized: Mapped[str] = mapped_column(String(32))
    number_original: Mapped[str] = mapped_column(String(64))
    operator: Mapped[str | None] = mapped_column(String(40), nullable=True)
    internal_id: Mapped[str | None] = mapped_column(String(60), nullable=True)
    label: Mapped[str | None] = mapped_column(String(200), nullable=True)
    period_start: Mapped[date | None] = mapped_column(Date, nullable=True)
    period_end: Mapped[date | None] = mapped_column(Date, nullable=True)
    source: Mapped[str | None] = mapped_column(String(300), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    validation_status: Mapped[str] = mapped_column(String(20), default="pendente")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SourceFile(Base):
    """Arquivo original preservado. Nunca é alterado depois de gravado."""

    __tablename__ = "source_files"
    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"), index=True)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("source_files.id"), nullable=True)
    original_name: Mapped[str] = mapped_column(String(500))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    detected_format: Mapped[str] = mapped_column(String(20))
    storage_key: Mapped[str] = mapped_column(String(300))
    kind: Mapped[str] = mapped_column(String(20), default="cdr")  # cdr | erb_registry | other
    operator_declared: Mapped[str | None] = mapped_column(String(40), nullable=True)
    operator_detected: Mapped[str | None] = mapped_column(String(40), nullable=True)
    operator_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    meta: Mapped[dict] = mapped_column(JSONB, default=dict)
    status: Mapped[str] = mapped_column(String(20), default="recebido")
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class LayoutProfile(Base):
    """Mapeamento salvo para reaproveitar em arquivos com a mesma estrutura."""

    __tablename__ = "layout_profiles"
    id: Mapped[int] = mapped_column(primary_key=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey("organizations.id"))
    name: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(20), default="cdr")
    operator: Mapped[str | None] = mapped_column(String(40), nullable=True)
    signature: Mapped[str] = mapped_column(String(64), index=True)
    columns: Mapped[list] = mapped_column(JSONB, default=list)
    mapping: Mapped[dict] = mapped_column(JSONB, default=dict)
    options: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Job(Base):
    """Fila de tarefas persistida no PostgreSQL (SELECT … FOR UPDATE SKIP LOCKED)."""

    __tablename__ = "jobs"
    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int | None] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"), nullable=True, index=True)
    type: Mapped[str] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(20), default="queued", index=True)
    # queued | running | done | failed | cancelled
    params: Mapped[dict] = mapped_column(JSONB, default=dict)
    result: Mapped[dict] = mapped_column(JSONB, default=dict)
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    total: Mapped[int] = mapped_column(BigInteger, default=0)
    processed: Mapped[int] = mapped_column(BigInteger, default=0)
    errors_count: Mapped[int] = mapped_column(BigInteger, default=0)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    worker: Mapped[str | None] = mapped_column(String(100), nullable=True)
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Import(Base):
    __tablename__ = "imports"
    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"), index=True)
    file_id: Mapped[int] = mapped_column(ForeignKey("source_files.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20), default="cdr")
    mapping: Mapped[dict] = mapped_column(JSONB, default=dict)
    options: Mapped[dict] = mapped_column(JSONB, default=dict)
    status: Mapped[str] = mapped_column(String(20), default="draft")
    # draft | queued | running | done | failed | cancelled | superseded
    rows_total: Mapped[int] = mapped_column(BigInteger, default=0)
    rows_ok: Mapped[int] = mapped_column(BigInteger, default=0)
    rows_error: Mapped[int] = mapped_column(BigInteger, default=0)
    rows_warning: Mapped[int] = mapped_column(BigInteger, default=0)
    rows_duplicate: Mapped[int] = mapped_column(BigInteger, default=0)
    rows_out_of_scope: Mapped[int] = mapped_column(BigInteger, default=0)
    job_id: Mapped[int | None] = mapped_column(ForeignKey("jobs.id"), nullable=True)
    rules_version: Mapped[str] = mapped_column(String(20))
    summary: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ImportIssue(Base):
    __tablename__ = "import_issues"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    import_id: Mapped[int] = mapped_column(ForeignKey("imports.id", ondelete="CASCADE"), index=True)
    row_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    page: Mapped[int | None] = mapped_column(Integer, nullable=True)
    field: Mapped[str | None] = mapped_column(String(60), nullable=True)
    severity: Mapped[str] = mapped_column(String(10))  # error | warning | info
    code: Mapped[str] = mapped_column(String(60))
    message: Mapped[str] = mapped_column(Text)
    raw: Mapped[dict | None] = mapped_column(JSONB, nullable=True)


class Event(Base):
    """Registro normalizado. Valores originais ficam em `raw` e `*_raw`; nada é inventado."""

    __tablename__ = "events"
    __table_args__ = (
        Index("ix_events_case_ts", "case_id", "ts_utc"),
        Index("ix_events_case_target", "case_id", "target_number", "ts_utc"),
        Index("ix_events_case_other", "case_id", "other_number"),
        Index("ix_events_case_a", "case_id", "a_number"),
        Index("ix_events_case_b", "case_id", "b_number"),
        Index("ix_events_case_cell", "case_id", "cell_key"),
        Index("ix_events_case_type", "case_id", "event_type"),
        Index("ix_events_import", "import_id"),
        Index("ix_events_dedup", "case_id", "dedup_hash"),
    )
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"))
    import_id: Mapped[int] = mapped_column(ForeignKey("imports.id", ondelete="CASCADE"))
    file_id: Mapped[int] = mapped_column(ForeignKey("source_files.id", ondelete="CASCADE"))
    file_sha256: Mapped[str] = mapped_column(String(64))
    row_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    page: Mapped[int | None] = mapped_column(Integer, nullable=True)
    operator: Mapped[str | None] = mapped_column(String(40), nullable=True)
    event_type: Mapped[str] = mapped_column(String(30))
    direction: Mapped[str] = mapped_column(String(10), default="unknown")  # out | in | unknown
    a_number: Mapped[str | None] = mapped_column(String(32), nullable=True)
    b_number: Mapped[str | None] = mapped_column(String(32), nullable=True)
    a_raw: Mapped[str | None] = mapped_column(String(80), nullable=True)
    b_raw: Mapped[str | None] = mapped_column(String(80), nullable=True)
    target_number: Mapped[str | None] = mapped_column(String(32), nullable=True)
    other_number: Mapped[str | None] = mapped_column(String(32), nullable=True)
    ts_original: Mapped[str | None] = mapped_column(String(80), nullable=True)
    ts_utc: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ts_local: Mapped[datetime | None] = mapped_column(DateTime(timezone=False), nullable=True)
    tz_name: Mapped[str | None] = mapped_column(String(60), nullable=True)
    tz_status: Mapped[str] = mapped_column(String(12), default="unknown")  # confirmed | assumed | unknown
    duration_s: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str | None] = mapped_column(String(60), nullable=True)
    tech: Mapped[str | None] = mapped_column(String(10), nullable=True)
    mcc: Mapped[str | None] = mapped_column(String(4), nullable=True)
    mnc: Mapped[str | None] = mapped_column(String(4), nullable=True)
    lac: Mapped[str | None] = mapped_column(String(20), nullable=True)
    tac: Mapped[str | None] = mapped_column(String(20), nullable=True)
    cell_id: Mapped[str | None] = mapped_column(String(30), nullable=True)
    eci: Mapped[str | None] = mapped_column(String(30), nullable=True)
    nci: Mapped[str | None] = mapped_column(String(30), nullable=True)
    cgi: Mapped[str | None] = mapped_column(String(60), nullable=True)
    erb_raw: Mapped[str | None] = mapped_column(String(120), nullable=True)
    cell_key: Mapped[str | None] = mapped_column(String(80), nullable=True)
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lon: Mapped[float | None] = mapped_column(Float, nullable=True)
    azimuth: Mapped[float | None] = mapped_column(Float, nullable=True)
    imei: Mapped[str | None] = mapped_column(String(20), nullable=True)
    imsi: Mapped[str | None] = mapped_column(String(20), nullable=True)
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    bytes_up: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    bytes_down: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    raw: Mapped[dict] = mapped_column(JSONB, default=dict)
    warnings: Mapped[list] = mapped_column(JSONB, default=list)
    confidence: Mapped[float] = mapped_column(Float, default=1.0)
    dedup_hash: Mapped[str] = mapped_column(String(40))
    is_duplicate: Mapped[bool] = mapped_column(Boolean, default=False)
    duplicate_of: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    out_of_scope: Mapped[bool] = mapped_column(Boolean, default=False)
    # Resolução técnica de ERB
    resolved_cell_id: Mapped[int | None] = mapped_column(ForeignKey("erb_cells.id", ondelete="SET NULL"), nullable=True)
    resolution_status: Mapped[str | None] = mapped_column(String(12), nullable=True)
    # exact | probable | ambiguous | none
    resolution_rule: Mapped[str | None] = mapped_column(String(60), nullable=True)
    resolution_version_id: Mapped[int | None] = mapped_column(ForeignKey("erb_registry_versions.id", ondelete="SET NULL"), nullable=True)
    resolution_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    resolution_candidates: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    resolution_manual: Mapped[bool] = mapped_column(Boolean, default=False)
    revision: Mapped[int] = mapped_column(Integer, default=0)


class EventCorrection(Base):
    """Correção manual auditável: o valor anterior é preservado aqui e em `raw`."""

    __tablename__ = "event_corrections"
    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), index=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"))
    field: Mapped[str] = mapped_column(String(40))
    old_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    new_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    reason: Mapped[str] = mapped_column(Text)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    revision: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ErbRegistryVersion(Base):
    __tablename__ = "erb_registry_versions"
    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"), index=True)
    import_id: Mapped[int | None] = mapped_column(ForeignKey("imports.id", ondelete="CASCADE"), nullable=True)
    file_id: Mapped[int | None] = mapped_column(ForeignKey("source_files.id", ondelete="CASCADE"), nullable=True)
    operator: Mapped[str | None] = mapped_column(String(40), nullable=True)
    name: Mapped[str] = mapped_column(String(300))
    reference_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    rows: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ErbCell(Base):
    __tablename__ = "erb_cells"
    __table_args__ = (
        Index("ix_erb_case_key", "case_id", "cell_key"),
        Index("ix_erb_case_ids", "case_id", "mcc", "mnc", "cell_id"),
        Index("ix_erb_case_site", "case_id", "site_code"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"))
    version_id: Mapped[int] = mapped_column(ForeignKey("erb_registry_versions.id", ondelete="CASCADE"), index=True)
    row_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    operator: Mapped[str | None] = mapped_column(String(40), nullable=True)
    tech: Mapped[str | None] = mapped_column(String(10), nullable=True)
    mcc: Mapped[str | None] = mapped_column(String(4), nullable=True)
    mnc: Mapped[str | None] = mapped_column(String(4), nullable=True)
    lac: Mapped[str | None] = mapped_column(String(20), nullable=True)
    tac: Mapped[str | None] = mapped_column(String(20), nullable=True)
    cell_id: Mapped[str | None] = mapped_column(String(30), nullable=True)
    eci: Mapped[str | None] = mapped_column(String(30), nullable=True)
    nci: Mapped[str | None] = mapped_column(String(30), nullable=True)
    cgi: Mapped[str | None] = mapped_column(String(60), nullable=True)
    cell_key: Mapped[str | None] = mapped_column(String(80), nullable=True)
    site_code: Mapped[str | None] = mapped_column(String(80), nullable=True)
    site_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    address: Mapped[str | None] = mapped_column(String(300), nullable=True)
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lon: Mapped[float | None] = mapped_column(Float, nullable=True)
    azimuth: Mapped[float | None] = mapped_column(Float, nullable=True)
    beamwidth: Mapped[float | None] = mapped_column(Float, nullable=True)
    sector: Mapped[str | None] = mapped_column(String(20), nullable=True)
    height_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    validation_status: Mapped[str] = mapped_column(String(20), default="ok")
    validation_notes: Mapped[list] = mapped_column(JSONB, default=list)
    raw: Mapped[dict] = mapped_column(JSONB, default=dict)


class ResolutionRun(Base):
    __tablename__ = "resolution_runs"
    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"), index=True)
    params: Mapped[dict] = mapped_column(JSONB, default=dict)
    result: Mapped[dict] = mapped_column(JSONB, default=dict)
    rules_version: Mapped[str] = mapped_column(String(20))
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SavedQuery(Base):
    __tablename__ = "saved_queries"
    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    name: Mapped[str] = mapped_column(String(200))
    filters: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Annotation(Base):
    __tablename__ = "annotations"
    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"), index=True)
    ts_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    number: Mapped[str | None] = mapped_column(String(32), nullable=True)
    text: Mapped[str] = mapped_column(Text)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AlertRule(Base):
    __tablename__ = "alert_rules"
    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    rule_type: Mapped[str] = mapped_column(String(40))
    params: Mapped[dict] = mapped_column(JSONB, default=dict)
    severity: Mapped[str] = mapped_column(String(10), default="media")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Alert(Base):
    __tablename__ = "alerts"
    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"), index=True)
    rule_id: Mapped[int | None] = mapped_column(ForeignKey("alert_rules.id", ondelete="SET NULL"), nullable=True)
    rule_type: Mapped[str] = mapped_column(String(40))
    title: Mapped[str] = mapped_column(String(300))
    description: Mapped[str] = mapped_column(Text)
    params: Mapped[dict] = mapped_column(JSONB, default=dict)
    support_event_ids: Mapped[list] = mapped_column(JSONB, default=list)
    support_count: Mapped[int] = mapped_column(Integer, default=0)
    severity: Mapped[str] = mapped_column(String(10), default="media")
    review_status: Mapped[str] = mapped_column(String(20), default="pendente")
    analyst_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    rules_version: Mapped[str] = mapped_column(String(20))
    fingerprint: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Report(Base):
    __tablename__ = "reports"
    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"), index=True)
    code: Mapped[str] = mapped_column(String(40), unique=True)
    report_type: Mapped[str] = mapped_column(String(20))  # cdr | erb | links | full
    fmt: Mapped[str] = mapped_column(String(10))  # pdf | xlsx | csv | json | html
    title: Mapped[str] = mapped_column(String(300))
    params: Mapped[dict] = mapped_column(JSONB, default=dict)
    input_files: Mapped[list] = mapped_column(JSONB, default=list)
    storage_key: Mapped[str | None] = mapped_column(String(300), nullable=True)
    sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    app_version: Mapped[str] = mapped_column(String(20))
    rules_version: Mapped[str] = mapped_column(String(20))
    status: Mapped[str] = mapped_column(String(20), default="gerando")
    # gerando | rascunho | em_revisao | aprovado | devolvido | falhou
    job_id: Mapped[int | None] = mapped_column(ForeignKey("jobs.id"), nullable=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ReportReview(Base):
    __tablename__ = "report_reviews"
    id: Mapped[int] = mapped_column(primary_key=True)
    report_id: Mapped[int] = mapped_column(ForeignKey("reports.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    action: Mapped[str] = mapped_column(String(20))  # submetido | aprovado | devolvido | comentario
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AuditLog(Base):
    """Trilha encadeada por hash (cada linha referencia o hash da anterior)."""

    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    user_email: Mapped[str | None] = mapped_column(String(254), nullable=True)
    action: Mapped[str] = mapped_column(String(60), index=True)
    case_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    entity: Mapped[str | None] = mapped_column(String(40), nullable=True)
    entity_id: Mapped[str | None] = mapped_column(String(60), nullable=True)
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    details: Mapped[dict] = mapped_column(JSONB, default=dict)
    prev_hash: Mapped[str] = mapped_column(String(64))
    hash: Mapped[str] = mapped_column(String(64))


class SystemSetting(Base):
    __tablename__ = "system_settings"
    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[dict] = mapped_column(JSONB, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
