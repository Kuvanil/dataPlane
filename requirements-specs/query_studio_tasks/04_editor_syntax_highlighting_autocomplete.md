# Task #4 — SQL editor UI — syntax highlighting + autocomplete (QS-T4)

**TRD reference:** FR1, FR2, Usability NFR (§4–5).

**Current state:** No SQL editor UI exists in the frontend.

## Scope

Build the SQL editor workspace with syntax highlighting, schema-aware autocomplete sourced from Schema Intel, a connection selector, and SQL formatting capability.

### Frontend — Page/Route `/query-studio`

#### Editor component
- Integrate a SQL editor library (CodeMirror or Monaco).
- Syntax highlighting for SQL keywords, strings, numbers, comments.
- Schema-aware autocomplete: typing a table prefix suggests matching tables/columns from the selected connection's Schema Intel catalog.
- SQL formatting button that formats the current query.
- Line numbers, bracket matching, automatic indentation.

#### Connection selector
- Dropdown at the top populated from `GET /connectors`.
- Selecting a connection triggers a schema load for autocomplete data.
- Show connection health status indicator next to each option.

#### Toolbar
- **Run** button → calls `POST /query/execute`.
- **Format** button → formats SQL.
- **Clear** button → clears the editor.
- **Save** button → saves query (QS-T6).
- **Connection** dropdown.

#### Component architecture
```
pages/query-studio/
  page.tsx                    — Main Query Studio page
  components/
    SqlEditor.tsx             — SQL editor with CodeMirror/Monaco
    AutocompleteProvider.tsx  — Schema-aware autocomplete data loader
    ConnectionSelector.tsx    — Connection dropdown
    Toolbar.tsx               — Run, Format, Clear, Save buttons
```

### Dependencies
- **Schema Intel** — catalog API for autocomplete data.
- **Connectors** — `GET /connectors` for connection list.
- **CodeMirror or Monaco editor library** — add to package.json.

## Verify
- Editor renders with syntax highlighting.
- Autocomplete shows tables/columns from selected connection.
- Format button transforms SQL.
- Connection selector populates correctly.
- Run button calls execute endpoint.

## Risk
Low-Medium. Integration of third-party editor library is standard. Schema-aware autocomplete needs careful data loading to avoid performance issues.