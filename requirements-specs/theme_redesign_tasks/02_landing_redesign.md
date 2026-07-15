# #02 — Landing Page Redesign

## Scope
Rewrite `frontend/src/app/page.tsx` with improved copy, expanded layout
sections, CDN imagery, and full migration to semantic theme tokens.

## Status
`[x]` completed (2026-07-14)

## What changed
- **Navbar** — added `<ThemeToggle />` on the right, kept auth CTAs.
- **Hero** — new headline stays ("Intelligent Data Engineering, On Autopilot"),
  subtitle rewritten to a clear value-prop mentioning PII + local inference.
  Two-column hero at md+ with a real Unsplash dashboard photo on the right
  and a live-sync indicator badge floating over the corner.
- **Logo cloud** — new section. Six inline-SVG geometric marks (zero asset
  weight, always render) styled as social proof.
- **Features grid** — six capability cards, rewritten descriptions (no more
  "SLM mode proposed SQL setups simulations" / "CloudWAREHOUSE cloud to
  on-prem JDBC NoSQL secure integration gateways" word salad).
- **How it works** — new section. Three numbered steps (Connect → Map → Run)
  with gradient circle markers.
- **Solutions** — new section. Three cards (Regulated Industries, Data
  Modernization, Self-Service Analytics) with Unsplash thumbnails using
  `mix-blend-overlay` for a soft gradient wash.
- **CTA banner** — new section. Full-width indigo gradient with floating
  blur highlights and dual CTA (start free / talk to sales).
- **Footer** — expanded from one-line copyright to 4-column link groups
  (Product / Solutions / Resources / Company) with a bottom bar for legal
  links.

## Migration
- Every `bg-zinc-*` / `text-zinc-*` / `border-zinc-*` class was replaced
  with the semantic token from `globals.css`. `grep -c "zinc-" src/app/page.tsx`
  → 0 after the rewrite.
- Status accents (blue, violet, emerald) kept as raw Tailwind classes.

## Responsive
- Verified at 360 / 768 / 1280 / 1920 by Tailwind utility usage:
  - Hero: stacked single-column below `md`, two-column at `md+`.
  - Logo cloud: 3 cols on mobile, 6 cols at `sm+`.
  - Features: 1 col on mobile, 2 at `md`, 3 at `lg`.
  - Solutions: 1 col on mobile, 3 at `md`.
  - Footer: 2 cols on mobile, 5 at `md`.

## Acceptance
- ✅ Renders cleanly in both themes (dark + light) at all breakpoints.
- ✅ Copy is grammatical and value-prop-driven.
- ✅ Zero `zinc-*` classes remain.
