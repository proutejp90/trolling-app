# Badge

Badges label an item with a category or state in one or two words.

20px tall, `radius-xs`, `small` text (12px/500), padding `space-2`. Two kinds:

- **Label** (outlined, `border`, `text-secondary`) with an 8px coloured dot: user-defined labels like Bug or Frontend. The dot carries the colour; the text stays neutral.
- **Tone** (soft fill, no border): `accent`, `success`, `warning`, `danger`, `info` on their `-soft` backgrounds, for system states like Shipped or Overdue.

Never more than three badges in a list row; collapse the rest into "+2". Badges are not buttons; filtering by a label happens from the filter menu.
