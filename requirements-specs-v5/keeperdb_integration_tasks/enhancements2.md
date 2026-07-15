# Keeper Secrets Manager Integration — Enhancements (second pass)

Second-pass findings, 2026-07-15. Robustness items surfaced during the deeper
validation review (correctness defects are in `bugs2.md`). The first pass's
open items in `enhancements.md` (live Keeper acceptance run; Task #10 tenant
isolation; pin the unbounded `ollama` dependency) still stand.

## Open

1. **AES key-rotation window can't actually be completed — no bulk re-encrypt
   path.** `SECRETS_ENCRYPTION_KEY_PREVIOUS` lets reads fall back to the old
   key, and `rotate()` re-encrypts with the current key — but re-encryption
   only happens as a side effect of an actual *credential* rotation. There is
   no "re-encrypt every row under the new key" operation. So after an admin
   rotates the AES key, any connection whose credentials are never rotated
   during the window stays encrypted under the old key; when the admin then
   removes `..._PREVIOUS` (the point of a rotation window), `_decrypt` can no
   longer find the encrypting key and every credential-dependent op on those
   connections fails permanently. Add an admin `POST /connectors/rekey-secrets`
   (analogous to `migrate-secrets`) that reads each row with whatever key
   works and re-writes it under the current key, so the window can be closed
   cleanly.

2. **Keeper backfill/create is non-idempotent on partial failure (orphaned
   external records).** `migrate_plaintext_secrets` performs an external,
   non-transactional `create_secret` per connection but defers the DB commit
   to the end of the loop with no per-row try/except. AES is unaffected (its
   row is in the same transaction and rolls back cleanly), but for the keeper
   backend a mid-loop failure (e.g. connection #50 while Keeper blips) rolls
   back the DB `secrets_ref`/`config` changes for #1–49 while the 49 Keeper
   records already created remain — so a re-run creates 49 *new* records and
   orphaned duplicates accumulate on every retry. Make the keeper backfill
   commit per row (or record created refs so a re-run reuses/cleans them), so
   idempotency holds for keeper as it already does for aes256.
