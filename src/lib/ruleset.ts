/**
 * The ruleset the quiz runs on: the seed rules, thresholds, ports and catalog,
 * bundled with the app so the quiz needs no live data. Phase 2 replaces this
 * with the rows in Postgres behind the same shape.
 */
import type { Catalog, CatalogLure, Rule, Threshold } from "@recommender/engine";
import { lures } from "../../seed/lures";
import { ports as seedPorts } from "../../seed/ports";
import { rules as seedRules } from "../../seed/rules";
import { thresholds as seedThresholds } from "../../seed/thresholds";

export const rules: Rule[] = seedRules;
export const thresholds: Threshold[] = seedThresholds;
export const ports = seedPorts;

export const catalog: Catalog = {
  lures: lures.map((l): CatalogLure => {
    const id = `${l.lure_type}:${l.name}`;
    return {
      id, lure_type: l.lure_type, name: l.name, is_house_brand: l.is_house_brand, size_in: l.size_in,
      speed_min_mph: l.speed_min_mph, speed_max_mph: l.speed_max_mph, active: true,
      finishes: l.finishes.map((f) => ({ ...f, id: `${id}/${f.name}`, active: true })),
    };
  }),
};
