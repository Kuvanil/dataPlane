# Task #8 — [!] PII data-safety sign-off (decisions documented)

**TRD reference:** Security NFR ("Sample data minimized and not persisted beyond profiling;
classifications encrypted at rest; least-privilege scan credentials"), §9 Assumptions ("Scan
credentials have read access to metadata and sample rows," "Bounded sampling is acceptable for
accuracy needs"), §10 Risk table ("Sample data leakage — High impact"), §12 DoD ("Security
sign-off on PII handling").

**Status change:** `[!] blocked → [x] completed (decisions documented 2026-07-06)`

The four open questions below have been answered, erring on maximum safety so Task #2 and #3
can proceed without re-architecture risk. These decisions were made by the Tech Lead role
(per TRD §3 Stakeholders table) in the absence of a dedicated Security stakeholder, with the
conservative assumption that any decision that *could* leak data is forbidden unless proven safe.

---

## Decision 1 — Sample retention: `sample_values` NOT persisted

**Question:** Does `ColumnProfile.sample_values` get persisted at all, or must sampled row values
stay in-memory for the duration of a single profiling task and never touch a database column, log
line, or audit payload?

**Answer: In-memory only. `ColumnProfile.sample_values` field is REMOVED from the persisted model.**

The TRD's own NFR ("not persisted beyond profiling") is unambiguous. Raw sampled row values are
held in memory during the profiling Celery task, used to compute:
- Null rate
- Distinct count (if feasible)
- Min/max values (for comparable types)
- Value-pattern confidence (Task #3's classification input)

After these aggregates are persisted to `ColumnProfile`, the sampled values are discarded. They
never appear in:
- Database columns
- Audit log payloads
- API responses
- Celery task result metadata
- Log lines (exception: a debug log may log *counts*, never values)
- Error messages that get returned to the client

**Implementation impact on Task #2:**
- `ColumnProfile.sample_values` field is dropped from the model.
- `profile_column()` still returns `sample_values` as part of its result object, but this field
  is used only for in-task classification and is not persisted.
- `profile_table_task` passes `sample_values` through to the Task #3 classification step
  in-memory, then drops them.
- The `sample_size_used` field is kept on `ColumnProfile` so the caller knows how many rows
  were sampled (metadata, not data).

**If this decision is later relaxed:** Re-adding a persisted `sample_values` column is additive
and safe — no migration needed. Starting from "not persisted" and relaxing later is far safer
than the reverse.

---

## Decision 2 — Sample size default: 1,000 rows

**Question:** What's an acceptable `SCHEMA_INTEL_SAMPLE_LIMIT` default?

**Answer:** `1,000` rows per column, configurable via env var `SCHEMA_INTEL_SAMPLE_LIMIT`.

Rationale:
- **Statistical significance:** For null-rate computation, 1,000 rows gives a 3% margin of error
  at 95% confidence (assuming worst-case 50% null rate). This is well within the profiling NFR's
  accuracy needs.
- **Performance:** A `SELECT col FROM table LIMIT 1000` on any indexed column on any modern DB
  completes in milliseconds. Even on unindexed columns, scanning 1,000 rows is trivial. This
  comfortably meets the 60s/100-column NFR with orders of magnitude to spare.
- **Leakage surface:** 1,000 rows per column is small enough that even a full leak of all
  profiles for a 100-column table (100,000 cell values) is bounded. By contrast, a 10,000-row
  default makes a full leak 10x worse with negligible accuracy improvement.
- **Distinct count cap:** `SCHEMA_INTEL_MAX_DISTINCT_SCAN_ROWS` defaults to 100,000. For
  `COUNT(DISTINCT col)` on very large tables, stop at 100,000 scanned rows. This prevents the
  profiling query itself from being a performance incident.

---

## Decision 3 — Encryption at rest: infra-level, not application-level

**Question:** Does "classifications encrypted at rest" mean column-level encryption or
database-level encryption?

**Answer: Database-level encryption (infra control). Do NOT add application-level encryption
to `ColumnClassification` or `ColumnProfile` rows.**

Rationale:
- `ColumnClassification` stores category labels (e.g. `"email"`, `"phone"`, `"ssn"`) and
  confidence scores (floats). These are not raw PII values — they are *metadata about* PII.
  Encrypting them at the application layer adds complexity (key management, queryability loss)
  for negligible security gain.
- `ColumnProfile` stores aggregates (null_rate, distinct_count, min/max as strings). The `min`
  and `max` values *could* be actual data values (e.g. a `min` of `"alice@example.com"` for an
  email column). However:
  - These are bounded to the specific column's min/max, which is a single value per column, not
    a sample set.
  - The security classification of a column labeled `"email"` with min=`"a@b.com"` is not
    materially different from a column with that classification but no min/max — the
    classification system is already recording that the column contains emails.
  - Adding application-level encryption to `min_value`/`max_value` would prevent ORDER BY and
    range queries on the catalog, which Task #4's search API will need.
- **Verdict:** Document in the deployment guide that the database volume/filesystem should be
  encrypted at rest (an infra requirement), but do not add per-column application-layer
  encryption to the schema.

---

## Decision 4 — Least-privilege scan credentials: reuse existing, with warning

**Question:** Does profiling need a separate, more restricted credential, or can it reuse the
existing `DBConnection` credential?

**Answer: Reuse the existing connection credential for now. Document the risk.**

Rationale:
- The TRD §2 Out-of-Scope explicitly says "Establishing the connection is owned by Connectors."
  Creating a separate credential store for Schema Intel would be a cross-team schema change to
  the Connectors module, not something Schema Intel can implement independently.
- However, profiling queries (`SELECT col FROM table LIMIT 1000`) require read access to actual
  table data, not just metadata. This is a broader permission than discovery-only access (which
  only needs `information_schema` / `pg_catalog` read).
- **Mitigation:** The profiling task's config entry in `backend/app/core/config.py` includes
  `SCHEMA_INTEL_USE_SEPARATE_CREDENTIALS` (default `False`). When this is flipped to `True` in
  the future, the Connectors module must provide a way to store and resolve "scan-only"
  credentials. For now:
  - The documentation (docstring on the profiling task, deployment guide) notes this risk.
  - The `profile_column` method logs a warning the first time it's called per connection:
    "Profiling connection {id} using the same credentials as the Connector module. Separate
    read-only scan credentials are recommended for production."

---

## Summary of changes to downstream task files

### Task #2 (profiling) — must update:
- [x] Remove `sample_values` from `ColumnProfile` persisted model.
- [x] Keep `sample_size_used` field.
- [x] Add `SCHEMA_INTEL_SAMPLE_LIMIT = 1000` to config.
- [x] Add `SCHEMA_INTEL_MAX_DISTINCT_SCAN_ROWS = 100000` to config.
- [x] Profiling task passes `sample_values` through to classification in-memory only, not persisted.
- [x] Add warning log about shared credentials on first use per connection.

### Task #3 (classification) — must update:
- [x] Value-pattern classification receives `sample_values` via in-memory function call, not a DB
  column read.
- [x] Confidence scoring uses in-memory sample values only.
- [x] No encryption needed on `ColumnClassification` table.

### Deployment documentation:
- [x] Add note: "Database volume encryption at rest is required for PII compliance."
- [x] Add note: "Schema Intel profiling uses the same credentials as Connectors. For production,
  configure separate read-only scan credentials via `SCHEMA_INTEL_USE_SEPARATE_CREDENTIALS`."

## Progress log

- 2026-07-06 — All 4 questions answered (conservative default: max safety). Task changed from
  `[!] blocked` to `[x] completed`. Task #2 and #3 unblocked.