// Generates src/styles/tokens.css from design-system/tokens.json, in the layout
// design-system/implementation.md section 1 shows. Run with --check in CI to
// fail when the committed file is out of date.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tokens = JSON.parse(readFileSync(join(root, "design-system/tokens.json"), "utf8"));
const out = join(root, "src/styles/tokens.css");

const themes = tokens.color.themes.map((t) => t.id); // primary theme first
const themed = [...tokens.color.tokens, ...tokens.shadow.tokens];
const valueFor = (token, theme) =>
  typeof token.value === "string" ? token.value : (token.value[theme] ?? token.value[themes[0]]);

const block = (selector, lines) => `${selector} {\n${lines.map((l) => `  ${l}`).join("\n")}\n}\n`;

let css = `/* ${tokens.name} — generated from design-system/tokens.json by scripts/gen-tokens.mjs. Do not edit. */\n\n`;
for (const [i, theme] of themes.entries()) {
  const selector = i === 0 ? `:root, [data-theme="${theme}"]` : `[data-theme="${theme}"]`;
  css += block(selector, [
    ...themed.map((t) => `--${t.name}: ${valueFor(t, theme)};`),
    `color-scheme: ${theme};`,
  ]) + "\n";
}

const sizeName = (n) => n; // size tokens keep their names: --control-md, --row-height
css += block(":root", [
  `--font-sans: ${tokens.type.families.sans};`,
  `--font-mono: ${tokens.type.families.mono};`,
  ...tokens.spacing.tokens.map((t) => `--${t.name}: ${t.value};`),
  ...tokens.radius.tokens.map((t) => `--${t.name}: ${t.value};`),
  ...tokens.size.tokens.map((t) => `--${sizeName(t.name)}: ${t.value};`),
  ...tokens.zIndex.tokens.map((t) => `--${t.name}: ${t.value};`),
]);

if (process.argv.includes("--check")) {
  if (readFileSync(out, "utf8") !== css) {
    console.error("src/styles/tokens.css is out of date. Run: npm run tokens");
    process.exit(1);
  }
  console.log("tokens.css is up to date");
} else {
  writeFileSync(out, css);
  console.log(`wrote ${out}`);
}
