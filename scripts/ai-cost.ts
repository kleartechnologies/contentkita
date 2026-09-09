/**
 * Where the tokens go.
 *
 *   node --experimental-strip-types scripts/ai-cost.ts
 *   node --env-file=.env.local scripts/ai-cost.ts --exact
 *
 * Builds the exact strings `/api/generate` would send for a real 30-day pack
 * and reports the size of each block, so a claim about prompt cost is a
 * measurement rather than a guess.
 *
 * Offline it estimates tokens from character counts, which is close enough to
 * see which block dominates but not close enough to bill anyone. With
 * `--exact` it asks OpenAI itself: a completion capped at one output token
 * comes back with `usage.prompt_tokens` counted by the real tokenizer, for a
 * fraction of a cent per probe. That is the only way to get an exact input
 * count without shipping a copy of the BPE tables.
 *
 * Nothing here writes anything or touches a real owner's data.
 */

import { buildBrief } from "../lib/content/brief.ts";
import { DEMO_RESTAURANT } from "../lib/content/demo.ts";
import type { RestaurantProfile } from "../lib/content/types.ts";
import { HOUSE, ITEMS_SCHEMA, daysPrompt, systemPrompt } from "../lib/ai/prompt.ts";
import { RATES, costOf, usd } from "../lib/ai/pricing.ts";
import { MAX_TARGET_DAYS } from "../lib/ai/request.ts";

const DAYS = 30;

/**
 * Two profiles, because they cost differently.
 *
 * The demo restaurant has a promotion and a price, so its brief is longer on
 * facts and shorter on prohibitions. The sparse one is the case the product was
 * verified against — no price, no promotion, no hours — which makes the
 * forbidden list longer. A cost figure quoted from only one of them would be
 * quoting the convenient half.
 */
const SPARSE: RestaurantProfile = {
  ...DEMO_RESTAURANT,
  promotion: null,
  promotionDates: "",
  promotionConditions: "",
  menuNotes: "Masak harian guna resipi rumah. Teh ais buat sendiri, tak guna premix.",
};

const PROFILES: { label: string; profile: RestaurantProfile }[] = [
  { label: "demo (promotion + price)", profile: DEMO_RESTAURANT },
  { label: "sparse (no promo, no price)", profile: SPARSE },
];

/**
 * Characters per token, for Bahasa Melayu under o200k_base.
 *
 * Malay tokenises worse than English — fewer whole words have their own token —
 * so the English rule of thumb of four would understate every figure here.
 * Only used when `--exact` is off, and every estimated number is labelled.
 */
const CHARS_PER_TOKEN = 3.6;

/**
 * The prefix size at which OpenAI's cache engages.
 *
 * This is the documented minimum, and it was checked rather than trusted. An
 * earlier probe here concluded the effective floor was ~3,300 tokens; it was
 * wrong, because it varied the prefix between calls and so measured a cold
 * cache every time. Redone with one fixed prefix, a constant `prompt_cache_key`
 * and five *different* suffixes, a 1,536-token prefix returned 1,408 cached
 * tokens from the second call onward on gpt-4.1 and 1,280 of 1,546 on
 * gpt-5.4-mini. A real benchmarked pack logged 67% of its input cached.
 */
const CACHE_FLOOR = 1_024;

function estimate(text: string): number {
  return Math.round(text.length / CHARS_PER_TOKEN);
}

/** Batches of days, the way the client actually asks for a month. */
function batches(days: number): number[][] {
  const out: number[][] = [];
  for (let first = 1; first <= days; first += MAX_TARGET_DAYS) {
    const batch: number[] = [];
    for (let d = first; d < first + MAX_TARGET_DAYS && d <= days; d++) batch.push(d);
    out.push(batch);
  }
  return out;
}

/**
 * Exact prompt tokens, counted by the provider.
 *
 * One output token is requested and thrown away. The response is billed, but at
 * these sizes a probe costs well under a cent and buys a number nobody has to
 * caveat.
 */
async function exactTokens(system: string, user: string, model: string): Promise<number> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("--exact needs OPENAI_API_KEY");
  const base = process.env.OPENAI_BASE_URL?.trim().replace(/\/+$/, "") || "https://api.openai.com/v1";

  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      max_tokens: 1,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`token probe failed: ${response.status} ${(await response.text()).slice(0, 200)}`);
  }
  const payload = (await response.json()) as { usage?: { prompt_tokens?: number } };
  return payload.usage?.prompt_tokens ?? 0;
}

function bar(value: number, max: number, width = 28): string {
  const filled = max === 0 ? 0 : Math.round((value / max) * width);
  return "█".repeat(filled).padEnd(width, "·");
}

async function report(exact: boolean) {
  const model = process.env.OPENAI_MODEL?.trim() || "gpt-4.1";
  const count = exact
    ? (system: string, user: string) => exactTokens(system, user, model)
    : async (system: string, user: string) => estimate(system) + estimate(user);

  console.log(`\nContentKita — prompt cost profile`);
  console.log(`  ${DAYS} days, ${batches(DAYS).length} batches of ${MAX_TARGET_DAYS}`);
  console.log(`  token counts: ${exact ? `exact, counted by ${model}` : `estimated at ${CHARS_PER_TOKEN} chars/token`}\n`);

  // The schema travels on every request too. It is not part of the messages, so
  // it is reported separately rather than folded into a block it is not in.
  console.log(`  response schema: ${JSON.stringify(ITEMS_SCHEMA).length} chars (~${estimate(JSON.stringify(ITEMS_SCHEMA))} tokens), sent on every call`);

  for (const { label, profile } of PROFILES) {
    const brief = buildBrief(profile, DAYS);
    const system = systemPrompt(brief);
    const house = HOUSE;
    const restaurantBlock = system.slice(house.length);

    const all = batches(DAYS);
    // The avoid list grows as the month is written: batch one carries none,
    // later batches carry up to 24 hooks. A plausible hook is used so the
    // figure reflects what a real fifth batch pays.
    const hook = "Bau kicap panas dari dapur tu memang tak boleh tipu.";

    console.log(`\n  ── ${label} ────────────────────────────────`);

    let packInput = 0;
    const rows: { name: string; tokens: number }[] = [];

    for (const [index, days] of all.entries()) {
      const avoid = Array.from({ length: Math.min(24, index * MAX_TARGET_DAYS) }, () => hook);
      const user = daysPrompt(brief, days, { avoid });
      const tokens = await count(system, user);
      packInput += tokens;
      rows.push({ name: `batch ${index + 1} (days ${days[0]}-${days[days.length - 1]})`, tokens });
    }

    const houseTokens = exact ? await exactTokens(house, "", model) : estimate(house);
    const stable = exact ? await exactTokens(system, "", model) : estimate(system);

    console.log(`\n     stable prefix (system message), sent identically ${all.length}×:`);
    console.log(`       house block  ${String(houseTokens).padStart(5)} tok  ${bar(houseTokens, stable)}  identical for every restaurant`);
    console.log(`       restaurant   ${String(stable - houseTokens).padStart(5)} tok  ${bar(stable - houseTokens, stable)}  ${restaurantBlock.length} chars`);
    console.log(`       ─────────────────────`);
    console.log(
      `       total        ${String(stable).padStart(5)} tok  ${
        stable >= CACHE_FLOOR
          ? `✓ over the ${CACHE_FLOOR}-token cache minimum — batches 2+ read this back at a tenth of the price`
          : `✗ under the ${CACHE_FLOOR}-token cache minimum — nothing caches at this size`
      }`,
    );

    console.log(`\n     per-batch input:`);
    const max = Math.max(...rows.map((r) => r.tokens));
    for (const row of rows) {
      console.log(`       ${row.name.padEnd(26)} ${String(row.tokens).padStart(5)} tok  ${bar(row.tokens, max)}`);
    }

    // Batch one pays full price to fill the cache and the rest read it back, in
    // 128-token blocks. The ceiling, not a promise: a routing miss occasionally
    // costs one batch its discount, so a real pack lands near this, under it.
    const cacheable = Math.floor(stable / 128) * 128;
    const cached = stable >= CACHE_FLOOR ? cacheable * (all.length - 1) : 0;

    console.log(`\n     pack input total     ${String(packInput).padStart(6)} tok`);
    console.log(
      cached > 0
        ? `     of which cacheable   ${String(cached).padStart(6)} tok  (${((cached / packInput) * 100).toFixed(0)}% — prefix × ${all.length - 1} repeat batches, rounded to 128-token blocks)`
        : `     of which cacheable        0 tok  (prefix under the ${CACHE_FLOOR}-token minimum)`,
    );

    // Output is measured, not estimated: it is whatever the model writes. A
    // representative day from a real generated plan is ~300 tokens across the
    // nine fields, which is the figure used until the benchmark replaces it.
    const outPerDay = 300;
    const output = outPerDay * DAYS;
    console.log(`     pack output (est)    ${String(output).padStart(6)} tok  (${outPerDay}/day × ${DAYS})`);

    console.log(`\n     estimated cost per pack:`);
    for (const [name] of Object.entries(RATES)) {
      const withCache = costOf(name, { input: packInput, cachedInput: cached, output });
      const without = costOf(name, { input: packInput, cachedInput: 0, output });
      console.log(
        `       ${name.padEnd(14)} ${usd(withCache).padStart(9)}  (${usd(without)} without prompt caching)`,
      );
    }
  }

  console.log("");
}

const exact = process.argv.includes("--exact");
report(exact).catch((error) => {
  console.error(`\n  ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
