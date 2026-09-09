import "server-only";

import { buildBrief, ownerSuppliedText, type RestaurantBrief } from "../content/brief.ts";
import { addDays } from "../content/mock-generator.ts";
import { validateResponse, type Violation } from "../content/validate.ts";
import type { ContentItem } from "../content/types.ts";

import { AiError, complete } from "./openai.ts";
import { daysPrompt, planPrompt, systemPrompt } from "./prompt.ts";
import type { GenerationRequestBody } from "./request.ts";

/**
 * Turning a request into thirty validated days.
 *
 * The cost shape is deliberate and bounded:
 *
 *   plan mode  — one full-month request, plus at most one repair request that
 *                asks only for the days that failed validation.
 *   days mode  — one request for the named days, plus at most one repair.
 *
 * So a month costs one call in the normal case and never more than two. There
 * is no per-field calling, no agent loop and no second model grading the first.
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

export interface GenerationOutcome {
  items: ContentItem[];
  /** What the last attempt still got wrong, for the server log. */
  violations: Violation[];
  calls: number;
}

export async function generateItems(
  request: GenerationRequestBody,
  signal?: AbortSignal,
): Promise<GenerationOutcome> {
  const { restaurant, days, startDate, mode, targetDays } = request;

  const brief: RestaurantBrief = buildBrief(restaurant, days);
  const supplied = ownerSuppliedText(restaurant);
  const planId = `plan-${restaurant.id}`;
  const dateForDay = (day: number) => addDays(startDate, day - 1);

  const wanted = mode === "days" ? targetDays : brief.schedule.map((s) => s.day);
  const system = systemPrompt(brief);

  const first =
    mode === "days"
      ? daysPrompt(brief, wanted, { avoid: request.avoid })
      : planPrompt(brief);

  let calls = 0;
  const collected = new Map<number, ContentItem>();
  let outstanding = wanted;
  let violations: Violation[] = [];
  let prompt = first;

  for (let attempt = 0; attempt <= MAX_REPAIRS; attempt++) {
    calls += 1;
    const raw = await complete({
      system,
      user: prompt,
      maxTokens: budgetFor(outstanding.length),
      signal,
    });

    const result = validateResponse(raw, {
      brief,
      supplied,
      planId,
      dateForDay,
      expectedDays: outstanding,
    });

    for (const item of result.items) collected.set(item.day, item);
    violations = result.violations;

    outstanding = [...result.badDays, ...result.missingDays].sort((a, b) => a - b);
    if (outstanding.length === 0) break;

    if (attempt === MAX_REPAIRS) break;

    // Repair only what failed, and tell the model exactly why, quoting the
    // validator's own instructions back at it.
    prompt = daysPrompt(brief, outstanding, {
      reasons: reasonsFrom(violations),
      avoid: [...request.avoid, ...[...collected.values()].map((i) => i.hook)].slice(0, 40),
    });
  }

  if (outstanding.length > 0) {
    // A partial month is never returned. Showing 27 days as a finished 30-day
    // plan would be the product lying about its own output.
    throw new AiError(
      "incomplete",
      `Could not produce valid copy for ${outstanding.length} day(s): ${reasonsFrom(violations).join(" | ")}`,
      true,
    );
  }

  return {
    items: wanted.map((day) => collected.get(day)!),
    violations,
    calls,
  };
}
