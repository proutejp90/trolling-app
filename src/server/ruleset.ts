/** Rules, thresholds, catalog and ports: from Postgres when it is configured, else the bundled seed. */
import type { Catalog, CatalogLure, Rule, Threshold } from "@recommender/engine";
import * as bundled from "@/lib/ruleset";
import type { PortRow } from "./conditions";
import type { Queryable } from "./db";

export interface Ruleset { rules: Rule[]; thresholds: Threshold[]; catalog: Catalog; ports: PortRow[]; source: "database" | "bundled" }

export function bundledRuleset(): Ruleset {
  return {
    rules: bundled.rules, thresholds: bundled.thresholds, catalog: bundled.catalog, source: "bundled",
    ports: bundled.ports.map((p) => ({ id: null, name: p.name, shore: p.shore, lat: p.lat, lon: p.lon })),
  };
}

export async function loadRuleset(q: Queryable): Promise<Ruleset> {
  const [rules, thresholds, lures, finishes, ports] = await Promise.all([
    q.query(`select code, stage, priority, "when", recommend, tags, source_note, lakes, species, enabled, version from public.rules`),
    q.query("select name, value, unit, is_owner_estimate, note from public.thresholds"),
    q.query("select id, lure_type, name, is_house_brand, size_in, speed_min_mph, speed_max_mph, active from public.lures order by lure_type, size_in nulls last, name"),
    q.query("select id, lure_id, name, base_color, finish_types, pattern, color_family, active from public.lure_finishes order by created_at, name"),
    q.query("select id, name, shore, lat, lon, time_zone from public.ports where active order by lat"),
  ]);
  const n = (v: unknown) => (v === null ? null : Number(v));
  return {
    source: "database",
    rules: rules.rows as Rule[],
    thresholds: thresholds.rows as Threshold[],
    ports: ports.rows as PortRow[],
    catalog: {
      lures: lures.rows.map((l): CatalogLure => ({
        ...l, size_in: n(l.size_in), speed_min_mph: n(l.speed_min_mph), speed_max_mph: n(l.speed_max_mph),
        finishes: finishes.rows.filter((f) => f.lure_id === l.id),
      })),
    },
  };
}
