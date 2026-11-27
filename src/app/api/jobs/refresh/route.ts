import { NextResponse } from "next/server";
import { db, hasDb } from "@/server/db";
import { currentTime } from "@/server/fetcher";
import { refreshConditions } from "@/server/jobs/refresh";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Called by the host's scheduler. Protected by a shared secret so the public cannot make the app hit NOAA. */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  if (!hasDb()) return NextResponse.json({ error: "No database configured." }, { status: 503 });
  const summary = await refreshConditions(db(), currentTime());
  return NextResponse.json({ now: summary.now, reporting: summary.stations.filter((s) => s.readings > 0).length, stations: summary.stations.length, forecasts: summary.forecasts.length, errors: summary.errors });
}
