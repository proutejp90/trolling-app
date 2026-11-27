# ListRow

ListRow is one item in a list view: 36px tall, single line, never wraps.

Order left to right: priority icon, ID (`small`, `text-tertiary`, tabular figures, fixed 64px), status icon, title (`ui`, `text-primary`, truncates with ellipsis), then right-aligned metadata: up to three badges, assignee avatar (20px), date (`small`, `text-tertiary`). Gap `space-3`, side padding `space-6`, `border-subtle` bottom hairline.

States: hover and keyboard focus fill `surface-3`; selected fills `accent-soft`; the open item in the detail panel stays selected. Rows sit under sticky 32px **group headers** on `surface-1` with the status icon, name and a count.

Interactions: click or Enter opens the item; X or Cmd/Shift-click selects; right-click or the row's ghost menu opens actions; drag reorders within manual sort. Status and priority icons are clickable and open their pickers in place. Each icon carries an `aria-label`; colour is never the only signal (the icons differ in shape).
