# Keeper Secrets Manager Integration — Enhancements

## Open

1. Complete the Task #11 live Keeper acceptance run against a real Keeper tenant:
   one-time-token bootstrap, record create, partial rotate, retrieve, and delete.
2. Resolve Task #10 tenant isolation before production sign-off; vault references and
   Keeper owner/folder selection currently follow the repository-wide unscoped model.
3. Pin the newly unbounded `ollama` dependency to a tested compatible release. The
   current `backend/requirements.txt` change from `ollama==0.1.7` to `ollama` weakens
   reproducible builds even though it is not required by the vault feature itself.
