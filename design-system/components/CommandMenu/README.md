# CommandMenu

CommandMenu is the Cmd/Ctrl-K palette: one search box over every action, item and destination in the app.

560px wide, centred about 20% from the top, `surface-2`, 1px `border`, `radius-lg`, `shadow-lg`, over a `backdrop` scrim. Input row 48px with 14px text; results in groups (Actions, Navigation, Recent, then matching items) with `micro` group labels; items 36px with a 16px icon, label and right-aligned `Kbd`. The highlighted item fills `surface-3`. Footer hint bar on `surface-1`.

Behaviour: opens in under 50ms with the input focused; fuzzy matches as you type; arrow keys move, Enter runs, Esc closes (first Esc clears the query). Context-aware: with a row selected, its actions rank first. Supports nested pages ("Change status…" opens a status list) with Backspace on an empty query to go back. Build with `cmdk` or the WAI-ARIA combobox pattern. Enters with a 150ms fade and 0.98 to 1 scale.
