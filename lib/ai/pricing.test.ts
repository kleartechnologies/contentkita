import assert from "node:assert/strict";
import test from "node:test";

import { costOf, ratesFor, RATES, usd } from "./pricing.ts";

/**
 * The arithmetic every cost claim in this repository rests on.
 *
 * Small, but worth pinning: the one mistake that matters here is treating
 * `cachedInput` as a separate charge on top of `input` rather than a discounted
 * slice of it, which would overstate the saving from prompt caching in exactly
 * the direction that flatters the design.
 */

test("cached input is a discounted slice of input, not an extra charge", () => {
  const rates = RATES["gpt-4.1"];
  const cost = costOf("gpt-4.1", { input: 1000, cachedInput: 400, output: 0 });
  const expected = (600 * rates.input + 400 * rates.cached) / 1_000_000;
  assert.equal(cost, expected);
  // And it is strictly cheaper than the same tokens with no cache hit.
  assert.ok(cost < costOf("gpt-4.1", { input: 1000, cachedInput: 0, output: 0 }));
});

test("a fully cached prompt still costs something", () => {
  assert.ok(costOf("gpt-4.1", { input: 1000, cachedInput: 1000, output: 0 }) > 0);
});

test("output dominates, which is why shortening the prompt is not the lever", () => {
  // ContentKita's measured profile: ~15k input, ~9k output for a 30-day pack.
  const input = costOf("gpt-4.1", { input: 15_312, cachedInput: 0, output: 0 });
  const output = costOf("gpt-4.1", { input: 0, cachedInput: 0, output: 8_766 });
  assert.ok(output > input * 2);
});

test("an unknown model is priced at zero rather than guessed at", () => {
  assert.equal(ratesFor("gpt-9-imaginary"), null);
  assert.equal(costOf("gpt-9-imaginary", { input: 1e6, cachedInput: 0, output: 1e6 }), 0);
});

test("every rate is a real number, so no entry silently prices at zero", () => {
  for (const [model, rates] of Object.entries(RATES)) {
    for (const [field, value] of Object.entries(rates)) {
      assert.ok(Number.isFinite(value) && value > 0, `${model}.${field}`);
    }
  }
});

test("a per-pack figure keeps the cents that matter", () => {
  assert.equal(usd(0.1008), "$0.1008");
  assert.equal(usd(12.5), "$12.50");
});
