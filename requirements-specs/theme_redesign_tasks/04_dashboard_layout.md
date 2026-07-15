# #04 — Dashboard Layout Migration

## Scope
Migrate `frontend/src/app/dashboard/layout.tsx` (sidebar + sticky header
that wrap every `/dashboard/*` route) to semantic theme tokens and add a
`<ThemeToggle />` to the header.

## Status
`[x]` completed (2026-07-14)

## What changed
- **Page background**: `bg-zinc-950` → `bg-background`.
- **Sidebar panel**: `bg-zinc-900/50` → `bg-surface-elevated`;
  `border-zinc-800` → `border-border`.
- **Brand block**: `text-zinc-400` → `text-fg-muted` (subtitle).
- **Nav items**:
  - Inactive: `text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200` →
    `text-fg-muted hover:bg-surface-overlay hover:text-fg`.
  - Active: `bg-blue-600/10 text-blue-400 border-blue-500/20` →
    `bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30`.
- **Footer (sidebar)**: `bg-emerald-400` pulse + `text-zinc-400` for
  "Admin Session" label, hover styles for log-out button.
- **Header**: `bg-zinc-900/20 backdrop-blur-md` →
  `bg-surface-overlay backdrop-blur-md`. Border and text colors migrated.
- **"5 DBs Connected" badge** kept emerald (status accent stays raw).
- **ThemeToggle** added to header next to the badge; the badge hides on
  small screens (`hidden sm:flex`) to keep the header compact.

## What did NOT change
- Menu items array (13 entries, including the new `integrations` route).
- Routing, navigation logic, log-out handler.
- Layout structure (aside + main, h-screen overflow-hidden).
- Emojis used as icons.

## Acceptance
- ✅ Sidebar renders correctly in both themes.
- ✅ Active nav item clearly highlighted (blue accent in both themes).
- ✅ Header sticky + blurred in both themes.
- ✅ ThemeToggle present.
