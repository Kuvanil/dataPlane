# Agentic DBA Copilot — Enhancements

## Open

1. Add a provisioned-database end-to-end acceptance run covering plan generation,
   approval, multi-object DDL application, collision migration, and generated draft
   mapping inspection. The current suite validates these at mocked/SQLite boundaries.
2. Resolve Task #11's shared tenant-isolation architecture decision before production
   sign-off. Plan list/read/reject surfaces intentionally inherit the repository-wide
   scoping gap documented by that task.
