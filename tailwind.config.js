// Meridian's Tailwind mapping, from design-system/implementation.md section 2.
// theme.colors is replaced, not extended, so the default palette does not exist.
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    colors: {
      transparent: "transparent", current: "currentColor",
      surface: { 0: "var(--surface-0)", 1: "var(--surface-1)", 2: "var(--surface-2)", 3: "var(--surface-3)", 4: "var(--surface-4)" },
      border: { subtle: "var(--border-subtle)", DEFAULT: "var(--border)", strong: "var(--border-strong)" },
      fg: { DEFAULT: "var(--text-primary)", secondary: "var(--text-secondary)", tertiary: "var(--text-tertiary)", disabled: "var(--text-disabled)" },
      accent: { DEFAULT: "var(--accent)", hover: "var(--accent-hover)", text: "var(--accent-text)", soft: "var(--accent-soft)", on: "var(--on-accent)" },
      focus: "var(--focus)",
      success: { DEFAULT: "var(--success)", soft: "var(--success-soft)" },
      warning: { DEFAULT: "var(--warning)", soft: "var(--warning-soft)" },
      danger: { DEFAULT: "var(--danger)", soft: "var(--danger-soft)" },
      info: { DEFAULT: "var(--info)", soft: "var(--info-soft)" },
    },
    fontFamily: { sans: "var(--font-sans)", mono: "var(--font-mono)" },
    fontSize: {
      micro: ["11px", { lineHeight: "14px", fontWeight: "500" }],
      small: ["12px", { lineHeight: "16px", fontWeight: "500" }],
      ui: ["13px", { lineHeight: "20px", fontWeight: "500" }],
      body: ["14px", { lineHeight: "22px" }],
      t3: ["15px", { lineHeight: "22px", fontWeight: "600" }],
      t2: ["18px", { lineHeight: "26px", fontWeight: "600" }],
      t1: ["24px", { lineHeight: "32px", fontWeight: "600", letterSpacing: "-0.01em" }],
    },
    borderRadius: { none: "0", xs: "4px", sm: "6px", md: "8px", lg: "12px", full: "9999px" },
    boxShadow: { none: "none", sm: "var(--shadow-sm)", md: "var(--shadow-md)", lg: "var(--shadow-lg)" },
    extend: {
      spacing: { 0.5: "2px" },
      height: {
        "ctl-sm": "24px", ctl: "28px", "ctl-lg": "32px", row: "36px", topbar: "44px",
        // On-water profile, angler screens only. See DECISIONS.md.
        touch: "44px", "touch-lg": "56px",
      },
      minHeight: { touch: "44px", "touch-lg": "56px" },
      minWidth: { touch: "44px" },
      width: { sidebar: "240px", panel: "360px" },
      transitionTimingFunction: { out: "cubic-bezier(0.16, 1, 0.3, 1)" },
    },
  },
};
