# Bug 01: JDBC field definitions in task spec #3 don't match implementation

- **Severity:** Medium
- **File:** `backend/app/services/connector_catalog.py` lines 87-102 vs `requirements-specs/connector_tasks/03_connector_catalog_types.md`
- **Status:** Open

## Description

Task spec #3 defines the JDBC connector type with fields `url`, `driver_class`, `user`, `password`, `connection_properties` — but the actual implementation in `connector_catalog.py` only has `url` (marked secret) and `schema` (optional). The `driver_class`, `user`, `password`, and `connection_properties` fields are absent.

## Spec says (task #3 pages 77-96):
```python
"jdbc": ConnectorTypeMetadata(
    fields=[
        FieldDef(key="url", label="JDBC URL", ...),
        FieldDef(key="driver_class", label="Driver Class", ...),  # MISSING
        FieldDef(key="user", label="Username", ...),              # MISSING
        FieldDef(key="password", ...),                            # MISSING
        FieldDef(key="connection_properties", ...),               # MISSING
    ],
    secret_fields=["password", "connection_properties"],
)
```

## Code has (connector_catalog.py lines 87-102):
```python
"jdbc": ConnectorTypeMetadata(
    fields=[
        FieldDef(key="url", ...),  # secret=True
        FieldDef(key="schema", ...),  # optional
    ],
    secret_fields=["url"],
)
```

## Impact

- **Frontend forms:** The dynamic form for JDBC connections shows only `url` and `schema` — users will not see fields for `driver_class`, `user`, or `password`.
- **Connector instantiation mismatch:** The JDBCConnector class (`jdbc.py:22-25`) takes `url` and `schema` parameters — it embeds credentials inside the JDBC URL string itself (`postgresql://user:pass@host:port/db`). This design difference means the catalog fields don't match the connector's actual constructor.
- **Backward compatibility:** A frontend built from the spec would fail because it expects fields that don't exist.

## Impact Assessment

The existing design (single `url` field with embedded credentials) is arguably simpler than the spec's 5-field design — but the task spec and code are out of sync. Either the spec should be updated to document the single-URL design, or the code should implement the spec.

## Suggested Fix

Pick one direction:
1. **Update spec to match code:** Change task #3's JDBC entry to `url` (secret) + `schema` (optional) and note that credentials are embedded in the URL.
2. **Update code to match spec:** Add `driver_class`, `user`, `password`, `connection_properties` fields to the catalog and update `JDBCConnector.__init__` to accept them separately, constructing the URL internally.