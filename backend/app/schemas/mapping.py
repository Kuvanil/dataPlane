"""Pydantic schemas for the mapping workspace API (Schema Mapper)."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


# ── Request bodies ────────────────────────────────────────────────


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


class SuggestionAcceptRequest(BaseModel):
    transformation: Dict[str, Any] = Field(default_factory=dict)


# ── Response bodies ───────────────────────────────────────────────


class EdgeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

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


class MappingResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

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


class SuggestionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

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


class MappingListResponse(BaseModel):
    """Review §11.8: paginated list shape so callers can page through
    ≥10,000 mappings per tenant instead of receiving an unbounded array."""

    items: List[MappingResponse]
    total: int
    limit: int
    offset: int
    has_more: bool


class SuggestionListResponse(BaseModel):
    """Paginated shape for GET /mappings/{id}/suggestions (review §11.8)."""

    items: List[SuggestionResponse]
    total: int
    limit: int
    offset: int
    has_more: bool
