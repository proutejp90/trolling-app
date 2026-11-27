import { Quiz } from "@/components/quiz/quiz";
import { ThemeToggle } from "@/components/theme-toggle";

// Home, Quick questions and Recommendation, run from the bundled ruleset.
// Phase 2 swaps the questions the buoys and forecast can answer for live data.
export default function Home() {
  return (
    <div className="on-water mx-auto flex min-h-screen max-w-md flex-col">
      <header className="flex h-topbar items-center justify-between border-b border-border-subtle bg-surface-1 pl-4 pr-1">
        <span className="text-t3">Conditions recommender</span>
        <ThemeToggle />
      </header>
      <main className="flex flex-1 flex-col p-4">
        <Quiz />
      </main>
    </div>
  );
}
