/**
 * What the agent may write, and what the app shows. The agent writes words
 * only. Every depth, speed, lure, finish and evidence tag on the screen comes
 * from the engine and is attached here, in code, so the agent cannot change one.
 */
import { z } from "zod";
import { z as z4 } from "zod/v4";
import type { SetupLureType, Tag } from "@recommender/engine";

const sentence = z.string().min(1).max(260);

/** The structured output requested from the model. */
export const agentOutput = z.object({
  conditions_summary: z.string().min(1).max(360),
  groups: z.array(z.object({
    lure_type: z.enum(["spoon", "flasher_fly", "meat_rig", "plug"]),
    reasons: z.array(z.object({ text: sentence, rule_codes: z.array(z.string()).min(1).max(4) })).min(1).max(8),
  })).max(4),
  report_notes: z.array(z.object({ text: sentence, report_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), agrees: z.boolean() })).max(4),
  confidence_reason: sentence,
  caveats: z.array(sentence).max(3),
});
export type AgentOutput = z.infer<typeof agentOutput>;

/**
 * The same shape without length limits, in the zod flavor the SDK's structured-output
 * helper takes. The API constrains the shape; agentOutput then enforces the limits.
 */
export const agentWire = z4.object({
  conditions_summary: z4.string(),
  groups: z4.array(z4.object({
    lure_type: z4.enum(["spoon", "flasher_fly", "meat_rig", "plug"]),
    reasons: z4.array(z4.object({ text: z4.string(), rule_codes: z4.array(z4.string()) })),
  })),
  report_notes: z4.array(z4.object({ text: z4.string(), report_date: z4.string(), agrees: z4.boolean() })),
  confidence_reason: z4.string(),
  caveats: z4.array(z4.string()),
});

export interface Reason { text: string; rule_codes: string[]; tags: Tag[] }

/** What the recommendation screen renders, whether the agent or the templates wrote it. */
export interface Explanation {
  source: "agent" | "template";
  prompt_version: string | null;
  model: string | null;
  conditions_summary: string;
  groups: { lure_type: SetupLureType; reasons: Reason[] }[];
  report_notes: { text: string; report_date: string; agrees: boolean }[];
  confidence_reason: string;
  caveats: string[];
}

/** A validated fishing report row passed to the agent. Text fields are untrusted. */
export interface ReportRow {
  port: string; report_date: string; species: string;
  water_depth_min_ft: number | null; water_depth_max_ft: number | null;
  lure_depth_min_ft: number | null; lure_depth_max_ft: number | null;
  lures: string[]; colors: string[]; water_temp_f: number | null; break_depth_ft: number | null; notes: string | null;
}
