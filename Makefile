# Common tasks. CORPUS points at the synthetic test corpus (finqa-testdata).
CORPUS ?= ../finqa-testdata

.PHONY: install dev-backend dev-frontend test lint seed eval-dev eval-test eval-stress up

install:            ## install backend (editable, with dev tools) and frontend dependencies
	cd backend && pip install -e ".[dev]"
	cd frontend && npm install

dev-backend:        ## API on :8000 with auto-reload
	cd backend && uvicorn app.main:app --reload --port 8000

dev-frontend:       ## React dev server on :5173 (proxies /api to :8000)
	cd frontend && npm run dev

test:               ## backend tests + frontend typecheck
	cd backend && python -m pytest
	cd frontend && npm run typecheck

lint:
	cd backend && ruff check app tests && ruff format --check app tests

seed:               ## load the corpus (companies, baselines, document sets; never ground truth)
	cd backend && python -m app.cli seed --corpus $(abspath $(CORPUS))

eval-dev:           ## run the agents over FY2023 sets and score against ground truth
	cd backend && python -m app.cli eval --corpus $(abspath $(CORPUS)) --split dev --out runs/dev

eval-test:          ## held-out FY2024 + FY2025 sets
	cd backend && python -m app.cli eval --corpus $(abspath $(CORPUS)) --split test --out runs/test

eval-stress:        ## ten 286-page sets: accuracy + latency vs the 10-minute target
	cd backend && python -m app.cli eval --corpus $(abspath $(CORPUS)) --split stress --out runs/stress

up:                 ## full stack in Docker on http://localhost:8080
	CORPUS_DIR=$(abspath $(CORPUS)) docker compose up --build
