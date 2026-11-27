/**
 * Turns an engine result into an explanation. One model call, checked on the
 * server; on a failed check, one retry that tells the model what was wrong;
 * after that, or on any error or timeout, the templated explanation.
 * The app never depends on the model being up.
 */
import type { EngineResult } from "@recommender/engine";
import type { Conditions } from "../conditions";
import { assemble, checkAgentOutput } from "./checks";
import { buildFacts, PROMPT_VERSION, SYSTEM_PROMPT, userMessage } from "./prompt";
import { agentOutput, type AgentOutput, type Explanation, type ReportRow } from "./schema";
import { templateExplanation } from "./template";

/** One call to the model. Returns the parsed output, or null when it refused or returned nothing usable. */
export type ModelCall = (args: { system: string; user: string; retryNote?: string; previous?: string; signal: AbortSignal }) => Promise<unknown>;

export interface ExplainInput {
  port: string; date: string; engine: EngineResult; conditions: Conditions;
  confidence: "low" | "medium" | "high"; confidenceReason: string; depthSource: string; reports?: ReportRow[];
}
export interface ExplainResult {
  explanation: Explanation;
  attempts: number;
  /** Why each rejected attempt failed, for the audit table and the evals. */
  rejections: string[][];
  latency_ms: number;
  raw: AgentOutput | null;
}

export async function explain(input: ExplainInput, deps: { call: ModelCall | null; model: string | null; timeoutMs?: number }): Promise<ExplainResult> {
  const started = Date.now();
  const fallback = templateExplanation(input.engine, input.conditions, input.confidenceReason);
  const done = (explanation: Explanation, attempts: number, rejections: string[][], raw: AgentOutput | null): ExplainResult =>
    ({ explanation, attempts, rejections, latency_ms: Date.now() - started, raw });
  if (!deps.call || !deps.model || input.engine.status !== "ok" || input.engine.setups.length === 0) return done(fallback, 0, [], null);

  const reports = input.reports ?? [];
  const user = userMessage(buildFacts({ ...input, reports }));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 12_000);
  const rejections: string[][] = [];
  let retryNote: string | undefined, previous: string | undefined;
  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const raw = await deps.call({ system: SYSTEM_PROMPT, user, retryNote, previous, signal: controller.signal });
      const parsed = agentOutput.safeParse(raw);
      const problems = parsed.success
        ? checkAgentOutput(parsed.data, input.engine, input.conditions, input.date, reports).problems
        : parsed.error.issues.map((i) => `schema: ${i.path.join(".")} ${i.message}`);
      if (parsed.success && problems.length === 0) {
        return done(assemble(parsed.data, input.engine, { prompt_version: PROMPT_VERSION, model: deps.model }), attempt, rejections, parsed.data);
      }
      rejections.push(problems);
      previous = JSON.stringify(raw ?? null);
      retryNote = `Your last answer was rejected by the server's checks. Fix exactly these problems and answer again:\n- ${problems.slice(0, 12).join("\n- ")}`;
    }
  } catch (err) {
    rejections.push([`call failed: ${err instanceof Error ? err.name : "error"}`]);
  } finally {
    clearTimeout(timer);
  }
  return done(fallback, rejections.length, rejections, null);
}
