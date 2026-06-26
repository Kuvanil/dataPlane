from sqlalchemy import Column, Integer, String, JSON, DateTime
from datetime import datetime
from app.core.database import Base

class DBConnection(Base):
    """
    Stores credentials or connection parameters for target databases.
    """
    __tablename__ = "connections"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True, nullable=False)
    type = Column(String, nullable=False) # 'postgres', 'sqlite', 'mysql', etc.
    config = Column(JSON, nullable=False) # {host, port, dbname, path, etc.}
    created_at = Column(DateTime, default=datetime.utcnow)
