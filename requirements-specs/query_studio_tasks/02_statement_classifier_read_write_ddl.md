# Task #2 — Statement classifier (read/write/DDL) (QS-T2)

**TRD reference:** FR4, Security NFR (§4–5).

**Current state:** No statement classifier exists. The AskData Bot project has a similar task (ADB-T2) — the Query Studio classifier should be shared or consistent with that implementation.

## Scope

Build a SQL statement classifier that determines whether input SQL is read-only (SELECT), write (INSERT, UPDATE, DELETE), or DDL (CREATE, ALTER, DROP, TRUNCATE). Also extract metadata (tables referenced, columns, schema) for use by autocomplete and audit.

### Classifier — `backend/app/services/statement_classifier.py` (new, shared)

```python
class StatementType(enum.Enum):
    SELECT = "select"
    INSERT = "insert"
    UPDATE = "update"
    DELETE = "delete"
    DDL = "ddl"       # CREATE, ALTER, DROP, TRUNCATE
    UNKNOWN = "unknown"

@dataclass
class ClassifiedStatement:
    type: StatementType
    raw_sql: str
    tables_referenced: list[str]
    columns_referenced: list[str]
    is_multi_statement: bool
    warnings: list[str]

def classify(sql: str) -> ClassifiedStatement:
    """Classify a SQL statement and extract metadata."""
```

- Use `sqlparse` for robust parsing.
- Handle: single statement, multi-statement (semicolon-separated), CTEs, subqueries.
- Extract table names from FROM/JOIN clauses.
- Used by both Query Studio (QS-T1 execution) and AskData Bot (ADB-T2 guardrails).

### Dependencies

- `sqlparse` library (add to requirements.txt if not present).

## Edge cases

- **Multi-statement input** — Classify as the most restrictive type (e.g., if any statement is write, classify as write).
- **Comments** — Strip SQL comments before classification.
- **CTE with write CTE** — The final statement determines classification, but warn if any CTE is write.
- **Unknown statements** — Classify as UNKNOWN, treat as most restrictive (block execution pending review).

## Verify

- Test classification for each statement type.
- Test multi-statement detection.
- Test table/column extraction.
- Test CTEs, subqueries, comments.

## Risk

Low. Well-understood problem with established libraries.