# Task #1 — `SecretManager` abstract interface

**Reference:** TRD §5 FR1, §12 Technical Notes. Transcribes the design in
`requirements-specs/connector_tasks/02_secret_manager_integration.md` §"Secret manager
abstraction" into actual code — that design was reviewed at the time but never implemented.
Depends on nothing; unblocked.

**Goal:** A single, backend-agnostic interface every connector code path calls through, so the
eventual choice of backend (Task #2) is a pure swap-in.

## Changes

### 1. New: `backend/app/services/secret_manager.py`

```python
class SecretManager(ABC):
    @abstractmethod
    def store(self, connection_id: int, secrets: dict) -> str:
        """Encrypt/store secret values, return a secrets_ref string."""

    @abstractmethod
    def retrieve(self, secrets_ref: str) -> dict:
        """Retrieve secret values by ref. Server-side only — never exposed to the client."""

    @abstractmethod
    def rotate(self, secrets_ref: str, new_secrets: dict) -> str:
        """Update secrets, may return a new ref."""

    @abstractmethod
    def delete(self, secrets_ref: str) -> None:
        """Remove secrets from the vault (called on hard delete)."""
```

- Ref format is backend-defined but must be a string that round-trips through `secrets_ref`
  (existing nullable `String` column on `DBConnection`, `connector_tasks#1`) — e.g.
  `"enc://aes256/{key_id}/{row_id}"` for the self-hosted backend, `"keeper://{record_uid}"` for
  KSM.
- A module-level `get_secret_manager() -> SecretManager` factory reads `Settings.SECRET_MANAGER_BACKEND`
  and returns the configured implementation. This is the only place that branches on backend
  choice — `ConnectionService` (Task #4) never imports a concrete backend class directly.
- No concrete implementation lives in this file — that's Task #3 (KSM) or a self-hosted
  AES-256-GCM implementation, chosen per Task #2.

### 2. Tests

- `backend/tests/secrets/test_secret_manager_interface.py` — a fake in-memory implementation of
  `SecretManager` used to verify `ConnectionService` (once wired in Task #4) only calls the
  abstract methods, never anything backend-specific.

## Verify

```bash
cd backend && pytest tests/secrets/test_secret_manager_interface.py -v
```

## Risk

- Low — pure interface definition, no runtime behavior yet. The risk is entirely in getting the
  method signatures right so Tasks #3/#4 don't need to change them later; they're taken verbatim
  from `connector_tasks#2`'s already-reviewed design, not invented fresh here.
