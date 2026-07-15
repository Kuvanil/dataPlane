# Task #7 — Docker/env wiring for KSM bootstrap token

**Reference:** TRD §6 NFR Operability, §12 Technical Notes. Depends on #2 (sign-off that KSM is
the chosen backend).

**Goal:** Wire KSM's client configuration into this repo's existing Docker-first, no-hardcoded-
secrets conventions — no new pattern invented, reuse how every other secret in this stack (e.g.
`SECRETS_ENCRYPTION_KEY`, `OLLAMA_*`) is already handled.

## Changes

### `backend/app/core/config.py`

- Add to `Settings`:
  - `SECRET_MANAGER_BACKEND: str = "aes256"` — `"aes256"` | `"keeper"`, flips to `"keeper"` only
    after Task #2's sign-off, default stays the zero-external-infrastructure option until then.
  - `KSM_CONFIG_PATH: str | None = None` — path to the mounted KSM client config file produced by
    the one-time-token bootstrap (`ksm profile init` or equivalent, run once outside the app, per
    Keeper's documented bootstrap flow) — **never** a literal token value in an env var or in code.

### `docker-compose.yml`

- Mount the KSM config file into the `api` and `worker` services (both need to read/rotate
  secrets — `worker` runs pipeline executions that call `retrieve()`) as a read-only bind mount or
  Docker secret, matching how other sensitive local files are handled in this stack.
- Document in a comment (or a short section in `README`/deployment docs, whichever this repo
  already uses for this kind of note) that the KSM config file must be generated via Keeper's
  one-time-token bootstrap process before first run, and must never be committed to the repo —
  add its filename pattern to `.gitignore` if not already covered.

### `.env.example` (if this repo maintains one — check first; if not, document inline in
`docker-compose.yml` comments matching existing convention)

- Add `SECRET_MANAGER_BACKEND=aes256` (commented `# or "keeper" — see requirements-specs-v5/keeperdb_integration_tasks/02`)
  and `KSM_CONFIG_PATH=/run/secrets/ksm_config.json` as documented, non-functional placeholders —
  never a real path with a real token.

## Verify

```bash
docker compose config  # confirm compose file parses and no secret value is inlined
grep -r "KSM_CONFIG_PATH\|SECRET_MANAGER_BACKEND" docker-compose.yml backend/app/core/config.py
```

- Manually confirm no real KSM token or config content is present anywhere in a committed file —
  `git diff` review before commit, same discipline this repo already applies to `SECRET_KEY`/
  `SECRETS_ENCRYPTION_KEY`.

## Risk

- Low — mechanical, follows existing patterns in this repo for every other secret already handled
  this way. The only real risk is a careless commit of an actual bootstrap config/token, mitigated
  by explicit `.gitignore` coverage and pre-commit review.
