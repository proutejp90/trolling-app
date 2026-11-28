import type { ReactNode } from "react";

/** A card on surface-2 with a hairline edge. Parts inside are split by hairlines, never by shadows. */
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`overflow-hidden rounded-md border border-border-subtle bg-surface-2 ${className}`}>{children}</section>;
}

/** The strip at the top of a card: title on the left, a count or status on the right. */
export function CardHeader({ title, right, level = "h3" }: { title: string; right?: ReactNode; level?: "h2" | "h3" }) {
  const Heading = level;
  return (
    <div className="flex min-h-touch items-center justify-between gap-3 border-b border-border-subtle bg-surface-1 px-4">
      <Heading className="text-t3">{title}</Heading>
      {right}
    </div>
  );
}

/** A zone: a labeled group of cards. The label is a real heading so screen readers can jump between zones. */
export function Zone({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-micro text-fg-tertiary">{label}</h2>
      {children}
    </section>
  );
}

/** A muted panel on surface-1 with no border, for notes and fine print. */
export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-md bg-surface-1 p-4 ${className}`}>{children}</div>;
}
