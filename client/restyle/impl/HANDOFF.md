# JobApp — "Clean Professional" restyle + light/dark

This folder mirrors `client/src/`. Copy these files into your repo to apply the
new design system. No dependency or config changes are needed — it relies only
on Tailwind v4 features you already have (`@theme`, `@custom-variant`).

## Apply

**Replace** (same paths under `client/src/`):
- `index.css`
- `App.jsx`
- `components/ChatWindow.jsx`
- `components/StatusBar.jsx`
- `components/MessageInput.jsx`
- `components/StartModal.jsx`
- `components/GapInterviewModal.jsx`
- `components/WorkspaceInspector.jsx`
- `components/AgentTimeline.jsx`

**Add** (new file):
- `theme.js`

**Unchanged** — keep yours as-is: `main.jsx`, `App.css`, `hooks/useStream.js`,
`assets/*`, `index.html`. (Fonts load via `@import` at the top of `index.css`,
so no `<link>` edit is required.)

Then `npm run dev` as usual.

## How the theming works

`index.css` defines semantic CSS variables once:

- Light values in `:root`, dark values in `:root[data-theme="dark"]`.
- `@theme inline { … }` exposes each variable as a Tailwind utility
  (`bg-surface`, `text-fg`, `text-accent`, `bg-success`, `border-line`, …).
- Because the mapping is `inline`, the **same class resolves per-theme at
  runtime** — components never branch on theme.

`theme.js` exports `useTheme()`, which reflects the choice onto
`<html data-theme="dark">` and persists it to `localStorage` (`jobapp-theme`).
`App.jsx` renders the sun/moon toggle in the header.

## Token reference

| Utility                         | Light      | Dark       | Use                         |
|---------------------------------|------------|------------|-----------------------------|
| `bg-app`                        | `#fbfbfc`  | `#0e1116`  | page background             |
| `bg-chat`                       | `#f6f7f9`  | `#0e1116`  | chat scroll area            |
| `bg-surface`                    | `#ffffff`  | `#141922`  | header, input, panels       |
| `bg-surface-2`                  | `#ffffff`  | `#171d26`  | bubbles, cards              |
| `border-line` / `border-line-strong` | `#e6e8ed` / `#d5d9e0` | `#222a35` / `#2e3744` | borders |
| `text-fg` / `-secondary` / `-muted` / `-faint` | `#1b2230` … `#a3abb6` | `#e7ecf3` … `#525c6b` | text ramp |
| `text-accent` / `bg-accent` / `text-accent-fg` | `#2f5fd0` | `#5b8bf0` | single brand accent |
| `text-success` / `text-danger` / `text-warn` | `#1f9d57` / `#d24545` / `#b07512` | `#3ec77a` / `#ec6a6a` / `#e0a23a` | semantic states |

Opacity modifiers work (`bg-accent/10`, `border-danger/40`) via color-mix.

## Key design change in ChatWindow

The previous per-agent rainbow (19 colors) is gone. Messages now use **one
semantic vocabulary**:

- **neutral** (`border-l-line-strong`) — the assistant is talking
- **accent** (`border-l-accent`, "Needs your input" label) — action required
- **success** — a background step completed
- **danger** (`ring-danger`) — an error surfaced

This keeps the machinery hidden from the user (matching your StatusBar's
plain-language philosophy) instead of exposing 19 unlearnable colors.

## Note on verification

These files were verified at the token level against the real Tailwind v4
browser build (both themes compile and switch correctly). Full end-to-end
rendering happens in your Vite app — run `npm run dev` and click through the
states (New → Start, Files → Workspace, Timeline, the gap action) in both
themes to confirm.
