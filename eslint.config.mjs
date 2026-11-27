import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts", "design-system/**", "*.config.js"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ["scripts/**/*.mjs"], languageOptions: { globals: { process: "readonly", console: "readonly" } } },
  {
    // The engine stays standalone: no framework or app imports.
    files: ["packages/engine/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: ["next", "next/*", "react", "react-dom", "@/*", "@supabase/*", "@anthropic-ai/*"] }],
    },
  },
);
