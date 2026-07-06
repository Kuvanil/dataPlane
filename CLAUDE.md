# dataPlane — Agent Entrypoint

Agentic DBA platform. FastAPI + Celery + Postgres backend, Next.js frontend, Docker-first.
Read this file first, every session. Load the other files below **only when the task needs them** — don't preload everything.

| File | Load when |
|---|---|
| `prompts/*.md` | The binding coding-standards contract. Numbered 01→14; load only the file matching your task (e.g. touching Docker → `11-docker-first.md`). |
| `SKILLS.md` | Starting a task that matches a known playbook (API change, migration, frontend feature, Celery task, infra, security-sensitive change). |
| `MEMORY.md` | Start of every session (read) and end of every session (append). Cross-session project state — decisions, gotchas, in-flight work. |
| `requirements-specs/**/INDEX.md` | Working a spec-driven epic (see "Spec-driven work" below). |

## Non-negotiables (condensed from `prompts/`, so you don't have to load all 12 files up front)

- No hardcoded config/secrets — env vars via `Settings` (`backend/app/core/config.py`) / `NEXT_PUBLIC_*` (frontend `src/lib/api.ts`).
- No bare `except: pass` — log via `logging.getLogger(__name__)`, never swallow silently.
- External calls (Ollama, DB, HTTP) get retries with exponential backoff.
- Every pipeline/Celery stage logs `logger.info("[pipeline] stage=...")` on entry.
- No placeholder/mock UI or TODO stubs — wire buttons to real endpoints or don't ship them.
- Docker: multi-stage builds, non-root, no dev tools in the final image, service names not `localhost`.
- Validate inputs at the boundary (routers/API), trust internal calls.

## Repo map

- `backend/app/api/routers/` — one router per domain (`connectors`, `mapper`, `mappings`, `pipelines`, `query`, `schema`, `audit`, `auth`, `autopilot`, `askdata`, `agent`, `tasks`).
- `backend/app/services/` — business logic, one file per domain concern.
- `backend/app/models/` — SQLAlchemy models.
- `backend/app/tasks/` — Celery tasks.
- `backend/tests/` — pytest, run with `pytest` from `backend/` (pythonpath=. is set).
- `frontend/src/app/dashboard/<feature>/` — one directory per dashboard feature; `frontend/src/lib/api.ts` is the only place that should call `fetch`.

## Agentic working loop (every task, regardless of size)

1. **Understand** — read the relevant router/service/component and its existing tests before writing anything.
2. **Plan** — for anything touching more than one file, write the plan down (a spec file under `requirements-specs/` for multi-step work, or just state it for a one-off fix). Don't skip straight to code on non-trivial changes.
3. **Implement** — smallest diff that satisfies the requirement. No drive-by refactors.
4. **Verify** — run the relevant test suite (`pytest` in `backend/`, `npm run lint && npm run build` in `frontend/`) and, for anything with a UI or runtime surface, actually exercise it. Don't claim done on type-check alone.
5. **Record** — append what changed and why to `MEMORY.md` (short — see that file's format) and update the relevant `INDEX.md` progress log if this was spec-driven work.

If you're blocked on a product decision (ambiguous requirement, missing design sign-off, security/tenant-isolation question) — **stop and flag it**, marked `[?]` or `[!]` per the status legend in `requirements-specs/mapper_tasks/INDEX.md`. Don't guess on security- or compliance-sensitive gaps.

## Spec-driven work

For multi-step features, this repo uses per-epic `INDEX.md` files (see `requirements-specs/mapper_tasks/INDEX.md` and `requirements-specs/Pipelines_tasks/INDEX.md` as the reference pattern): a status legend (`[ ]`/`[~]`/`[x]`/`[!]`/`[?]`), a priority-ordered table, a confidence note per task, an execution order, and a dated progress log with one entry per completed task describing exactly what changed and any honest caveats. Follow this pattern for any new multi-task epic instead of inventing a new format.

## For Kimchi (small-context coding agent)

Kimchi's context budget is tight — don't hand it this whole tree at once.
- Point Kimchi at **one** `SKILLS.md` playbook plus the **one** relevant `prompts/NN-*.md` file for the task at hand, not the full set.
- Give Kimchi exact file paths (from the repo map above) instead of asking it to explore.
- Keep task instructions to a single concrete diff. Split multi-file epics into one `INDEX.md` line item per Kimchi invocation.
- Have Kimchi read the last 3–5 entries of `MEMORY.md`, not the whole file, unless doing a fresh session review.
