import type { Rule, Threshold } from "./schema";
import type { Catalog, EngineContext, EngineResult } from "./types";

export function evaluate(_context: EngineContext, _rules: Rule[], _thresholds: Threshold[], _catalog: Catalog): EngineResult {
  throw new Error("not implemented");
}
