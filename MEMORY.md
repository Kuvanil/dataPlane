# MEMORY — Cross-Session Project State

This is a working log for agents (Kimchi and others) that don't retain context between sessions. Read the **Current state** section and the last 3-5 **Log** entries before starting work; append one short entry when you finish a task. This is not a changelog for humans — `git log` is authoritative for that. Keep entries short and factual; prune stale ones instead of letting this file grow unbounded (target: keep it under ~150 lines — archive older log entries into `requirements-specs/**/INDEX.md` progress logs where they already live, don't duplicate).

## Current state (as of 2026-07-06)

- **Stack:** FastAPI + Celery + Postgres backend, Next.js (App Router, React 19) frontend, Docker-first. No migration tool — schema changes apply via `Base.metadata.create_all` on app start (see `SKILLS.md` §2).
- **Core platform capabilities shipped:** Audit Trail, Schema Drift Detection (Celery beat), persistent Query History/Chat Sessions, JWT auth, AI Autopilot backend (7-step agent loop). See `backend/app/models/` and `backend/app/api/routers/` for the concrete surfaces.
- **Schema Mapper TRD gap-closure** (`requirements-specs/mapper_tasks/INDEX.md`): tasks #1 (N:1 mapping UI), #3 (nullability display), #5 (autosave-loss warning), #6 (rename UI) are done. #2 (keyboard a11y for drag-and-drop) and #4 (canvas virtualization) are open — both need a human decision (accessibility audit; virtualization library choice) before auto-implementing. #7 (tenant isolation sign-off) is blocked on product.
- **Pipelines epic** (`requirements-specs/Pipelines_tasks/INDEX.md`): tasks defined (data model, drift validation, execution engine, scheduler, retry handling, run history, UI monitoring, audit/role gating, concurrency, tests, secret vaulting) — check that INDEX.md for current status before assuming any are done.
- **Governance files added 2026-07-06:** root `CLAUDE.md` (entrypoint), `SKILLS.md` (task playbooks), this file. `prompts/*.md` remains the binding coding-standards contract and was intentionally left unmodified in that pass.

## Known constraints / gotchas

- `SECRET_KEY` (JWT) must be overridden via env var in production — code default is dev-only.
- No Alembic-equivalent migrations — destructive schema changes (drop/rename column) need a human sign-off, not an auto-implementation.
- Celery beat requires its own `beat` service entry in `docker-compose.yml` — periodic tasks silently won't fire without it.
- `frontend/src/lib/api.ts` is the single chokepoint for HTTP calls and 401 handling (`setUnauthorizedHandler`) — don't add a parallel fetch or auth-redirect path.

## Log

- 2026-07-06 — Added `CLAUDE.md`, `SKILLS.md`, `MEMORY.md` at repo root to formalize agentic-SDLC practice on top of `prompts/*.md`, and wrote instructions in a compact, section-scoped style for Kimchi's limited context window. `prompts/*.md` left as-is per decision to treat it as already current.
