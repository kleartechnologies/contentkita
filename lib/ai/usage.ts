/**
 * What one generation cost, in tokens.
 *
 * Deliberately a tiny, boring shape. It is the only thing the transport reports
 * back besides the content itself, and it is the only thing the server logs
 * about a generation — no prompt text, no restaurant fields, no owner
 * identifiers beyond what the route already has, and under no circumstances the
 * provider key.
 *
 * Pure, with no SDK import, so it can be built and summed in a test.
 */

export interface Usage {
  /** Prompt tokens, including any that were served from the prompt cache. */
  input: number;
  /** The subset of `input` that hit OpenAI's prompt cache, at a lower rate. */
  cachedInput: number;
  output: number;
}

export const ZERO_USAGE: Usage = { input: 0, cachedInput: 0, output: 0 };

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    input: a.input + b.input,
    cachedInput: a.cachedInput + b.cachedInput,
    output: a.output + b.output,
  };
}

export function totalTokens(usage: Usage): number {
  return usage.input + usage.output;
}

/** Share of prompt tokens that were served from cache, as a 0-1 fraction. */
export function cacheHitRate(usage: Usage): number {
  return usage.input === 0 ? 0 : usage.cachedInput / usage.input;
}

/**
 * The `usage` block of a chat completion, read defensively.
 *
 * Every field is optional in practice: a stand-in server may omit the block
 * entirely, and `prompt_tokens_details` only appears on models that support
 * prompt caching. Missing numbers become zero rather than throwing, because a
 * generation that succeeded must not fail on the way to the accounting.
 */
export function readUsage(raw: unknown): Usage {
  if (typeof raw !== "object" || raw === null) return ZERO_USAGE;
  const u = raw as {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    prompt_tokens_details?: { cached_tokens?: unknown } | null;
  };
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const input = num(u.prompt_tokens);
  return {
    input,
    // Never allow the cached figure to exceed the total it is a subset of; a
    // provider oddity there would otherwise show up as a negative bill.
    cachedInput: Math.min(input, num(u.prompt_tokens_details?.cached_tokens)),
    output: num(u.completion_tokens),
  };
}
