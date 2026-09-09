import "server-only";

import { createHash } from "node:crypto";

import { ITEMS_SCHEMA } from "./prompt.ts";
import { addUsage, readUsage, ZERO_USAGE, type Usage } from "./usage.ts";

/**
 * The OpenAI transport. Server-only, by construction.
 *
 * `server-only` makes an accidental import from a client component a build
 * error rather than a leaked key, and the key itself is read from a plain
 * `OPENAI_API_KEY` — never a `NEXT_PUBLIC_` variable, which Next would inline
 * into the browser bundle.
 *
 * Deliberately plain `fetch` rather than a provider SDK: one request shape is
 * all this product makes, and a dependency-free transport is easier to audit
 * for exactly the thing that matters here — that the secret never leaves the
 * server and the raw provider error never reaches a user.
 */

const DEFAULT_BASE = "https://api.openai.com/v1";

/**
 * Where requests go.
 *
 * Overridable so the end-to-end flow can be exercised against a local stub
 * during development without anyone holding the production key. In production
 * this is unset and the real API is used; nothing about the key handling
 * changes either way.
 */
function endpoint(): string {
  const base = process.env.OPENAI_BASE_URL?.trim().replace(/\/+$/, "");
  return `${base || DEFAULT_BASE}/chat/completions`;
}

/**
 * The two models, and why there are two.
 *
 * Writing is the bulk of the spend — thirty captions is thirty captions' worth
 * of output tokens. A repair is narrow: it rewrites only the days the validator
 * rejected. Keeping them separate is what lets the writing model be chosen on
 * price without the failure path getting worse.
 *
 * Both default to `gpt-5.4-mini`, decided by `scripts/ai-bench.ts` across
 * seventeen benchmarked months of the demo restaurant — same brief, same
 * schedule, same batch boundaries — and decided on truthfulness rather than on
 * price or prose:
 *
 *   gpt-4.1        $0.108 a pack. The warmest Malay of the candidates, and the
 *                  most fabrication: 1, 2, 2 and 5 invented opening hours over
 *                  four runs, one of which ended with 18 of 30 days because two
 *                  batches could not be repaired inside the bound.
 *   gpt-4.1-mini   $0.023. Neither of two runs produced a whole month.
 *   gpt-5.4-nano   $0.019. 18 of 30 days, nine violations. Not a candidate.
 *   gpt-5-mini     $0.026-$0.031. The best variety of the cheap models and the
 *                  closest to gpt-4.1 in voice — and it invents hours and
 *                  prices too: three runs gave 30, 30, then 25 of 30 days with
 *                  ten violations. Also the slowest, 25.7s for a batch that
 *                  needed its repair, against a thirty-second platform limit.
 *   gpt-5.4-mini   $0.040-$0.048. Five months on the shipping prompt, five
 *                  complete, zero repairs and zero violations in all five.
 *                  Slowest batch 15.2s.
 *
 * Invented opening hours are the failure mode of this product, and gpt-5.4-mini
 * is the only candidate that has not yet produced one. A pack that delivers 25
 * of 30 days is not a cheaper pack, it is a broken one. That took precedence
 * over the two places gpt-5.4-mini reads weaker than gpt-4.1: it leans on a
 * handful of words — "orang" turns up in 11 of 30 hooks — and given three
 * `best_seller` days in one month it tends to write one sentence three ways.
 * Those are lines an owner can edit in the plan view. An invented opening time
 * is one they cannot catch.
 *
 * Five clean runs is evidence, not a guarantee: a sixth, under a prompt variant
 * that was tried and reverted, produced two. `MAX_REPAIRS` and the validator
 * are what make that safe, not the model's record.
 *
 * Repair stays on the same model. A stronger repair model was worth pricing and
 * is not worth buying while the writing model is not reaching the repair path;
 * `OPENAI_REPAIR_MODEL` is there for the day that changes.
 *
 * Both are overridable from the environment, and neither should change without
 * a benchmark behind it.
 */
const DEFAULT_MODEL = "gpt-5.4-mini";
const DEFAULT_REPAIR_MODEL = "gpt-5.4-mini";

export function aiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export function aiModel(): string {
  return process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL;
}

/** Falls back to the writing model, so unsetting one variable cannot leave a gap. */
export function repairModel(): string {
  return process.env.OPENAI_REPAIR_MODEL?.trim() || DEFAULT_REPAIR_MODEL;
}

/**
 * A failure that has already been decided to be safe to surface.
 *
 * `code` is what the browser receives; the route maps it to Malay wording. The
 * provider's own message is logged server-side and never travels.
 */
export class AiError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  /**
   * What the failed attempt was billed, when it got far enough to be billed at
   * all. A truncated response costs the same as a useful one, and a cost report
   * that dropped it would understate what generation really costs.
   */
  usage: Usage | null = null;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = "AiError";
    this.code = code;
    this.retryable = retryable;
  }
}

export interface CompletionInput {
  system: string;
  user: string;
  /** Upper bound on the response. Sized by how many days were asked for. */
  maxTokens: number;
  /** Defaults to `aiModel()`. A repair passes the stronger model here. */
  model?: string;
  /**
   * Groups requests that share a prompt prefix so they are likely to land on
   * the same cache. Hashed before it is sent: the provider needs a stable
   * opaque string, not the identifier itself.
   */
  cacheGroup?: string;
  signal?: AbortSignal;
}

export interface CompletionResult {
  content: unknown;
  usage: Usage;
  model: string;
}

/** How long a single attempt may take before it is abandoned. */
const ATTEMPT_TIMEOUT_MS = 120_000;
const MAX_ATTEMPTS = 3;

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

/** A stable, meaningless string. Enough to route a cache, useless to anyone reading a log. */
function cacheKey(group: string): string {
  return createHash("sha256").update(group).digest("hex").slice(0, 32);
}

/**
 * Enough variation to keep thirty hooks from rhyming, low enough that the truth
 * rules are still followed closely. Only sent to models that accept it.
 */
const TEMPERATURE = 0.8;

/** The request fields a given model will actually accept. */
interface Tuning {
  /** `max_tokens` or `max_completion_tokens` — the reasoning models renamed it. */
  tokenField: "max_tokens" | "max_completion_tokens";
  /** Everything else that varies by model family. */
  params: Record<string, unknown>;
}

/**
 * What each model family will take, measured rather than assumed.
 *
 * One request shape no longer covers the catalogue. GPT-5 models reject
 * `max_tokens` outright, and they think before they answer — thinking tokens
 * are billed as output and never returned, so a model whose sticker price is a
 * quarter of gpt-4.1's can quietly cost more than it. Every rule below was
 * probed against the live API rather than read off a changelog:
 *
 *   gpt-4.1*                 max_tokens, temperature
 *   gpt-5, -mini, -nano      max_completion_tokens, reasoning_effort:minimal,
 *                            no temperature (only the default 1 is allowed)
 *   gpt-5.1 … gpt-5.4*       max_completion_tokens, reasoning_effort:none,
 *                            temperature
 *   gpt-5.5                  as 5.1+, but temperature is refused again
 *
 * `reasoning_effort` is pinned to whichever floor the model offers. ContentKita
 * asks for restaurant captions against a brief it has already been handed; it
 * does not need the model to deliberate, and left unset gpt-5-mini spent 320
 * thinking tokens writing a single hook.
 *
 * A name matching neither family keeps the shape this product has always sent,
 * which is the one the rest of the `gpt-4o`-era catalogue still answers to. If
 * that guess is wrong the provider says so in a 400 that lands in the server
 * log with the parameter named — a loud failure on a deliberately configured
 * model, not a silent wrong answer.
 */
function tuning(model: string): Tuning {
  const version = /^gpt-5(?:\.(\d+))?(?:$|[-.])/.exec(model);
  if (!version) {
    return { tokenField: "max_tokens", params: { temperature: TEMPERATURE } };
  }

  const minor = Number(version[1] ?? 0);
  return {
    tokenField: "max_completion_tokens",
    params: {
      // The 5.0 line calls its floor "minimal"; everything after it calls the
      // same idea "none" and rejects the older word.
      reasoning_effort: minor === 0 ? "minimal" : "none",
      // 5.0 and 5.5 accept only the default temperature; the versions between
      // them take ours. Defaulting to 1 errs towards more variety, not less,
      // which is the safe direction for a product that needs thirty distinct
      // hooks.
      ...(minor >= 1 && minor <= 4 ? { temperature: TEMPERATURE } : {}),
    },
  };
}

function billed(error: AiError, usage: Usage): AiError {
  error.usage = usage;
  return error;
}

async function once(
  input: CompletionInput,
  key: string,
  model: string,
  maxTokens: number,
): Promise<{ raw: string; usage: Usage }> {
  const { tokenField, params } = tuning(model);

  const timeout = AbortSignal.timeout(ATTEMPT_TIMEOUT_MS);
  const signal = input.signal
    ? AbortSignal.any([input.signal, timeout])
    : timeout;

  let response: Response;
  try {
    response = await fetch(endpoint(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      signal,
      body: JSON.stringify({
        model,
        ...params,
        // `max_tokens` was renamed for the reasoning models. Whichever name
        // this model answers to, the ceiling itself is the same number.
        [tokenField]: maxTokens,
        // Every batch of a month shares a long identical prefix. This asks the
        // provider to route them together. Measured, it changes nothing at
        // ContentKita's prefix size — see the note in `prompt.ts` — but it is
        // free, it is the documented way to ask, and it is what makes the
        // discount arrive by itself if the prefix ever grows.
        ...(input.cacheGroup ? { prompt_cache_key: cacheKey(input.cacheGroup) } : {}),
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "content_plan",
            strict: true,
            schema: ITEMS_SCHEMA,
          },
        },
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.user },
        ],
      }),
    });
  } catch (error) {
    if (input.signal?.aborted) throw new AiError("cancelled", "Request cancelled");
    // A DNS failure, a dropped socket or our own timeout all land here.
    throw new AiError(
      "unavailable",
      `Provider unreachable: ${error instanceof Error ? error.name : "unknown"}`,
      true,
    );
  }

  if (!response.ok) {
    // Read the body for the server log only. It can contain provider detail and
    // must never be forwarded to the browser.
    const body = await response.text().catch(() => "");
    if (response.status === 401 || response.status === 403) {
      throw new AiError("misconfigured", `Provider rejected the key (${response.status})`);
    }
    if (response.status === 400) {
      throw new AiError("bad_request", `Provider rejected the request: ${body.slice(0, 500)}`);
    }
    throw new AiError(
      isRetryableStatus(response.status) ? "unavailable" : "provider_error",
      `Provider returned ${response.status}: ${body.slice(0, 500)}`,
      isRetryableStatus(response.status),
    );
  }

  const payload = (await response.json()) as {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
    usage?: unknown;
  };
  const choice = payload.choices?.[0];
  const content = choice?.message?.content;
  const usage = readUsage(payload.usage);

  if (choice?.finish_reason === "length") {
    // A truncated response is malformed JSON. Say so precisely rather than
    // letting the parser report a syntax error twenty lines later.
    throw billed(new AiError("truncated", "Model response hit the token ceiling", true), usage);
  }
  if (typeof content !== "string" || !content.trim()) {
    throw billed(new AiError("empty", "Model returned no content", true), usage);
  }

  return { raw: content, usage };
}

/**
 * One completion, with bounded retries for transient failures only.
 *
 * A rejected key or a malformed request is never retried — retrying a 401 just
 * burns time and tells us nothing new. A truncation is retried with a larger
 * ceiling rather than at the same one: repeating an identical request that has
 * already proved too small pays for three failures and cannot succeed.
 *
 * Usage is reported for every attempt that reached the provider, including the
 * ones that then failed. A truncated response is billed, and a cost report that
 * quietly dropped it would understate what generation actually costs.
 */
export async function complete(input: CompletionInput): Promise<CompletionResult> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new AiError("misconfigured", "OPENAI_API_KEY is not set");

  const model = input.model ?? aiModel();
  let maxTokens = input.maxTokens;
  let spent: Usage = ZERO_USAGE;
  let last: AiError | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const { raw, usage } = await once(input, key, model, maxTokens);
      spent = addUsage(spent, usage);
      try {
        return { content: JSON.parse(raw), usage: spent, model };
      } catch {
        throw new AiError("malformed", "Model returned content that is not JSON", true);
      }
    } catch (error) {
      const failure =
        error instanceof AiError
          ? error
          : new AiError("unknown", error instanceof Error ? error.message : "unknown");

      // Whatever this attempt was billed counts, whether or not it was useful.
      if (failure.usage) spent = addUsage(spent, failure.usage);
      failure.usage = spent;

      if (!failure.retryable || attempt === MAX_ATTEMPTS) throw failure;
      if (failure.code === "truncated") {
        // Give the next attempt room to finish. Capped so a pathological
        // response cannot escalate the ceiling without bound.
        maxTokens = Math.min(16_000, Math.round(maxTokens * 1.5));
      }
      last = failure;
      // Plain exponential backoff. No jitter: this is one user's single
      // generation, not a fleet stampeding a shared endpoint.
      await new Promise((resolve) => setTimeout(resolve, 800 * 2 ** (attempt - 1)));
    }
  }

  throw last ?? new AiError("unknown", "Generation failed");
}
