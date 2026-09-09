import type { Usage } from "./usage.ts";

/**
 * What a generation actually costs.
 *
 * Kept as plain data next to the transport so a cost figure is never a number
 * somebody typed into a report by hand. The rates are USD per one million
 * tokens, as published by OpenAI; `cached` is the discounted rate a repeated
 * prompt prefix is billed at, which is the whole reason `lib/ai/prompt.ts`
 * bothers to keep its prefix stable.
 *
 * Pure, with no SDK import, so the arithmetic is unit-testable offline.
 */

export interface ModelRates {
  /** USD per 1M input tokens, uncached. */
  input: number;
  /** USD per 1M input tokens that hit the prompt cache. */
  cached: number;
  /** USD per 1M output tokens. */
  output: number;
}

/**
 * Rates as of the last time this table was checked against OpenAI's pricing
 * page (2026-09-09). A model absent from here is priced at zero rather than
 * guessed at — a made-up rate in a cost report is worse than an obviously
 * missing one.
 *
 * Reasoning models are the reason `output` is worth reading twice. Their
 * thinking tokens are billed as output at the output rate and are not returned
 * to us, so an unbounded `reasoning_effort` can multiply the real cost of a
 * model whose sticker price looks cheap. `lib/ai/openai.ts` pins the effort to
 * the floor for exactly that reason.
 */
export const RATES: Record<string, ModelRates> = {
  "gpt-4.1": { input: 2.0, cached: 0.5, output: 8.0 },
  "gpt-4.1-mini": { input: 0.4, cached: 0.1, output: 1.6 },
  "gpt-4.1-nano": { input: 0.1, cached: 0.025, output: 0.4 },
  "gpt-5.5": { input: 5.0, cached: 0.5, output: 30.0 },
  "gpt-5.4": { input: 2.5, cached: 0.25, output: 15.0 },
  "gpt-5.4-mini": { input: 0.75, cached: 0.075, output: 4.5 },
  "gpt-5.4-nano": { input: 0.2, cached: 0.02, output: 1.25 },
  "gpt-5.2": { input: 1.75, cached: 0.175, output: 14.0 },
  "gpt-5.1": { input: 1.25, cached: 0.125, output: 10.0 },
  "gpt-5": { input: 1.25, cached: 0.125, output: 10.0 },
  "gpt-5-mini": { input: 0.25, cached: 0.025, output: 2.0 },
  "gpt-5-nano": { input: 0.05, cached: 0.005, output: 0.4 },
};

export function ratesFor(model: string): ModelRates | null {
  return RATES[model] ?? null;
}

/**
 * USD for one call's usage.
 *
 * `cachedInput` is a subset of `input` in OpenAI's own accounting, so the
 * uncached remainder is what gets charged at the full rate. Getting that
 * backwards would overstate every saving prompt caching produces.
 */
export function costOf(model: string, usage: Usage): number {
  const rates = ratesFor(model);
  if (!rates) return 0;
  const fresh = Math.max(0, usage.input - usage.cachedInput);
  return (
    (fresh * rates.input +
      usage.cachedInput * rates.cached +
      usage.output * rates.output) /
    1_000_000
  );
}

/** USD formatted the way a per-pack figure is worth reading: cents matter. */
export function usd(amount: number): string {
  return amount >= 1 ? `$${amount.toFixed(2)}` : `$${amount.toFixed(4)}`;
}
