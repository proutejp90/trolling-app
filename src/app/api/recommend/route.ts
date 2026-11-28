import { NextResponse } from "next/server";
import { db, hasDb } from "@/server/db";
import { currentTime } from "@/server/fetcher";
import { recommend, recommendInput, UnknownPortError } from "@/server/recommend";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const parsed = recommendInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    // A bad date is the common case, so it is named: the client shows the message at the Date field.
    if (parsed.error.issues.some((i) => i.path[0] === "date")) return NextResponse.json({ error: "Enter a date like 07/15/2027.", field: "date" }, { status: 400 });
    return NextResponse.json({ error: "Check the port, date and answers and try again." }, { status: 400 });
  }
  try {
    return NextResponse.json(await recommend(parsed.data, { db: hasDb() ? db() : null, now: currentTime() }));
  } catch (err) {
    if (err instanceof UnknownPortError) return NextResponse.json({ error: "That port is not in the list." }, { status: 404 });
    console.error("recommend failed", err);
    // The database being down must not take the app down: answer from the bundled rules.
    try {
      return NextResponse.json(await recommend(parsed.data, { db: null, now: currentTime() }));
    } catch {
      return NextResponse.json({ error: "Couldn't build a setup. Try again." }, { status: 500 });
    }
  }
}
