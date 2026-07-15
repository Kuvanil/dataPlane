# ACI External Tools Integration — Enhancements

## Open

1. Run the Task #11 live outage/recovery walkthrough against a provisioned ACI tenant
   and linked Slack account, including a real notification delivery and audit check.
2. Add an operator-facing integration health probe/metric for circuit state and recent
   delivery failures; today the UI degrades clearly and Audit Trail records failures,
   but operators must inspect those surfaces manually.
3. Resolve Task #10 tenant isolation before production sign-off, especially the shared
   linked-account owner configuration.
