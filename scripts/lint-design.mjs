// Fails on hex colors and default Tailwind palette classes in component code.
// Colors come from Meridian's semantic tokens only; src/styles/tokens.css is the
// one generated file allowed to hold raw values.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const ALLOW = new Set(["src/styles/tokens.css"]);
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g;
const PALETTE = /\b(?:bg|text|border|ring|fill|stroke|from|to|via|outline|decoration|divide|placeholder|shadow|accent|caret)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)(?:-\d{2,3})?\b/g;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (/\.(tsx?|css)$/.test(name)) yield path;
  }
}

const problems = [];
for (const file of walk(join(root, "src"))) {
  const rel = relative(root, file);
  if (ALLOW.has(rel)) continue;
  readFileSync(file, "utf8").split("\n").forEach((line, i) => {
    for (const [re, what] of [[HEX, "hex color"], [PALETTE, "default Tailwind palette class"]]) {
      for (const m of line.matchAll(re)) problems.push(`${rel}:${i + 1} ${what}: ${m[0]}`);
    }
  });
}

if (problems.length) {
  console.error(problems.join("\n"));
  console.error(`\n${problems.length} design-system violation(s). Use Meridian's semantic tokens.`);
  process.exit(1);
}
console.log("design lint passed");
