# Task #1 — Self-host decision + ACI service wiring into docker-compose

**Status: `[?]` open — needs explicit product/infra sign-off before building.** Reference: TRD §10
Assumptions, §12 Technical Notes.

## The decision this task can't make unilaterally

ACI.dev offers both a hosted/cloud API and a self-hostable backend+portal (Apache 2.0). This repo
is Docker-first and self-hosted end to end (Postgres, Redis/broker, worker, beat, api, frontend all
run as local `docker-compose` services per `prompts/11-docker-first.md`) — self-hosting ACI too is
the consistent default, but it means running and maintaining another service (its own Postgres/
storage needs, its own upgrade cadence) versus taking a dependency on an external hosted API with
none of that operational cost but a live third-party dependency and recurring cost. **Recommend
self-hosting** for consistency with this repo's existing posture, but this is a real decision, not
a default to silently assume — get sign-off before building the rest of this task.

## Changes (once self-hosting is confirmed)

### 1. `docker-compose.yml`
- Add an `aci` service (ACI's backend API) following the exact conventions every other service in
  this file already uses: named volume for any persistent state, health check, restart policy,
  non-root, service-name networking (not `localhost`) — per `prompts/11-docker-first.md`, the
  binding contract for this task.
- Confirm from ACI's own deployment docs whether the dev portal is required for this epic's scope
  (Task #8 deep-links to it for OAuth-connect UX) or whether the backend API alone suffices for
  v1 — add `aci-portal` only if actually needed, not speculatively.
- ACI's own dependencies (likely its own Postgres/Redis, per its self-hosting docs — confirm exact
  requirements before assuming it can share this stack's existing `postgres`/`broker` services or
  needs its own).

### 2. `backend/app/core/config.py`
- Add `ACI_BASE_URL: str` and `ACI_API_KEY: str` to `Settings`, matching the existing `OLLAMA_*`
  fields' shape (env-var sourced, sane local-dev default for the URL, no default for the API key —
  a secret must not have a checked-in fallback).

### 3. `.env.example`
- Document the new required variables, consistent with how other services' config is documented
  there already.

## Verify

```bash
docker compose up -d aci  # or whatever the final service name is
docker compose ps  # confirm healthy
```
Manually: confirm the `api` service can reach the `aci` service by its compose service name (not
`localhost`) once Task #2's client service exists to actually exercise this.

## Risk

- If self-hosting ACI's full stack (backend + portal + its own dependencies) turns out to be
  heavier than this repo's existing footprint comfortably absorbs, that's a legitimate reason to
  reconsider the hosted-API alternative — raise it explicitly rather than forcing self-hosting to
  fit.
