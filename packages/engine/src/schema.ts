/**
 * Shapes for rules and thresholds as data. No framework imports: this package
 * must run alone under a test runner and be reusable outside the app.
 *
 * Phase 0 defines the data shapes and the seed rows. evaluate() lands in Phase 1.
 */
import { z } from "zod";

export const STAGES = ["location", "depth", "presentation", "color", "speed", "tip"] as const;
export const TAGS = ["science", "reports", "lore"] as const;
/** Setup-level lure types used in recommendations and passes. */
export const SETUP_LURE_TYPES = ["spoon", "flasher_fly", "meat_rig", "plug"] as const;
/** Catalog row types. A flasher_fly setup joins an attractor row and a fly row. */
export const CATALOG_LURE_TYPES = ["spoon", "plug", "fly", "meat_rig", "attractor"] as const;
export const FINISH_TYPES = ["chrome", "glow", "fluorescent", "uv", "paint"] as const;
export const COLOR_FAMILIES = [
  "red", "orange", "yellow", "chartreuse", "green", "blue", "purple", "silver", "white", "black",
] as const;

export const OPS = ["eq", "ne", "in", "not_in", "gt", "gte", "lt", "lte", "contains"] as const;

const scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);

/** A leaf compares a context field with a literal value or a named threshold. */
export const leafSchema = z
  .object({
    field: z.string().min(1),
    op: z.enum(OPS),
    value: z.union([scalar, z.array(scalar)]).optional(),
    /** Name of a thresholds row; a dotted suffix reads a key, e.g. "temp_band_f.min". */
    threshold: z.string().min(1).optional(),
  })
  .strict()
  .refine((l) => (l.value !== undefined) !== (l.threshold !== undefined), {
    message: "a condition needs exactly one of value or threshold",
  });

export type Leaf = z.infer<typeof leafSchema>;
export type Condition = Leaf | { all: Condition[] } | { any: Condition[] } | { not: Condition };

export const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    leafSchema,
    z.object({ all: z.array(conditionSchema) }).strict(),
    z.object({ any: z.array(conditionSchema) }).strict(),
    z.object({ not: conditionSchema }).strict(),
  ]),
);

export const ruleSchema = z
  .object({
    code: z.string().regex(/^[RP]\d{2}$/),
    stage: z.enum(STAGES),
    /** Higher wins within a stage. Ties go to the stronger tag: science, reports, lore. */
    priority: z.number().int(),
    /** { all: [] } means always. */
    when: conditionSchema,
    /** Stage-specific payload. Phase 1 tightens this per stage. */
    recommend: z.record(z.unknown()),
    /** One or two evidence tags, strongest first. */
    tags: z.array(z.enum(TAGS)).min(1).max(2),
    source_note: z.string().min(1),
    lakes: z.array(z.string()).min(1),
    species: z.string().default("chinook"),
    enabled: z.boolean(),
    version: z.number().int().positive().default(1),
  })
  .strict();

export type Rule = z.infer<typeof ruleSchema>;

const range = z.object({ min: z.number(), max: z.number() }).strict().refine((r) => r.min <= r.max);

export const thresholdSchema = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9_]*$/),
    /** null marks a placeholder the owner has not set. Rules that read it are skipped. */
    value: z.union([z.number(), range, z.null()]),
    unit: z.string(),
    /** True when no research backs the number. The admin screen flags these. */
    is_owner_estimate: z.boolean(),
    note: z.string(),
  })
  .strict();

export type Threshold = z.infer<typeof thresholdSchema>;
