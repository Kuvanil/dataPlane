# Task #5 — Retry + failure handling (PIPE-T5)

**TRD reference:** FR7, AC4 ("Retry on transient failure"), Usability NFR ("actionable error
messages").

**Status change:** `[ ] → [x] completed`

**Current state:** No retry logic exists anywhere in the backend. `grep -rniE
"autoretry_for|retry_backoff"` and `grep -rn "RetryPolicy"` across `backend/app` return nothing —
confirmed during the TRD-vs-code audit. Existing Celery tasks (`app/tasks/ai_tasks.py`) don't use
`autoretry_for` either, so there's no in-repo precedent to follow; this will be the first retry
implementation in the codebase.

**Precondition:** Task #3 (async Celery execution path) and Task #4 (scheduler) exist.

## Scope

### Retry classification

Classify failures as retryable vs. terminal. The `run_pipeline_task` catches exceptions and
determines retry eligibility:

```python
RETRYABLE_ERROR_SUBSTRINGS = [
    "timeout",
    "connection refused",
    "connection reset",
    "deadlock",
    "too many connections",
    "rate limit",
    "temporary failure",
    "could not connect",
    "lock wait timeout",
    "transaction rollback",
]

TERMINAL_ERROR_SUBSTRINGS = [
    "drift",            # Task #2 drift check failure
    "authentication failed",
    "access denied",
    "permission denied",
    "syntax error",
    "does not exist",
    "not found",
    "malformed",
    "constraint failed",
    "unique constraint",
]


def classify_error(error_message: str) -> str:
    """Classify an error as 'retryable', 'terminal', or 'unknown'.

    'unknown' is treated as retryable (conservative — retry rather than
    silently fail a run that might recover).
    """
    error_lower = error_message.lower()

    for pattern in TERMINAL_ERROR_SUBSTRINGS:
        if pattern in error_lower:
            return "terminal"

    for pattern in RETRYABLE_ERROR_SUBSTRINGS:
        if pattern in error_lower:
            return "retryable"

    return "retryable"  # Conservative default
```

### Retry logic in `run_pipeline_task`

Update `run_pipeline_task` to use Celery's `autoretry_for` with per-pipeline policy:

```python
from app.core.celery_app import celery_app
from app.core.database import SessionLocal
from app.models.pipeline import RetryPolicy
from app.services.pipeline_executor import PipelineExecutor


@celery_app.task(
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=600,     # Max 10 minutes between retries
    retry_jitter=True,         # Add jitter to avoid thundering herd
    max_retries=None,          # Per-pipeline max_attempts overrides this
    default_retry_delay=60,    # 60s base backoff
)
def run_pipeline_task(self, pipeline_id: int, run_id: int, trigger: str = "manual"):
    """Execute a pipeline asynchronously with configurable retry."""
    # Load retry policy
    db = SessionLocal()
    try:
        retry_policy = db.query(RetryPolicy).filter(
            RetryPolicy.pipeline_id == pipeline_id
        ).first()

        if retry_policy:
            # Override Celery's retry settings from the policy
            self.max_retries = retry_policy.max_attempts - 1  # Celery is 0-based
            if retry_policy.backoff_seconds:
                self.retry_backoff = retry_policy.backoff_seconds
    finally:
        db.close()

    # Execute
    try:
        return PipelineExecutor.execute(pipeline_id, run_id, trigger)
    except Exception as exc:
        error_msg = str(exc)
        classification = classify_error(error_msg)

        if classification == "terminal":
            # Don't retry — fail immediately
            _update_run_status_db(pipeline_id, run_id, "failed", error=error_msg)
            return {"status": "failed", "error": error_msg, "retries_exhausted": True}

        # Retryable — let Celery handle the retry
        # Update run status to 'retrying' so the UI shows progress
        _update_run_status_db(pipeline_id, run_id, "retrying",
                              error=f"Attempt {self.request.retries + 1}: {error_msg}")
        raise self.retry(exc=exc)


def _update_run_status_db(pipeline_id: int, run_id: int, status: str, error: str = None):
    """Update PipelineRun status directly (called from within a Celery task
    so needs its own DB session)."""
    db = SessionLocal()
    try:
        from app.models.pipeline import PipelineRun
        from sqlalchemy import func
        run = db.query(PipelineRun).filter(PipelineRun.id == run_id).first()
        if run:
            run.status = status
            if status == "retrying":
                run.retry_count = (run.retry_count or 0) + 1
            if status == "failed":
                run.finished_at = func.now()
            if error:
                run.error_message = error
            db.commit()
    finally:
        db.close()
```

### Router endpoint — `PUT /pipelines/{id}/retry-policy`

Add to `backend/app/api/routers/pipelines.py`:

```python
@router.put("/{pipeline_id}/retry-policy", response_model=RetryPolicyRead)
def upsert_retry_policy(
    pipeline_id: int,
    req: RetryPolicyUpsert,
    db: Session = Depends(get_db),
    user: User = Depends(require_role("admin", "analyst")),
):
    """Create or update a pipeline's retry policy."""
    p = PipelineCRUD.get_pipeline(db, pipeline_id)

    policy = db.query(RetryPolicy).filter(RetryPolicy.pipeline_id == pipeline_id).first()
    if policy:
        policy.max_attempts = req.max_attempts
        policy.backoff_seconds = req.backoff_seconds
        policy.retryable_error_patterns = req.retryable_error_patterns
    else:
        policy = RetryPolicy(
            pipeline_id=pipeline_id,
            max_attempts=req.max_attempts,
            backoff_seconds=req.backoff_seconds,
            retryable_error_patterns=req.retryable_error_patterns,
        )
        db.add(policy)

    record_audit(db, "pipeline_retry_policy_updated", actor=user.email,
                 payload={"pipeline_id": pipeline_id, "max_attempts": req.max_attempts})
    db.commit()
    db.refresh(policy)
    return policy
```

### Default retry policy on pipeline create

When a pipeline is created without an explicit retry policy, create a default one:

```python
# In PipelineCRUD.create_pipeline, after pipeline creation:
default_policy = RetryPolicy(pipeline_id=pipeline.id, max_attempts=3, backoff_seconds=60)
db.add(default_policy)
```

## Dependencies

- Task #1 (`RetryPolicy` model, `PipelineRun.retry_count` — already built).
- Task #3/#4 (retry wraps `run_pipeline_task` — execution path exists).

## Verify

- Mock a transient failure (e.g. connection timeout) → confirm retries up to `max_attempts`, then
  final failure.
- Mock a terminal failure (e.g. drift block) → confirm no retry, immediate failure.
- Confirm `PipelineRun.retry_count` increments correctly.
- Confirm `status='retrying'` between attempts (visible to the UI monitor).

## Risk

Low-medium. Main risk is misclassifying an error as retryable when it's actually deterministic
(e.g. a malformed transformation will fail identically on every retry, wasting time and masking
the real error under retry noise) — the `TERMINAL_ERROR_SUBSTRINGS` list is kept explicit and
conservative. Unknown errors default to retryable (better to retry a non-retryable error than to
fail a recoverable one).