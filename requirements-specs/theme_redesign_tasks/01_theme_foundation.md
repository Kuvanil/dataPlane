# #01 — Theme Foundation

## Scope
Establish the Tailwind v4 CSS-variable theming system that every later chunk
(landing, login, dashboard chrome, dashboard sub-pages) depends on. Zero new
npm dependencies — the entire feature ships via `globals.css` plus a small
client-side `ThemeProvider`.

## Status
`[ ]` not started

## Files to change / add

| File | Action | Notes |
|---|---|---|
| `frontend/src/app/globals.css` | rewrite | Full token set: light defaults in `:root`, dark overrides in `.dark`, `@theme inline` mappings for all semantic colors. |
| `frontend/src/app/layout.tsx` | modify | Inline `<script>` in `<head>` sets `.dark`/`.light` on `<html>` from `localStorage` before paint. Wrap `{children}` in `<ThemeProvider>`. Add `suppressHydrationWarning`. |
| `frontend/src/lib/theme/ThemeProvider.tsx` | new | Client component; context with `{ theme, setTheme, toggle }`; syncs with `localStorage` and `<html>` class. Default = `dark`. |
| `frontend/src/lib/theme/ThemeToggle.tsx` | new | Client component; sun/moon icon button; reads/writes context. |
| `frontend/src/lib/theme/useTheme.ts` | new | Hook re-export of `useContext(ThemeContext)`. |
| `frontend/src/lib/theme/index.ts` | new | Barrel export. |
| `frontend/src/lib/theme/__tests__/ThemeProvider.test.tsx` | new | Vitest: class applied, localStorage round-trips, default is `dark`. |

## Design

### CSS tokens (Tailwind v4 `@theme inline`)

```css
@import "tailwindcss";

:root {
  /* Light defaults */
  --background: #ffffff;
  --surface: #f9fafb;        /* zinc-50 */
  --surface-elevated: #ffffff;
  --surface-overlay: #f4f4f5; /* zinc-100 */
  --fg: #18181b;              /* zinc-900 */
  --fg-muted: #3f3f46;        /* zinc-700 */
  --fg-subtle: #71717a;       /* zinc-500 */
  --border: #e4e4e7;          /* zinc-200 */
  --border-strong: #d4d4d8;   /* zinc-300 */
  --accent: #4f46e5;          /* indigo-600 */
  --accent-fg: #ffffff;
  --success: #10b981;
  --warning: #f59e0b;
  --danger: #ef4444;
}

.dark {
  --background: #09090b;      /* zinc-950 */
  --surface: #18181b;          /* zinc-900 */
  --surface-elevated: rgba(24,24,27,0.5);
  --surface-overlay: rgba(39,39,42,0.5);
  --fg: #fafafa;               /* zinc-50 */
  --fg-muted: #d4d4d8;         /* zinc-300 */
  --fg-subtle: #a1a1aa;        /* zinc-400 */
  --border: #27272a;           /* zinc-800 */
  --border-strong: #3f3f46;    /* zinc-700 */
  --accent: #818cf8;           /* indigo-400 (lighter for dark bg) */
  --accent-fg: #09090b;
}

@theme inline {
  --color-background: var(--background);
  --color-surface: var(--surface);
  --color-surface-elevated: var(--surface-elevated);
  --color-surface-overlay: var(--surface-overlay);
  --color-fg: var(--fg);
  --color-fg-muted: var(--fg-muted);
  --color-fg-subtle: var(--fg-subtle);
  --color-border: var(--border);
  --color-border-strong: var(--border-strong);
  --color-accent: var(--accent);
  --color-accent-fg: var(--accent-fg);
  --color-success: var(--success);
  --color-warning: var(--warning);
  --color-danger: var(--danger);
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
}

body {
  background: var(--background);
  color: var(--fg);
  font-family: var(--font-sans), Arial, Helvetica, sans-serif;
}
```

### Hydration-safe inline script

```tsx
// app/layout.tsx (excerpt)
const themeScript = `
  (function() {
    try {
      var t = localStorage.getItem('dp_theme');
      if (!t) t = 'dark';
      document.documentElement.classList.add(t);
    } catch (e) {}
  })();
`;

// in <head>:
<script dangerouslySetInnerHTML={{ __html: themeScript }} />
```

### ThemeProvider (client)

```tsx
"use client";
import { createContext, useCallback, useEffect, useState } from "react";

type Theme = "dark" | "light";
const ThemeContext = createContext<{
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
} | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Initial value comes from the class the inline script already set,
  // so the first React render matches the DOM and there's no hydration mismatch.
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof document === "undefined") return "dark";
    return document.documentElement.classList.contains("light") ? "light" : "dark";
  });

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    document.documentElement.classList.remove("dark", "light");
    document.documentElement.classList.add(t);
    try { localStorage.setItem("dp_theme", t); } catch {}
  }, []);

  const toggle = useCallback(() => setTheme(theme === "dark" ? "light" : "dark"), [theme, setTheme]);

  return <ThemeContext.Provider value={{ theme, setTheme, toggle }}>{children}</ThemeContext.Provider>;
}

export { ThemeContext };
```

### ThemeToggle

Simple `use client` button: `<button onClick={toggle} aria-label="Toggle theme">` with two SVGs (sun + moon) and conditional visibility based on `theme`.

## Acceptance

1. Toggling the button switches the `.dark`/`.light` class on `<html>` and persists across reload.
2. No hydration warning in browser console.
3. `npm run lint` reports zero new problems vs. baseline.
4. Vitest `ThemeProvider.test.tsx` passes:
   - default theme = `dark` when `localStorage` empty
   - applies `.dark` to `<html>`
   - `setTheme("light")` flips class and writes `localStorage`
   - `toggle()` alternates

## Verification commands

```bash
cd /Users/anilkumar/workspace/dataplane-main/frontend
npm run lint 2>&1 | tee /tmp/lint_chunk1.txt
npx vitest run src/lib/theme/__tests__/ThemeProvider.test.tsx
```

## Confidence
High — Tailwind v4 `@theme inline` is the documented pattern for custom tokens (already used in current `globals.css`); no breaking changes in Next 16 for the inline-script-in-head pattern.

## Progress log
_(filled in as work happens)_
