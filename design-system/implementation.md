# Implementation

How to wire Meridian into a codebase. Written for Claude Code and other coding agents.

## 1. CSS variables

Generate one stylesheet from `tokens.json`. Dark is the default theme; light overrides it.

```css
@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap");

:root, [data-theme="dark"] {
  --surface-0: #0b0c0e; --surface-1: #111214; --surface-2: #18191c;
  --surface-3: #222327; --surface-4: #2b2c31;
  --border-subtle: #1d1e21; --border: #2a2b30; --border-strong: #62656d;
  --text-primary: #f1f2f4; --text-secondary: #a2a5ad;
  --text-tertiary: #80838b; --text-disabled: #4f5259;
  --accent: #5e5ee0; --accent-hover: #5151cf; --accent-text: #a9a9f7;
  --accent-soft: #1d1d38; --on-accent: #ffffff; --focus: #8a8af3;
  --success: #4cc38a; --success-soft: #12291e;
  --warning: #e2b33c; --warning-soft: #2b2310;
  --danger: #f26b72;  --danger-soft: #2f1517;
  --info: #5b9cf5;    --info-soft: #13223a;
  --backdrop: rgba(0,0,0,.6);
  --shadow-sm: 0 1px 2px rgba(0,0,0,.4);
  --shadow-md: 0 4px 16px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.04);
  --shadow-lg: 0 16px 48px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.05);
  color-scheme: dark;
}

[data-theme="light"] {
  --surface-0: #fbfbfc; --surface-1: #f4f5f7; --surface-2: #ffffff;
  --surface-3: #ebecef; --surface-4: #e1e3e7;
  --border-subtle: #ebecef; --border: #d9dbe0; --border-strong: #8c919a;
  --text-primary: #16171a; --text-secondary: #555962;
  --text-tertiary: #6a6e77; --text-disabled: #a9adb5;
  --accent: #5b5bd6; --accent-hover: #4d4dc8; --accent-text: #4848c0;
  --accent-soft: #ececfb; --on-accent: #ffffff; --focus: #5b5bd6;
  --success: #1a7a43; --success-soft: #e5f4ec;
  --warning: #8f5d00; --warning-soft: #fbf1dc;
  --danger: #c02d37;  --danger-soft: #fbe8e9;
  --info: #2a63c4;    --info-soft: #e6eefb;
  --backdrop: rgba(16,17,20,.35);
  --shadow-sm: 0 1px 2px rgba(16,17,20,.06);
  --shadow-md: 0 4px 16px rgba(16,17,20,.08), 0 0 0 1px rgba(16,17,20,.04);
  --shadow-lg: 0 16px 48px rgba(16,17,20,.14), 0 0 0 1px rgba(16,17,20,.05);
  color-scheme: light;
}

:root {
  --font-sans: "Inter", system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, Menlo, monospace;
  --space-0-5: 2px; --space-1: 4px; --space-2: 8px; --space-3: 12px;
  --space-4: 16px; --space-5: 20px; --space-6: 24px; --space-8: 32px; --space-12: 48px;
  --radius-xs: 4px; --radius-sm: 6px; --radius-md: 8px; --radius-lg: 12px; --radius-full: 9999px;
  --control-sm: 24px; --control-md: 28px; --control-lg: 32px; --row-height: 36px;
  --topbar-height: 44px; --sidebar-width: 240px; --panel-width: 360px;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --dur-fast: 100ms; --dur-base: 150ms; --dur-slow: 200ms;
}

html { font-family: var(--font-sans); font-size: 13px; line-height: 20px;
  font-feature-settings: "cv11", "ss01"; -webkit-font-smoothing: antialiased;
  background: var(--surface-0); color: var(--text-primary); }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { * { transition-duration: 0ms !important; animation: none !important; } }
```

Theme switching: set `data-theme` on `<html>`. Default to the OS preference via `prefers-color-scheme` on first load, then persist the user's choice.

## 2. Tailwind mapping (v3 or v4)

Point Tailwind at the variables so utility classes stay semantic.

```js
// tailwind.config.js
module.exports = {
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    colors: {
      transparent: 'transparent', current: 'currentColor',
      surface: { 0: 'var(--surface-0)', 1: 'var(--surface-1)', 2: 'var(--surface-2)', 3: 'var(--surface-3)', 4: 'var(--surface-4)' },
      border: { subtle: 'var(--border-subtle)', DEFAULT: 'var(--border)', strong: 'var(--border-strong)' },
      fg: { DEFAULT: 'var(--text-primary)', secondary: 'var(--text-secondary)', tertiary: 'var(--text-tertiary)', disabled: 'var(--text-disabled)' },
      accent: { DEFAULT: 'var(--accent)', hover: 'var(--accent-hover)', text: 'var(--accent-text)', soft: 'var(--accent-soft)', on: 'var(--on-accent)' },
      focus: 'var(--focus)',
      success: { DEFAULT: 'var(--success)', soft: 'var(--success-soft)' },
      warning: { DEFAULT: 'var(--warning)', soft: 'var(--warning-soft)' },
      danger:  { DEFAULT: 'var(--danger)',  soft: 'var(--danger-soft)' },
      info:    { DEFAULT: 'var(--info)',    soft: 'var(--info-soft)' },
    },
    fontFamily: { sans: 'var(--font-sans)', mono: 'var(--font-mono)' },
    fontSize: {
      micro: ['11px', { lineHeight: '14px', fontWeight: '500' }],
      small: ['12px', { lineHeight: '16px', fontWeight: '500' }],
      ui:    ['13px', { lineHeight: '20px', fontWeight: '500' }],
      body:  ['14px', { lineHeight: '22px' }],
      't3':  ['15px', { lineHeight: '22px', fontWeight: '600' }],
      't2':  ['18px', { lineHeight: '26px', fontWeight: '600' }],
      't1':  ['24px', { lineHeight: '32px', fontWeight: '600', letterSpacing: '-0.01em' }],
    },
    borderRadius: { none: '0', xs: '4px', sm: '6px', md: '8px', lg: '12px', full: '9999px' },
    boxShadow: { none: 'none', sm: 'var(--shadow-sm)', md: 'var(--shadow-md)', lg: 'var(--shadow-lg)' },
    extend: {
      spacing: { '0.5': '2px' },
      height: { 'ctl-sm': '24px', 'ctl': '28px', 'ctl-lg': '32px', row: '36px', topbar: '44px' },
      width: { sidebar: '240px', panel: '360px' },
      transitionTimingFunction: { out: 'cubic-bezier(0.16, 1, 0.3, 1)' },
    },
  },
};
```

Replacing `theme.colors` (not extending) removes Tailwind's default palette, so raw colours like `bg-blue-500` can't sneak in.

## 3. Recommended stack

- React + TypeScript, Tailwind for styling.
- **Radix UI primitives** (or shadcn/ui re-skinned with these tokens) for menus, dialogs, popovers, tooltips and the focus management they need.
- **cmdk** for the command palette.
- **Lucide React** for icons (`size={16} strokeWidth={1.5}`).
- **Framer Motion** only for panel and modal enter/exit; CSS transitions for everything else.

## 4. Component build order

Build primitives first, then the shell, then views:

1. Button, IconButton, Kbd, Badge, Avatar, StatusIcon, PriorityIcon
2. Input, Textarea, Checkbox, Toggle, Select (as a menu)
3. Menu / DropdownMenu, Popover, Tooltip, Dialog, Toast
4. CommandMenu
5. AppShell: Sidebar, SidebarItem, TopBar, DetailPanel
6. ListRow, GroupHeader, BoardCard, PropertyRow, EmptyState, Skeleton

## 5. Drop-in CLAUDE.md block

Paste this into the project's `CLAUDE.md` so every Claude Code session follows the system:

```md
## Design system: Meridian
- Follow /design-system/README.md and tokens.json. Read a component's README before building or changing it.
- Colors: semantic CSS variables only (surface-*, border*, text-*, accent*, status). No hex values, no Tailwind default palette.
- Type: Inter. Default UI text is 13px/20px weight 500. Never below 11px, never weight 700.
- Spacing on the 4px grid (space-* tokens). Radius: 4 badges, 6 controls, 8 cards/menus, 12 modals.
- Controls 28px tall by default; list rows 36px and never wrap.
- Borders separate regions; shadows only on menus, popovers, modals.
- One accent-filled button per view at most.
- Every action needs a keyboard shortcut or command-palette entry; :focus-visible ring is 2px var(--focus), offset 2px.
- Motion: 100–200ms, no bounce; respect prefers-reduced-motion.
- No emoji, gradients, illustrations or left-border accent cards in product UI.
- Dark theme is primary; test every screen in both data-theme="dark" and "light".
```
