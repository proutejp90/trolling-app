/**
 * Migrate and seed. Usage: tsx scripts/db.mts migrate | seed | reset
 *
 * Works against plain Postgres (local, CI) and against Supabase. On plain
 * Postgres it first applies supabase/local-shim.sql so auth.uid() and the API
 * roles exist. Seeding is idempotent: rows upsert on their natural keys, and
 * rules and thresholds that already exist are left alone so a re-seed never
 * overwrites the owner's edits.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { ruleSchema, thresholdSchema } from "@recommender/engine";
import { lures } from "../seed/lures";
import { ports } from "../seed/ports";
import { rules } from "../seed/rules";
import { distanceMi } from "../seed/geo";
import { PORT_STATION_LINK_MAX_MI, stations } from "../seed/stations";
import { thresholds } from "../seed/thresholds";

const root = join(import.meta.dirname, "..");
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/conditions";

async function migrate(db: pg.Client) {
  const hasAuth = await db.query("select 1 from information_schema.schemata where schema_name = 'auth'");
  if (hasAuth.rowCount === 0) {
    await db.query(readFileSync(join(root, "supabase/local-shim.sql"), "utf8"));
    console.log("applied local auth shim");
  }
  await db.query("create table if not exists public._migrations (name text primary key, applied_at timestamptz not null default now())");
  // The table sits in the API-exposed schema on Supabase; with RLS on and no policies only the service role reads it.
  await db.query("alter table public._migrations enable row level security");
  // Migrations applied through Supabase's own tooling are recorded there under the name without the timestamp.
  const supa = await db.query("select to_regclass('supabase_migrations.schema_migrations') as t");
  const viaSupabase = new Set<string>(
    supa.rows[0].t ? (await db.query("select name from supabase_migrations.schema_migrations")).rows.map((r) => r.name) : [],
  );
  const dir = join(root, "supabase/migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const done = await db.query("select 1 from public._migrations where name = $1", [file]);
    if (done.rowCount) continue;
    if (viaSupabase.has(file.replace(/^\d+_/, "").replace(/\.sql$/, ""))) {
      await db.query("insert into public._migrations (name) values ($1)", [file]);
      continue;
    }
    await db.query("begin");
    try {
      await db.query(readFileSync(join(dir, file), "utf8"));
      await db.query("insert into public._migrations (name) values ($1)", [file]);
      await db.query("commit");
      console.log(`migrated ${file}`);
    } catch (err) {
      await db.query("rollback");
      throw err;
    }
  }
}

async function seed(db: pg.Client) {
  await db.query("begin");

  for (const p of ports) {
    await db.query(
      `insert into public.ports (name, state, lake, lat, lon, shore, home_river)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (name, state) do nothing`,
      [p.name, p.state, p.lake, p.lat, p.lon, p.shore, p.home_river],
    );
  }

  for (const s of stations) {
    await db.query(
      `insert into public.stations (source, external_id, name, lake, lat, lon, has_temp_profile, seasonal, meta)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (source, external_id) do update set name = excluded.name, lat = excluded.lat, lon = excluded.lon,
         has_temp_profile = excluded.has_temp_profile, seasonal = excluded.seasonal, meta = excluded.meta`,
      [s.source, s.external_id, s.name, s.lake, s.lat, s.lon, s.has_temp_profile, s.seasonal, JSON.stringify(s.meta)],
    );
  }

  // The station list is generated, not owner-edited: drop buoys that left it.
  await db.query(
    "delete from public.stations where source <> 'nws' and (source || '/' || external_id) <> all($1::text[])",
    [stations.map((s) => `${s.source}/${s.external_id}`)],
  );

  // Link each port to nearby stations, nearest first. Recomputed on every seed.
  const portRows = (await db.query("select id, lat, lon from public.ports")).rows;
  const stationRows = (await db.query("select id, lat, lon from public.stations where source <> 'nws'")).rows;
  await db.query("delete from public.port_stations");
  await db.query("update public.ports set nws = null"); // the refresh job relinks NWS observation stations
  for (const p of portRows) {
    const near = stationRows
      .map((s) => ({ id: s.id, mi: distanceMi(p.lat, p.lon, s.lat, s.lon) }))
      .filter((s) => s.mi <= PORT_STATION_LINK_MAX_MI)
      .sort((a, b) => a.mi - b.mi);
    for (const [i, s] of near.entries()) {
      await db.query(
        "insert into public.port_stations (port_id, station_id, distance_mi, rank) values ($1, $2, $3, $4)",
        [p.id, s.id, s.mi.toFixed(1), i + 1],
      );
    }
  }

  for (const raw of thresholds) {
    const t = thresholdSchema.parse(raw);
    await db.query(
      `insert into public.thresholds (name, value, unit, is_owner_estimate, note)
       values ($1, $2, $3, $4, $5) on conflict (name) do nothing`,
      [t.name, JSON.stringify(t.value), t.unit, t.is_owner_estimate, t.note],
    );
  }

  for (const raw of rules) {
    const r = ruleSchema.parse(raw);
    await db.query(
      `insert into public.rules (code, priority, stage, "when", recommend, tags, source_note, lakes, species, enabled, version)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) on conflict (code) do nothing`,
      [r.code, r.priority, r.stage, JSON.stringify(r.when), JSON.stringify(r.recommend), r.tags, r.source_note, r.lakes, r.species, r.enabled, r.version],
    );
  }

  for (const l of lures) {
    const { rows } = await db.query(
      `insert into public.lures (lure_type, name, brand, is_house_brand, size_in, body_style, speed_min_mph, speed_max_mph, dive_notes, shop_url)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       on conflict (lure_type, name) do update set updated_at = public.lures.updated_at
       returning id`,
      [l.lure_type, l.name, l.brand, l.is_house_brand, l.size_in, l.body_style, l.speed_min_mph, l.speed_max_mph, l.dive_notes, l.shop_url],
    );
    for (const f of l.finishes) {
      await db.query(
        `insert into public.lure_finishes (lure_id, name, base_color, finish_types, pattern, color_family)
         values ($1, $2, $3, $4, $5, $6) on conflict (lure_id, name) do nothing`,
        [rows[0].id, f.name, f.base_color, f.finish_types, f.pattern, f.color_family],
      );
    }
  }

  await db.query("commit");
  const counts = await db.query(
    `select (select count(*) from public.ports) as ports, (select count(*) from public.stations) as stations,
            (select count(*) from public.port_stations) as port_stations, (select count(*) from public.rules) as rules,
            (select count(*) from public.thresholds) as thresholds, (select count(*) from public.lures) as lures,
            (select count(*) from public.lure_finishes) as lure_finishes`,
  );
  console.log("seeded", counts.rows[0]);
}

async function reset(db: pg.Client) {
  if (!/localhost|127\.0\.0\.1/.test(DATABASE_URL)) throw new Error("reset only runs against a local database");
  await db.query("drop schema if exists private cascade; drop schema public cascade; create schema public; drop schema if exists auth cascade;");
  await migrate(db);
  await seed(db);
}

const command = process.argv[2];
const db = new pg.Client({ connectionString: DATABASE_URL });
await db.connect();
try {
  if (command === "migrate") await migrate(db);
  else if (command === "seed") await seed(db);
  else if (command === "reset") await reset(db);
  else throw new Error("usage: tsx scripts/db.mts migrate | seed | reset");
} finally {
  await db.end();
}
