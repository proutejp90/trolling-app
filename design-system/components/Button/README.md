# Button

Buttons trigger actions; four variants, three sizes, 28px tall by default.

- **primary** (`accent` fill, `on-accent` text): the single main action of a view, at most one per screen. Show its shortcut as a `Kbd` inside.
- **secondary** (`surface-3` fill, `border`): standard actions like Filter, Save, Cancel.
- **ghost** (transparent, `text-secondary`, `surface-3` on hover): toolbar actions and icon buttons.
- **danger** (`danger-soft` fill, `danger` text): destructive actions; prefer an Undo toast over a confirm dialog.

Sizes: `sm` 24px (`control-sm`), default 28px (`control-md`), `lg` 32px (`control-lg`). Padding `space-3` horizontal (`space-2` small), icon 16px, gap `space-2`, radius `radius-sm`, text `ui` (13px/500).

Icon-only buttons are square (28×28) and need an `aria-label` and a tooltip with the label and shortcut. Loading keeps the width and swaps the icon for a 14px spinner. Disabled: `text-disabled` on `surface-1`, no hover. Labels are sentence case and start with a verb.

Consumer provides: label, optional leading icon, optional shortcut, onClick.
