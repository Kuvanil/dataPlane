# Data Platform Rules

## Data Handling
- Always validate schema
- Track lineage
- Ensure idempotency

## Pipelines
- Must be retryable
- Must log every stage

## Storage
- Use PostgreSQL or data warehouse
- Separate OLTP vs analytical workloads

## Security
- Mask sensitive data
- Implement RBAC if needed
``