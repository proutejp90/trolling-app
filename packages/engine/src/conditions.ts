import type { Condition, Leaf, Threshold } from "./schema";

/** true, false, or null when the answer is unknown because an input is missing. */
export type Tri = boolean | null;
export interface Verdict { value: Tri; missing?: string }
export type Fields = Record<string, unknown>;
export type ThresholdMap = Map<string, Threshold["value"]>;

export function thresholdMap(thresholds: Threshold[]): ThresholdMap {
  return new Map(thresholds.map((t) => [t.name, t.value]));
}

/** Reads "name" or "name.min" / "name.max". Returns null when the threshold has no value. */
export function readThreshold(map: ThresholdMap, ref: string): number | null {
  const [name, key] = ref.split(".") as [string, string | undefined];
  const v = map.get(name);
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return key ? null : v;
  return key === "min" || key === "max" ? v[key] : null;
}

export function readRange(map: ThresholdMap, name: string): { min: number; max: number } | null {
  const v = map.get(name);
  return v !== null && typeof v === "object" ? v : null;
}

function leaf(l: Leaf, fields: Fields, thresholds: ThresholdMap): Verdict {
  const actual = fields[l.field];
  if (actual === undefined || actual === null) return { value: null, missing: `${l.field} is not known` };
  let expected: unknown = l.value;
  if (l.threshold !== undefined) {
    expected = readThreshold(thresholds, l.threshold);
    if (expected === null) return { value: null, missing: `threshold ${l.threshold} has no value` };
  }
  const num = (x: unknown) => (typeof x === "number" ? x : NaN);
  switch (l.op) {
    case "eq": return { value: actual === expected };
    case "ne": return { value: actual !== expected };
    case "in": return { value: Array.isArray(expected) && expected.includes(actual as never) };
    case "not_in": return { value: Array.isArray(expected) && !expected.includes(actual as never) };
    case "gt": return { value: num(actual) > num(expected) };
    case "gte": return { value: num(actual) >= num(expected) };
    case "lt": return { value: num(actual) < num(expected) };
    case "lte": return { value: num(actual) <= num(expected) };
    case "contains": return { value: Array.isArray(actual) && actual.includes(expected as never) };
  }
}

/** Three-valued evaluation: a missing input makes a condition unknown, not false. */
export function evalCondition(c: Condition, fields: Fields, thresholds: ThresholdMap): Verdict {
  if ("all" in c) {
    let unknown: Verdict | null = null;
    for (const part of c.all) {
      const v = evalCondition(part, fields, thresholds);
      if (v.value === false) return v;
      if (v.value === null) unknown ??= v;
    }
    return unknown ?? { value: true };
  }
  if ("any" in c) {
    let unknown: Verdict | null = null;
    for (const part of c.any) {
      const v = evalCondition(part, fields, thresholds);
      if (v.value === true) return v;
      if (v.value === null) unknown ??= v;
    }
    return unknown ?? { value: false };
  }
  if ("not" in c) {
    const v = evalCondition(c.not, fields, thresholds);
    return v.value === null ? v : { value: !v.value };
  }
  return leaf(c, fields, thresholds);
}

export function referencesField(c: Condition, field: string): boolean {
  if ("all" in c) return c.all.some((p) => referencesField(p, field));
  if ("any" in c) return c.any.some((p) => referencesField(p, field));
  if ("not" in c) return referencesField(c.not, field);
  return c.field === field;
}
