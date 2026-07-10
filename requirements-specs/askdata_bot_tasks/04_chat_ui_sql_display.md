# Task #4 — Chat UI + SQL display (ADB-T4)

**TRD reference:** FR1, FR3, FR8, Usability NFR (§4–5).

**Current state:** No chat UI exists for NL-to-SQL interaction. The frontend (`frontend/src/app/`) has no AskData-specific page or component. A sidebar module indicator (active/online) for AskData doesn't exist.

## Scope

Build the conversational chat interface that lets users type natural-language questions, see the generated SQL displayed in a code block, view results in a table, and interact with the response (edit in Query Studio, visualize). This is an entirely new frontend feature.

### Frontend — Chat Interface Components

#### Page/Route — `/askdata`

A full-page chat interface with:

1. **Message list** — Scrollable conversation view with user messages (NL questions) and bot responses (SQL + results). Each bot message shows:
   - Generated SQL in a syntax-highlighted code block with a copy button.
   - Natural-language summary text.
   - Result table (if executed), paginated for large results.
   - Action buttons: "Edit in Query Studio" → opens Query Studio with the SQL pre-loaded (task #6), "Visualize" → opens Visualize with the result set (task #6).
   - Timestamp.

2. **Input area** — Bottom-fixed text input with:
   - Multi-line textarea for questions.
   - Send button.
   - Loading state (spinner / "Thinking..." indicator) while the bot processes.
   - Disabled state when no connection is selected.

3. **Connection selector** — Dropdown at the top of the chat sidebar/header to select which connection to query. Populated from `GET /connectors`. The bot's questions scope to this connection's schema.

4. **Sidebar indicator** — In the app's main navigation sidebar, show an AskData icon with a status dot (green = online/service available, red/gray = service unavailable). This should be driven by a health-check call to the AskData backend.

5. **Suggested questions** — Below the input area (or as initial prompt), show a few contextual suggestions based on the selected connection's schema. Loaded from `POST /askdata/suggestions` or generated client-side from connection metadata.

### API Integration

- `POST /askdata/message` — Primary endpoint (task #3). The UI calls this with each user message.
- `GET /connectors` — Populate connection selector.
- `POST /askdata/suggestions` — Get suggested questions.
- `POST /askdata/{msgId}/to-query-studio` — Handoff to Query Studio (task #6).
- `POST /askdata/{msgId}/to-visualize` — Handoff to Visualize (task #6).

### Component architecture

```
pages/askdata/
  page.tsx                    — Main AskData page (/askdata)
  components/
    ChatView.tsx              — Scrollable message list
    MessageBubble.tsx         — Single message (user or bot)
    SqlBlock.tsx              — Syntax-highlighted SQL code block with copy
    ResultTable.tsx           — Paginated result table with column headers
    ChatInput.tsx             — Text input + send button
    ConnectionSelector.tsx    — Dropdown connection picker
    SuggestedQuestions.tsx    — Contextual question suggestions
    SidebarIndicator.tsx      — Status dot component for sidebar
```

### Dependencies

- **Task #1, #2, #3** — Backend APIs for NL-to-SQL, guardrails, and execution.
- **Task #6** — Handoff endpoints for Query Studio and Visualize (can be mocked initially).
- **Connection list** — Connectors API (`GET /connectors`) for the dropdown.

## Edge cases

- **Empty state** — Show welcome message and connection selector prompt when user hasn't asked anything yet.
- **Error state** — Display error messages from the backend clearly (e.g., "I couldn't understand that question. Could you rephrase?" "The database connection is unavailable.")
- **Loading state** — Show a typing indicator while waiting for the backend.
- **Long SQL** — SQL code block should be scrollable, not expand the message bubble indefinitely.
- **Large result sets** — Paginated result table with server-side or client-side pagination. Show "Showing 20 of 1,247 results" counter.
- **Connection switching** — When the user switches connections mid-conversation, clear the context and start fresh (or show a clear indicator of the switch).
- **Session timeout** — If the session expires, show a reconnect/message to the user.

## Verify

- Chat renders with connection selector and input.
- User types question → loading indicator → response with SQL + summary + result table.
- SQL code block renders with syntax highlighting and copy button.
- Result table paginates correctly.
- "Edit in Query Studio" button navigates to Query Studio with SQL pre-loaded.
- Sidebar indicator shows green status.
- Empty/loading/error states render correctly.
- Responsive layout works on different screen sizes.

## Risk

Low-Medium. This is a standard chat UI pattern. The main complexity is the rich rendering of SQL + result tables in each message. The connection selector and sidebar indicator are straightforward.