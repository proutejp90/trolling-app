import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

// Meridian Badge: 20px, small text, never a button. Two kinds.
// Tone: soft fill, no border, for system states. Label: outlined with an 8px dot, for categories and sources.
const tones = {
  neutral: "bg-surface-3 text-fg-secondary",
  accent: "bg-accent-soft text-accent-text",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
} as const;

const dots = {
  neutral: "bg-fg-tertiary", accent: "bg-accent", success: "bg-success", warning: "bg-warning", danger: "bg-danger", info: "bg-info",
} as const;

export type BadgeTone = keyof typeof tones;

/** Every badge carries a word. Status badges also take a 12px icon, so color is never the only signal. */
export function Badge({ tone = "neutral", kind = "tone", icon: Icon, children }: { tone?: BadgeTone; kind?: "tone" | "label"; icon?: LucideIcon; children: ReactNode }) {
  const look = kind === "label" ? "border border-border text-fg-secondary" : tones[tone];
  return (
    <span className={`inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-xs px-2 text-small ${look}`}>
      {kind === "label" ? <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${dots[tone]}`} /> : null}
      {Icon ? <Icon size={12} strokeWidth={1.5} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

/** Evidence tags. The word always shows; color is never the only signal. */
export const EVIDENCE_TAGS = {
  science: { label: "Science", tone: "info" },
  reports: { label: "Reports", tone: "warning" },
  lore: { label: "Lore", tone: "neutral" },
  your_log: { label: "Your log", tone: "accent" },
} as const satisfies Record<string, { label: string; tone: BadgeTone }>;

export const CONFIDENCE = {
  high: { label: "High confidence", tone: "success" },
  medium: { label: "Medium confidence", tone: "warning" },
  low: { label: "Low confidence", tone: "danger" },
} as const satisfies Record<string, { label: string; tone: BadgeTone }>;
