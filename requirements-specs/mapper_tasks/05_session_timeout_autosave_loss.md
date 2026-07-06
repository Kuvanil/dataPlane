# Task #5 — Unsaved transformation edits can be silently lost on session timeout

**TRD reference:** NFR §5 Reliability — "Draft autosave every 30 seconds and on blur; **no data
loss on session timeout**; published versions immutable; 99.9% module availability."

**Gap:** `frontend/src/app/dashboard/schema-mapper/hooks/useMapping.ts`'s autosave mechanism
queues transformation edits in a plain in-memory ref, `dirtyQueueRef` (line 86), flushed either
every 30 seconds (`AUTOSAVE_INTERVAL_MS`, line 29) or on `visibilitychange` (lines 118-120). This
queue is never persisted anywhere outside JS memory.

Separately, `frontend/src/lib/api.ts`'s `handle401()` (lines 16-20) reacts to *any* 401 response
(from *any* in-flight request, including a queued autosave flush) by immediately clearing the
auth token and hard-navigating the browser to `/login`:

```ts
function handle401() {
  if (typeof window !== "undefined") {
    localStorage.removeItem("dp_token");
    window.location.href = "/login";
  }
}
```

`window.location.href = ...` is a full page navigation — it discards the entire JS runtime,
including `dirtyQueueRef`'s contents, with no warning to the user and no attempt to flush pending
work first. If a user has been editing a transformation for close to (or beyond) the 30-second
autosave window when their session expires, the edit is gone with no indication anything was
lost — the user simply lands on the login page. This directly contradicts the literal NFR text
("no data loss on session timeout").

## Changes

### 1. `frontend/src/lib/api.ts`
- `handle401()` needs a way to attempt a best-effort flush before navigating away. The cleanest
  approach given the existing architecture: export a settable callback,
  `let onUnauthorized: (() => void) | null = null;` plus `export function
  setUnauthorizedHandler(fn: () => void) { onUnauthorized = fn; }`, and have `handle401()` call
  `onUnauthorized?.()` synchronously *before* clearing the token / navigating, so the hook layer
  (not the low-level API client) owns the actual flush-and-warn logic. Keep `handle401`'s
  existing token-clear + navigate behavior as the fallback if no handler is registered (e.g. on
  pages that don't use `useMapping`).

### 2. `frontend/src/app/dashboard/schema-mapper/hooks/useMapping.ts`
- On mount, call `setUnauthorizedHandler(...)` with a function that: (a) checks
  `dirtyQueueRef.current.length > 0`, and if so, (b) shows a blocking toast/message ("Your
  session expired with unsaved changes — please log back in; your last edit may not have saved")
  instead of silently redirecting, and (c) makes a best-effort synchronous flush attempt if the
  browser supports it (e.g. `navigator.sendBeacon` isn't a great fit here since these are
  authenticated PUT requests, not fire-and-forget beacons — realistically the honest fix is
  "warn clearly, don't pretend to save," not "guarantee the save," since a call that already
  401'd cannot be retried with the same expired token). Clean up the handler on unmount
  (`setUnauthorizedHandler(null)`).
- This changes the guarantee from "no data loss" (not actually achievable once auth has already
  expired — there's no valid token left to save with) to "no *silent* data loss" — the user is
  told what happened instead of being redirected with no explanation. Flag this distinction
  explicitly to whoever picks up this task: truly preventing data loss requires either (a)
  proactively refreshing the session before it expires (needs a refresh-token flow, which doesn't
  exist in this codebase today — `AuthService`/`get_current_user` appear to be a single
  long-lived JWT with no refresh endpoint, confirm before assuming this is in scope), or (b)
  persisting the dirty queue to `localStorage` so it survives a page reload and can be replayed
  after re-login. (b) is more achievable in this task's scope than (a); consider it if "warn
  clearly" isn't judged sufficient.

### 3. Tests
- No frontend test harness exists for hooks in this repo today (confirmed: `frontend` has no
  `*.test.ts`/`*.test.tsx` files under the schema-mapper directory). Manual verification: force
  a 401 (e.g. temporarily shorten the JWT expiry or manually corrupt the stored token) while a
  transformation edit is queued but not yet flushed, confirm the warning is shown instead of a
  silent redirect.

## Verify

```bash
cd frontend && npx tsc --noEmit && npm run build
```

Plus the manual 401-with-pending-edit walkthrough above.

## Risk

- This task can only honestly deliver "no *silent* data loss," not a hard guarantee of "no data
  loss" per the NFR's literal wording, without a refresh-token flow that doesn't exist elsewhere
  in this codebase. Recommend scoping this task to the warning behavior (achievable now) and
  filing the localStorage-persistence or refresh-token approach as a follow-up if the literal NFR
  guarantee is required rather than a best-effort warning.
- `handle401()` is used by every page in the app (`lib/api.ts` is shared, not schema-mapper-
  specific) — the optional-callback design is intentionally non-breaking for every other page
  that doesn't register a handler; verify no other page's login-redirect behavior changes.
