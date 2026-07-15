# Theme & Static Content Redesign — Task Index

> Source: user request 2026-07-14 — redesign the static content on `/` and `/login`,
> rewrite copy, improve layout, add CDN imagery, and add a site-wide dark + light theme
> system using Tailwind v4 CSS variables (no new dependencies). Theme is migrated across
> every page in `frontend/src/app/` that currently hardcodes `zinc-*` color classes.

## Status legend
- `[ ]` not started · `[~]` in progress · `[x] completed` · `[!]` blocked · `[?]` needs human input

## Task list

| # | Severity | Area | Status | Title |
|---|---|---|---|---|
| [01](01_theme_foundation.md) | HIGH | infra | `[ ]` | Build Tailwind v4 CSS-variable theme system: tokens, ThemeProvider, ThemeToggle |
| [02](02_landing_redesign.md) | HIGH | `/` | `[ ]` | Redesign landing page (hero, features, how-it-works, solutions, CTA, footer) |
| [03](03_login_redesign.md) | MEDIUM | `/login` | `[ ]` | Redesign login page (two-column, copy, banners, ThemeToggle) |
| [04](04_dashboard_layout.md) | HIGH | `/dashboard/*` | `[ ]` | Migrate dashboard chrome (layout, sidebar, header) to semantic tokens |
| [05](05_dashboard_subpages.md) | HIGH | `/dashboard/*` | `[ ]` | Bulk-migrate all dashboard sub-page files to semantic tokens (no data-wiring changes) |
| [06](06_verification_docs.md) | HIGH | meta | `[ ]` | Run full pipeline (build / lint / test / tsc), update README + PROGRESS.md |

## Execution order

1. **#1** Theme foundation — every later chunk depends on the token names + provider being stable.
2. **#4** Dashboard layout migration — proves the tokens work on the most-changed surface (sidebar/header) before bulk migration.
3. **#2** + **#3** Static-page redesigns — independent of each other; can run in parallel.
4. **#5** Bulk sub-page migration — biggest blast radius; run after the dashboard chrome is proven.
5. **#6** Verification — run after every other chunk lands.

## Dependencies

- **#1** has no frontend deps. Backend is untouched throughout.
- **#2, #3, #4, #5** all depend on **#1** (the token names + provider must be stable).
- **#5** depends on **#4** so the dashboard chrome is already on tokens before sub-pages.
- **#6** depends on all of the above.

## Non-negotiables

- **No new npm dependencies.** Use Tailwind v4 native `@theme inline` + a tiny client-side `ThemeProvider`.
- **Default theme = dark.** Existing users must not see a jarring flip on next visit.
- **Persistence = `localStorage` key `dp_theme`.** No server work needed.
- **Hydration safety:** inline `<script>` in `<head>` sets the `.dark`/`.light` class before React paints. `suppressHydrationWarning` on `<html>`.
- **No mock/placeholder UI.** Same rule the repo enforces per `dashboard_static_ui_tasks/INDEX.md`.
- **Data wiring is sacred.** Functional behaviour delivered by prior task chunks (`dashboard_static_ui_tasks`, `mapper_tasks`, `security_tasks`, etc.) must not regress. Only class names change in the migration chunks.

## Token map (Chunk 1 — for downstream chunks to reference)

| Old class (zinc) | New class (semantic) | Purpose |
|---|---|---|
| `bg-zinc-950` | `bg-background` | Page background |
| `bg-zinc-900` | `bg-surface` | Card / panel background |
| `bg-zinc-900/50`, `bg-zinc-900/30` | `bg-surface-elevated` | Card on tinted background |
| `bg-zinc-800/50`, `bg-zinc-800/30` | `bg-surface-overlay` | Row hover, inset chips |
| `text-zinc-50`, `text-zinc-100` | `text-fg` | Primary text |
| `text-zinc-200`, `text-zinc-300` | `text-fg-muted` | Secondary text |
| `text-zinc-400`, `text-zinc-500` | `text-fg-subtle` | Tertiary text / placeholders |
| `border-zinc-800`, `border-zinc-900` | `border-border` | Default border |
| `border-zinc-700` | `border-border-strong` | Emphasised border |

Status / accent colors (`blue-*`, `emerald-*`, `red-*`, `amber-*`, etc.) are **not** migrated — they already carry semantic meaning (info / success / danger / warning) and read in both themes.

## Progress log

- 2026-07-14 — Plan approved. 6 tasks filed.
