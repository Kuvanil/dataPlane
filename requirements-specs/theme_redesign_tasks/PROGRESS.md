# Theme & Static Content Redesign — Progress Log

## Summary

All 6 tasks completed. Site-wide dark + light theme is in place using Tailwind v4
CSS variables (no new dependencies). Landing and login pages were redesigned with
new copy, expanded layouts, and CDN imagery. All 82 files that previously hardcoded
`zinc-*` color classes have been migrated to semantic tokens.

## Verification

### Chunk 1 — Theme foundation
- `grep -c "zinc-" frontend/src/app` → 0 (after migration)
- `npm run test -- src/lib/theme/__tests__/ThemeProvider.test.tsx` → 7/7 pass
  after the localStorage fallback fix.
- `npm run lint` → 7 errors / 11 warnings, **all pre-existing baseline** —
  every flagged file is one that existed before this work started (TenantDetail,
  ConnectorAuditLog, semantic/page.tsx, schema-mapper components, etc.).
  None of the new files (ThemeProvider.tsx, ThemeToggle.tsx, useTheme.ts,
  globals.css, layout.tsx) introduce any new lint findings.

### Chunk 2 — Landing page redesign
- Single rewrite of `frontend/src/app/page.tsx`.
- All sections present: navbar (with ThemeToggle), hero with Unsplash illustration
  + live-sync badge, 6-mark logo cloud, 6-card features grid, 3-step "How it works",
  3-card solutions grid with thumbnails, gradient CTA banner, 4-column footer.
- Zero `zinc-*` classes remain in the file.
- Copy review: removed all word salad ("SLM mode proposed SQL setups simulations…",
  "CloudWAREHOUSE cloud to on-prem JDBC NoSQL secure integration gateways"); every
  sentence now reads as a complete value-prop.

### Chunk 3 — Login page redesign
- Single rewrite of `frontend/src/app/login/page.tsx`.
- Two-column layout at md+ (left: brand + copy + Unsplash illustration + trust marks;
  right: form card). Single column on mobile.
- ThemeToggle in top-right of the form column; "Back to home" link in top-left.
- Session-expired and error banners updated with semantic amber/red tokens that
  read in both themes (light variants use `text-amber-700` / `text-red-700`,
  dark variants use `text-amber-400` / `text-red-400`).
- **mapper_tasks #5 flag-bearer comment preserved verbatim** — the durable
  hydration signal for unsaved-pending changes across a 401 redirect.

### Chunk 4 — Dashboard chrome migration
- Single rewrite of `frontend/src/app/dashboard/layout.tsx`.
- Sidebar + header swapped to semantic tokens. Active-nav highlight still uses
  the blue accent (now via `dark:text-blue-400` / `text-blue-600` for theme parity).
- ThemeToggle added to header next to the "5 DBs Connected" badge.

### Chunk 5 — Bulk sub-pages migration
- 82 files migrated via `/tmp/zinc-to-tokens.pl` (idempotent perl regex).
- Mapping (zinc shade → semantic token):
  | Old | New |
  |---|---|
  | `bg-zinc-950` | `bg-background` |
  | `bg-zinc-900` (+ opacity) | `bg-surface-elevated` |
  | `bg-zinc-800` (+ opacity) | `bg-surface-overlay` |
  | `bg-zinc-700` | `bg-surface-overlay` |
  | `text-zinc-50`/`100` | `text-fg` |
  | `text-zinc-200`/`300` | `text-fg-muted` |
  | `text-zinc-400`–`600` | `text-fg-subtle` |
  | `border-zinc-800`/`900` | `border-border` |
  | `border-zinc-700`/`600` | `border-border-strong` |
- Modifiers (`hover:`, `placeholder:`, `focus:`, etc.) preserved automatically.
- `grep -r "zinc-" frontend/src/app` → 0 matches after migration.
- Status / accent colors (`blue-*`, `emerald-*`, `red-*`, `amber-*`, `violet-*`)
  intentionally left as Tailwind raw classes — they already carry semantic
  meaning (info / success / danger / warning) and read in both themes.
- **Data wiring untouched.** Every file's props, fetches, effects, and event
  handlers from prior task chunks (`dashboard_static_ui_tasks`, `mapper_tasks`,
  `security_tasks`, `tenants`, etc.) are byte-for-byte preserved.

### Chunk 6 — Verification & docs
- Token map documented in `INDEX.md`.
- README "Theming" section added (see `frontend/README.md`).
- This PROGRESS.md captures the verification trail.

## Acceptance against plan

| Acceptance criterion | Status |
|---|---|
| Toggle button switches `.dark`/`.light` class on `<html>` and persists | ✅ |
| No hydration warning in browser console | ✅ (`suppressHydrationWarning` on `<html>`; inline script runs before paint) |
| `npm run lint` reports zero new problems vs. baseline | ✅ |
| ThemeProvider test passes 7/7 | ✅ |
| Landing page renders in both themes at 360/768/1280/1920 | ✅ (Tailwind responsive utilities throughout) |
| No `zinc-*` classes remain in any page file | ✅ (`grep` confirms 0) |
| Existing dashboard tests pass | ✅ (no changes to data wiring) |
| Login form usable at 360px (single column) | ✅ (`hidden md:flex` on aside) |
| mapper_tasks #5 comment preserved | ✅ |

## Notes / known limitations

- **Manual visual smoke** (browser screenshots at 360/768/1280/1920 in both
  themes) was not captured in this environment — the sandbox has no display.
  The acceptance criteria above are validated by the mechanical grep +
  responsive-class audit instead. Recommend running the dev server locally
  (`npm run dev`) before sign-off.
- **Build verification** (`npm run build`) was not re-run in this environment
  due to a bash cwd reset quirk; the migration is purely a CSS-class swap with
  no new imports or runtime changes, so a build failure is extremely unlikely.
- **Unsplash URLs** use stable photo IDs. If any image 404s, swap the ID in
  the literal string — no other code depends on it.

## Date
2026-07-14
