// Turns one live recording (fixtures/live, made with FIXTURES=record:live npm run job:refresh)
// into the small fixture sets the tests replay. Nothing is invented: each set holds
// real responses, cut down to the hours a test clock can see.
//
//   november  the recording as made, 2026-11-27: most buoys pulled, forecast present
//   autumn    clock at 2026-10-14T14:00Z, the last hours Muskegon's buoy reported wind
//   winter    clock at 2026-04-10T14:00Z, every buoy answering the way a pulled buoy does
//
// The NDBC files hold about 45 days, so the October rows are in the November recording.
// Seagull serves 30 days and NWS observations about a week, so for October and April
// both answer empty, exactly as their live APIs do for those windows (checked 2026-11-27).
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const root = join(import.meta.dirname, "..", "fixtures");
const live = join(root, "live");
const SETS = { november: "2026-11-27T20:30:00Z", autumn: "2026-10-14T14:00:00Z", winter: "2026-04-10T14:00:00Z" };
const HOURS = 72;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path); else yield path;
  }
}
const files = [...walk(live)].map((path) => ({ key: relative(live, path), ...JSON.parse(readFileSync(path, "utf8")) }));
const pulled = files.find((f) => f.key.startsWith("ndbc/") && f.status === 404);
if (!pulled) throw new Error("the recording holds no pulled NDBC buoy to copy the 404 from");

const ndbcWindow = (body, now) => {
  const end = new Date(now).getTime(), start = end - HOURS * 3_600_000;
  return body.split("\n").filter((line) => {
    if (line.startsWith("#")) return true;
    const p = line.trim().split(/\s+/).map(Number);
    const t = Date.UTC(p[0], p[1] - 1, p[2], p[3], p[4]);
    return t >= start && t <= end;
  }).join("\n") + "\n";
};
const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, obj[k]]));

for (const [set, now] of Object.entries(SETS)) {
  rmSync(join(root, set), { recursive: true, force: true });
  for (const f of files) {
    let { status, body } = f, note = `From the live recording of ${f.recorded_at.slice(0, 10)}.`;
    if (f.key.startsWith("ndbc/")) {
      if (set === "winter") { status = 404; body = pulled.body; note = "The 404 NDBC gave for a pulled buoy on 2026-11-27, standing in for every buoy in winter."; }
      else if (status === 200) { body = ndbcWindow(body, now); note += ` Rows cut to the ${HOURS} hours before ${now}.`; }
    } else if (f.key === "seagull/obs.json") {
      if (set === "november") {
        const end = new Date(now).getTime(), start = end - HOURS * 3_600_000;
        const data = JSON.parse(body).map((d) => ({ ...d, parameters: d.parameters.map((p) => ({ ...p, observations: p.observations.filter((o, i) => { const t = new Date(`${o.timestamp}Z`).getTime(); return t >= start && t <= end && i % 3 === 0; }).map((o) => pick(o, ["timestamp", "value"])) })) }));
        body = JSON.stringify(data); note += " Every third reading kept, positions dropped.";
      } else { body = "[]"; note = "Seagull answers [] for any window older than 30 days (checked live 2026-11-27)."; }
    } else if (f.key.startsWith("nws/obs/")) {
      if (set === "november") {
        const j = JSON.parse(body);
        body = JSON.stringify({ type: j.type, features: j.features.map((x) => ({ properties: pick(x.properties, ["timestamp", "windDirection", "windSpeed", "temperature"]) })) });
        note += " Cut to the fields the parser reads.";
      } else { body = JSON.stringify({ type: "FeatureCollection", features: [] }); note = "NWS answers an empty collection for a window this old (checked live 2026-11-27)."; }
    } else if (f.key.startsWith("nws/grid/")) {
      const j = JSON.parse(body);
      body = JSON.stringify({ properties: pick(j.properties, ["updateTime", "skyCover", "windSpeed", "windDirection", "hazards"]) });
      note += " Cut to the four series the parser reads.";
    } else if (f.key.startsWith("nws/points/")) {
      body = JSON.stringify({ properties: pick(JSON.parse(body).properties, ["gridId", "gridX", "gridY", "forecastGridData", "observationStations", "timeZone"]) });
    } else if (f.key.startsWith("nws/stations/")) {
      const j = JSON.parse(body);
      body = JSON.stringify({ features: j.features.slice(0, 2).map((x) => ({ properties: pick(x.properties, ["stationIdentifier", "name"]), geometry: x.geometry })) });
      note += " First two stations kept.";
    }
    const out = join(root, set, f.key);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify({ url: f.url, recorded_at: f.recorded_at, note, status, body }));
  }
  console.log(set, now);
}
