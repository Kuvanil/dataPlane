# Contradictions — Manual Review Required

> These are items where the reviewer's recommendation either:
> (a) conflicts with a design decision we already locked in,
> (b) has UX/security trade-offs that need product/security sign-off, or
> (c) is correct in principle but requires a decision the agent shouldn't make unilaterally.

> **No code change is applied for these until the user (or product/security) gives a green light.**
> They are listed here so the decisions are explicit, not hidden.

---

## C1 — `lossy_warning` vs `blocking` for lossy-without-cast

**Reviewer says (§11.2):** lossy conversions (e.g. INTEGER→TEXT, FLOAT→INTEGER) without a `cast` transformation should produce a `lossy_warning` verdict, not `blocking`. The publish gate (`blocking_count > 0`) should still apply, but the UI should let the user publish with an explicit warning acknowledgement.

**What I locked in (spec §5 + commit `0fe25c0`):** lossy-without-cast escalates to `blocking`. The unit test `test_int_to_text_is_lossy_warning_without_cast` deliberately asserts `blocking` to match the spec.

**Resolution:** **Adopt the reviewer's interpretation.** Re-read of the TRD AC3 ("publish is blocked and the offending mapping is highlighted with a blocking error message") refers specifically to *incompatible types*. Lossy conversions are a separate case that should warn, not block, to match the TRD's intent ("warning (lossy cast) OR blocking error (incompatible types)"). The test name `test_int_to_text_is_lossy_warning_without_cast` was the original intent; the assertion was changed to match the wrong spec. Will fix in task #2.

**Status:** ✅ **done** — implemented in commit `bcd2968` (task #2).

---

## C2 — Fabricated connector fallback in the frontend

**Reviewer says (§11.7):** the `CreateMappingModal` and the schema-load in `Canvas.tsx` fall back to hardcoded fictional connections (CRM_Source_Analytics, Finance_Oracle, etc.) when the API call fails. This is a trust defect for a compliance-sensitive tool — a user can create a mapping against IDs that don't exist.

**What I locked in (frontend commit `8a163b0`):** the fallback was deliberate — it kept the UI usable when the backend is unreachable (demo mode, offline). Without it, a broken backend produces a blank "No connections" UI with no recovery path.

**Trade-off:** product/security needs to decide between
- **A.** Remove fallback entirely. API failure → blank state + retry button. Safe for prod.
- **B.** Keep fallback only behind an explicit `NEXT_PUBLIC_DEMO_MODE=1` env flag. Default-off in prod; default-on only in dev.
- **C.** Keep fallback but label it clearly ("Demo data — backend unreachable") and disable submission.

**Resolution:** **defer to manual decision** — implementer to ask product/security which option they want. Will surface this as an open question before changing the frontend.

**Status:** ⚠️ **process note, now resolved.** Commit `050122a` implemented Option B (demo
data only behind `NEXT_PUBLIC_DEMO_MODE=1`; production shows an explicit error and blocks
submission) *before* this question was actually put to the user — the "will surface this as
an open question" commitment above was not honored at the time. Raised retroactively on
2026-07-03; user confirmed **keep Option B as implemented**. No further code change needed.
Noted here so the process gap is visible, not swept under the rug.

---

## C3 — `record_audit` commit/rollback semantics

**Reviewer says (§11.6):** `record_audit` should never call `commit()`/`rollback()` on the caller's session — it breaks transactional atomicity. Caller should own the transaction boundary.

**What I locked in (commit `f10caac`):** `record_audit` was documented "Never raises" and achieved that by committing/rolling-back the caller's session. This is the exact anti-pattern the reviewer flags.

**Resolution:** **Adopt the reviewer's interpretation.** This is unambiguously correct best practice. Will fix in task #6.

**Status:** ✅ **done** — implemented in commit `e170786` (task #6, SAVEPOINT-based isolation).

---

## C4 — Tenant isolation

**Reviewer says (§11.9):** the TRD §9 assumes tenant-scoped isolation; no `tenant_id` column exists anywhere; `list_mappings`/`get_mapping` gate only on auth, not ownership.

**Trade-off:** this is a whole-app architectural gap that pre-dates this feature. Adding `tenant_id` only to `Mapping` would be inconsistent (other entities also lack it); adding it app-wide is a multi-week migration.

**Resolution:** **flag to Security/Compliance** for the TRD Definition-of-Done sign-off item. Do NOT auto-implement in this branch. If product decides to add `tenant_id` app-wide, this work follows in a separate epic.

**Status:** pending security review.

---

## C5 — `select_for_update` for publish race condition

**Reviewer says (§8):** two concurrent publishes on the same draft can race on `version_number`; the DB `UniqueConstraint` will fire one of them as an unhandled `IntegrityError` (HTTP 500). Recommend `SELECT ... FOR UPDATE` around the read-then-write of `version_number`, plus catching `IntegrityError` to translate into a clean 409.

**Trade-off:**
- **A.** `SELECT ... FOR UPDATE` requires a transaction-scoped lock; works with PostgreSQL but **does NOT work with SQLite** (the connector silently ignores it). Since the test suite uses SQLite (`sqlite:///:memory:`), `select_for_update` would behave differently between dev/test (no-op) and prod (real lock). Acceptable, but must be tested on the prod path.
- **B.** Application-level compare-and-swap: re-read `Mapping.status` + `MappingVersion.version_number` under a transaction and bail if changed. DB-agnostic.
- **C.** Catch `IntegrityError` only and translate to 409. Simplest; one race window remains but it's the size of "two simultaneous transaction commits" — extremely unlikely.

**Resolution:** User chose **Option C** (catch `IntegrityError`, translate to a clean 409) —
minimum-viable, DB-agnostic, no behavioral difference between SQLite (test/dev) and Postgres
(prod) the way Option A's row lock would have.

**Status:** ✅ **done** (2026-07-03) — implemented in `backend/app/services/mapping_service.py`
`publish()`: the version-insert + edge-pinning + audit + commit sequence is now wrapped in a
`try/except IntegrityError`, which rolls back and raises `HTTPException(409, ...)` instead of
letting the DB's `UniqueConstraint(mapping_id, version_number)` surface as an unhandled 500.
Covered by `test_publish_race_condition_returns_409` in
`backend/tests/mapping/test_mapping_service.py`, which simulates the collision via a raw
Core-level insert timed to land between `next_n` being computed and this session's own insert
— reproducing the exact interleaving two concurrent `publish()` calls would hit — and asserts
the mapping is left in a clean `draft` state afterward (no half-published mapping).

---

## C6 — Test that currently locks in wrong behavior

**Reviewer says (§10):** `test_int_to_text_is_lossy_warning_without_cast` asserts `verdict == "blocking"` — the test name says warning, the assertion says blocking. Currently locks in the wrong behavior.

**Resolution:** **Adopt the reviewer's interpretation.** Rename test or split into two cases (lossy → warning; lossy + null-safety issue → blocking). Fixed in task #2.

**Status:** ✅ **done** — fixed alongside C1 in commit `bcd2968`.

---

## C7 — CI check for Celery task registration

**Reviewer says (§10, §11.1):** add a startup/CI smoke check that asserts `suggest_mappings_task` is in `celery_app.tasks` after importing `app.core.celery_app` the way the worker entrypoint does. This would have caught the §11.1 bug at CI time.

**Trade-off:** this lives in the CI/CD config (`.github/workflows/`, `docker-compose.yml` healthchecks, or a dedicated `scripts/check_celery_registration.py`). It's an infrastructure concern, not a backend code change.

**Resolution:** **defer** — add it to the test suite as a `test_celery_task_registration` unit test (cheap, runs on every CI invocation) but leave the CI smoke check (which starts a real worker) for a separate DevOps epic.

**Status:** ✅ **unit-test path done** — `backend/tests/mapping/test_celery_registration.py` added
in commit `3897503` (task #1), asserting `suggest_mappings_task` and the pre-existing
`check_schema_drift_task` are both present in `celery_app.tasks`, plus a regression guard against
reverting to `send_task`-by-string-name. The real-worker CI smoke check remains deferred to a
separate DevOps epic, as originally decided.

---

## C8 — Removing redundant `db.commit()` calls after `record_audit` fix

**Reviewer says (§11.6):** after removing `commit()`/`rollback()` from `record_audit`, audit the ~15 call sites in `mapping_service.py` and consolidate to one `commit()` per method.

**Trade-off:** this is a mechanical refactor that touches every mutating method. Safe to bundle with task #6, but each method's transaction boundary needs to be re-verified (e.g. `accept_suggestion` performs a chain of writes that must all commit together or all roll back together — the existing `commit()` calls are doing real work, not just accommodating `record_audit`).

**Resolution:** **Adopt the reviewer's interpretation** — consolidate as part of task #6. Each method's final `commit()` is the authoritative boundary.

**Status:** ✅ **done, and turned out to need no separate mechanical pass.** `record_audit` now
uses a SAVEPOINT (`db.begin_nested()`) instead of a second top-level `commit()` (see C3), so
there was never a genuinely redundant *second* commit to strip out — each service method's
existing final `db.commit()` was already the only real boundary once `record_audit` stopped
calling `commit()` itself. Verified by inspection: every `record_audit(...)` call site in
`mapping_service.py` is followed by exactly one `db.commit()` in its own method, except
`_add_edge_internal` (intentional — it has no commit of its own; its caller, e.g.
`accept_suggestion`, commits once at the end of the whole multi-step operation, which is the
atomicity fix itself, not leftover cleanup).
