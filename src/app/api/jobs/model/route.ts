import { NextResponse } from "next/server";
import { db, hasDb } from "@/server/db";
import { currentTime } from "@/server/fetcher";
import { modelSetup, modelUpload, storeModel } from "@/server/jobs/model";
import { loadRuleset } from "@/server/ruleset";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const allowed = (request: Request) => {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
};

/** The lake model job asks which ports to read, then posts what it read. Same shared secret as the other jobs. */
export async function GET(request: Request) {
  if (!allowed(request)) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  if (!hasDb()) return NextResponse.json({ error: "No database configured." }, { status: 503 });
  return NextResponse.json(await modelSetup(db(), (await loadRuleset(db())).thresholds));
}

export async function POST(request: Request) {
  if (!allowed(request)) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  if (!hasDb()) return NextResponse.json({ error: "No database configured." }, { status: 503 });
  const parsed = modelUpload.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "The upload is not in the expected shape.", issues: parsed.error.issues.slice(0, 5) }, { status: 400 });
  return NextResponse.json(await storeModel(db(), parsed.data, currentTime()));
}
