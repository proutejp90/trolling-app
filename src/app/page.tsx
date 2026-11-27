import { ThemeToggle } from "@/components/theme-toggle";
import { Badge, CONFIDENCE, EVIDENCE_TAGS } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// Phase 0 placeholder for Home. It proves the Meridian tokens, the Tailwind
// mapping and the on-water sizes are wired in. The port picker and the
// recommendation flow arrive with the quiz in Phase 1.
export default function Home() {
  return (
    <div className="on-water mx-auto flex min-h-screen max-w-md flex-col">
      <header className="flex h-topbar items-center justify-between border-b border-border-subtle bg-surface-1 pl-4 pr-1">
        <span className="text-t3">Conditions recommender</span>
        <ThemeToggle />
      </header>

      <main className="flex flex-1 flex-col gap-4 p-4">
        <div>
          <h1 className="text-t1">Get a starting setup</h1>
          <p className="mt-2 text-fg-secondary">
            Pick a port and a date to see which lures to run, how deep and how fast, and why.
          </p>
        </div>

        <section className="rounded-md border border-border-subtle bg-surface-2 p-4">
          <h2 className="text-t3">Every reason shows its evidence</h2>
          <ul className="mt-3 flex flex-col gap-3 text-fg-secondary">
            <li className="flex items-start gap-3">
              <Badge tone={EVIDENCE_TAGS.science.tone}>{EVIDENCE_TAGS.science.label}</Badge>
              <span>Published research on fish and light.</span>
            </li>
            <li className="flex items-start gap-3">
              <Badge tone={EVIDENCE_TAGS.reports.tone}>{EVIDENCE_TAGS.reports.label}</Badge>
              <span>Michigan DNR weekly fishing reports.</span>
            </li>
            <li className="flex items-start gap-3">
              <Badge tone={EVIDENCE_TAGS.lore.tone}>{EVIDENCE_TAGS.lore.label}</Badge>
              <span>Captain and angler experience.</span>
            </li>
            <li className="flex items-start gap-3">
              <Badge tone={EVIDENCE_TAGS.your_log.tone}>{EVIDENCE_TAGS.your_log.label}</Badge>
              <span>Results from your own trips.</span>
            </li>
          </ul>
          <div className="mt-4 flex flex-wrap gap-2 border-t border-border-subtle pt-4">
            <Badge tone={CONFIDENCE.high.tone}>{CONFIDENCE.high.label}</Badge>
            <Badge tone={CONFIDENCE.medium.tone}>{CONFIDENCE.medium.label}</Badge>
            <Badge tone={CONFIDENCE.low.tone}>{CONFIDENCE.low.label}</Badge>
          </div>
        </section>

        <div className="mt-auto flex flex-col gap-2">
          <Button variant="primary" size="touch" disabled aria-describedby="get-setup-note">
            Get setup
          </Button>
          <p id="get-setup-note" className="text-small text-fg-tertiary">
            Recommendations are not built yet. This page is the Phase 0 foundation.
          </p>
        </div>
      </main>

      <footer className="border-t border-border-subtle p-4 text-small text-fg-tertiary">
        A starting setup based on conditions, reports and angler experience.
      </footer>
    </div>
  );
}
