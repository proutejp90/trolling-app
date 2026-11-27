/** Runs one conditions refresh from the command line: tsx scripts/job-refresh.mts */
import { db } from "../src/server/db";
import { currentTime } from "../src/server/fetcher";
import { refreshConditions } from "../src/server/jobs/refresh";

const pool = db();
try {
  const summary = await refreshConditions(pool, currentTime());
  const withData = summary.stations.filter((s) => s.readings > 0);
  console.log(`refreshed at ${summary.now}: ${withData.length} of ${summary.stations.length} stations reporting, ${summary.forecasts.length} port forecasts`);
  for (const s of summary.stations) console.log(`  ${s.source} ${s.id} ${s.name}: ${s.readings} readings${s.newest ? `, newest ${s.newest}` : ""}${s.note ? ` (${s.note})` : ""}`);
  for (const e of summary.errors) console.error(`  error: ${e}`);
  if (summary.errors.length && !withData.length) process.exitCode = 1;
} finally {
  await pool.end();
}
