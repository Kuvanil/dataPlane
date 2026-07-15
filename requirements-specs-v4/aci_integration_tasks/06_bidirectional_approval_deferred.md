# Task #6 — Bidirectional "approve from Slack/Jira" (inbound webhook)

**Status: `[?]` open — deferred, not built in this epic.** Reference: TRD §3 Out-of-Scope, §11
Risks; INDEX.md design decision #1.

## Why this is its own gated task, not a fast-follow on Task #5

Notify-out (Task #5) is one-directional: dataPlane → external tool. Approving *from* the external
tool requires the reverse: external tool → dataPlane, which means:

1. **An inbound webhook endpoint** dataPlane must expose and secure (signature/HMAC verification
   against Slack's/Jira's signing secret — get this wrong and anyone who finds the URL could forge
   approval events).
2. **Identity mapping** — when a Slack user clicks "Approve," dataPlane needs to know *which*
   dataPlane user/role that maps to, and whether that person is actually authorized to approve
   *this* recommendation/plan. A Slack workspace membership is not a dataPlane role; conflating
   them would silently weaken the exact approval-gating this whole platform (DDL execution, mapping
   publish, Autopilot recommendations) has been built to enforce.
3. **Replay/idempotency** — a duplicated or replayed webhook event must not double-execute an
   approval.

This is real, dedicated security design work — not a natural continuation of Task #5's "post a
message" plumbing — and this epic explicitly does not build it.

## What to do instead, for now

- Task #5's notification links back to dataPlane's own existing, already-authenticated approval UI
  — the approver clicks through and approves inside dataPlane, using dataPlane's own auth/role
  check, unchanged. This gets 90% of the UX benefit (no dashboard-polling) without the inbound-
  webhook security surface.
- If/when this task is picked up: design the identity-mapping model explicitly (e.g. a dataPlane
  admin pre-links their Slack user ID to their dataPlane account, and only pre-linked identities
  can trigger an approval webhook — never trust the webhook payload's claimed identity alone),
  require webhook signature verification from day one, and treat this as security-sensitive per
  `SKILLS.md` §6 — get explicit human sign-off before landing, don't auto-implement.

## Verify

N/A — not built in this epic. "Done" for this task file is documenting the deferral and the
identity-mapping design constraint clearly enough that a future implementer doesn't skip it.

## Risk

- The temptation to "just also wire up the approve button" once Task #5's notification exists will
  be real — resist it without the identity-mapping design above resolved first.
