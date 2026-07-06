# Task #3 — Connector types catalog + dynamic form metadata (CONN-T5, catalog half)

**TRD reference:** FR1, §11 API: `GET /connectors/types`.

**Current state:** `backend/app/api/routers/connectors.py` has a hardcoded `VALID_TYPES = {"sqlite", "postgres", "mysql", "oracle", "jdbc"}` set used only for validation. There is no endpoint that returns these types with metadata. The frontend has no way to dynamically render connector configuration forms — a user must know the required fields for each type through external documentation.

## Scope

Build a `GET /connectors/types` endpoint that returns the full catalog of supported connector types with metadata, enabling a dynamic form UI on the frontend.

### Connector types catalog — `backend/app/services/connector_catalog.py` (new)

A static registry of supported connector types with their metadata:

```python
CONNECTOR_TYPES = {
    "postgres": ConnectorTypeMetadata(
        name="PostgreSQL",
        type="postgres",
        category="relational",
        icon="postgresql",      # icon identifier for frontend
        description="PostgreSQL relational database",
        fields=[
            FieldDef(key="host", label="Host", type="text", required=True, placeholder="localhost"),
            FieldDef(key="port", label="Port", type="number", required=True, default=5432),
            FieldDef(key="dbname", label="Database Name", type="text", required=True),
            FieldDef(key="user", label="Username", type="text", required=True),
            FieldDef(key="password", label="Password", type="password", required=True, secret=True),
            FieldDef(key="schema", label="Schema", type="text", required=False, default="public"),
            FieldDef(key="sslmode", label="SSL Mode", type="select", required=False,
                     options=["disable", "allow", "prefer", "require", "verify-ca", "verify-full"],
                     default="prefer"),
        ],
        secret_fields=["password"],
    ),
    "mysql": ConnectorTypeMetadata(
        name="MySQL",
        type="mysql",
        category="relational",
        icon="mysql",
        description="MySQL / MariaDB relational database",
        fields=[
            FieldDef(key="host", label="Host", type="text", required=True, placeholder="localhost"),
            FieldDef(key="port", label="Port", type="number", required=True, default=3306),
            FieldDef(key="dbname", label="Database Name", type="text", required=True),
            FieldDef(key="user", label="Username", type="text", required=True),
            FieldDef(key="password", label="Password", type="password", required=True, secret=True),
        ],
        secret_fields=["password"],
    ),
    "oracle": ConnectorTypeMetadata(
        name="Oracle",
        type="oracle",
        category="relational",
        icon="oracle",
        description="Oracle Database",
        fields=[
            FieldDef(key="host", label="Host", type="text", required=True),
            FieldDef(key="port", label="Port", type="number", required=True, default=1521),
            FieldDef(key="service_name", label="Service Name", type="text", required=True),
            FieldDef(key="user", label="Username", type="text", required=True),
            FieldDef(key="password", label="Password", type="password", required=True, secret=True),
        ],
        secret_fields=["password"],
    ),
    "sqlite": ConnectorTypeMetadata(
        name="SQLite",
        type="sqlite",
        category="file",
        icon="sqlite",
        description="SQLite file-based database",
        fields=[
            FieldDef(key="path", label="File Path", type="text", required=True, placeholder="/data/mydb.sqlite"),
        ],
        secret_fields=[],
    ),
    "jdbc": ConnectorTypeMetadata(
        name="Generic JDBC",
        type="jdbc",
        category="relational",
        icon="database",
        description="Generic JDBC-compliant database",
        fields=[
            FieldDef(key="url", label="JDBC URL", type="text", required=True,
                     placeholder="jdbc:postgresql://host:5432/db"),
            FieldDef(key="driver_class", label="Driver Class", type="text", required=True,
                     placeholder="org.postgresql.Driver"),
            FieldDef(key="user", label="Username", type="text", required=True),
            FieldDef(key="password", label="Password", type="password", required=True, secret=True),
            FieldDef(key="connection_properties", label="Connection Properties", type="textarea",
                     required=False, secret=True),
        ],
        secret_fields=["password", "connection_properties"],
    ),
}
```

### Schemas — `backend/app/schemas/connection.py`

**Corrected 2026-07-06:** use Pydantic `BaseModel`, not plain `@dataclass` — every other schema
file in this codebase (`schemas/mapping.py`, `schemas/schema_catalog.py`) uses Pydantic v2
(`ConfigDict(from_attributes=True)`, `Field(...)`), and these two types are meant to be used as a
FastAPI `response_model`, which is where that convention pays off (automatic validation, OpenAPI
schema generation, `Field(...)` constraints) rather than a bare dataclass:

```python
from pydantic import BaseModel, Field

class FieldDef(BaseModel):
    key: str
    label: str
    type: str                # "text", "number", "password", "select", "textarea", "boolean"
    required: bool = False
    default: Any = None
    placeholder: str = ""
    options: list[str] = Field(default_factory=list)  # for "select" type
    secret: bool = False     # if True, value is never returned on GET

class ConnectorTypeMetadata(BaseModel):
    name: str
    type: str
    category: str            # "relational", "file", "warehouse", "object_store"
    icon: str
    description: str
    fields: list[FieldDef]
    secret_fields: list[str]
```

### Router endpoint — `backend/app/api/routers/connectors.py`

```python
@router.get("/types", response_model=dict[str, ConnectorTypeMetadata])
def list_connector_types():
    """Return all supported connector types with metadata for dynamic form rendering."""
    return CONNECTOR_TYPES

@router.get("/types/{type}", response_model=ConnectorTypeMetadata)
def get_connector_type(type: str):
    """Return metadata for a single connector type."""
    if type not in CONNECTOR_TYPES:
        raise HTTPException(status_code=404, detail=f"Unknown connector type '{type}'")
    return CONNECTOR_TYPES[type]
```

### Validation integration

Update `POST /connectors/` to validate `config` fields against the type's `FieldDef` requirements:

- Required fields must be present (not None, not empty string).
- Unknown fields (not in `FieldDef`) should be silently stripped or rejected with a 422 warning (prefer stripping for forward-compatibility with new fields that the backend doesn't validate yet).
- Type validation for `number` fields (must be int/float).
- `select` fields must have a value from the allowed options list.

## Dependencies

- No task dependencies — this is self-contained.
- Task #2 references this catalog's `secret_fields` mapping.

## Edge cases

- **Future connector types:** The catalog is a single dict. Adding a new connector type is a one-entry addition. No code changes needed beyond the dict.
- **Frontend form generation:** The `FieldDef.type` values are designed to map 1:1 to HTML input types — `text` → `<input type="text">`, `password` → `<input type="password">`, `number` → `<input type="number">`, `select` → `<select>`, `textarea` → `<textarea>`, `boolean` → `<input type="checkbox">`. This lets the frontend render forms without any per-type logic.
- **Backwards compatibility:** The existing `VALID_TYPES` set is derived from `CONNECTOR_TYPES.keys()`. Remove the hardcoded set and use the catalog as the source of truth.
- **Field order matters:** The `fields` list preserves insertion order (Python 3.7+). The frontend should render fields in the order they appear.
- **JDBC is a catch-all:** Its fields are intentionally generic. The `driver_class` field lets users specify any JDBC driver. No per-vendor validation is possible at this level.

## Verify

```bash
cd backend && .venv/bin/pytest tests/connectors/ -v
```

- Test `GET /connectors/types` returns all 5 types with correct structure.
- Test `GET /connectors/types/postgres` returns Postgres metadata.
- Test `GET /connectors/types/fake` returns 404.
- Test that `POST /connectors/` with an unknown type returns 422 (derived from catalog, not hardcoded set).
- Test that `POST /connectors/` with missing required fields returns 422.
- Test that `POST /connectors/` with an unknown field in config strips it silently.

## Risk

Low. This is additive — no existing code is changed except removing the hardcoded `VALID_TYPES` set. The type metadata is static data, not a runtime system.