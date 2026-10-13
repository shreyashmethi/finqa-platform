"""
FastAPI application factory.

    uvicorn app.main:app --reload            (development)
    uvicorn app.main:app --workers 1         (production: one process owns the run worker pool)

Startup: configure logging -> apply migrations -> start the run manager -> resume unfinished runs.
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.agents.runner import get_run_manager
from app.api import admin, evidence, exceptions, insights, runs, sets
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.db.migrate import upgrade

log = logging.getLogger("finqa")


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings = get_settings()
    configure_logging(settings.log_level, settings.log_json)
    upgrade()
    manager = get_run_manager()
    if settings.resume_on_startup:
        resumed = manager.resume_incomplete()
        if resumed:
            log.info("resumed %d unfinished run(s)", len(resumed))
    yield
    manager.shutdown()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="FinQA Reconciliation API",
        version="0.1.0",
        description="Multi-agent reconciliation of financial figures across company documents.",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception):  # pragma: no cover - safety net
        # Log the details server-side; never leak stack traces to clients.
        log.exception("unhandled error on %s %s", request.method, request.url.path)
        return JSONResponse(status_code=500, content={"detail": "Internal server error"})

    @app.get("/api/health", tags=["admin"])
    def health():
        return {"status": "ok"}

    for router in (sets.router, runs.router, exceptions.router, evidence.router, admin.router, insights.router):
        app.include_router(router, prefix="/api")
    return app


app = create_app()
