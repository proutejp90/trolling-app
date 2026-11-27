/** The Anthropic API call. Server-only: the key is read from the environment and never reaches the client. */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { agentWire } from "./schema";
import type { ModelCall } from "./explain";

/** The model name lives in an env var, as the spec asks. Opus 5.5 is the default. */
export const agentModel = () => process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
export const agentConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY);

let client: Anthropic | null = null;

export const callModel: ModelCall = async ({ system, user, retryNote, previous, signal }) => {
  client ??= new Anthropic({ maxRetries: 0 }); // a slow retry is worse than the templated fallback
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: user }];
  if (retryNote && previous) messages.push({ role: "assistant", content: previous }, { role: "user", content: retryNote });
  const response = await client.messages.parse(
    {
      model: agentModel(),
      max_tokens: 4000,
      // The instructions and examples never change between requests, so they are cached.
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages,
      // A short, well-specified writing task: low effort keeps it inside the latency target.
      output_config: { effort: "low", format: zodOutputFormat(agentWire) },
    },
    { signal },
  );
  // A refusal or a cut-off answer is treated like any other failure: the templated reasons are shown.
  if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") return null;
  return response.parsed_output;
};
