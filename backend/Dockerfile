# Backend image: FastAPI + LangGraph runtime.
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    FINQA_DATA_DIR=/data

WORKDIR /app

COPY pyproject.toml alembic.ini ./
COPY migrations ./migrations
COPY app ./app
# Postgres extras included so the same image runs on SQLite (default) or Postgres.
RUN pip install --upgrade pip && pip install ".[postgres]"

# Run as an unprivileged user; /data holds the SQLite DB, checkpoints and uploads.
RUN useradd --create-home --uid 10001 finqa && mkdir -p /data && chown finqa /data
USER finqa
VOLUME ["/data"]
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/api/health')"

# One worker process: it owns the background run pool. Scale with more containers + Postgres.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
