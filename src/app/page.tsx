import { ConnectionBadge } from "@/components/connection-badge";
import { Quiz } from "@/components/quiz/quiz";
import { ThemeToggle } from "@/components/theme-toggle";
import type { PortOption } from "@/lib/home";
import * as bundled from "@/lib/ruleset";
import { db, hasDb } from "@/server/db";

export const dynamic = "force-dynamic";

async function portList(): Promise<PortOption[]> {
  if (hasDb()) {
    try {
      const { rows } = await db().query("select name, state, lat, lon from public.ports where active order by lat");
      return rows.map((r) => ({ name: r.name, state: r.state, lat: Number(r.lat), lon: Number(r.lon) }));
    } catch (err) {
      console.error("ports query failed; using the bundled list", err);
    }
  }
  return bundled.ports.map((p) => ({ name: p.name, state: p.state, lat: p.lat, lon: p.lon }));
}

// Home, Quick questions, Recommendation and Conditions. The questions shown are
// only the ones the cached buoy and forecast data could not answer.
export default async function Home() {
  return (
    <div className="on-water flex min-h-screen flex-col">
      {/* The bar runs the full width of the window; its contents stay on the content column. */}
      <header className="border-b border-border-subtle bg-surface-1">
        <div className="mx-auto flex h-topbar max-w-md items-center justify-between gap-3 pl-4 pr-1">
          <span className="text-t3">Conditions recommender</span>
          <span className="flex items-center gap-1">
            <ConnectionBadge />
            <ThemeToggle />
          </span>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col p-4">
        <Quiz ports={await portList()} />
      </main>
    </div>
  );
}
