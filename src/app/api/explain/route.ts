import { NextResponse } from "next/server";
import { db, hasDb } from "@/server/db";
import { currentTime } from "@/server/fetcher";
import { explainInput, explainRecommendation } from "@/server/recommend";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** The agent's explanation, requested after the engine result is already on screen. Never an error the angler sees. */
export async function POST(request: Request) {
  const parsed = explainInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the port, date and answers and try again." }, { status: 400 });
  try {
    return NextResponse.json(await explainRecommendation(parsed.data, { db: hasDb() ? db() : null, now: currentTime() }));
  } catch (err) {
    console.error("explain failed", err);
    // The screen keeps the templated reasons it already has.
    return NextResponse.json({ explanation: null, cached: false, attempts: 0 });
  }
}
