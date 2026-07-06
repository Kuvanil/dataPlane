# Task #2 — [!] Secret manager integration for credential vaulting (CONN-T2)

**TRD reference:** FR3, FR6 (credential rotation), Security NFR, §10 risk table (credential leakage).

**Current state:** `backend/app/models/connection.py` stores all connection parameters — including passwords, API keys, and tokens — in plaintext JSON in the `config` column. The `GET /connectors/{id}` response returns the full config dict, including secrets. There is no vault abstraction, no encryption at rest for credentials, and no audit of credential access.

## ⚠️ Decision needed before implementing (2026-07-06)

This task's own Risk section (below) calls it "the most security-sensitive task in the connectors
scope," and the TRD lists a dedicated stakeholder ("Security — Credential handling sign-off",
§3) plus a DoD checklist item ("Security sign-off on credential handling", §12). Every sibling
epic in this codebase gates its own highest-risk, hardest-to-reverse decision behind an explicit
`[!]` blocked task requiring human sign-off before implementation — `mapper_tasks/07`
(tenant isolation), `schema_intel_tasks/08` (PII data-safety) and `09` (tenant isolation),
`Pipelines_tasks/03` (execution engine semantics) and `11` (secret vaulting sign-off, which
explicitly deferred this exact decision to "whoever owns Connectors' credential storage" — i.e.
this task). This task should not be the one place in the repo that skips that gate.

**The specific decision needed from you (repo owner / Security stakeholder):** is the
"Implementation #1 (default): AES-256-GCM envelope encryption, key in an env var, ciphertext in a
new DB table" approach below acceptable as the interim credential-storage mechanism, or does your
compliance posture require an external vault (HashiCorp Vault, AWS Secrets Manager, etc.) from day
one with no interim self-hosted-encryption stopgap? This is genuinely hard to reverse once
connections exist and pipelines depend on them — migrating live credentials from one storage
scheme to another later is exactly the kind of "irreversible action" this repo's other sign-off
gates exist to catch before, not after, implementation.

Until this is confirmed, treat this task as blocked. The abstraction layer design (the
`SecretManager` interface below) is safe to build and review regardless of which implementation
is chosen — only the "Implementation #1" section is gated.

## Scope

Replace plaintext credential storage with a vault-backed secret manager. This is the highest-priority security task in the TRD.

### Secret manager abstraction — `backend/app/services/secret_manager.py` (new)

A pluggable interface with two implementations:

**Interface (`SecretManager`):**
- `store(connection_id: int, secrets: dict) -> str` — stores secret values and returns a `secrets_ref` string (e.g. `"vault://connections/{id}/creds"` or `"enc://aes256/{key_id}"`).
- `retrieve(secrets_ref: str) -> dict` — retrieves secret values by ref. Only called server-side; never exposed to the client.
- `rotate(secrets_ref: str, new_secrets: dict) -> str` — updates secrets, may return a new ref.
- `delete(secrets_ref: str)` — removes secrets from the vault when the connection is deleted.

**Implementation #1 (default): AES-256-GCM envelope encryption**
- A `SECRETS_ENCRYPTION_KEY` environment variable (base64-encoded 32-byte key) is loaded at startup.
- Each secret set is encrypted with a random nonce and stored as a base64 ciphertext in a new `connection_secrets` table (separate from the `config` JSON for defense-in-depth — even a SQL injection that dumps `connections` won't reveal secrets).
- The `secrets_ref` column in `DBConnection` stores the row ID of the `connection_secrets` table.
- This requires zero external infrastructure (no Vault, no KMS, no cloud dependency) while providing real encryption-at-rest.

**Implementation #2 (future): External vault (HashiCorp Vault, AWS Secrets Manager, etc.)**
- Not built in this task. The abstraction layer ensures future swap-in doesn't require changing connector code.

### New model — `backend/app/models/connection_secret.py`

```python
class ConnectionSecret(Base):
    __tablename__ = "connection_secrets"

    id = Column(Integer, primary_key=True)
    connection_id = Column(Integer, ForeignKey("connections.id"), nullable=False, unique=True)
    ciphertext = Column(Text, nullable=False)  # base64-encoded AES-256-GCM ciphertext
    key_id = Column(String, nullable=False)    # allows key rotation: which encryption key was used
    created_at = Column(DateTime, default=datetime.utcnow)
    rotated_at = Column(DateTime, nullable=True)
```

### Service changes — `backend/app/services/connection_service.py`

- `create_connection()` — extract known secret fields from `config` (e.g. `password`, `api_key`, `token`, `secret_key`) before storing the rest in `config`. Call `secret_manager.store()` to encrypt and store the extracted secrets. Set `secrets_ref` on the model.
- `get_connection()` — assemble response from `config` + metadata. **Never include secrets.** Return a `sanitized_config` dict that has secret-field keys replaced with `{"redacted": true}`.
- `update_connection()` — same extraction + re-encryption for non-secret fields; delegate credential rotation to Task #8's `rotate_credentials()`.
- `delete_connection()` — call `secret_manager.delete()` on soft-delete.

### Known secret fields per connector type

| Type | Secret fields |
|------|---------------|
| `postgres` | `password` |
| `mysql` | `password` |
| `oracle` | `password` |
| `sqlite` | None (file-path only, no credentials) |
| `jdbc` | `password`, `connection_properties` (may contain secrets) |

Hard-code this mapping in the service. Extension for new connector types is a dict update.

### Router changes — `backend/app/api/routers/connectors.py`

- `GET /connectors/{id}` — return sanitized config (no secret values).
- `POST /connectors/` — ensure request validation strips no-op: if secrets are sent (current behavior), the service layer handles extraction; if secrets are omitted, the endpoint works (for connectors like SQLite that have no secrets).
- All existing routes continue to work unchanged in terms of HTTP interface.

### Known secret fields list endpoint

Add `GET /connectors/types/{type}/secret-fields` that returns the list of field names considered secret for a given connector type. This allows the frontend to render password fields with type="password" and never send them to the client on GET.

## Dependencies

- Task #1 (model upgrade: `secrets_ref` column).
- Task #3 (connector types metadata: secret-fields mapping should live alongside the types catalog).

## Edge cases

- **Encryption key rotation:** The `key_id` column on `ConnectionSecret` allows tracking which key was used. When the `SECRETS_ENCRYPTION_KEY` env var changes, existing secrets become undecryptable. The rotate flow (Task #8) decrypts with the old key and re-encrypts with the new one. During the transition period, the secret manager should try all known keys.
- **Empty secrets (SQLite):** `sqlite` connectors have no secrets. The service should not create a `ConnectionSecret` row for them. `secrets_ref` stays null.
- **Backfill existing connections:** Existing rows have secrets in `config`. **Corrected 2026-07-06:** an earlier draft triggered this migration implicitly on the first `GET /connectors/{id}` — that mutates state (writes a new `ConnectionSecret` row, clears `config`) as a side effect of an HTTP `GET`, which should be idempotent and side-effect-free; it also duplicated Task #8's rotate-time backfill ("the same backfill logic described in Task #2"), giving two independent places that could race each other. Do the backfill exactly once, explicitly: either a startup migration step (iterate all connections with `secrets_ref is None` and migrate them before the app starts serving traffic) or a dedicated admin-triggered endpoint (`POST /connectors/{id}/migrate-secrets`). Task #8's rotate flow can then simply call the same migration function directly instead of re-describing the logic.
- **Race on backfill:** If the backfill is a startup step, no request-time race exists at all — the app doesn't serve traffic until it completes. If a dedicated endpoint is preferred instead, use `INSERT ... ON CONFLICT` (upsert) or a unique constraint on `connection_id` to deduplicate concurrent calls.
- **Audit requirement:** `retrieve()` should log access (which actor, which connection, timestamp). Since `retrieve` is called server-side during pipeline execution, be careful not to spam logs — batch at info-level, not per-column-access.
- **Client response must never show secrets:** Even transiently (e.g., 422 validation response echoing back the request body). FastAPI's default 422 often echoes the received payload. The router must strip secret fields from error responses.

## Verify

```bash
cd backend && .venv/bin/pytest tests/connectors/ -v
```

- Test that `POST /connectors/` with password stores ciphertext, not plaintext.
- Test that `GET /connectors/{id}` returns `{"password": {"redacted": true}}` not the actual password.
- Test that the backfill migration on unmigrated rows works (existing row with secrets in config → `secrets_ref` populated, config cleared of secrets).
- Test that SQLite connections (no secrets) work without a `ConnectionSecret` row.
- Test that encryption key rotation doesn't break reads for existing secrets.
- Test that `DELETE /connectors/{id}` (hard delete) removes the `ConnectionSecret` row.
- Test that soft-deleted connections retain their secrets ref (so re-activation works) — only hard delete removes secrets.

## Risk

**High** — this is the most security-sensitive task in the connectors scope. Mistakes (e.g., logging a password, returning a ciphertext as raw bytes, failing to strip a secret from a 422 response) are production incidents. Key mitigations:

1. The abstraction layer keeps vault logic isolated — the connector drivers themselves never touch encryption code.
2. The AES-256-GCM implementation uses the `cryptography` library (already available via the existing Python ecosystem) — not a hand-rolled cipher.
3. Every `store`/`retrieve` path must be covered by a test that explicitly asserts no plaintext secret appears in logs, responses, or stdout.
4. Add a security note in the service docstring: "If you are debugging and need to inspect a stored secret, NEVER log it. Use `****` placeholders."