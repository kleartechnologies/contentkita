import assert from "node:assert/strict";
import test from "node:test";

import { generateItems, GenerationFailure } from "./generate.ts";
import { DEMO_RESTAURANT } from "../content/demo.ts";
import type { GenerationRequestBody } from "./request.ts";

/**
 * The loop that spends money.
 *
 * Everything here is offline: `fetch` is replaced, so no key is needed and no
 * request leaves the machine. What is being checked is not the copy — that is
 * the benchmark's job — but the shape of the spend. One call in the normal
 * case, never more than two, the cheap model doing the writing and the strong
 * one doing the repair, and a failure that still reports what it cost.
 */

const DAYS = [1, 2];

function request(): GenerationRequestBody {
  return {
    mode: "days",
    packId: "",
    restaurant: DEMO_RESTAURANT,
    days: 30,
    startDate: "2026-10-01",
    targetDays: [...DAYS],
    avoid: [],
    avoidCtas: [],
  };
}

/** A day that passes the validator: plain Malay, no claims, no invented numbers. */
function goodDay(day: number) {
  return {
    day,
    hook: `Tengah hari ni memang senang nak singgah makan ${day}.`,
    caption:
      "Dapur kami dah mula sejak pagi tadi.\n\nKuah masak perlahan, nasi baru angkat. Kalau sempat, singgah lah sekejap.",
    cta: "Simpan post ni untuk rujukan nanti.",
    visualIdea: "Ambil gambar dari atas meja, cahaya siang dari tingkap.",
    videoIdea: "Shot dekat kuah mendidih, kemudian pinggan siap dihidang.",
    designDirection: "Warna hangat, teks minimum di bahagian bawah.",
    hashtags: ["warungkakina", "kajang", "masakanmelayu"],
  };
}

/** The same day with a price the owner never quoted — the validator rejects it. */
function fabricatedDay(day: number) {
  return { ...goodDay(day), caption: `${goodDay(day).caption}\n\nSet kami RM99 sahaja.` };
}

interface Call {
  model: string;
  body: Record<string, unknown>;
}

/**
 * Replaces `fetch` with a scripted provider.
 *
 * Each entry is one response, in order. Returns the calls that were made so a
 * test can assert which model saw which request.
 */
function stubProvider(responses: unknown[][]): { calls: Call[]; restore: () => void } {
  const calls: Call[] = [];
  const original = globalThis.fetch;
  let index = 0;

  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    calls.push({ model: String(body.model), body });
    const items = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ items }) }, finish_reason: "stop" }],
        usage: {
          prompt_tokens: 1000,
          completion_tokens: 500,
          prompt_tokens_details: { cached_tokens: 640 },
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  return { calls, restore: () => { globalThis.fetch = original; } };
}

function withEnv<T>(vars: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const before = { ...process.env };
  Object.assign(process.env, vars);
  return fn().finally(() => {
    process.env = before;
  });
}

const ENV = {
  OPENAI_API_KEY: "test-key-not-a-real-one",
  OPENAI_MODEL: "writer-model",
  OPENAI_REPAIR_MODEL: "repair-model",
};

test("a clean first pass costs exactly one call", async () => {
  const provider = stubProvider([DAYS.map(goodDay)]);
  try {
    const outcome = await withEnv(ENV, () => generateItems(request()));
    assert.equal(outcome.items.length, 2);
    assert.equal(outcome.calls, 1);
    assert.equal(outcome.repairs, 0);
    assert.equal(outcome.violations.length, 0);
    assert.deepEqual(outcome.models, ["writer-model"]);
    assert.equal(provider.calls.length, 1);
  } finally {
    provider.restore();
  }
});

test("usage is summed across calls, cached input included", async () => {
  const provider = stubProvider([DAYS.map(goodDay)]);
  try {
    const outcome = await withEnv(ENV, () => generateItems(request()));
    assert.deepEqual(outcome.usage, { input: 1000, cachedInput: 640, output: 500 });
  } finally {
    provider.restore();
  }
});

test("a fabricated price costs one repair, and the repair goes to the stronger model", async () => {
  const provider = stubProvider([
    [goodDay(1), fabricatedDay(2)],
    [goodDay(2)],
  ]);
  try {
    const outcome = await withEnv(ENV, () => generateItems(request()));
    assert.equal(outcome.items.length, 2);
    assert.equal(outcome.calls, 2);
    assert.equal(outcome.repairs, 1);
    assert.deepEqual(provider.calls.map((c) => c.model), ["writer-model", "repair-model"]);
    // The repair asked for the failing day only.
    const repair = provider.calls[1].body.messages as { role: string; content: string }[];
    const asked = repair.find((m) => m.role === "user")!.content;
    assert.match(asked, /Hari 2/);
    assert.ok(!/Hari 1 \|/.test(asked), "the repair should not pay to rewrite the day that passed");
  } finally {
    provider.restore();
  }
});

test("a repaired violation is still reported — it happened, and it was paid for", async () => {
  const provider = stubProvider([
    [goodDay(1), fabricatedDay(2)],
    [goodDay(2)],
  ]);
  try {
    const outcome = await withEnv(ENV, () => generateItems(request()));
    assert.equal(outcome.violations.length, 1);
    assert.equal(outcome.violations[0].day, 2);
  } finally {
    provider.restore();
  }
});

test("a model that keeps fabricating is cut off after one repair", async () => {
  const provider = stubProvider([DAYS.map(fabricatedDay)]);
  try {
    await withEnv(ENV, () => generateItems(request()));
    assert.fail("should not have returned a plan");
  } catch (error) {
    assert.ok(error instanceof GenerationFailure, String(error));
    assert.equal(error.code, "incomplete");
    // One write plus one repair, and no third attempt however bad the output.
    assert.equal(provider.calls.length, 2);
    assert.equal(error.calls, 2);
    assert.equal(error.repairs, 1);
    assert.ok(error.violations.length >= 2);
    assert.deepEqual(error.usage, { input: 2000, cachedInput: 1280, output: 1000 });
  } finally {
    provider.restore();
  }
});

test("a partial month is never returned as if it were whole", async () => {
  const provider = stubProvider([[goodDay(1)], [goodDay(1)]]);
  try {
    await withEnv(ENV, () => generateItems(request()));
    assert.fail("should not have returned a plan with a missing day");
  } catch (error) {
    assert.ok(error instanceof GenerationFailure, String(error));
    assert.equal(error.code, "incomplete");
  } finally {
    provider.restore();
  }
});

test("every batch of one plan shares a cache key, and it leaks nothing about the owner", async () => {
  const provider = stubProvider([
    [goodDay(1), fabricatedDay(2)],
    [goodDay(2)],
  ]);
  try {
    await withEnv(ENV, () => generateItems(request()));
    const keys = provider.calls.map((c) => String(c.body.prompt_cache_key));
    assert.equal(new Set(keys).size, 1);
    assert.match(keys[0], /^[0-9a-f]{32}$/);
    assert.ok(!keys[0].includes(DEMO_RESTAURANT.id));
  } finally {
    provider.restore();
  }
});


/* --- the request shape each model family accepts -------------------------- */

/**
 * These four assertions are the difference between a working model switch and a
 * 400. Every expectation was probed against the live API before it was written
 * down; the table in `openai.ts` records what was found.
 */
async function bodyFor(model: string): Promise<Record<string, unknown>> {
  const provider = stubProvider([DAYS.map(goodDay)]);
  try {
    await withEnv({ ...ENV, OPENAI_MODEL: model }, () => generateItems(request()));
    return provider.calls[0].body;
  } finally {
    provider.restore();
  }
}

test("gpt-4.1 is sent the shape it has always been sent", async () => {
  const body = await bodyFor("gpt-4.1");
  assert.equal(body.temperature, 0.8);
  assert.ok("max_tokens" in body);
  assert.ok(!("max_completion_tokens" in body));
  assert.ok(!("reasoning_effort" in body));
});

test("the 5.0 line gets the renamed ceiling, its own effort word, and no temperature", async () => {
  const body = await bodyFor("gpt-5-mini");
  assert.ok("max_completion_tokens" in body);
  assert.ok(!("max_tokens" in body));
  // Left unset it thinks before answering, and thinking is billed as output.
  assert.equal(body.reasoning_effort, "minimal");
  // The 5.0 line accepts only the default temperature and 400s on any other.
  assert.ok(!("temperature" in body));
});

test("5.1 through 5.4 take both the newer effort word and our temperature", async () => {
  const body = await bodyFor("gpt-5.4-mini");
  assert.equal(body.reasoning_effort, "none");
  assert.equal(body.temperature, 0.8);
  assert.ok("max_completion_tokens" in body);
});

test("gpt-5.5 refuses temperature again, so it is not offered one", async () => {
  const body = await bodyFor("gpt-5.5");
  assert.equal(body.reasoning_effort, "none");
  assert.ok(!("temperature" in body));
});

test("an unrecognised model keeps the shape this product has always sent", async () => {
  const body = await bodyFor("some-model-nobody-has-heard-of");
  assert.ok("max_tokens" in body);
  assert.equal(body.temperature, 0.8);
  assert.ok(!("reasoning_effort" in body));
});
