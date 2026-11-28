import { NextResponse } from "next/server";
import { db, hasDb } from "@/server/db";
import { currentTime } from "@/server/fetcher";
import { githubKeys, refuseGithubToken } from "@/server/github-oidc";
import { modelSetup, modelUpload, storeModel } from "@/server/jobs/model";
import { loadRuleset } from "@/server/ruleset";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The repository whose lake model workflow may post here. */
const REPOSITORY = process.env.LAKE_MODEL_REPOSITORY ?? "proutejp90/trolling-app";

/**
 * Two ways in: the shared secret the other jobs use, or a token GitHub signed for this
 * repository's lake model workflow on main. The second needs nothing set up by hand.
 */
async function allowed(request: Request): Promise<boolean> {
  const bearer = request.headers.get("authorization")?.replace(/^Bearer /i, "") ?? "";
  if (!bearer) return false;
  const secret = process.env.CRON_SECRET;
  if (secret && bearer === secret) return true;
  try {
    const audience = [new URL(request.url).origin, process.env.URL].filter((a): a is string => Boolean(a));
    const refused = refuseGithubToken(bearer, await githubKeys(), { repository: REPOSITORY, workflowFile: "lake-model.yml", audience, now: new Date() });
    if (refused) console.warn("lake model job refused:", refused);
    return refused === null;
  } catch (err) {
    console.error("could not check the lake model job's token", err);
    return false;
  }
}

/** The lake model job asks which ports to read, then posts what it read. */
export async function GET(request: Request) {
  if (!(await allowed(request))) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  if (!hasDb()) return NextResponse.json({ error: "No database configured." }, { status: 503 });
  return NextResponse.json(await modelSetup(db(), (await loadRuleset(db())).thresholds));
}

export async function POST(request: Request) {
  if (!(await allowed(request))) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  if (!hasDb()) return NextResponse.json({ error: "No database configured." }, { status: 503 });
  const parsed = modelUpload.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "The upload is not in the expected shape.", issues: parsed.error.issues.slice(0, 5) }, { status: 400 });
  return NextResponse.json(await storeModel(db(), parsed.data, currentTime()));
}
