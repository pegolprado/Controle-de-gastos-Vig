from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from .config import APP_VERSION, settings
from .jobs import start_embedded_worker, stop_embedded_worker
from .routers import admin, analysis, auth, cases, files, outputs
from .security import CSRF_COOKIE, CSRF_HEADER, csrf_matches

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s: %(message)s")

CSRF_EXEMPT = {"/api/health"}


@asynccontextmanager
async def lifespan(app: FastAPI):
    start_embedded_worker()
    yield
    stop_embedded_worker()


app = FastAPI(
    title="MARX Intelligence Pro",
    version=APP_VERSION,
    lifespan=lifespan,
    docs_url="/api/docs" if settings.env != "production" else None,
    redoc_url=None,
    openapi_url="/api/openapi.json" if settings.env != "production" else None,
)


class SecurityMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if request.method not in ("GET", "HEAD", "OPTIONS") and path.startswith("/api/") and path not in CSRF_EXEMPT:
            if not csrf_matches(request.cookies.get(CSRF_COOKIE), request.headers.get(CSRF_HEADER)):
                return JSONResponse({"detail": "Token CSRF ausente ou inválido. Recarregue a página."}, status_code=403)
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        response.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        if path.startswith("/api/"):
            response.headers.setdefault("Cache-Control", "no-store")
        return response


app.add_middleware(SecurityMiddleware)

for r in (auth.router, admin.router, cases.router, files.router, analysis.router, outputs.router):
    app.include_router(r, prefix="/api")


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    logging.getLogger("atlas").exception("erro não tratado em %s", request.url.path)
    return JSONResponse({"detail": "Erro interno. O incidente foi registrado."}, status_code=500)


# Serve o front-end compilado quando STATIC_DIR está definido (implantação em contêiner único).
STATIC_DIR = os.getenv("STATIC_DIR")
if STATIC_DIR and Path(STATIC_DIR).is_dir():
    static_root = Path(STATIC_DIR).resolve()

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa(full_path: str):
        if full_path.startswith("api/"):
            return JSONResponse({"detail": "Não encontrado"}, status_code=404)
        candidate = (static_root / full_path).resolve()
        if full_path and static_root in candidate.parents and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(static_root / "index.html")
