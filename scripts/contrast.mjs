// Contrast of every text and surface pair the angler screens use, in both themes. WCAG AA is 4.5 for text.
// Usage: node scripts/contrast.mjs   (exits 1 when a pair is under AA)
import { readFileSync } from "node:fs";

const css = readFileSync("src/styles/tokens.css", "utf8");
const block = (sel) => Object.fromEntries([...css.slice(css.indexOf(sel)).split("}")[0].matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/g)].map((m) => [m[1], m[2]]));
const themes = { dark: block(':root, [data-theme="dark"]'), light: block('[data-theme="light"] {') };
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const pairs = [
  ...["surface-0", "surface-1", "surface-2"].flatMap((s) => ["text-primary", "text-secondary", "text-tertiary"].map((t) => [t, s])),
  ...["accent", "success", "warning", "danger", "info"].map((t) => [t === "accent" ? "accent-text" : t, `${t}-soft`]),
  ["text-secondary", "surface-3"], ["accent-text", "surface-1"], ["accent-text", "surface-2"], ["danger", "surface-2"], ["on-accent", "accent"],
];
let failed = 0;
for (const [name, t] of Object.entries(themes)) {
  for (const [fg, bg] of pairs) {
    const r = ratio(t[fg], t[bg]);
    if (r < 4.5) failed++;
    console.log(`${name.padEnd(5)} ${fg.padEnd(15)} on ${bg.padEnd(13)} ${r.toFixed(2)} ${r < 4.5 ? "UNDER AA" : ""}`);
  }
}
process.exit(failed ? 1 : 0);
