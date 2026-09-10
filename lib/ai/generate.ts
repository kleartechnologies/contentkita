import "server-only";

import { buildBrief, ownerSuppliedText, type RestaurantBrief } from "../content/brief.ts";
import { addDays } from "../content/mock-generator.ts";
import { validateResponse, type Violation } from "../content/validate.ts";
import type { ContentItem } from "../content/types.ts";

import { AiError, aiModel, complete, repairModel } from "./openai.ts";
import { daysPrompt, systemPrompt } from "./prompt.ts";
import type { GenerationRequestBody } from "./request.ts";
import { addUsage, ZERO_USAGE, type Usage } from "./usage.ts";

/**
 * Turning a request into validated days.
 *
 * The cost shape is deliberate and bounded. One request asks for the days it
 * names and nothing else, and at most one repair follows, asking only for the
 * days that failed validation. So a batch costs one call in the normal case and
 * never more than two. There is no per-field calling, no agent loop and no
 * second model grading the first — validation is deterministic code in
 * `lib/content/validate.ts`, which costs nothing and cannot itself hallucinate.
 *
 * ## Which model does what
 *
 * Writing goes to `aiModel()` and a repair to `repairModel()`, kept separate so
 * the failure path can be given a stronger model than the writing path without
 * paying that rate for thirty captions. They currently name the same model —
 * see the note in `openai.ts` for why a stronger repair was priced and not
 * bought.
 *
 * How often a repair happens is a property of the writing model, not of this
 * code, and `scripts/ai-bench.ts` measures it rather than assuming it. On
 * gpt-4.1 roughly one day in eight was rejected, which landed a repair in most
 * six-day batches; on the current gpt-5.4-mini four benchmarked months needed
 * none at all. Neither number is a guarantee. A repair rewrites only the
 * failing days, so it is cheap when it comes, and nothing here may assume it
 * will not.
 */

/**
 * At most one repair, and no way to configure that upwards.
 *
 * A repair is a retry of a request that already produced tokens, so a loop here
 * is a loop that spends money. The bound is a constant rather than an
 * environment variable precisely so a bad deploy cannot raise it.
 */
const MAX_REPAIRS = 1;

/** Roughly 320 tokens a day plus headroom, floored so a one-day ask is not starved. */
function budgetFor(days: number): number {
  return Math.min(16_000, Math.max(1_500, days * 420 + 800));
}

/** The distinct instructions behind a set of violations, most useful first. */
function reasonsFrom(violations: Violation[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of violations) {
    if (seen.has(v.detail)) continue;
    seen.add(v.detail);
    out.push(v.detail);
  }
  return out.slice(0, 10);
}

/**
 * A generation that did not finish, carrying what it spent getting there.
 *
 * Without this a failed pack logs as free and blameless — no calls, no repairs,
 * no violations, no tokens — which is precisely backwards: a failure is the run
 * worth knowing the most about, because it was billed and produced nothing. The
 * counters travel with the error rather than dying in the stack.
 */
export class GenerationFailure extends AiError {
  readonly calls: number;
  readonly repairs: number;
  /** Every rejection along the way — why it failed, in the validator's words. */
  readonly violations: Violation[];
  readonly models: string[];
  readonly durationMs: number;

  constructor(cause: AiError, state: Omit<GenerationOutcome, "items">) {
    super(cause.code, cause.message, cause.retryable);
    this.name = "GenerationFailure";
    this.usage = state.usage;
    this.calls = state.calls;
    this.repairs = state.repairs;
    this.violations = state.violations;
    this.models = state.models;
    this.durationMs = state.durationMs;
  }
}

export interface GenerationOutcome {
  items: ContentItem[];
  /**
   * Everything the validator rejected on the way to this result, across every
   * attempt. Empty when the first pass was clean, which is what makes it the
   * honest measure of how often the writing model fabricates something — a
   * repaired violation still happened, and a report that only kept the final
   * attempt's would show a permanent zero.
   */
  violations: Violation[];
  calls: number;
  /** Calls that were repairs. Zero on the happy path, at most `MAX_REPAIRS`. */
  repairs: number;
  usage: Usage;
  /** The model that wrote the content, and the one that repaired it if any. */
  models: string[];
  durationMs: number;
}

export async function generateItems(
  request: GenerationRequestBody,
  signal?: AbortSignal,
): Promise<GenerationOutcome> {
  const started = Date.now();
  const { restaurant, days, startDate, mode, targetDays } = request;

  const brief: RestaurantBrief = buildBrief(restaurant, days, startDate);
  const supplied = ownerSuppliedText(restaurant);
  const planId = `plan-${restaurant.id}`;
  const dateForDay = (day: number) => addDays(startDate, day - 1);

  const wanted = mode === "days" ? targetDays : brief.schedule.map((s) => s.day);

  // Every batch of one owner's month shares this string exactly. It is the
  // prompt cache's prefix, and the reason the facts are not restated per batch.
  const system = systemPrompt(brief);

  let calls = 0;
  let repairs = 0;
  let usage: Usage = ZERO_USAGE;
  const models = new Set<string>();
  const collected = new Map<number, ContentItem>();
  let outstanding = wanted;
  // The last attempt's, which is what the repair prompt and the failure message
  // are built from, kept apart from the running record of everything rejected.
  let violations: Violation[] = [];
  const rejected: Violation[] = [];
  let prompt = daysPrompt(brief, wanted, {
    avoid: request.avoid,
    avoidCtas: request.avoidCtas,
  });

  for (let attempt = 0; attempt <= MAX_REPAIRS; attempt++) {
    calls += 1;
    const repairing = attempt > 0;
    if (repairing) repairs += 1;

    let result;
    try {
      result = await complete({
        system,
        user: prompt,
        maxTokens: budgetFor(outstanding.length),
        model: repairing ? repairModel() : aiModel(),
        // Groups this owner's batches so they share a cache. It is a hash of an
        // opaque plan id — no owner detail travels with it.
        cacheGroup: planId,
        signal,
      });
    } catch (error) {
      // A failed call was still billed, and it was one of the calls this
      // generation made. Both facts leave with the error rather than being
      // rounded down to nothing by whoever logs it.
      if (error instanceof AiError) {
        throw new GenerationFailure(error, {
          violations: rejected,
          calls,
          repairs,
          usage: addUsage(usage, error.usage ?? ZERO_USAGE),
          models: [...models],
          durationMs: Date.now() - started,
        });
      }
      throw error;
    }

    usage = addUsage(usage, result.usage);
    models.add(result.model);

    const validated = validateResponse(result.content, {
      brief,
      supplied,
      planId,
      dateForDay,
      expectedDays: outstanding,
      written: request.avoid,
    });

    for (const item of validated.items) collected.set(item.day, item);
    violations = validated.violations;
    rejected.push(...validated.violations);

    outstanding = [...validated.badDays, ...validated.missingDays].sort((a, b) => a - b);
    if (outstanding.length === 0) break;

    if (attempt === MAX_REPAIRS) break;

    // Repair only what failed, and tell the model exactly why, quoting the
    // validator's own instructions back at it.
    prompt = daysPrompt(brief, outstanding, {
      reasons: reasonsFrom(violations),
      avoid: [...request.avoid, ...[...collected.values()].map((i) => i.hook)].slice(0, 40),
      avoidCtas: [
        ...request.avoidCtas,
        ...[...collected.values()].map((i) => i.cta),
      ].slice(0, 40),
    });
  }

  if (outstanding.length > 0) {
    // A partial month is never returned. Showing 27 days as a finished 30-day
    // plan would be the product lying about its own output.
    throw new GenerationFailure(
      new AiError(
        "incomplete",
        `Could not produce valid copy for ${outstanding.length} day(s): ${reasonsFrom(violations).join(" | ")}`,
        true,
      ),
      {
        violations: rejected,
        calls,
        repairs,
        usage,
        models: [...models],
        durationMs: Date.now() - started,
      },
    );
  }

  return {
    items: wanted.map((day) => collected.get(day)!),
    violations: rejected,
    calls,
    repairs,
    usage,
    models: [...models],
    durationMs: Date.now() - started,
  };
}
