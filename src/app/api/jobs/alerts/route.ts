import { NextResponse } from "next/server";
import { db, hasDb } from "@/server/db";
import { currentTime } from "@/server/fetcher";
import { refreshAlerts } from "@/server/jobs/refresh";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Called by the host's scheduler every 15 minutes. Same shared secret as the full refresh. */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  if (!hasDb()) return NextResponse.json({ error: "No database configured." }, { status: 503 });
  return NextResponse.json(await refreshAlerts(db(), currentTime()));
}
