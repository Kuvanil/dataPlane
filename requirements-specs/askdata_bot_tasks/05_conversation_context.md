# Task #5 — Conversation context handling (ADB-T5)

**TRD reference:** FR8 (§4).

**Current state:** `ChatMessage` model exists in `backend/app/models/chat_session.py` with `id`, `session_id`, `role`, `content`, `created_at`. The existing `AskDataService.chat()` loads history from DB, appends messages, bounds history to 20 messages, and persists to DB. However, this context is for the general DB intelligence chat — not for NL-to-SQL sessions. There is no connection-scoped context, no schema context management across turns, and no context window management optimized for NL-to-SQL follow-ups.

## Scope

Build session-scoped conversation context management optimized for the NL-to-SQL use case: track which connection is being queried, maintain relevant schema context across turns, manage the LLM context window, and allow follow-up questions to inherit context from previous turns.

### Data model — extend ChatMessage

Add to `ChatMessage` model or create `AskDataSession`:

```python
class AskDataSession(Base):
    """Tracks NL-to-SQL chat session state."""
    __tablename__ = "askdata_sessions"
    
    id = Column(Integer, primary_key=True)
    session_id = Column(String, unique=True, index=True, nullable=False)
    connection_id = Column(Integer, ForeignKey("connections.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, onupdate=datetime.utcnow)
    metadata = Column(JSON, nullable=True)  # Schema summary, resolved context, etc.
```

Extend `ChatMessage` with connection_id field if needed, or derive it from the session.

### Context management

1. **Session initialization** — When a user starts a session with a connection selected, store the `connection_id` on the session. All subsequent questions in that session default to the same connection.

2. **Schema context snapshot** — At session start (or when connection is selected), take a "context snapshot" of the Schema Intel catalog for that connection. Cache it and re-use for follow-up questions. Only refresh when:
   - The user explicitly requests a refresh.
   - A configurable TTL expires (e.g., 5 minutes).
   - Schema drift is detected (integration with Schema Intel drift detection).

3. **Context window management** — LLM context windows have limits. Implement a strategy:
   - Always include the current question and the schema context snapshot.
   - Include the last N exchanges (configurable, default 5) of Q&A history.
   - Truncate older exchanges, keeping only the SQL + summary (not full result tables).
   - Use a token counter to ensure the full prompt fits within the model's context window.

4. **Follow-up resolution** — Follow-up questions like "how about last quarter?" or "what about Europe?" need to refer back to the previous question's context. The prompt should include:
   - The previous user message and generated SQL.
   - The current user message.
   - Instructions: "Infer missing context (table names, time periods, filters) from the previous exchange."

5. **Session cleanup** — Sessions should have a configurable TTL (default 24 hours). Old sessions should be cleaned up by a background task.

### Service — `backend/app/services/askdata_context.py` (new)

```python
class AskDataContextManager:
    """Manages conversation context for NL-to-SQL sessions."""
    
    @classmethod
    def get_or_create_session(cls, session_id: str, connection_id: int, db: Session) -> AskDataSession:
        """Get existing session or create new one with connection context."""
    
    @classmethod
    def get_context_prompt(cls, session_id: str, current_question: str, db: Session) -> str:
        """Build the context prompt for the LLM including schema, history, and current question."""
    
    @classmethod
    def persist_exchange(cls, session_id: str, question: str, response: dict, db: Session) -> None:
        """Save the Q&A exchange to the session history."""
    
    @classmethod
    def clear_session(cls, session_id: str, db: Session) -> None:
        """Clear session state and message history."""
    
    @classmethod
    def cleanup_stale_sessions(cls, db: Session, ttl_hours: int = 24) -> int:
        """Remove sessions older than TTL."""
```

### Dependencies

- **ChatMessage model** — already exists, can be reused or extended.
- **Schema Intel** — catalog retrieval for context snapshots.
- **Task #1** — the generation pipeline consumes context from this service.
- **Task #3** — the execution pipeline saves results to context.

## Edge cases

- **Empty session history** — First question in a session gets only schema context, no history.
- **Connection switch mid-session** — Clear the session's connection context, re-prompt for connection or start fresh.
- **Context window overflow** — Gracefully truncate oldest history, not the schema context.
- **Orphaned sessions** — Cleanup task removes sessions with no activity beyond TTL.
- **Concurrent sessions** — Same user can have multiple sessions (e.g., querying different connections in different tabs).

## Verify

```bash
cd backend && .venv/bin/pytest tests/askdata/ -v -k "context"
```

- Test session creation and retrieval with connection_id.
- Test context prompt includes schema snapshot + history + current question.
- Test follow-up question resolves context from previous exchange.
- Test context window truncation when token limit is exceeded.
- Test session cleanup removes sessions beyond TTL.
- Test connection switch clears context.

## Risk

Low. This is a well-understood pattern for conversational AI context management. The main decisions are around token budget allocation (how much for schema vs. history vs. current question) and TTL values.