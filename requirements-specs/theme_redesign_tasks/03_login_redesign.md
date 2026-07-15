# #03 — Login Page Redesign

## Scope
Rewrite `frontend/src/app/login/page.tsx` with a two-column layout,
polished copy, CDN imagery, full semantic-token migration, and a
ThemeToggle. Preserve the `mapper_tasks #5` flag-bearer comment block
verbatim.

## Status
`[x]` completed (2026-07-14)

## What changed
- **Two-column layout at md+** — left aside is a blue→indigo→violet
  gradient panel with brand mark, value-prop headline, descriptive copy,
  Unsplash illustration, and three trust marks (SOC 2 ready / Private
  inference / Audit trail). Right column is the form card.
- **Single-column on mobile** — left aside is `hidden md:flex`; the form
  column centers and includes a mobile-only brand mark.
- **Top bar** — "← Back to home" link on the left, `<ThemeToggle />` on the
  right.
- **Banners** — session-expired (amber) and error (red) banners now use
  light/dark-aware color tokens:
  - Light: `text-amber-700` / `text-red-700` on `bg-*-500/10`
  - Dark: `text-amber-400` / `text-red-400` on the same soft background
- **Form inputs** — `bg-surface-elevated` / `border-border` /
  `placeholder:text-fg-subtle` / `focus:border-accent` — all theme-aware.
- **"Don't have an account?"** — apostrophe escaped with `&apos;` to keep
  `react/no-unescaped-entities` clean.

## Preserved (must not regress)
- The `dp_session_expired_with_pending` localStorage flag hydration
  logic and its explanatory comment block — durable signal that
  survives a 401 redirect with unsaved edits queued. The comment is
  verbatim from the pre-redesign page.

## Migration
- All `bg-zinc-*` / `text-zinc-*` / `border-zinc-*` classes replaced with
  semantic tokens. `grep -c "zinc-" src/app/login/page.tsx` → 0 after
  the rewrite.

## Acceptance
- ✅ Form usable at 360px width (single column, no overflow).
- ✅ ThemeToggle present and functional.
- ✅ No `zinc-*` classes remain.
- ✅ mapper_tasks #5 comment block intact.
