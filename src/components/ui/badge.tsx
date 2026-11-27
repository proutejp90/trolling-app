import type { ReactNode } from "react";

// Meridian Badge, tone kind: soft fill, no border, always with a word.
const tones = {
  neutral: "bg-surface-3 text-fg-secondary",
  accent: "bg-accent-soft text-accent-text",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
} as const;

export type BadgeTone = keyof typeof tones;

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span className={`inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-xs px-2 text-small ${tones[tone]}`}>
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
