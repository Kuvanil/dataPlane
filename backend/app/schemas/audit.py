from pydantic import BaseModel
from typing import Any, Dict, Optional
from datetime import datetime


class AuditEventCreate(BaseModel):
    event_type: str
    actor: str = "system"
    connection_id: Optional[int] = None
    connection_name: Optional[str] = None
    payload: Optional[Dict[str, Any]] = None
    status: str = "success"
    duration_ms: Optional[int] = None


class AuditEventResponse(BaseModel):
    id: int
    event_type: str
    actor: str
    connection_id: Optional[int]
    connection_name: Optional[str]
    payload: Optional[Dict[str, Any]]
    status: str
    duration_ms: Optional[int]
    created_at: datetime

    model_config = {"from_attributes": True}
