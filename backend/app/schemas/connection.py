from pydantic import BaseModel
from typing import Dict, Any
from datetime import datetime

class ConnectionBase(BaseModel):
    name: str
    type: str
    config: Dict[str, Any]

class ConnectionCreate(ConnectionBase):
    pass

class ConnectionResponse(ConnectionBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True
