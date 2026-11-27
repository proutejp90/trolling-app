# Meridian

Meridian is a design system for fast, dense, keyboard-first productivity software: issue trackers, CRMs, engagement trackers, internal tools and admin dashboards. It takes after the calm, precise style that Linear made the standard: dark by default, one accent hue, hairline borders instead of shadows, small type, and every action reachable from the keyboard.

This file is the spec. It is written so a coding agent (Claude Code) can build a product UI from it without guessing. Read it top to bottom once, then use `tokens.json` for exact values and each `components/<Name>/README.md` for component rules. The **Implementation** section holds the CSS variable setup, a Tailwind mapping and a ready-made `CLAUDE.md` block.

## Principles

1. **Speed is the feature.** Interactions respond in under 100ms. Optimistic updates everywhere; never block the UI on a network round trip for a toggle, status change or reorder.
2. **Quiet by default.** Neutral greys carry 95% of the interface. The `accent` hue marks the one thing that matters on a screen: the primary action, the selection, the focus. Status colours appear only as small icons and badges.
3. **Density with air.** Rows are 36px, text is 13px, but spacing stays on the 4px grid and alignment is exact. Dense never means cramped.
4. **Keyboard first, mouse friendly.** Every action has a shortcut, a command-palette entry, or both. Focus is always visible.
5. **Structure through lines and tone.** Separate regions with 1px `border-subtle` hairlines and one-step surface changes. Shadows only on things that float (menus, modals).
6. **Content over chrome.** No decorative illustration, gradients or emoji inside the product. Icons are functional and monochrome.

## Content and voice

- Sentence case everywhere: buttons, menus, headers, labels ("Create issue", not "Create Issue").
- Verbs first on actions: "Assign to me", "Copy link", "Move to backlog".
- Short and literal. No exclamation marks, no "Oops!", no marketing language in the app.
- Empty states say what the view is for and give one action: "No issues in this view. Press C to create one."
- Errors say what happened and what to do: "Couldn't save. Check your connection and try again."
- Numbers and IDs use tabular figures (`font-variant-numeric: tabular-nums`). IDs look like `ENG-142`.

## Color

Dark is the primary theme (`data-theme="dark"`); light mirrors it token for token (`data-theme="light"`). Build with the semantic tokens only. Never put a hex value in component code.

| Layer | Token | Use |
|---|---|---|
| Canvas | `surface-0` | Main content area |
| Shell | `surface-1` | Sidebar, top bar, side panel |
| Raised | `surface-2` | Inputs, cards, menus, modals |
| Hover | `surface-3` | Row, nav and ghost-button hover |
| Pressed | `surface-4` | Active/pressed fills |

- Text: `text-primary` for content, `text-secondary` for supporting copy, `text-tertiary` for IDs, timestamps and placeholders, `text-disabled` only for disabled controls.
- Borders: `border-subtle` between rows and regions, `border` around controls, `border-strong` on hover and for checkboxes.
- Accent: `accent` fills (primary button, checked checkbox), `accent-text` for links and the active nav label, `accent-soft` behind selected rows and the active nav item. Text on an accent fill is always `on-accent`.
- Status: `success` (done), `info` (in progress), `warning` (in review / at risk), `danger` (urgent, overdue, destructive). Each has a `-soft` background for badges and banners. Status is never conveyed by colour alone: pair it with an icon shape or a word.
- Contrast: all text tokens pass 4.5:1 on `surface-0` to `surface-2` in both themes; `focus` and `border-strong` pass 3:1.

## Typography

One family, **Inter** (load from Google Fonts with weights 400, 500, 600), plus **JetBrains Mono** for code and shortcuts. Enable Inter's `cv11`, `ss01` and tabular numbers where numbers line up.

| Style | Size / line | Weight | Use |
|---|---|---|---|
| `title-1` | 24 / 32 | 600 | Page and issue titles |
| `title-2` | 18 / 26 | 600 | Settings sections, modal titles |
| `title-3` | 15 / 22 | 600 | Card and panel headers |
| `body` | 14 / 22 | 400 | Descriptions, comments |
| `ui` | 13 / 20 | 500 | **Default app text**: rows, buttons, nav, inputs |
| `small` | 12 / 16 | 500 | Badges, IDs, timestamps |
| `micro` | 11 / 14 | 500 | Sidebar section labels, table headers |
| `mono` | 12 / 18 | 400 | Code, branch names, kbd |

Never go below 11px. Never use weight 700. Headings tighten letter-spacing slightly (`-0.01em` to `-0.02em`); body text keeps the default.

## Spacing, radius, sizing

- **4px grid.** Use only `space-*` tokens: 2, 4, 8, 12, 16, 20, 24, 32, 48px.
- **Radius** grows with the element: `radius-xs` 4px (badges, kbd), `radius-sm` 6px (buttons, inputs, rows), `radius-md` 8px (cards, menus), `radius-lg` 12px (modals, command palette), `radius-full` (avatars, dots).
- **Controls**: 24px small, 28px default, 32px large. List rows are 36px. Icons are 16px with a 1.5px stroke.

## Layout: the app shell

```
┌──────────────┬──────────────────────────────────────────┬───────────────┐
│ Sidebar      │ Top bar (44px): title · filters · display│               │
│ 240px        ├──────────────────────────────────────────┤ Detail panel  │
│ surface-1    │ Content (surface-0)                      │ 360px         │
│              │ list rows 36px / board / table           │ surface-1     │
│ workspace    │                                          │ (optional)    │
│ search ⌘K    │                                          │               │
│ nav groups   │                                          │               │
└──────────────┴──────────────────────────────────────────┴───────────────┘
```

- **Sidebar**: workspace switcher at top, then search / command palette trigger, then nav groups with `micro` section labels. Nav items are 28px tall, 16px icon, `ui` text in `text-secondary`; hover `surface-3`; active `accent-soft` background with `text-primary` label. Collapsible with `[`.
- **Top bar**: view title (`title-3` weight 600 at 14px is acceptable), view tabs, then filter and display buttons right-aligned. Bottom border `border-subtle`.
- **Content**: lists are the default view. Group headers are sticky, 32px, `surface-1`, with count. Boards use 280px columns with `radius-md` cards on `surface-2`.
- **Detail panel**: opens on the right for the selected item, or the item opens full width. Properties are a two-column label/value list with 32px rows.
- **Responsive**: under 1024px the detail panel becomes a full-screen route; under 768px the sidebar becomes an overlay drawer.

## Iconography

Use **Lucide** icons at 16px, stroke width 1.5, `currentColor`. Icons sit in `text-tertiary` by default and take `text-primary` on hover or when active. Status icons are custom: an outlined circle (backlog/todo), a half-filled circle (in progress), a filled circle with check (done), a circle with an X (cancelled), each in its status colour. Priority uses three ascending bars, plus a filled `danger` square with `!` for urgent.

## Interaction and states

- **Hover**: background shifts one surface step (`surface-3`); no movement, no shadow.
- **Selected**: `accent-soft` background; multi-select with Shift/Cmd click or `X` on the focused row.
- **Focus**: `outline: 2px solid var(--focus); outline-offset: 2px;` on `:focus-visible` only. In lists, the keyboard-focused row gets the full-row `surface-3` fill (same as hover), so J/K navigation is always visible.
- **Disabled**: `text-disabled`, no hover, `cursor: not-allowed`, opacity unchanged.
- **Loading**: skeleton rows in `surface-3`, no spinners for content under 300ms. Buttons show an inline 14px spinner and keep their width.
- **Empty**: centered in the content area, `title-3` + one line of `text-secondary` + one secondary button and its shortcut.
- **Toasts**: bottom-left, `surface-2`, `shadow-md`, 4s, with an Undo action for destructive changes instead of confirm dialogs.

## Motion

Fast and functional. Durations: 100ms for hover and colour changes, 150ms for menus and popovers, 200ms for modals and panels. Easing `cubic-bezier(0.25, 0.1, 0.25, 1)` in, `cubic-bezier(0.16, 1, 0.3, 1)` for things that enter. Menus fade and scale from 0.98; modals fade and rise 4px. No bounce, no spring overshoot, no motion longer than 250ms. Respect `prefers-reduced-motion` by dropping transforms and keeping opacity fades.

## Keyboard

| Key | Action |
|---|---|
| `⌘K` / `Ctrl K` | Command palette (searches actions, items and navigation) |
| `C` | Create new item |
| `J` / `K` or `↓` / `↑` | Move focus through rows |
| `Enter` | Open focused item |
| `X` | Select focused row |
| `Esc` | Close panel, menu or modal; clear selection |
| `/` | Focus search / filter |
| `[` | Toggle sidebar |
| `G` then `I` / `P` / `S` | Go to inbox / projects / settings |
| `?` | Shortcut help |

Every menu item shows its shortcut on the right as a `Kbd`. Single-letter shortcuts are disabled while typing in an input.

## Accessibility

- All text meets 4.5:1 (3:1 for 24px+ and non-text UI) in both themes.
- Status and priority always carry an icon shape and an accessible label, never colour alone.
- Every interactive element is reachable by Tab and shows the `focus` ring.
- The command palette and menus follow the WAI-ARIA combobox and menu patterns (arrow keys, Home/End, typeahead).
- Hit targets are at least 24×24px; touch layouts raise rows to 44px.

## Do and don't

- Do use one accent-filled button per view at most. Don't use accent for decoration.
- Do separate regions with `border-subtle`. Don't add shadows to cards or panels.
- Do truncate long titles with an ellipsis and show the full text in a tooltip. Don't wrap list rows.
- Do keep icons monochrome. Don't use emoji or coloured illustrations in the product.
- Don't use gradients, glassmorphism, left-border accent cards, or blue-to-purple hero washes.
