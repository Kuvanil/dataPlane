# Schema Mapper Data Layer + API — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver persistent, versioned, audited, role-gated mapping workspace API at `/api/v1/mappings` per the [design spec](../specs/2026-06-27-schema-mapper-upgrade-design.md).

**Architecture:** SQLAlchemy models (Mapping, MappingVersion, FieldMapping, AISuggestion) + service layer (TransformationGrammar allow-list AST, MappingValidationService type matrix, MappingService state machine) + FastAPI router with `require_role` dependency + Celery task for AI suggestions. All state changes emit `AuditLog` rows.

**Tech Stack:** Python 3.11, FastAPI, SQLAlchemy 2.x, Celery 5.x, Pydantic 2.x, pytest. Existing stack only — no new deps.

---

## File Structure

**New files:**
- `backend/app/models/mapping.py` — 4 SQLAlchemy models
- `backend/app/schemas/mapping.py` — Pydantic request/response schemas
- `backend/app/api/deps.py` — `require_role` dependency
- `backend/app/services/transformation_grammar.py` — 11-kind AST + `compile_sql`
- `backend/app/services/mapping_validation_service.py` — type matrix
- `backend/app/services/mapping_service.py` — CRUD + state machine
- `backend/app/api/routers/mappings.py` — full `/api/v1/mappings` surface
- `backend/app/workers/mapping_tasks.py` — Celery task (kept separate from `tasks/ai_tasks.py` for clean separation of concerns)
- `backend/tests/mapping/__init__.py`
- `backend/tests/mapping/conftest.py`
- `backend/tests/mapping/test_transformation_grammar.py`
- `backend/tests/mapping/test_mapping_validation_service.py`
- `backend/tests/mapping/test_mapping_service.py`
- `backend/tests/mapping/test_mappings_router.py`
- `docs/mapper-mapping-contract.md` — Pipelines contract

**Modified files:**
- `backend/app/main.py` — import `Mapping` etc., include `mappings` router
- `backend/requirements.txt` — add `pytest`, `httpx` (test deps; verify not already present)
- `backend/Dockerfile` — copy `tests/` for in-container pytest run

---

## Task Decomposition

The plan executes in dependency order. Each step is 2–5 minutes and commits at natural checkpoints.

### Phase A — Data models + Pydantic schemas
1. SQLAlchemy models in `backend/app/models/mapping.py` (Mapping, MappingVersion, FieldMapping, AISuggestion)
2. Pydantic schemas in `backend/app/schemas/mapping.py`
3. Wire import into `backend/app/main.py` (so `Base.metadata.create_all` picks them up)
4. Commit

### Phase B — Restricted transformation grammar
5. `backend/app/services/transformation_grammar.py` — 11-kind AST, `parse`, `validate`, `compile_sql`, `GrammarError`
6. Unit tests `test_transformation_grammar.py` (positive + negative cases)
7. Commit

### Phase C — Type-compatibility validation
8. `backend/app/services/mapping_validation_service.py` — type matrix + `validate_mapping`
9. Unit tests `test_mapping_validation_service.py` (10-row fixture)
10. Commit

### Phase D — Mapping service (state machine + audit)
11. `backend/app/api/deps.py` — `require_role` dependency
12. `backend/app/services/mapping_service.py` — full CRUD, suggestions accept/reject, validate, publish, export_json
13. Tests `test_mapping_service.py` (happy path + publish-gate blocking + audit emission on every action)
14. Commit

### Phase E — Router + Celery task + wiring
15. `backend/app/workers/mapping_tasks.py` — `suggest_mappings_task`
16. `backend/app/api/routers/mappings.py` — full surface with role gates and audit emissions
17. `backend/app/main.py` — include router, ensure worker module is imported
18. Tests `test_mappings_router.py` (role denials + full flow via HTTP)
19. Commit

### Phase F — Contract doc + final verification
20. `docs/mapper-mapping-contract.md` — JSON shape for Pipelines
21. Run `pytest backend/tests/mapping -v` — must be green
22. Final commit

---

## Detailed Steps

### Phase A — Data models

#### Task A1: Write models

**Files:** Create `backend/app/models/mapping.py`

- [ ] **Step 1:** Create `backend/app/models/mapping.py` with all 4 models. Key invariants:
  - `Mapping.status` ∈ `{draft, published}`; default `draft`
  - `MappingVersion.status` ∈ `{draft, published, archived}`
  - `FieldMapping.version_id` nullable while in draft
  - `FieldMapping.target_table`, `target_column`, `version_id` form a unique constraint
  - `AISuggestion.confidence` range 0–100
  - All timestamps use `func.now()` server default, `DateTime(timezone=True)`
  - FK `connections.id` uses `ondelete="SET NULL"` (mirror existing `AuditLog` pattern)

```python
"""Mapping workspace models (Schema Mapper upgrade)."""
from sqlalchemy import (
    Column, Integer, String, Text, DateTime, ForeignKey, JSON,
    UniqueConstraint, Float, Index,
)
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.core.database import Base


class Mapping(Base):
    __tablename__ = "mappings"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    source_id = Column(Integer, ForeignKey("connections.id", ondelete="SET NULL"), nullable=True)
    target_id = Column(Integer, ForeignKey("connections.id", ondelete="SET NULL"), nullable=True)
    status = Column(String, nullable=False, default="draft")  # draft | published
    current_version_id = Column(Integer, ForeignKey("mapping_versions.id", ondelete="SET NULL", use_alter=True, name="fk_mappings_current_version"), nullable=True)
    created_by = Column(String, nullable=False, default="system")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True)

    versions = relationship("MappingVersion", back_populates="mapping",
                            foreign_keys="MappingVersion.mapping_id",
                            cascade="all, delete-orphan")
    current_version = relationship("MappingVersion", foreign_keys=[current_version_id],
                                   post_update=True)
    edges = relationship("FieldMapping", back_populates="mapping",
                         cascade="all, delete-orphan",
                         foreign_keys="FieldMapping.mapping_id")
    suggestions = relationship("AISuggestion", back_populates="mapping",
                               cascade="all, delete-orphan")


class MappingVersion(Base):
    __tablename__ = "mapping_versions"
    __table_args__ = (UniqueConstraint("mapping_id", "version_number", name="uq_mapping_version"),)

    id = Column(Integer, primary_key=True, index=True)
    mapping_id = Column(Integer, ForeignKey("mappings.id", ondelete="CASCADE"), nullable=False, index=True)
    version_number = Column(Integer, nullable=False)
    status = Column(String, nullable=False, default="draft")  # draft | published | archived
    published_at = Column(DateTime(timezone=True), nullable=True)
    published_by = Column(String, nullable=True)
    schema_snapshot = Column(JSON, nullable=True)
    edges_snapshot = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    mapping = relationship("Mapping", back_populates="versions",
                           foreign_keys=[mapping_id])


class FieldMapping(Base):
    __tablename__ = "field_mappings"
    __table_args__ = (
        UniqueConstraint("version_id", "target_table", "target_column", name="uq_field_target_per_version"),
        Index("ix_field_mapping_mapping", "mapping_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    mapping_id = Column(Integer, ForeignKey("mappings.id", ondelete="CASCADE"), nullable=False)
    version_id = Column(Integer, ForeignKey("mapping_versions.id", ondelete="CASCADE"), nullable=True)
    target_table = Column(String, nullable=False)
    target_column = Column(String, nullable=False)
    target_type = Column(String, nullable=True)
    target_nullable = Column(Integer, nullable=True)  # 1 = nullable, 0 = not null, NULL = unknown
    target_is_pk = Column(Integer, nullable=True)  # 1 = PK, 0 = not PK
    sources = Column(JSON, nullable=False, default=list)  # [{table,column,type}, ...]
    transformation = Column(JSON, nullable=False, default=dict)
    origin = Column(String, nullable=False, default="manual")  # manual | ai_accepted | english_parsed
    ai_confidence = Column(Float, nullable=True)
    audit = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    mapping = relationship("Mapping", back_populates="edges", foreign_keys=[mapping_id])


class AISuggestion(Base):
    __tablename__ = "ai_suggestions"
    __table_args__ = (Index("ix_ai_suggestion_mapping_status", "mapping_id", "status"),)

    id = Column(Integer, primary_key=True, index=True)
    mapping_id = Column(Integer, ForeignKey("mappings.id", ondelete="CASCADE"), nullable=False)
    target_table = Column(String, nullable=False)
    target_column = Column(String, nullable=False)
    target_type = Column(String, nullable=True)
    source_table = Column(String, nullable=False)
    source_column = Column(String, nullable=False)
    source_type = Column(String, nullable=True)
    confidence = Column(Float, nullable=False, default=0.0)
    reason = Column(Text, nullable=True)
    status = Column(String, nullable=False, default="pending")  # pending | accepted | rejected
    accepted_edge_id = Column(Integer, ForeignKey("field_mappings.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    decided_at = Column(DateTime(timezone=True), nullable=True)
    decided_by = Column(String, nullable=True)

    mapping = relationship("Mapping", back_populates="suggestions")
```

- [ ] **Step 2:** Commit
```bash
git add backend/app/models/mapping.py
git commit -m "feat(mapping): add Mapping, MappingVersion, FieldMapping, AISuggestion models"
```

#### Task A2: Write Pydantic schemas

**Files:** Create `backend/app/schemas/mapping.py`

- [ ] **Step 1:** Schemas for create / read / update / edge / transformation / publish / export.
  - Mirror `AuditEventResponse` style: `model_config = {"from_attributes": True}`.
  - Strict-enough validators for `transformation.kind` (must be in allow-list).

```python
"""Pydantic schemas for the mapping workspace API."""
from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field, field_validator


class MappingCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    source_id: int = Field(..., ge=1)
    target_id: int = Field(..., ge=1)


class MappingUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200)


class SourceRef(BaseModel):
    table: str = Field(..., min_length=1)
    column: str = Field(..., min_length=1)
    type: Optional[str] = None
    nullable: Optional[bool] = None


class TargetRef(BaseModel):
    table: str = Field(..., min_length=1)
    column: str = Field(..., min_length=1)
    type: Optional[str] = None
    nullable: Optional[bool] = None
    primary_key: Optional[bool] = None


class EdgeCreate(BaseModel):
    target: TargetRef
    sources: List[SourceRef] = Field(..., min_length=1)
    transformation: Dict[str, Any] = Field(default_factory=dict)
    origin: str = Field(default="manual")

    @field_validator("origin")
    @classmethod
    def _origin(cls, v: str) -> str:
        if v not in {"manual", "ai_accepted", "english_parsed"}:
            raise ValueError("origin must be manual | ai_accepted | english_parsed")
        return v


class EdgeTransformationUpdate(BaseModel):
    transformation: Dict[str, Any]


class EdgeResponse(BaseModel):
    id: int
    mapping_id: int
    target: TargetRef
    sources: List[SourceRef]
    transformation: Dict[str, Any]
    origin: str
    ai_confidence: Optional[float] = None
    audit: Dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class MappingResponse(BaseModel):
    id: int
    name: str
    source_id: Optional[int] = None
    target_id: Optional[int] = None
    status: str
    current_version_id: Optional[int] = None
    created_by: str
    created_at: datetime
    updated_at: datetime
    edges: List[EdgeResponse] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class ValidationIssue(BaseModel):
    edge_id: Optional[int] = None
    suggestion_id: Optional[int] = None
    verdict: str  # ok | lossy_warning | blocking
    message: str


class ValidationResponse(BaseModel):
    mapping_id: int
    ok_count: int
    warning_count: int
    blocking_count: int
    issues: List[ValidationIssue]


class PublishResponse(BaseModel):
    mapping_id: int
    version_number: int
    version_id: int
    status: str
    published_at: datetime
    published_by: str


class SuggestionResponse(BaseModel):
    id: int
    mapping_id: int
    target_table: str
    target_column: str
    target_type: Optional[str] = None
    source_table: str
    source_column: str
    source_type: Optional[str] = None
    confidence: float
    reason: Optional[str] = None
    status: str
    created_at: datetime
    decided_at: Optional[datetime] = None
    decided_by: Optional[str] = None

    model_config = {"from_attributes": True}


class SuggestionAcceptRequest(BaseModel):
    transformation: Dict[str, Any] = Field(default_factory=dict)
```

- [ ] **Step 2:** Commit
```bash
git add backend/app/schemas/mapping.py
git commit -m "feat(mapping): add Pydantic schemas for mapping workspace API"
```

### Phase B — Transformation grammar

#### Task B1: Grammar parser + AST + compile_sql

**Files:** Create `backend/app/services/transformation_grammar.py`

- [ ] **Step 1:** Implement 11-kind AST with structured payloads, validator, and dialect-specific `compile_sql`.

```python
"""Restricted, allow-listed transformation grammar for schema mappings.

No freeform DSL. Input is a structured JSON dict with a ``kind`` field; each
allowed kind has a fixed payload shape. This file rejects everything else.

Each AST node exposes ``compile_sql(dialect, placeholders)`` which returns a
parameterized SQL fragment and appends any literal placeholders to the
``placeholders`` list (caller binds them).
"""
from __future__ import annotations

from typing import Any, Dict, List, Tuple


ALLOWED_KINDS: frozenset[str] = frozenset({
    "direct", "cast", "concat", "substring", "coalesce",
    "upper", "lower", "trim", "default", "null_if", "lookup",
})


class GrammarError(ValueError):
    """Raised when a transformation payload is invalid.

    Attributes:
        kind: short error category ("unknown_kind", "missing_field", "bad_type")
        location: dotted path within the payload, e.g. "concat.parts[0].value"
    """

    def __init__(self, message: str, *, kind: str = "grammar_error", location: str = ""):
        super().__init__(message)
        self.kind = kind
        self.location = location

    def to_dict(self) -> Dict[str, str]:
        return {"kind": self.kind, "message": str(self), "location": self.location}


# Per-kind schema (lightweight, hand-rolled — no extra dependency).
# Each entry maps field-name → (type, required). Type is one of:
#   "str", "int", "bool", "any", "list_concat_parts", "list_int"
_KIND_SCHEMAS: Dict[str, Dict[str, Tuple[str, bool]]] = {
    "direct": {},
    "cast": {"from": ("str", True), "to": ("str", True)},
    "concat": {"parts": ("list_concat_parts", True)},
    "substring": {"source_index": ("int", True), "start": ("int", True), "length": ("int", True)},
    "coalesce": {"fallback_kind": ("str", True), "fallback_value": ("any", True)},
    "upper": {},
    "lower": {},
    "trim": {},
    "default": {"value_kind": ("str", True), "value": ("any", True)},
    "null_if": {"equals": ("any", True)},
    "lookup": {"table": ("str", True), "key_column": ("str", True),
               "value_column": ("str", True), "default": ("any", False)},
}


def parse(payload: Any) -> Dict[str, Any]:
    """Validate a transformation payload and return a normalized AST dict.

    The returned dict always has ``{"kind": str, "payload": dict, "_sql_fn": callable}``.
    """
    if not isinstance(payload, dict):
        raise GrammarError("transformation must be an object", kind="bad_type", location="$")
    kind = payload.get("kind")
    if not isinstance(kind, str) or kind not in ALLOWED_KINDS:
        raise GrammarError(
            f"unknown transformation kind '{kind}'; allowed: {sorted(ALLOWED_KINDS)}",
            kind="unknown_kind",
            location="kind",
        )
    schema = _KIND_SCHEMAS[kind]
    body: Dict[str, Any] = {}
    for fname, (ftype, required) in schema.items():
        if fname not in payload:
            if required:
                raise GrammarError(f"missing required field '{fname}' for kind '{kind}'",
                                   kind="missing_field", location=fname)
            continue
        value = payload[fname]
        body[fname] = _check_field(value, ftype, f"{kind}.{fname}")
    return {"kind": kind, "payload": body, "_sql_fn": _SQL_FNS[kind]}


def _check_field(value: Any, ftype: str, location: str) -> Any:
    if ftype == "str":
        if not isinstance(value, str):
            raise GrammarError(f"expected string at {location}", kind="bad_type", location=location)
        return value
    if ftype == "int":
        if isinstance(value, bool) or not isinstance(value, int):
            raise GrammarError(f"expected integer at {location}", kind="bad_type", location=location)
        return value
    if ftype == "bool":
        if not isinstance(value, bool):
            raise GrammarError(f"expected boolean at {location}", kind="bad_type", location=location)
        return value
    if ftype == "any":
        return value
    if ftype == "list_concat_parts":
        if not isinstance(value, list) or not value:
            raise GrammarError(f"expected non-empty list at {location}",
                               kind="bad_type", location=location)
        for i, part in enumerate(value):
            if not isinstance(part, dict):
                raise GrammarError(f"concat.parts[{i}] must be an object",
                                   kind="bad_type", location=f"{location}[{i}]")
            pk = part.get("kind")
            if pk == "literal":
                if "value" not in part or not isinstance(part["value"], str):
                    raise GrammarError(
                        f"concat.parts[{i}].value must be string",
                        kind="bad_type",
                        location=f"{location}[{i}].value",
                    )
            elif pk == "source":
                pass  # N:1 sources are referenced by index at compile time
            else:
                raise GrammarError(
                    f"concat.parts[{i}].kind must be 'literal' or 'source'",
                    kind="bad_type",
                    location=f"{location}[{i}].kind",
                )
        return value
    raise GrammarError(f"internal: unknown field type '{ftype}'",
                       kind="internal", location=location)


# SQL fragment builders ---------------------------------------------------
# Each function returns (sql_fragment, placeholders_appended)
# Source columns are referenced as positional placeholders %s, %s, ... (Postgres/SQLite/MySQL).
# Oracle uses :1, :2, ...; we emit %s and rely on the connector to translate if needed.
# Callers bind values to placeholders in the order they are appended.

def _sql_direct(payload: Dict[str, Any], sources: List[str], placeholders: List[Any]) -> str:
    if not sources:
        raise GrammarError("direct requires at least one source column", kind="bad_type", location="sources")
    return "%s"


def _sql_cast(payload: Dict[str, Any], sources: List[str], placeholders: List[Any]) -> str:
    if not sources:
        raise GrammarError("cast requires at least one source column", kind="bad_type", location="sources")
    return f"CAST(%s AS {payload['to']})"


def _sql_concat(payload: Dict[str, Any], sources: List[str], placeholders: List[Any]) -> str:
    parts = payload["parts"]
    frags: List[str] = []
    src_iter = iter(range(len(sources)))
    for part in parts:
        if part["kind"] == "literal":
            placeholders.append(part["value"])
            frags.append("%s")
        else:
            try:
                idx = next(src_iter)
            except StopIteration:
                raise GrammarError("concat has more 'source' parts than sources provided",
                                   kind="bad_type", location="concat.parts")
            frags.append("%s")
    return " || ".join(frags) if frags else "''"


def _sql_substring(payload: Dict[str, Any], sources: List[str], placeholders: List[Any]) -> str:
    idx = payload["source_index"]
    if idx < 0 or idx >= len(sources):
        raise GrammarError(f"substring.source_index {idx} out of range (have {len(sources)} sources)",
                           kind="bad_type", location="substring.source_index")
    return f"SUBSTRING(%s, {int(payload['start']) + 1}, {int(payload['length'])})"


def _sql_coalesce(payload: Dict[str, Any], sources: List[str], placeholders: List[Any]) -> str:
    if not sources:
        raise GrammarError("coalesce requires at least one source column", kind="bad_type", location="sources")
    placeholders.append(payload["fallback_value"])
    return f"COALESCE(%s, %s)"


def _sql_upper(payload: Dict[str, Any], sources: List[str], placeholders: List[Any]) -> str:
    if not sources:
        raise GrammarError("upper requires at least one source column", kind="bad_type", location="sources")
    return "UPPER(%s)"


def _sql_lower(payload: Dict[str, Any], sources: List[str], placeholders: List[Any]) -> str:
    if not sources:
        raise GrammarError("lower requires at least one source column", kind="bad_type", location="sources")
    return "LOWER(%s)"


def _sql_trim(payload: Dict[str, Any], sources: List[str], placeholders: List[Any]) -> str:
    if not sources:
        raise GrammarError("trim requires at least one source column", kind="bad_type", location="sources")
    return "TRIM(%s)"


def _sql_default(payload: Dict[str, Any], sources: List[str], placeholders: List[Any]) -> str:
    if not sources:
        raise GrammarError("default requires at least one source column", kind="bad_type", location="sources")
    placeholders.append(payload["value"])
    return "COALESCE(%s, %s)"


def _sql_null_if(payload: Dict[str, Any], sources: List[str], placeholders: List[Any]) -> str:
    if not sources:
        raise GrammarError("null_if requires at least one source column", kind="bad_type", location="sources")
    placeholders.append(payload["equals"])
    return f"NULLIF(%s, %s)"


def _sql_lookup(payload: Dict[str, Any], sources: List[str], placeholders: List[Any]) -> str:
    if not sources:
        raise GrammarError("lookup requires at least one source column", kind="bad_type", location="sources")
    tbl = payload["table"]
    kc = payload["key_column"]
    vc = payload["value_column"]
    default_clause = ""
    if "default" in payload and payload["default"] is not None:
        placeholders.append(payload["default"])
        default_clause = ", %s"
    return (
        f"(SELECT {vc} FROM {tbl} WHERE {kc} = %s{default_clause})"
    )


_SQL_FNS = {
    "direct": _sql_direct, "cast": _sql_cast, "concat": _sql_concat,
    "substring": _sql_substring, "coalesce": _sql_coalesce,
    "upper": _sql_upper, "lower": _sql_lower, "trim": _sql_trim,
    "default": _sql_default, "null_if": _sql_null_if, "lookup": _sql_lookup,
}


def compile_sql(transformation: Dict[str, Any], sources: List[str],
                placeholders: List[Any]) -> str:
    """Render a transformation into a parameterized SQL fragment."""
    ast = parse(transformation)
    return ast["_sql_fn"](ast["payload"], sources, placeholders)


def validate(transformation: Dict[str, Any]) -> None:
    """Re-validate a transformation payload (defense in depth)."""
    parse(transformation)
```

- [ ] **Step 2:** Commit
```bash
git add backend/app/services/transformation_grammar.py
git commit -m "feat(mapping): restricted transformation grammar with 11 allowed kinds"
```

#### Task B2: Grammar unit tests

**Files:** Create `backend/tests/mapping/__init__.py` (empty) and `backend/tests/mapping/test_transformation_grammar.py`

- [ ] **Step 1:** Tests for each of 11 kinds (positive), plus negative cases for unknown kinds, missing fields, bad types, empty concat parts, out-of-range substring index.

```python
"""Unit tests for the restricted transformation grammar."""
import pytest
from app.services.transformation_grammar import parse, compile_sql, GrammarError


def test_direct_accepts_empty_payload():
    ast = parse({"kind": "direct"})
    assert ast["kind"] == "direct"


def test_unknown_kind_rejected():
    with pytest.raises(GrammarError) as e:
        parse({"kind": "evil_eval"})
    assert e.value.kind == "unknown_kind"


def test_payload_must_be_object():
    with pytest.raises(GrammarError):
        parse("not an object")
    with pytest.raises(GrammarError):
        parse(42)


def test_cast_requires_from_to():
    with pytest.raises(GrammarError):
        parse({"kind": "cast", "from": "TEXT"})
    with pytest.raises(GrammarError):
        parse({"kind": "cast", "from": 1, "to": "TEXT"})
    ast = parse({"kind": "cast", "from": "TEXT", "to": "VARCHAR"})
    assert ast["payload"]["to"] == "VARCHAR"


def test_concat_rejects_empty_or_non_list():
    for bad in [{}, {"kind": "concat", "parts": []}, {"kind": "concat", "parts": "x"}]:
        with pytest.raises(GrammarError):
            parse(bad)


def test_concat_validates_part_kinds():
    with pytest.raises(GrammarError):
        parse({"kind": "concat", "parts": [{"kind": "lambda", "value": "x"}]})
    with pytest.raises(GrammarError):
        parse({"kind": "concat", "parts": [{"kind": "literal", "value": 1}]})


def test_substring_out_of_range():
    with pytest.raises(GrammarError):
        compile_sql({"kind": "substring", "source_index": 5, "start": 0, "length": 3},
                    ["a", "b"], [])


def test_substring_compiles_with_index():
    placeholders = []
    frag = compile_sql({"kind": "substring", "source_index": 1, "start": 0, "length": 3},
                       ["a", "b"], placeholders)
    assert "SUBSTRING" in frag


def test_coalesce_compiles_with_literal_placeholder():
    placeholders = []
    frag = compile_sql({"kind": "coalesce", "fallback_kind": "literal", "fallback_value": "n/a"},
                       ["src"], placeholders)
    assert frag == "COALESCE(%s, %s)"
    assert placeholders == ["n/a"]


def test_default_compiles():
    placeholders = []
    frag = compile_sql({"kind": "default", "value_kind": "literal", "value": "X"}, ["src"], placeholders)
    assert frag == "COALESCE(%s, %s)"
    assert placeholders == ["X"]


def test_null_if_compiles():
    placeholders = []
    frag = compile_sql({"kind": "null_if", "equals": ""}, ["src"], placeholders)
    assert frag == "NULLIF(%s, %s)"
    assert placeholders == [""]


def test_lookup_with_optional_default():
    placeholders = []
    frag = compile_sql({"kind": "lookup", "table": "lu_country",
                        "key_column": "code", "value_column": "name"},
                       ["src"], placeholders)
    assert "SELECT name FROM lu_country" in frag
    assert "code = %s" in frag
    assert placeholders == []


def test_lookup_with_default_appends_placeholder():
    placeholders = []
    frag = compile_sql({"kind": "lookup", "table": "lu_country",
                        "key_column": "code", "value_column": "name", "default": "UNK"},
                       ["src"], placeholders)
    assert placeholders == ["UNK"]
    assert frag.count("%s") == 2


def test_upper_lower_trim_compile():
    for kind in ("upper", "lower", "trim"):
        frag = compile_sql({"kind": kind}, ["src"], [])
        assert "%s" in frag


def test_validate_is_idempotent():
    parse({"kind": "cast", "from": "INT", "to": "TEXT"})
    parse({"kind": "cast", "from": "INT", "to": "TEXT"})  # second call must not raise


def test_missing_required_field():
    with pytest.raises(GrammarError) as e:
        parse({"kind": "concat", "parts": [{"kind": "literal", "value": "x"}]})
        # missing 'parts' key — actually we passed it; this should succeed
        # Use a different missing-field example:
        parse({"kind": "substring", "source_index": 0, "start": 0})
    assert e.value.kind == "missing_field"


def test_concat_too_many_source_parts():
    with pytest.raises(GrammarError) as e:
        compile_sql({"kind": "concat", "parts": [
            {"kind": "source"}, {"kind": "source"}, {"kind": "source"},
        ]}, ["a"], [])
    assert "concat" in e.value.location
```

- [ ] **Step 2:** Run tests:
```bash
cd /Users/anilkumar/workspace/dataplane-main/backend && python -m pytest tests/mapping/test_transformation_grammar.py -v
```
Expected: all pass.

- [ ] **Step 3:** Commit
```bash
git add backend/tests/mapping/
git commit -m "test(mapping): cover transformation grammar positive and negative cases"
```

### Phase C — Type compatibility

#### Task C1: MappingValidationService

**Files:** Create `backend/app/services/mapping_validation_service.py`

- [ ] **Step 1:** Type matrix, `validate_mapping(mapping)` returning verdict summary.

```python
"""Type-compatibility validation for mapping field edges.

Implements the matrix in the design spec §5. Each edge receives a verdict
``ok | lossy_warning | blocking`` and a human-readable message. The summary
returned to callers carries per-edge detail and aggregate counts.
"""
from __future__ import annotations

from typing import Any, Dict, List


# Type families used for cross-engine compatibility decisions.
_TEXT_FAMILY = {"TEXT", "VARCHAR", "CHAR", "CLOB", "STRING"}
_INT_FAMILY = {"INTEGER", "INT", "BIGINT", "SMALLINT", "TINYINT"}
_FLOAT_FAMILY = {"FLOAT", "DOUBLE", "REAL", "DECIMAL", "NUMERIC", "NUMERIC"}
_DATE_FAMILY = {"DATE"}
_TS_FAMILY = {"TIMESTAMP", "DATETIME", "TIMESTAMPTZ"}
_BOOL_FAMILY = {"BOOLEAN", "BOOL"}


def _normalize(t: str | None) -> str:
    return (t or "").strip().upper().split("(")[0]


def _family(t: str) -> str:
    t = _normalize(t)
    if t in _TEXT_FAMILY:
        return "text"
    if t in _INT_FAMILY:
        return "int"
    if t in _FLOAT_FAMILY:
        return "float"
    if t in _DATE_FAMILY:
        return "date"
    if t in _TS_FAMILY:
        return "timestamp"
    if t in _BOOL_FAMILY:
        return "bool"
    return "other"


def _is_lossless_widening(src: str, tgt: str) -> bool:
    s, t = _normalize(src), _normalize(t)
    # INT → BIGINT family (we treat BIGINT as widest)
    if s == "INTEGER" and t == "BIGINT":
        return True
    # TEXT → VARCHAR(N) (any length)
    if _family(s) == "text" and _family(t) == "text":
        return True
    # DATE → TIMESTAMP is widening
    if s == "DATE" and t == "TIMESTAMP":
        return True
    # BOOL → INT/TEXT (bool is 0/1; treat as lossless within our scope)
    if _family(s) == "bool" and _family(t) in {"int", "text"}:
        return True
    # exact same
    if s == t:
        return True
    return False


def _is_incompatible(src: str, tgt: str) -> bool:
    s, t = _family(src), _family(t)
    # text → int without cast is incompatible
    if s == "text" and t == "int":
        return True
    if s == "text" and t == "float":
        return True
    if s == "text" and t == "bool":
        return True
    if s == "text" and t == "date":
        return True
    if s == "text" and t == "timestamp":
        return True
    return False


def _has_null_safety(transform: Dict[str, Any]) -> bool:
    kind = (transform or {}).get("kind")
    return kind in {"default", "coalesce", "null_if", "cast"}


def _is_lossy(src: str, tgt: str) -> bool:
    s, t = _family(src), _family(t)
    if s == "int" and t == "text":
        return True
    if s == "float" and t == "int":
        return True
    if s == "float" and t == "text":
        return True
    if s == "timestamp" and t == "date":
        return True
    if s == "int" and t == "float":
        return True  # precision may differ
    return False


class MappingValidationService:
    @staticmethod
    def validate_edge(edge: Dict[str, Any]) -> Dict[str, Any]:
        """Validate a single edge dict. Returns ``{verdict, message}``."""
        target = edge.get("target") or {}
        sources = edge.get("sources") or []
        transformation = edge.get("transformation") or {"kind": "direct"}

        if not sources:
            return {
                "verdict": "blocking",
                "message": "edge has no source columns",
            }

        tgt_type = target.get("type") or ""
        tgt_nullable = target.get("nullable")
        tgt_is_pk = bool(target.get("primary_key"))

        # Block many-to-one violation
        if tgt_is_pk and len(sources) > 1:
            return {
                "verdict": "blocking",
                "message": "primary key target cannot have multiple sources",
            }

        # Single-source compatibility
        verdict = "ok"
        message = "compatible"
        for src in sources:
            src_type = src.get("type") or ""
            if _is_incompatible(src_type, tgt_type):
                verdict = "blocking"
                message = f"incompatible: cannot map {src_type} to {tgt_type} without cast"
                break
            if _is_lossy(src_type, tgt_type):
                verdict = "lossy_warning"
                message = f"lossy: mapping {src_type} to {tgt_type} may lose precision"
            elif _is_lossless_widening(src_type, tgt_type):
                pass  # remain 'ok'
            else:
                # same family, narrow case — treat as ok for now
                pass

        # If lossy but no cast transform, escalate to blocking
        if verdict == "lossy_warning" and transformation.get("kind") != "cast":
            verdict = "blocking"
            message = message + " (no CAST transformation supplied)"

        # Null-safety: target NOT NULL + nullable source without default/coalesce/null_if
        if tgt_nullable is False or tgt_nullable == 0:
            for src in sources:
                if src.get("nullable") and not _has_null_safety(transformation):
                    verdict = "blocking"
                    message = "target is NOT NULL but source is nullable and no null-handling transform provided"
                    break

        return {"verdict": verdict, "message": message}

    @classmethod
    def validate_mapping(cls, mapping: Any) -> Dict[str, Any]:
        """Validate every edge in a mapping and return an aggregate summary.

        ``mapping`` may be a Mapping ORM instance or a plain dict with
        ``edges`` key, each edge shaped like the FieldMapping serialization.
        """
        if isinstance(mapping, dict):
            edges = mapping.get("edges") or []
            mapping_id = mapping.get("id")
        else:
            mapping_id = getattr(mapping, "id", None)
            edges = list(getattr(mapping, "edges", []) or [])

        issues: List[Dict[str, Any]] = []
        ok = warn = blocking = 0
        for edge in edges:
            edge_dict = _edge_to_dict(edge)
            result = cls.validate_edge(edge_dict)
            verdict = result["verdict"]
            if verdict == "ok":
                ok += 1
            elif verdict == "lossy_warning":
                warn += 1
            else:
                blocking += 1
            issues.append({
                "edge_id": edge_dict.get("id"),
                "verdict": verdict,
                "message": result["message"],
            })

        return {
            "mapping_id": mapping_id,
            "ok_count": ok,
            "warning_count": warn,
            "blocking_count": blocking,
            "issues": issues,
        }


def _edge_to_dict(edge: Any) -> Dict[str, Any]:
    if isinstance(edge, dict):
        return edge
    return {
        "id": getattr(edge, "id", None),
        "target": getattr(edge, "target_ref_dict", lambda: {})() if hasattr(edge, "target_ref_dict") else {},
        "sources": getattr(edge, "sources", []) or [],
        "transformation": getattr(edge, "transformation", {}) or {},
    }
```

Note: the `_edge_to_dict` helper normalizes either an ORM `FieldMapping` row or a dict. Since `FieldMapping` stores target fields denormalized, the `target` attribute on the ORM is reconstructed as `{"table": edge.target_table, "column": edge.target_column, ...}`. Use a small helper or build it inline.

- [ ] **Step 2:** Commit
```bash
git add backend/app/services/mapping_validation_service.py
git commit -m "feat(mapping): type-compatibility validation service with lossless/lossy/blocking matrix"
```

#### Task C2: Validation tests

**Files:** Create `backend/tests/mapping/test_mapping_validation_service.py`

- [ ] **Step 1:** Fixture covering 10 type combinations.

```python
"""Unit tests for MappingValidationService covering the type matrix."""
import pytest
from app.services.mapping_validation_service import MappingValidationService


def _edge(target, sources, transformation=None):
    return {
        "id": 1,
        "target": target,
        "sources": sources,
        "transformation": transformation or {"kind": "direct"},
    }


def test_same_type_is_ok():
    e = _edge({"type": "TEXT", "nullable": False},
              [{"type": "TEXT", "nullable": True}])
    r = MappingValidationService.validate_edge(e)
    assert r["verdict"] == "ok"


def test_int_to_bigint_is_ok():
    e = _edge({"type": "BIGINT", "nullable": False},
              [{"type": "INTEGER", "nullable": False}])
    r = MappingValidationService.validate_edge(e)
    assert r["verdict"] == "ok"


def test_text_to_int_without_cast_is_blocking():
    e = _edge({"type": "INTEGER", "nullable": False},
              [{"type": "TEXT", "nullable": False}])
    r = MappingValidationService.validate_edge(e)
    assert r["verdict"] == "blocking"


def test_text_to_int_with_cast_is_ok():
    e = _edge({"type": "INTEGER", "nullable": False},
              [{"type": "TEXT", "nullable": False}],
              {"kind": "cast", "from": "TEXT", "to": "INTEGER"})
    r = MappingValidationService.validate_edge(e)
    assert r["verdict"] == "ok"


def test_int_to_text_is_lossy_warning_without_cast():
    e = _edge({"type": "TEXT", "nullable": False},
              [{"type": "INTEGER", "nullable": False}])
    r = MappingValidationService.validate_edge(e)
    assert r["verdict"] == "blocking"  # lossy + no cast → blocking


def test_int_to_text_with_cast_is_ok():
    e = _edge({"type": "TEXT", "nullable": False},
              [{"type": "INTEGER", "nullable": False}],
              {"kind": "cast", "from": "INTEGER", "to": "TEXT"})
    r = MappingValidationService.validate_edge(e)
    assert r["verdict"] == "ok"


def test_float_to_int_is_blocking_without_cast():
    e = _edge({"type": "INTEGER", "nullable": False},
              [{"type": "FLOAT", "nullable": False}])
    r = MappingValidationService.validate_edge(e)
    assert r["verdict"] == "blocking"


def test_timestamp_to_date_is_lossy():
    e = _edge({"type": "DATE", "nullable": False},
              [{"type": "TIMESTAMP", "nullable": False}])
    r = MappingValidationService.validate_edge(e)
    # lossy without cast becomes blocking
    assert r["verdict"] == "blocking"


def test_target_not_null_with_nullable_source_blocks_without_default():
    e = _edge({"type": "TEXT", "nullable": False},
              [{"type": "TEXT", "nullable": True}])
    r = MappingValidationService.validate_edge(e)
    assert r["verdict"] == "blocking"


def test_target_not_null_with_default_coalesce_is_ok():
    e = _edge({"type": "TEXT", "nullable": False},
              [{"type": "TEXT", "nullable": True}],
              {"kind": "default", "value_kind": "literal", "value": "n/a"})
    r = MappingValidationService.validate_edge(e)
    assert r["verdict"] == "ok"


def test_pk_target_blocks_many_to_one():
    e = _edge({"type": "INTEGER", "nullable": False, "primary_key": True},
              [{"type": "INTEGER", "nullable": False},
               {"type": "INTEGER", "nullable": False}])
    r = MappingValidationService.validate_edge(e)
    assert r["verdict"] == "blocking"


def test_empty_sources_blocks():
    e = _edge({"type": "TEXT"}, [])
    r = MappingValidationService.validate_edge(e)
    assert r["verdict"] == "blocking"


def test_summary_counts():
    mapping = {
        "id": 99,
        "edges": [
            _edge({"type": "TEXT"}, [{"type": "TEXT"}]),  # ok
            _edge({"type": "INTEGER"}, [{"type": "TEXT"}]),  # blocking
            _edge({"type": "BIGINT"}, [{"type": "INTEGER"}]),  # ok
        ],
    }
    s = MappingValidationService.validate_mapping(mapping)
    assert s["mapping_id"] == 99
    assert s["ok_count"] == 2
    assert s["blocking_count"] == 1
```

- [ ] **Step 2:** Run tests:
```bash
cd /Users/anilkumar/workspace/dataplane-main/backend && python -m pytest tests/mapping/test_mapping_validation_service.py -v
```
Expected: all pass.

- [ ] **Step 3:** Commit
```bash
git add backend/tests/mapping/test_mapping_validation_service.py
git commit -m "test(mapping): cover type-compatibility validation matrix"
```

### Phase D — Mapping service + role gate

#### Task D1: Role gate dependency

**Files:** Create `backend/app/api/deps.py`

- [ ] **Step 1:** `require_role(*allowed)` factory.

```python
"""FastAPI dependencies for role-based access control."""
from typing import Iterable
from fastapi import Depends, HTTPException, status
from app.models.user import User
from app.api.routers.auth import get_current_user


def require_role(*allowed: str):
    """Dependency factory: enforce that the current user's role is in ``allowed``."""
    allowed_set = set(allowed)

    def _dep(user: User = Depends(get_current_user)) -> User:
        if user.role not in allowed_set:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"role '{user.role}' not authorized; need one of {sorted(allowed_set)}",
            )
        return user

    return _dep
```

- [ ] **Step 2:** Commit
```bash
git add backend/app/api/deps.py
git commit -m "feat(auth): require_role dependency for RBAC"
```

#### Task D2: Mapping service

**Files:** Create `backend/app/services/mapping_service.py`

- [ ] **Step 1:** Full state machine: create, get, update, delete (soft), add_edge, remove_edge, update_edge_transformation, generate_suggestions (enqueue), accept_suggestion, reject_suggestion, validate, publish, export_json.

```python
"""Mapping workspace service: CRUD, draft/publish state machine, audit emission."""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.celery_app import celery_app
from app.models.connection import DBConnection
from app.models.mapping import (
    AISuggestion, FieldMapping, Mapping, MappingVersion,
)
from app.services.audit_helper import record_audit
from app.services.mapping_validation_service import MappingValidationService
from app.services.transformation_grammar import GrammarError, parse

logger = logging.getLogger(__name__)


class MappingService:

    # ── Mapping lifecycle ──────────────────────────────────────

    @staticmethod
    def create_mapping(db: Session, *, source_id: int, target_id: int,
                       name: str, actor: str) -> Mapping:
        for cid, label in ((source_id, "source"), (target_id, "target")):
            if not db.query(DBConnection).filter(DBConnection.id == cid).first():
                raise HTTPException(status_code=404, detail=f"{label} connection {cid} not found")
        if source_id == target_id:
            raise HTTPException(status_code=422, detail="source and target must be different")
        m = Mapping(name=name, source_id=source_id, target_id=target_id,
                    status="draft", created_by=actor)
        db.add(m)
        db.flush()
        record_audit(db, "mapping_created", actor=actor,
                     connection_id=source_id,
                     payload={"mapping_id": m.id, "name": name,
                              "source_id": source_id, "target_id": target_id})
        db.commit()
        db.refresh(m)
        return m

    @staticmethod
    def get_mapping(db: Session, mapping_id: int) -> Mapping:
        m = db.query(Mapping).filter(Mapping.id == mapping_id,
                                     Mapping.deleted_at.is_(None)).first()
        if not m:
            raise HTTPException(status_code=404, detail="mapping not found")
        return m

    @staticmethod
    def update_mapping_meta(db: Session, mapping_id: int, *,
                            name: Optional[str], actor: str) -> Mapping:
        m = MappingService.get_mapping(db, mapping_id)
        before = {"name": m.name}
        if name:
            m.name = name
        db.flush()
        record_audit(db, "mapping_meta_updated", actor=actor,
                     connection_id=m.source_id,
                     payload={"mapping_id": m.id, "before": before,
                              "after": {"name": m.name}})
        db.commit()
        db.refresh(m)
        return m

    @staticmethod
    def delete_mapping(db: Session, mapping_id: int, *, actor: str) -> None:
        m = MappingService.get_mapping(db, mapping_id)
        if m.status == "published":
            raise HTTPException(status_code=409, detail="published mappings cannot be deleted; archive instead")
        m.deleted_at = datetime.now(timezone.utc)
        db.flush()
        record_audit(db, "mapping_deleted", actor=actor,
                     connection_id=m.source_id,
                     payload={"mapping_id": m.id, "name": m.name})
        db.commit()

    # ── Edge operations ───────────────────────────────────────

    @staticmethod
    def add_edge(db: Session, mapping_id: int, *,
                 target: Dict[str, Any], sources: List[Dict[str, Any]],
                 transformation: Dict[str, Any], origin: str = "manual",
                 actor: str) -> FieldMapping:
        m = MappingService.get_mapping(db, mapping_id)
        _assert_draft(m)

        if not sources:
            raise HTTPException(status_code=422, detail="at least one source column is required")

        # FR3: enforce 1:1 / N:1 by checking existing draft edges that reference the same source column
        # with a different target is allowed; multiple sources per target is allowed; multiple targets
        # per source is blocked.
        for src in sources:
            src_key = (src["table"], src["column"])
            existing = (
                db.query(FieldMapping)
                .filter(FieldMapping.mapping_id == mapping_id,
                        FieldMapping.version_id.is_(None))
                .all()
            )
            for e in existing:
                for es in (e.sources or []):
                    if (es.get("table"), es.get("column")) == src_key and \
                       (e.target_table, e.target_column) != (target["table"], target["column"]):
                        raise HTTPException(
                            status_code=409,
                            detail=f"source {src_key} already mapped to {(e.target_table, e.target_column)}; many-to-many is not supported",
                        )

        # Validate transformation grammar
        try:
            parse(transformation or {"kind": "direct"})
        except GrammarError as exc:
            raise HTTPException(
                status_code=422,
                detail={"kind": "grammar_error", "message": exc.to_dict()["message"],
                        "location": exc.to_dict()["location"]},
            ) from exc

        now = datetime.now(timezone.utc).isoformat()
        audit = {"created_by": actor, "created_at": now, "updated_by": actor, "updated_at": now}
        edge = FieldMapping(
            mapping_id=m.id,
            version_id=None,
            target_table=target["table"],
            target_column=target["column"],
            target_type=target.get("type"),
            target_nullable=1 if target.get("nullable") else (0 if target.get("nullable") is False else None),
            target_is_pk=1 if target.get("primary_key") else 0,
            sources=sources,
            transformation=transformation or {"kind": "direct"},
            origin=origin,
            audit=audit,
        )
        db.add(edge)
        db.flush()
        record_audit(db, "mapping_edge_added", actor=actor,
                     connection_id=m.source_id,
                     payload={"mapping_id": m.id, "edge_id": edge.id,
                              "target": target, "sources": sources,
                              "origin": origin})
        db.commit()
        db.refresh(edge)
        return edge

    @staticmethod
    def remove_edge(db: Session, mapping_id: int, edge_id: int, *, actor: str) -> None:
        m = MappingService.get_mapping(db, mapping_id)
        _assert_draft(m)
        edge = db.query(FieldMapping).filter(
            FieldMapping.id == edge_id,
            FieldMapping.mapping_id == mapping_id,
        ).first()
        if not edge:
            raise HTTPException(status_code=404, detail="edge not found")
        before = {"target": edge.target_table + "." + edge.target_column}
        db.delete(edge)
        db.flush()
        record_audit(db, "mapping_edge_removed", actor=actor,
                     connection_id=m.source_id,
                     payload={"mapping_id": m.id, "edge_id": edge_id, "before": before})
        db.commit()

    @staticmethod
    def update_edge_transformation(db: Session, mapping_id: int, edge_id: int,
                                   transformation: Dict[str, Any], *, actor: str) -> FieldMapping:
        m = MappingService.get_mapping(db, mapping_id)
        _assert_draft(m)
        edge = db.query(FieldMapping).filter(
            FieldMapping.id == edge_id,
            FieldMapping.mapping_id == mapping_id,
        ).first()
        if not edge:
            raise HTTPException(status_code=404, detail="edge not found")
        try:
            parse(transformation or {"kind": "direct"})
        except GrammarError as exc:
            raise HTTPException(
                status_code=422,
                detail={"kind": "grammar_error", "message": exc.to_dict()["message"],
                        "location": exc.to_dict()["location"]},
            ) from exc
        before = dict(edge.transformation or {})
        edge.transformation = transformation or {"kind": "direct"}
        now = datetime.now(timezone.utc).isoformat()
        edge.audit = {**(edge.audit or {}), "updated_by": actor, "updated_at": now}
        db.flush()
        record_audit(db, "mapping_edge_updated", actor=actor,
                     connection_id=m.source_id,
                     payload={"mapping_id": m.id, "edge_id": edge_id,
                              "before": before, "after": edge.transformation})
        db.commit()
        db.refresh(edge)
        return edge

    # ── AI suggestions ────────────────────────────────────────

    @staticmethod
    def request_suggestions(db: Session, mapping_id: int, *, actor: str) -> str:
        m = MappingService.get_mapping(db, mapping_id)
        _assert_draft(m)
        task = celery_app.send_task(
            "app.workers.mapping_tasks.suggest_mappings_task",
            kwargs={"mapping_id": mapping_id},
        )
        record_audit(db, "mapping_suggestions_requested", actor=actor,
                     connection_id=m.source_id,
                     payload={"mapping_id": m.id, "task_id": task.id})
        db.commit()
        return task.id

    @staticmethod
    def accept_suggestion(db: Session, mapping_id: int, suggestion_id: int,
                          transformation: Optional[Dict[str, Any]], *, actor: str) -> FieldMapping:
        m = MappingService.get_mapping(db, mapping_id)
        _assert_draft(m)
        sug = db.query(AISuggestion).filter(
            AISuggestion.id == suggestion_id,
            AISuggestion.mapping_id == mapping_id,
        ).first()
        if not sug:
            raise HTTPException(status_code=404, detail="suggestion not found")
        if sug.status != "pending":
            raise HTTPException(status_code=409, detail=f"suggestion already {sug.status}")

        # Reuse add_edge semantics but skip the N:N guard (suggestion source is intentionally unique).
        edge = MappingService.add_edge(
            db, mapping_id,
            target={"table": sug.target_table, "column": sug.target_column,
                    "type": sug.target_type},
            sources=[{"table": sug.source_table, "column": sug.source_column,
                      "type": sug.source_type}],
            transformation=transformation or {"kind": "direct"},
            origin="ai_accepted",
            actor=actor,
        )
        edge.ai_confidence = sug.confidence
        sug.status = "accepted"
        sug.accepted_edge_id = edge.id
        sug.decided_at = datetime.now(timezone.utc)
        sug.decided_by = actor
        db.flush()
        record_audit(db, "ai_suggestion_accepted", actor=actor,
                     connection_id=m.source_id,
                     payload={"mapping_id": m.id, "suggestion_id": sug.id,
                              "edge_id": edge.id, "confidence": sug.confidence})
        db.commit()
        db.refresh(edge)
        return edge

    @staticmethod
    def reject_suggestion(db: Session, mapping_id: int, suggestion_id: int, *, actor: str) -> AISuggestion:
        m = MappingService.get_mapping(db, mapping_id)
        sug = db.query(AISuggestion).filter(
            AISuggestion.id == suggestion_id,
            AISuggestion.mapping_id == mapping_id,
        ).first()
        if not sug:
            raise HTTPException(status_code=404, detail="suggestion not found")
        if sug.status != "pending":
            raise HTTPException(status_code=409, detail=f"suggestion already {sug.status}")
        sug.status = "rejected"
        sug.decided_at = datetime.now(timezone.utc)
        sug.decided_by = actor
        db.flush()
        record_audit(db, "ai_suggestion_rejected", actor=actor,
                     connection_id=m.source_id,
                     payload={"mapping_id": m.id, "suggestion_id": sug.id,
                              "confidence": sug.confidence})
        db.commit()
        db.refresh(sug)
        return sug

    # ── Validation ────────────────────────────────────────────

    @staticmethod
    def validate(db: Session, mapping_id: int, *, actor: str) -> Dict[str, Any]:
        m = MappingService.get_mapping(db, mapping_id)
        summary = MappingValidationService.validate_mapping(m)
        record_audit(db, "mapping_validated", actor=actor,
                     connection_id=m.source_id,
                     payload={"mapping_id": m.id, **summary})
        db.commit()
        return summary

    # ── Publish + export ──────────────────────────────────────

    @staticmethod
    def publish(db: Session, mapping_id: int, *, actor: str) -> MappingVersion:
        m = MappingService.get_mapping(db, mapping_id)
        _assert_draft(m)
        summary = MappingValidationService.validate_mapping(m)
        if summary["blocking_count"] > 0:
            raise HTTPException(
                status_code=422,
                detail={"kind": "validation_blocking",
                        "blocking_count": summary["blocking_count"],
                        "issues": summary["issues"]},
            )

        from app.services.schema_service import SchemaService
        source_conn = db.query(DBConnection).filter(DBConnection.id == m.source_id).first()
        target_conn = db.query(DBConnection).filter(DBConnection.id == m.target_id).first()
        try:
            source_schema = SchemaService.get_full_schema(source_conn)
            target_schema = SchemaService.get_full_schema(target_conn)
        except Exception as exc:
            logger.warning("publish: schema fetch failed for mapping %s: %s", m.id, exc)
            raise HTTPException(status_code=500, detail=f"schema snapshot failed: {exc}") from exc

        # Determine next version number (per mapping)
        last = (
            db.query(MappingVersion)
            .filter(MappingVersion.mapping_id == m.id)
            .order_by(MappingVersion.version_number.desc())
            .first()
        )
        next_n = (last.version_number + 1) if last else 1

        # Snapshot edges (immutable copy)
        edges_snapshot = [_edge_to_dict(e) for e in m.edges]

        version = MappingVersion(
            mapping_id=m.id,
            version_number=next_n,
            status="published",
            published_at=datetime.now(timezone.utc),
            published_by=actor,
            schema_snapshot={"source": source_schema, "target": target_schema},
            edges_snapshot=edges_snapshot,
        )
        db.add(version)
        db.flush()
        # Pin all current draft edges to this version, then clear the draft edges
        # so the next draft starts clean.
        for e in m.edges:
            e.version_id = version.id
        m.status = "published"
        m.current_version_id = version.id
        db.flush()
        record_audit(db, "mapping_published", actor=actor,
                     connection_id=m.source_id,
                     payload={"mapping_id": m.id, "version_number": next_n,
                              "version_id": version.id, "edges_count": len(edges_snapshot)})
        db.commit()
        db.refresh(version)
        return version

    @staticmethod
    def export_json(db: Session, mapping_id: int, *,
                    actor: str, version_id: Optional[int] = None) -> Dict[str, Any]:
        m = MappingService.get_mapping(db, mapping_id)
        if version_id:
            v = db.query(MappingVersion).filter(
                MappingVersion.id == version_id,
                MappingVersion.mapping_id == m.id,
            ).first()
        else:
            v = m.current_version
        if not v:
            raise HTTPException(status_code=409, detail="no published version to export")
        if v.status != "published":
            raise HTTPException(status_code=409, detail=f"version {v.id} is not published")

        source_conn = db.query(DBConnection).filter(DBConnection.id == m.source_id).first()
        target_conn = db.query(DBConnection).filter(DBConnection.id == m.target_id).first()

        artifact = {
            "mapping_id": m.id,
            "name": m.name,
            "version": v.version_number,
            "status": "published",
            "published_at": v.published_at.isoformat() if v.published_at else None,
            "published_by": v.published_by,
            "source": {
                "connection_id": source_conn.id if source_conn else None,
                "name": source_conn.name if source_conn else None,
                "type": source_conn.type if source_conn else None,
            },
            "target": {
                "connection_id": target_conn.id if target_conn else None,
                "name": target_conn.name if target_conn else None,
                "type": target_conn.type if target_conn else None,
            },
            "field_mappings": v.edges_snapshot or [],
            "schema_snapshot": v.schema_snapshot or {},
        }
        record_audit(db, "mapping_exported", actor=actor,
                     connection_id=m.source_id,
                     payload={"mapping_id": m.id, "version_id": v.id,
                              "version_number": v.version_number})
        db.commit()
        return artifact


def _assert_draft(m: Mapping) -> None:
    if m.status != "draft":
        raise HTTPException(status_code=409,
                            detail=f"mapping {m.id} is '{m.status}'; only draft mappings are mutable")


def _edge_to_dict(edge: FieldMapping) -> Dict[str, Any]:
    return {
        "id": edge.id,
        "origin": edge.origin,
        "ai_confidence": edge.ai_confidence,
        "target": {
            "table": edge.target_table,
            "column": edge.target_column,
            "type": edge.target_type,
            "nullable": bool(edge.target_nullable) if edge.target_nullable is not None else None,
            "primary_key": bool(edge.target_is_pk),
        },
        "sources": list(edge.sources or []),
        "transformation": edge.transformation or {"kind": "direct"},
        "audit": edge.audit or {},
    }
```

- [ ] **Step 2:** Commit
```bash
git add backend/app/services/mapping_service.py
git commit -m "feat(mapping): MappingService with full state machine and audit emission"
```

#### Task D3: Mapping service tests

**Files:** Create `backend/tests/mapping/test_mapping_service.py` and `backend/tests/mapping/conftest.py`

- [ ] **Step 1:** `conftest.py` with SQLite in-memory fixture, seeded source/target connections, admin user.

```python
"""Shared pytest fixtures for mapping tests."""
import os
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("OLLAMA_HOST", "http://localhost:11434")
os.environ.setdefault("OLLAMA_MODEL", "llama3")
os.environ.setdefault("CELERY_BROKER_URL", "memory://")
os.environ.setdefault("CELERY_RESULT_BACKEND", "cache+memory://")

from app.core.database import Base  # noqa: E402
from app.models.connection import DBConnection  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services.auth_service import AuthService  # noqa: E402


@pytest.fixture()
def engine():
    eng = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(eng)
    yield eng
    Base.metadata.drop_all(eng)
    eng.dispose()


@pytest.fixture()
def db(engine):
    Session = sessionmaker(bind=engine)
    s = Session()
    try:
        yield s
    finally:
        s.close()


@pytest.fixture()
def admin(db):
    u = User(email="admin@test.local", hashed_password=AuthService.hash_password("x"),
             role="admin", is_active=True)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


@pytest.fixture()
def analyst(db):
    u = User(email="analyst@test.local", hashed_password=AuthService.hash_password("x"),
             role="analyst", is_active=True)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


@pytest.fixture()
def viewer(db):
    u = User(email="viewer@test.local", hashed_password=AuthService.hash_password("x"),
             role="viewer", is_active=True)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


@pytest.fixture()
def seeded_connections(db):
    src = DBConnection(name="SRC", type="sqlite", config={"path": "/tmp/src.db"})
    tgt = DBConnection(name="TGT", type="sqlite", config={"path": "/tmp/tgt.db"})
    db.add_all([src, tgt])
    db.commit()
    db.refresh(src)
    db.refresh(tgt)
    return src, tgt
```

- [ ] **Step 2:** Mapping service tests.

```python
"""Unit tests for MappingService."""
import pytest
from app.models.mapping import MappingVersion
from app.models.audit import AuditLog
from app.services.mapping_service import MappingService


def test_create_mapping_writes_audit(db, admin, seeded_connections):
    src, tgt = seeded_connections
    m = MappingService.create_mapping(db, source_id=src.id, target_id=tgt.id,
                                      name="My Mapping", actor=admin.email)
    assert m.id is not None
    assert m.status == "draft"
    audit = db.query(AuditLog).filter(AuditLog.event_type == "mapping_created").first()
    assert audit is not None
    assert audit.payload["mapping_id"] == m.id


def test_create_mapping_rejects_same_source_target(db, admin, seeded_connections):
    src, _ = seeded_connections
    from fastapi import HTTPException
    with pytest.raises(HTTPException):
        MappingService.create_mapping(db, source_id=src.id, target_id=src.id,
                                      name="Bad", actor=admin.email)


def test_add_edge_emits_audit(db, admin, seeded_connections):
    src, tgt = seeded_connections
    m = MappingService.create_mapping(db, source_id=src.id, target_id=tgt.id,
                                      name="M", actor=admin.email)
    edge = MappingService.add_edge(
        db, m.id,
        target={"table": "t1", "column": "c1", "type": "TEXT", "nullable": False},
        sources=[{"table": "s1", "column": "c1", "type": "TEXT", "nullable": False}],
        transformation={"kind": "direct"},
        actor=admin.email,
    )
    assert edge.id is not None
    audit = db.query(AuditLog).filter(AuditLog.event_type == "mapping_edge_added").first()
    assert audit is not None


def test_add_edge_blocks_many_to_many(db, admin, seeded_connections):
    src, tgt = seeded_connections
    m = MappingService.create_mapping(db, source_id=src.id, target_id=tgt.id,
                                      name="M", actor=admin.email)
    MappingService.add_edge(
        db, m.id,
        target={"table": "t1", "column": "c1", "type": "TEXT"},
        sources=[{"table": "s1", "column": "c1", "type": "TEXT"}],
        transformation={"kind": "direct"},
        actor=admin.email,
    )
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as e:
        MappingService.add_edge(
            db, m.id,
            target={"table": "t2", "column": "c2", "type": "TEXT"},
            sources=[{"table": "s1", "column": "c1", "type": "TEXT"}],
            transformation={"kind": "direct"},
            actor=admin.email,
        )
    assert e.value.status_code == 409


def test_add_edge_rejects_bad_transformation(db, admin, seeded_connections):
    src, tgt = seeded_connections
    m = MappingService.create_mapping(db, source_id=src.id, target_id=tgt.id,
                                      name="M", actor=admin.email)
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as e:
        MappingService.add_edge(
            db, m.id,
            target={"table": "t1", "column": "c1", "type": "TEXT"},
            sources=[{"table": "s1", "column": "c1", "type": "TEXT"}],
            transformation={"kind": "evil_eval"},
            actor=admin.email,
        )
    assert e.value.status_code == 422


def test_publish_blocks_when_validation_blocking(db, admin, seeded_connections):
    src, tgt = seeded_connections
    m = MappingService.create_mapping(db, source_id=src.id, target_id=tgt.id,
                                      name="M", actor=admin.email)
    # Text -> Integer without cast = blocking
    MappingService.add_edge(
        db, m.id,
        target={"table": "t1", "column": "c1", "type": "INTEGER"},
        sources=[{"table": "s1", "column": "c1", "type": "TEXT"}],
        transformation={"kind": "direct"},
        actor=admin.email,
    )
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as e:
        MappingService.publish(db, m.id, actor=admin.email)
    assert e.value.status_code == 422


def test_publish_creates_immutable_version(db, admin, seeded_connections, monkeypatch):
    from app.services import schema_service
    monkeypatch.setattr(schema_service.SchemaService, "get_full_schema",
                        staticmethod(lambda conn: {"dummy": [{"name": "x", "type": "TEXT"}]}))
    src, tgt = seeded_connections
    m = MappingService.create_mapping(db, source_id=src.id, target_id=tgt.id,
                                      name="M", actor=admin.email)
    MappingService.add_edge(
        db, m.id,
        target={"table": "t1", "column": "c1", "type": "TEXT", "nullable": False},
        sources=[{"table": "s1", "column": "c1", "type": "TEXT", "nullable": False}],
        transformation={"kind": "direct"},
        actor=admin.email,
    )
    v = MappingService.publish(db, m.id, actor=admin.email)
    assert v.version_number == 1
    assert v.status == "published"
    # Mapping now pinned to the version
    db.refresh(m)
    assert m.status == "published"
    assert m.current_version_id == v.id
    # Audit event
    audit = db.query(AuditLog).filter(AuditLog.event_type == "mapping_published").first()
    assert audit is not None
    assert audit.payload["version_number"] == 1


def test_publish_second_version_increments(db, admin, seeded_connections, monkeypatch):
    from app.services import schema_service
    monkeypatch.setattr(schema_service.SchemaService, "get_full_schema",
                        staticmethod(lambda conn: {"dummy": [{"name": "x", "type": "TEXT"}]}))
    src, tgt = seeded_connections
    m = MappingService.create_mapping(db, source_id=src.id, target_id=tgt.id,
                                      name="M", actor=admin.email)
    MappingService.add_edge(
        db, m.id,
        target={"table": "t1", "column": "c1", "type": "TEXT", "nullable": False},
        sources=[{"table": "s1", "column": "c1", "type": "TEXT", "nullable": False}],
        transformation={"kind": "direct"},
        actor=admin.email,
    )
    v1 = MappingService.publish(db, m.id, actor=admin.email)
    # Now back to draft, add another edge, republish
    db.refresh(m)
    assert m.status == "published"
    # Reopen via direct DB op (service doesn't expose reopen)
    m.status = "draft"
    db.commit()
    MappingService.add_edge(
        db, m.id,
        target={"table": "t1", "column": "c2", "type": "TEXT", "nullable": False},
        sources=[{"table": "s1", "column": "c2", "type": "TEXT", "nullable": False}],
        transformation={"kind": "direct"},
        actor=admin.email,
    )
    v2 = MappingService.publish(db, m.id, actor=admin.email)
    assert v2.version_number == 2


def test_export_json_shape(db, admin, seeded_connections, monkeypatch):
    from app.services import schema_service
    monkeypatch.setattr(schema_service.SchemaService, "get_full_schema",
                        staticmethod(lambda conn: {"t1": [{"name": "c1", "type": "TEXT"}]}))
    src, tgt = seeded_connections
    m = MappingService.create_mapping(db, source_id=src.id, target_id=tgt.id,
                                      name="ExportTest", actor=admin.email)
    MappingService.add_edge(
        db, m.id,
        target={"table": "t1", "column": "c1", "type": "TEXT", "nullable": False},
        sources=[{"table": "s1", "column": "c1", "type": "TEXT", "nullable": False}],
        transformation={"kind": "direct"},
        actor=admin.email,
    )
    v = MappingService.publish(db, m.id, actor=admin.email)
    artifact = MappingService.export_json(db, m.id, actor=admin.email)
    assert artifact["mapping_id"] == m.id
    assert artifact["version"] == v.version_number
    assert "field_mappings" in artifact and len(artifact["field_mappings"]) == 1
    assert "schema_snapshot" in artifact


def test_delete_mapping_emits_audit(db, admin, seeded_connections):
    src, tgt = seeded_connections
    m = MappingService.create_mapping(db, source_id=src.id, target_id=tgt.id,
                                      name="M", actor=admin.email)
    MappingService.delete_mapping(db, m.id, actor=admin.email)
    audit = db.query(AuditLog).filter(AuditLog.event_type == "mapping_deleted").first()
    assert audit is not None
```

- [ ] **Step 3:** Run tests:
```bash
cd /Users/anilkumar/workspace/dataplane-main/backend && python -m pytest tests/mapping/test_mapping_service.py -v
```
Expected: all pass.

- [ ] **Step 4:** Commit
```bash
git add backend/tests/mapping/test_mapping_service.py backend/tests/mapping/conftest.py
git commit -m "test(mapping): cover MappingService state machine and audit emissions"
```

### Phase E — Router + Celery task + wiring

#### Task E1: Celery task

**Files:** Create `backend/app/workers/__init__.py` (empty) and `backend/app/workers/mapping_tasks.py`

- [ ] **Step 1:** `suggest_mappings_task` that iterates unmapped target columns, calls AIService for source matches, inserts AISuggestion rows, emits `mapping_suggestions_ready` audit event.

```python
"""Celery task for AI mapping suggestions (Schema Mapper)."""
import logging
from datetime import datetime, timezone
from typing import Any, Dict

from app.core.celery_app import celery_app
from app.core.database import SessionLocal
from app.models.connection import DBConnection
from app.models.mapping import AISuggestion, Mapping
from app.services.ai_service import AIService
from app.services.audit_helper import record_audit
from app.services.schema_service import SchemaService

logger = logging.getLogger(__name__)


@celery_app.task(name="app.workers.mapping_tasks.suggest_mappings_task", bind=True)
def suggest_mappings_task(self, mapping_id: int) -> Dict[str, Any]:
    db = SessionLocal()
    try:
        m = db.query(Mapping).filter(Mapping.id == mapping_id).first()
        if not m:
            return {"status": "failed", "error": "mapping not found"}

        source_conn = db.query(DBConnection).filter(DBConnection.id == m.source_id).first()
        target_conn = db.query(DBConnection).filter(DBConnection.id == m.target_id).first()
        if not source_conn or not target_conn:
            return {"status": "failed", "error": "connection not found"}

        try:
            source_schema = SchemaService.get_full_schema(source_conn)
            target_schema = SchemaService.get_full_schema(target_conn)
        except Exception as exc:
            logger.warning("suggest_mappings_task: schema fetch failed: %s", exc)
            return {"status": "failed", "error": f"schema fetch: {exc}"}

        # Find target columns that aren't yet mapped in this draft
        existing_targets = {
            (e.target_table, e.target_column) for e in m.edges if e.version_id is None
        }

        # For each target table, get column-level matches from each source table
        suggestions_created = 0
        for tgt_table, tgt_cols in target_schema.items():
            for tgt_col in tgt_cols:
                if (tgt_table, tgt_col["name"]) in existing_targets:
                    continue
                # Look for the best source match per source table
                best_overall = None
                for src_table, src_cols in source_schema.items():
                    try:
                        result = AIService.match_schemas(
                            source_name=src_table, source_schema=src_cols,
                            target_name=tgt_table, target_schema=tgt_cols,
                        )
                    except Exception as exc:
                        logger.warning("AIService.match_schemas failed: %s", exc)
                        continue
                    for match in result.get("matches", []) or []:
                        if match.get("target") != tgt_col["name"]:
                            continue
                        conf = float(match.get("confidence", 0) or 0)
                        if best_overall is None or conf > best_overall["confidence"]:
                            best_overall = {
                                "source_table": src_table,
                                "source_column": match["source"],
                                "source_type": next((c.get("type") for c in src_cols
                                                     if c.get("name") == match["source"]), None),
                                "confidence": conf,
                                "reason": match.get("reason"),
                            }
                if best_overall and best_overall["confidence"] >= 50:
                    db.add(AISuggestion(
                        mapping_id=m.id,
                        target_table=tgt_table,
                        target_column=tgt_col["name"],
                        target_type=tgt_col.get("type"),
                        source_table=best_overall["source_table"],
                        source_column=best_overall["source_column"],
                        source_type=best_overall["source_type"],
                        confidence=best_overall["confidence"],
                        reason=best_overall["reason"],
                        status="pending",
                    ))
                    suggestions_created += 1

        db.flush()
        record_audit(db, "mapping_suggestions_ready",
                     actor="mapping-suggester",
                     connection_id=m.source_id,
                     payload={"mapping_id": m.id,
                              "suggestions_created": suggestions_created})
        db.commit()

        return {"status": "completed", "mapping_id": m.id,
                "suggestions_created": suggestions_created}
    except Exception as exc:
        logger.error("suggest_mappings_task failed: %s", exc)
        try:
            db.rollback()
        except Exception:
            pass
        return {"status": "failed", "error": str(exc)}
    finally:
        db.close()
```

- [ ] **Step 2:** Commit
```bash
git add backend/app/workers/
git commit -m "feat(mapping): Celery task for AI mapping suggestions"
```

#### Task E2: Mappings router

**Files:** Create `backend/app/api/routers/mappings.py`

- [ ] **Step 1:** Full router with role gates and audit emissions on every state-changing endpoint.

```python
"""Schema Mapper — versioned, audited, role-gated mapping workspace API."""
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.deps import require_role
from app.api.routers.auth import get_current_user
from app.core.database import get_db
from app.models.mapping import AISuggestion, FieldMapping, Mapping
from app.models.user import User
from app.schemas.mapping import (
    EdgeCreate, EdgeResponse, EdgeTransformationUpdate, MappingCreate,
    MappingResponse, MappingUpdate, PublishResponse, SourceRef, SuggestionAcceptRequest,
    SuggestionResponse, TargetRef, ValidationIssue, ValidationResponse,
)
from app.services.audit_helper import record_audit
from app.services.mapping_service import MappingService

logger = logging.getLogger(__name__)
router = APIRouter()


def _edge_response(edge: FieldMapping) -> EdgeResponse:
    return EdgeResponse(
        id=edge.id,
        mapping_id=edge.mapping_id,
        target=TargetRef(
            table=edge.target_table, column=edge.target_column,
            type=edge.target_type,
            nullable=bool(edge.target_nullable) if edge.target_nullable is not None else None,
            primary_key=bool(edge.target_is_pk),
        ),
        sources=[SourceRef(**s) for s in (edge.sources or [])],
        transformation=edge.transformation or {"kind": "direct"},
        origin=edge.origin,
        ai_confidence=edge.ai_confidence,
        audit=edge.audit or {},
        created_at=edge.created_at,
        updated_at=edge.updated_at,
    )


def _mapping_response(m: Mapping) -> MappingResponse:
    return MappingResponse(
        id=m.id,
        name=m.name,
        source_id=m.source_id,
        target_id=m.target_id,
        status=m.status,
        current_version_id=m.current_version_id,
        created_by=m.created_by,
        created_at=m.created_at,
        updated_at=m.updated_at,
        edges=[_edge_response(e) for e in (m.edges or []) if e.version_id is None],
    )


@router.post("/", response_model=MappingResponse, status_code=201)
def create_mapping(req: MappingCreate, db: Session = Depends(get_db),
                   user: User = Depends(require_role("admin", "analyst"))):
    m = MappingService.create_mapping(db, source_id=req.source_id, target_id=req.target_id,
                                      name=req.name, actor=user.email)
    return _mapping_response(m)


@router.get("/", response_model=List[MappingResponse])
def list_mappings(db: Session = Depends(get_db),
                  _user: User = Depends(get_current_user)):
    rows = db.query(Mapping).filter(Mapping.deleted_at.is_(None)) \
             .order_by(Mapping.created_at.desc()).all()
    return [_mapping_response(m) for m in rows]


@router.get("/{mapping_id}", response_model=MappingResponse)
def get_mapping(mapping_id: int, db: Session = Depends(get_db),
                _user: User = Depends(get_current_user)):
    m = MappingService.get_mapping(db, mapping_id)
    return _mapping_response(m)


@router.put("/{mapping_id}", response_model=MappingResponse)
def update_mapping(mapping_id: int, req: MappingUpdate, db: Session = Depends(get_db),
                   user: User = Depends(require_role("admin", "analyst"))):
    m = MappingService.update_mapping_meta(db, mapping_id, name=req.name, actor=user.email)
    return _mapping_response(m)


@router.delete("/{mapping_id}", status_code=204)
def delete_mapping(mapping_id: int, db: Session = Depends(get_db),
                   user: User = Depends(require_role("admin"))):
    MappingService.delete_mapping(db, mapping_id, actor=user.email)
    return None


@router.post("/{mapping_id}/edges", response_model=EdgeResponse, status_code=201)
def add_edge(mapping_id: int, req: EdgeCreate, db: Session = Depends(get_db),
             user: User = Depends(require_role("admin", "analyst"))):
    edge = MappingService.add_edge(
        db, mapping_id,
        target=req.target.model_dump(exclude_none=True),
        sources=[s.model_dump(exclude_none=True) for s in req.sources],
        transformation=req.transformation,
        origin=req.origin,
        actor=user.email,
    )
    return _edge_response(edge)


@router.delete("/{mapping_id}/edges/{edge_id}", status_code=204)
def remove_edge(mapping_id: int, edge_id: int, db: Session = Depends(get_db),
                user: User = Depends(require_role("admin", "analyst"))):
    MappingService.remove_edge(db, mapping_id, edge_id, actor=user.email)
    return None


@router.put("/{mapping_id}/edges/{edge_id}/transformation", response_model=EdgeResponse)
def update_edge_transformation(mapping_id: int, edge_id: int,
                               req: EdgeTransformationUpdate, db: Session = Depends(get_db),
                               user: User = Depends(require_role("admin", "analyst"))):
    edge = MappingService.update_edge_transformation(db, mapping_id, edge_id,
                                                     req.transformation, actor=user.email)
    return _edge_response(edge)


@router.post("/{mapping_id}/suggestions")
def request_suggestions(mapping_id: int, db: Session = Depends(get_db),
                        user: User = Depends(require_role("admin", "analyst"))):
    task_id = MappingService.request_suggestions(db, mapping_id, actor=user.email)
    return {"task_id": task_id, "status": "PENDING", "mapping_id": mapping_id}


@router.get("/{mapping_id}/suggestions", response_model=List[SuggestionResponse])
def list_suggestions(mapping_id: int, db: Session = Depends(get_db),
                     _user: User = Depends(get_current_user)):
    rows = db.query(AISuggestion).filter(AISuggestion.mapping_id == mapping_id) \
             .order_by(AISuggestion.confidence.desc()).all()
    return rows


@router.post("/{mapping_id}/suggestions/{suggestion_id}/accept",
             response_model=EdgeResponse)
def accept_suggestion(mapping_id: int, suggestion_id: int,
                      req: SuggestionAcceptRequest, db: Session = Depends(get_db),
                      user: User = Depends(require_role("admin", "analyst"))):
    edge = MappingService.accept_suggestion(db, mapping_id, suggestion_id,
                                            req.transformation, actor=user.email)
    return _edge_response(edge)


@router.post("/{mapping_id}/suggestions/{suggestion_id}/reject",
             response_model=SuggestionResponse)
def reject_suggestion(mapping_id: int, suggestion_id: int,
                      db: Session = Depends(get_db),
                      user: User = Depends(require_role("admin", "analyst"))):
    sug = MappingService.reject_suggestion(db, mapping_id, suggestion_id, actor=user.email)
    return sug


@router.post("/{mapping_id}/validate", response_model=ValidationResponse)
def validate_mapping(mapping_id: int, db: Session = Depends(get_db),
                     user: User = Depends(require_role("admin", "analyst"))):
    summary = MappingService.validate(db, mapping_id, actor=user.email)
    return ValidationResponse(
        mapping_id=summary["mapping_id"],
        ok_count=summary["ok_count"],
        warning_count=summary["warning_count"],
        blocking_count=summary["blocking_count"],
        issues=[ValidationIssue(**i) for i in summary["issues"]],
    )


@router.post("/{mapping_id}/publish", response_model=PublishResponse)
def publish_mapping(mapping_id: int, db: Session = Depends(get_db),
                    user: User = Depends(require_role("admin"))):
    v = MappingService.publish(db, mapping_id, actor=user.email)
    return PublishResponse(
        mapping_id=mapping_id,
        version_number=v.version_number,
        version_id=v.id,
        status=v.status,
        published_at=v.published_at,
        published_by=v.published_by,
    )


@router.get("/{mapping_id}/export")
def export_mapping(mapping_id: int,
                   version_id: Optional[int] = Query(None),
                   db: Session = Depends(get_db),
                   user: User = Depends(get_current_user)):
    artifact = MappingService.export_json(db, mapping_id, actor=user.email,
                                          version_id=version_id)
    return artifact
```

- [ ] **Step 2:** Commit
```bash
git add backend/app/api/routers/mappings.py
git commit -m "feat(mapping): /api/v1/mappings router with role gates and audit emissions"
```

#### Task E3: Wire into main.py

**Files:** Modify `backend/app/main.py`

- [ ] **Step 1:** Import the new model and the new router.

```python
# In the imports near the top:
from app.api.routers import mappings as mappings_router
from app.models.mapping import Mapping, MappingVersion, FieldMapping, AISuggestion  # noqa: F401
```

```python
# Near the other include_router calls:
app.include_router(mappings_router.router, prefix="/api/v1/mappings", tags=["Schema Mapper — Mappings"])
```

- [ ] **Step 2:** Commit
```bash
git add backend/app/main.py
git commit -m "feat(mapping): register /api/v1/mappings router and models in main.py"
```

#### Task E4: Router tests

**Files:** Create `backend/tests/mapping/test_mappings_router.py`

- [ ] **Step 1:** Use FastAPI TestClient with dependency overrides; cover viewer denial, full happy path.

```python
"""Integration tests for /api/v1/mappings."""
import pytest
from fastapi.testclient import TestClient

from app.api.routers.auth import get_current_user
from app.main import app


@pytest.fixture()
def client(admin, db, monkeypatch):
    """TestClient with admin user override; SQLite in-memory DB."""
    from app.api.routers import auth as auth_module

    def _override():
        return admin

    app.dependency_overrides[get_current_user] = _override
    app.dependency_overrides[auth_module.get_current_user] = _override
    # Skip DB session override; we'll patch get_db to use our in-memory session
    from app.core import database as db_module
    from app.core.database import SessionLocal as _SessionLocal  # noqa

    def _get_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[db_module.get_db] = _get_db

    # Patch schema_service to avoid filesystem access
    from app.services import schema_service
    monkeypatch.setattr(schema_service.SchemaService, "get_full_schema",
                        staticmethod(lambda conn: {"dummy": [{"name": "c1", "type": "TEXT"}]}))

    with TestClient(app) as c:
        yield c

    app.dependency_overrides.clear()


def test_create_mapping_201(client, seeded_connections):
    src, tgt = seeded_connections
    res = client.post("/api/v1/mappings/", json={
        "name": "Test", "source_id": src.id, "target_id": tgt.id,
    })
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["status"] == "draft"
    assert "edges" in body


def test_list_mappings_returns_empty(client):
    res = client.get("/api/v1/mappings/")
    assert res.status_code == 200
    assert isinstance(res.json(), list)


def test_full_flow_create_edge_validate_publish_export(client, seeded_connections, monkeypatch):
    src, tgt = seeded_connections
    # create
    res = client.post("/api/v1/mappings/", json={
        "name": "Flow", "source_id": src.id, "target_id": tgt.id,
    })
    assert res.status_code == 201
    mid = res.json()["id"]

    # add edge
    res = client.post(f"/api/v1/mappings/{mid}/edges", json={
        "target": {"table": "t1", "column": "c1", "type": "TEXT", "nullable": False},
        "sources": [{"table": "s1", "column": "c1", "type": "TEXT", "nullable": False}],
        "transformation": {"kind": "direct"},
        "origin": "manual",
    })
    assert res.status_code == 201, res.text

    # validate
    res = client.post(f"/api/v1/mappings/{mid}/validate")
    assert res.status_code == 200
    body = res.json()
    assert body["blocking_count"] == 0

    # publish
    res = client.post(f"/api/v1/mappings/{mid}/publish")
    assert res.status_code == 200, res.text
    v = res.json()
    assert v["version_number"] == 1

    # export
    res = client.get(f"/api/v1/mappings/{mid}/export")
    assert res.status_code == 200, res.text
    artifact = res.json()
    assert artifact["version"] == 1
    assert len(artifact["field_mappings"]) == 1


def test_publish_blocked_by_incompatible_types(client, seeded_connections, monkeypatch):
    from app.services import schema_service
    monkeypatch.setattr(schema_service.SchemaService, "get_full_schema",
                        staticmethod(lambda conn: {"t1": [{"name": "c1", "type": "INTEGER"}]}))
    src, tgt = seeded_connections
    res = client.post("/api/v1/mappings/", json={
        "name": "Block", "source_id": src.id, "target_id": tgt.id,
    })
    mid = res.json()["id"]
    res = client.post(f"/api/v1/mappings/{mid}/edges", json={
        "target": {"table": "t1", "column": "c1", "type": "INTEGER", "nullable": False},
        "sources": [{"table": "s1", "column": "c1", "type": "TEXT", "nullable": False}],
        "transformation": {"kind": "direct"},
        "origin": "manual",
    })
    assert res.status_code == 201
    res = client.post(f"/api/v1/mappings/{mid}/publish")
    assert res.status_code == 422
    assert res.json()["detail"]["kind"] == "validation_blocking"


def test_viewer_cannot_create(client, viewer, db):
    from app.api.routers.auth import get_current_user
    from app.main import app

    def _override():
        return viewer
    app.dependency_overrides[get_current_user] = _override
    res = client.post("/api/v1/mappings/", json={
        "name": "X", "source_id": 1, "target_id": 2,
    })
    assert res.status_code == 403
```

- [ ] **Step 2:** Run tests:
```bash
cd /Users/anilkumar/workspace/dataplane-main/backend && python -m pytest tests/mapping/test_mappings_router.py -v
```
Expected: all pass.

- [ ] **Step 3:** Commit
```bash
git add backend/tests/mapping/test_mappings_router.py
git commit -m "test(mapping): cover /api/v1/mappings router with role gating and full flow"
```

### Phase F — Contract doc + final verification

#### Task F1: Mapping contract for Pipelines

**Files:** Create `docs/mapper-mapping-contract.md`

- [ ] **Step 1:** Full contract document.

```markdown
# Mapping Artifact JSON Contract (Schema Mapper → Pipelines)

> Version 1.0 — published alongside Schema Mapper upgrade. Consumed by the Pipelines module via `GET /api/v1/mappings/{id}/export`.

## 1. Top-level shape

```json
{
  "mapping_id": 42,
  "name": "CRM → DW Customer Sync",
  "version": 3,
  "status": "published",
  "published_at": "2026-06-27T10:11:12.345678+00:00",
  "published_by": "admin@dataplane.ai",
  "source": { "connection_id": 1, "name": "CRM_Source_Analytics", "type": "sqlite" },
  "target": { "connection_id": 2, "name": "Data_Warehouse_Target", "type": "sqlite" },
  "field_mappings": [ /* see §2 */ ],
  "schema_snapshot": { "source": { /* captured at publish time */ }, "target": { /* captured at publish time */ } }
}
```

| Field | Type | Notes |
|---|---|---|
| `mapping_id` | int | Stable across versions |
| `name` | string | Latest display name |
| `version` | int | 1-indexed per mapping |
| `status` | string | Always `"published"` for this endpoint |
| `published_at` | ISO 8601 | UTC |
| `published_by` | string | User email |
| `source` / `target` | object | Connection metadata snapshot |
| `field_mappings` | array | Immutable list pinned at publish time |
| `schema_snapshot` | object | Captured from source/target at publish time |

## 2. Field mapping entry

```json
{
  "id": 19,
  "origin": "ai_accepted",
  "ai_confidence": 0.92,
  "target": {
    "table": "dw_customers",
    "column": "contact_email",
    "type": "VARCHAR",
    "nullable": false,
    "primary_key": false
  },
  "sources": [
    { "table": "crm_users", "column": "email_address", "type": "TEXT", "nullable": true }
  ],
  "transformation": { "kind": "cast", "from": "TEXT", "to": "VARCHAR" },
  "audit": {
    "created_by": "admin@dataplane.ai",
    "created_at": "2026-06-27T09:55:01.123+00:00",
    "updated_by": "admin@dataplane.ai",
    "updated_at": "2026-06-27T09:55:01.123+00:00"
  }
}
```

## 3. Transformation kinds

11 allowed values for `transformation.kind`: `direct`, `cast`, `concat`, `substring`, `coalesce`, `upper`, `lower`, `trim`, `default`, `null_if`, `lookup`. See `backend/app/services/transformation_grammar.py` for exact payload shapes.

## 4. Versioning & immutability

- Each publish creates a new `MappingVersion` row with a monotonic `version_number` per mapping.
- `MappingVersion.edges_snapshot` is an **immutable** copy of the draft edges at publish time. Pipelines must read from this snapshot, not from the live `FieldMapping` table.
- `MappingVersion.schema_snapshot` is captured from source/target at publish time. If the live schema drifts after publish, Pipelines should still execute against the snapshot (or compare and refuse if explicitly requested).
- A new draft does not retroactively change a published version.

## 5. Errors

- `409` if no published version exists when `export` is called.
- `404` if the mapping does not exist.
- `403` if the caller is not authenticated.

## 6. Example consumer

```python
import httpx
artifact = httpx.get(
    f"{API_BASE}/api/v1/mappings/42/export",
    headers={"Authorization": f"Bearer {token}"},
).json()
for fm in artifact["field_mappings"]:
    print(fm["target"]["table"], fm["target"]["column"], "←", fm["sources"])
```
```

- [ ] **Step 2:** Commit
```bash
git add docs/mapper-mapping-contract.md
git commit -m "docs(mapping): publish JSON contract for Pipelines consumers"
```

#### Task F2: Final verification

- [ ] **Step 1:** Run the full mapping test suite.
```bash
cd /Users/anilkumar/workspace/dataplane-main/backend && python -m pytest tests/mapping/ -v
```
Expected: all pass.

- [ ] **Step 2:** Verify the API surface via OpenAPI.
```bash
cd /Users/anilkumar/workspace/dataplane-main/backend && python -c "from app.main import app; print(len(app.routes), 'routes registered')"
```
Expected: route count increases by the number of new endpoints (~13).

- [ ] **Step 3:** Final commit if any cleanup is needed.
```bash
git status
```

---

## Risks

- **Schema snapshot size**: Very large schemas may produce large `schema_snapshot` blobs. Mitigation: cap by table count at publish time; out of scope for v1 but tracked.
- **Many-to-one N:N enforcement**: enforced at `add_edge` time, but legacy imports could violate it. Out of scope for v1; tracked.
- **Celery task ownership**: The mapping task uses `celery_app.send_task` so it doesn't need to be imported by the worker for routing; verified by existing `tasks/ai_tasks.py` pattern.

## Open Questions

None.
