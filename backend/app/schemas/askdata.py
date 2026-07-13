from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class AskDataAskRequest(BaseModel):
    """One conversational NL-to-SQL turn (ADB-T1/T2/T3/T5)."""
    connection_id: int
    question: str = Field(..., min_length=1)
    session_id: Optional[str] = None


class AskDataAskResponse(BaseModel):
    session_id: str
    sql: Optional[str] = None
    grounded: bool = False
    confidence: int = 0
    method: str = "unknown"
    executed: bool = False
    columns: List[str] = Field(default_factory=list)
    rows: List[Dict[str, Any]] = Field(default_factory=list)
    row_count: int = 0
    masked_columns: List[str] = Field(default_factory=list)
    summary: Optional[str] = None
    warnings: List[str] = Field(default_factory=list)
    error: Optional[str] = None


class ChatMessageEntry(BaseModel):
    id: int
    role: str
    content: str
    connection_id: Optional[int] = None
    sql_text: Optional[str] = None
    row_count: Optional[int] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class SessionMessagesResponse(BaseModel):
    session_id: str
    messages: List[ChatMessageEntry]
