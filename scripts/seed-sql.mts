/**
 * Prints the seed as one SQL script, for databases this machine cannot reach
 * directly (paste into the Supabase SQL editor). Same rows as `db:seed`, same
 * rule: existing rows are left alone. Usage: tsx scripts/seed-sql.mts > seed.sql
 */
import { ruleSchema, thresholdSchema } from "@recommender/engine";
import { lures } from "../seed/lures";
import { ports } from "../seed/ports";
import { rules } from "../seed/rules";
import { distanceMi, PORT_STATION_LINK_MAX_MI, stations } from "../seed/stations";
import { thresholds } from "../seed/thresholds";

const lit = (v: unknown) => `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
const out: string[] = [];

out.push(`insert into public.ports (name, state, lake, lat, lon, shore, home_river)
select name, state, lake, lat, lon, shore, home_river from jsonb_to_recordset(${lit(ports)})
  as x(name text, state text, lake text, lat float8, lon float8, shore text, home_river text)
on conflict (name, state) do nothing;`);

out.push(`insert into public.stations (source, external_id, name, lake, lat, lon, has_temp_profile, seasonal)
select source, external_id, name, lake, lat, lon, has_temp_profile, seasonal from jsonb_to_recordset(${lit(stations)})
  as x(source text, external_id text, name text, lake text, lat float8, lon float8, has_temp_profile bool, seasonal bool)
on conflict (source, external_id) do nothing;`);

const links = ports.flatMap((p) =>
  stations
    .map((s) => ({ p: p.name, st: p.state, src: s.source, ext: s.external_id, mi: Number(distanceMi(p.lat, p.lon, s.lat, s.lon).toFixed(1)) }))
    .filter((l) => l.mi <= PORT_STATION_LINK_MAX_MI)
    .sort((a, b) => a.mi - b.mi)
    .map((l, i) => ({ ...l, rank: i + 1 })),
);
out.push(`insert into public.port_stations (port_id, station_id, distance_mi, rank)
select p.id, s.id, x.mi, x.rank from jsonb_to_recordset(${lit(links)})
  as x(p text, st text, src text, ext text, mi numeric, rank int)
join public.ports p on p.name = x.p and p.state = x.st
join public.stations s on s.source = x.src and s.external_id = x.ext
on conflict do nothing;`);

out.push(`insert into public.thresholds (name, value, unit, is_owner_estimate, note)
select name, coalesce(value, 'null'::jsonb), unit, is_owner_estimate, note from jsonb_to_recordset(${lit(thresholds.map((t) => thresholdSchema.parse(t)))})
  as x(name text, value jsonb, unit text, is_owner_estimate bool, note text)
on conflict (name) do nothing;`);

out.push(`insert into public.rules (code, priority, stage, "when", recommend, tags, source_note, lakes, species, enabled, version)
select code, priority, stage, "when", recommend,
  array(select jsonb_array_elements_text(tags)), source_note, array(select jsonb_array_elements_text(lakes)), species, enabled, version
from jsonb_to_recordset(${lit(rules.map((r) => ruleSchema.parse(r)))})
  as x(code text, priority int, stage text, "when" jsonb, recommend jsonb, tags jsonb, source_note text, lakes jsonb, species text, enabled bool, version int)
on conflict (code) do nothing;`);

// Lures share a few finish sets; emit each set once.
const sets = new Map<string, number>();
const setList: unknown[][] = [];
const lureRows = lures.map(({ finishes, ...l }) => {
  const key = JSON.stringify(finishes);
  if (!sets.has(key)) { sets.set(key, setList.length); setList.push(finishes); }
  return { ...l, set: sets.get(key)! };
});
out.push(`insert into public.lures (lure_type, name, brand, is_house_brand, size_in, body_style, speed_min_mph, speed_max_mph, dive_notes, shop_url)
select lure_type, name, brand, is_house_brand, size_in, body_style, speed_min_mph, speed_max_mph, dive_notes, shop_url from jsonb_to_recordset(${lit(lureRows)})
  as x(lure_type text, name text, brand text, is_house_brand bool, size_in numeric, body_style text, speed_min_mph numeric, speed_max_mph numeric, dive_notes text, shop_url text)
on conflict (lure_type, name) do nothing;`);
out.push(`insert into public.lure_finishes (lure_id, name, base_color, finish_types, pattern, color_family)
select l.id, f.name, f.base_color, array(select jsonb_array_elements_text(f.finish_types)), f.pattern, f.color_family
from jsonb_to_recordset(${lit(lureRows.map((l) => ({ lure_type: l.lure_type, name: l.name, set: l.set })))}) as x(lure_type text, name text, set int)
join public.lures l on l.lure_type = x.lure_type and l.name = x.name
cross join lateral jsonb_to_recordset(${lit(setList)} -> x.set)
  as f(name text, base_color text, finish_types jsonb, pattern text, color_family text)
on conflict (lure_id, name) do nothing;`);

console.log(out.join("\n\n"));
