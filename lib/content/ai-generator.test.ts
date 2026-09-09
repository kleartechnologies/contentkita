import assert from "node:assert/strict";
import test from "node:test";

import { MAX_TARGET_DAYS } from "../ai/request.ts";
import { AiContentGenerator, GenerationError } from "./ai-generator.ts";
import { DEMO_RESTAURANT } from "./demo.ts";
import { buildSchedule } from "./schedule.ts";
import type { ContentItem, GenerationStage } from "./types.ts";

/**
 * The client half of the AI seam.
 *
 * The point of this class is what it does *not* do: it holds no provider key,
 * speaks no provider protocol, and sends no asset URL anywhere. Those are
 * asserted here against a fake transport, along with the failure behaviour an
 * owner actually experiences when something goes wrong.
 */

interface Call {
  url: string;
  init: RequestInit;
}

/** A stand-in for `/api/generate` that records what the browser tried to send. */
function transport(handler: (call: Call) => { status?: number; body: unknown }) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: unknown, init: unknown) => {
    const call = { url: String(url), init: (init ?? {}) as RequestInit };
    calls.push(call);
    const { status = 200, body } = handler(call);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response;
  }) as unknown as typeof fetch;

  return { calls, fetchImpl };
}

function sentBody(call: Call): Record<string, unknown> {
  return JSON.parse(String(call.init.body));
}

/** A day shaped as the route returns it, already validated server-side. */
function day(n: number): ContentItem {
  const slot = buildSchedule(DEMO_RESTAURANT, 30)[n - 1];
  return {
    id: `plan-x-d${n}`,
    planId: "plan-x",
    day: n,
    date: "",
    category: slot.category,
    platform: slot.platform,
    objective: "Objektif hari ini.",
    hook: `Hook hari ${n}.`,
    caption: "Caption penuh.",
    cta: "Save post ni.",
    visualIdea: "Gambar dari atas.",
    videoIdea: null,
    designDirection: "Warna hangat.",
    hashtags: ["kajang"],
    variantIndex: 0,
    variantCount: 0,
    edited: false,
  };
}

/**
 * Answers with exactly the days the request named, the way the route does.
 *
 * A month is written in several batches, so a stand-in that returned all thirty
 * days to every batch would let a broken client look correct.
 */
const servesRequestedDays = () =>
  transport((call) => {
    const body = sentBody(call) as { targetDays?: number[]; days?: number };
    const wanted = body.targetDays ?? Array.from({ length: body.days ?? 30 }, (_, i) => i + 1);
    return { body: { items: wanted.map(day) } };
  });

const generator = (fetchImpl: typeof fetch, token = "id-token-abc") =>
  new AiContentGenerator({ getToken: async () => token, fetchImpl });

const REQUEST = { restaurant: DEMO_RESTAURANT, startDate: "2026-03-01" };

/* --- the happy path ------------------------------------------------------- */

test("a plan comes back as thirty dated days", async () => {
  const { fetchImpl } = servesRequestedDays();

  const plan = await generator(fetchImpl).generatePlan(REQUEST);

  assert.equal(plan.items.length, 30);
  assert.equal(plan.items[0].date, "2026-03-01");
  assert.equal(plan.items[29].date, "2026-03-30");
  assert.equal(plan.generatorKind, "ai");
});

test("the plan belongs to the restaurant that asked for it", async () => {
  const { fetchImpl } = servesRequestedDays();

  const plan = await generator(fetchImpl).generatePlan(REQUEST);

  assert.equal(plan.restaurantId, DEMO_RESTAURANT.id);
  assert.equal(plan.id, `plan-${DEMO_RESTAURANT.id}`);
});

test("the owner is shown each stage in the order it happens", async () => {
  const { fetchImpl } = servesRequestedDays();
  const stages: GenerationStage[] = [];

  await generator(fetchImpl).generatePlan({
    ...REQUEST,
    onStage: (stage) => stages.push(stage),
  });

  assert.deepEqual(stages, ["brief", "strategy", "writing", "checking"]);
});

/* --- what leaves the browser ---------------------------------------------- */

test("the request carries the caller's ID token and nothing else identifying", async () => {
  const { calls, fetchImpl } = servesRequestedDays();

  await generator(fetchImpl, "token-xyz").generatePlan(REQUEST);

  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers.authorization, "Bearer token-xyz");
  assert.equal(calls[0].url, "/api/generate");
  assert.equal(calls[0].init.method, "POST");
});

test("no provider key or provider endpoint is ever referenced by the client", async () => {
  const { calls, fetchImpl } = servesRequestedDays();

  await generator(fetchImpl).generatePlan(REQUEST);

  const serialised = JSON.stringify(calls);
  assert.ok(!/openai|api\.openai\.com|sk-/i.test(serialised), serialised.slice(0, 200));
});

test("an uploaded file is sent as presence, never as a URL", async () => {
  const { calls, fetchImpl } = servesRequestedDays();
  const withAssets = {
    ...DEMO_RESTAURANT,
    logo: {
      path: "restaurants/uid/logo/a.png",
      url: "https://storage.example/signed-logo",
      name: "a.png",
      contentType: "image/png",
      size: 10,
      uploadedAt: "2026-01-01T00:00:00.000Z",
    },
    menuFile: {
      path: "restaurants/uid/menus/m.pdf",
      url: "https://storage.example/signed-menu",
      name: "m.pdf",
      contentType: "application/pdf",
      size: 10,
      uploadedAt: "2026-01-01T00:00:00.000Z",
    },
  };

  await generator(fetchImpl).generatePlan({ ...REQUEST, restaurant: withAssets });

  const body = JSON.stringify(sentBody(calls[0]));
  assert.ok(!body.includes("storage.example"), body);
  assert.ok(!body.includes("restaurants/uid"), body);
  const restaurant = sentBody(calls[0]).restaurant as Record<string, unknown>;
  assert.equal(restaurant.logo, true);
  assert.equal(restaurant.menuFile, true);
});

/* --- regenerating one day ------------------------------------------------- */

test("regenerating a day asks for that day alone", async () => {
  const { calls, fetchImpl } = transport(() => ({ body: { items: [day(12)] } }));

  const item = await generator(fetchImpl).regenerateDay(REQUEST, 12);

  const body = sentBody(calls[0]);
  assert.equal(body.mode, "days");
  assert.deepEqual(body.targetDays, [12]);
  assert.equal(item.day, 12);
  assert.equal(item.date, "2026-03-12");
});

test("the hook already on screen is sent so the rewrite is different", async () => {
  const { calls, fetchImpl } = transport(() => ({ body: { items: [day(12)] } }));

  await generator(fetchImpl).regenerateDay(
    { ...REQUEST, avoidHooks: ["Hook lama yang owner dah nampak."] },
    12,
  );

  assert.deepEqual(sentBody(calls[0]).avoid, ["Hook lama yang owner dah nampak."]);
});

test("a returned day is pinned to the day that was asked for", async () => {
  // A model that answers with the wrong day number must not shuffle the month.
  const { fetchImpl } = transport(() => ({ body: { items: [day(3)] } }));

  const item = await generator(fetchImpl).regenerateDay(REQUEST, 12);

  assert.equal(item.day, 12);
  assert.equal(item.date, "2026-03-12");
});

/* --- failures the owner sees ---------------------------------------------- */

test("a signed-out owner is told to sign in again, in Malay", async () => {
  const { fetchImpl } = servesRequestedDays();
  const engine = new AiContentGenerator({
    getToken: async () => {
      throw new Error("Not signed in");
    },
    fetchImpl,
  });

  await assert.rejects(engine.generatePlan(REQUEST), (err: GenerationError) => {
    assert.equal(err.code, "unauthenticated");
    assert.match(err.message, /log masuk semula/);
    return true;
  });
});

test("a dropped connection is reported as a connection problem", async () => {
  const fetchImpl = (async () => {
    throw new TypeError("Failed to fetch");
  }) as unknown as typeof fetch;

  await assert.rejects(generator(fetchImpl).generatePlan(REQUEST), (err: GenerationError) => {
    assert.equal(err.code, "network");
    assert.match(err.message, /Sambungan internet/);
    return true;
  });
});

test("the route's own wording is shown to the owner unchanged", async () => {
  const { fetchImpl } = transport(() => ({
    status: 429,
    body: { error: { code: "rate_limited", message: "Anda dah jana content tadi. Cuba lagi sekejap." } },
  }));

  await assert.rejects(generator(fetchImpl).generatePlan(REQUEST), (err: GenerationError) => {
    assert.equal(err.code, "rate_limited");
    assert.equal(err.message, "Anda dah jana content tadi. Cuba lagi sekejap.");
    return true;
  });
});

test("a failure with no readable body still produces a Malay message", async () => {
  const { fetchImpl } = transport(() => ({ status: 500, body: null }));

  await assert.rejects(generator(fetchImpl).generatePlan(REQUEST), (err: GenerationError) => {
    assert.equal(err.code, "unknown");
    assert.match(err.message, /Cuba lagi/);
    // No stack trace, provider name or internal detail reaches the screen.
    assert.ok(!/openai|firebase|stack|undefined/i.test(err.message));
    return true;
  });
});

test("a short month is refused rather than shown as a finished plan", async () => {
  // One batch comes back a day light. The other batches are fine, which is
  // exactly the case a per-batch check would wave through.
  let batch = 0;
  const { fetchImpl } = transport((call) => {
    const { targetDays } = sentBody(call) as { targetDays: number[] };
    const wanted = batch++ === 2 ? targetDays.slice(1) : targetDays;
    return { body: { items: wanted.map(day) } };
  });

  await assert.rejects(generator(fetchImpl).generatePlan(REQUEST), (err: GenerationError) => {
    assert.equal(err.code, "incomplete");
    assert.match(err.message, /tak simpan apa-apa/);
    return true;
  });
});

test("an empty or malformed response is refused", async () => {
  for (const body of [{ items: [] }, { ok: true }, null]) {
    const { fetchImpl } = transport(() => ({ body }));
    await assert.rejects(generator(fetchImpl).generatePlan(REQUEST), (err: GenerationError) => {
      assert.equal(err.code, "malformed");
      return true;
    });
  }
});

/* --- how a month is divided up -------------------------------------------- */

test("a month is asked for in batches small enough to answer in time", async () => {
  const { calls, fetchImpl } = servesRequestedDays();

  await generator(fetchImpl).generatePlan(REQUEST);

  assert.ok(calls.length > 1, "a whole month in one request cannot return in time");
  for (const call of calls) {
    const { targetDays } = sentBody(call) as { targetDays: number[] };
    assert.ok(
      targetDays.length <= MAX_TARGET_DAYS,
      `batch of ${targetDays.length} is too large`,
    );
  }
});

test("every day is asked for exactly once, and the plan is still 1..30", async () => {
  const { calls, fetchImpl } = servesRequestedDays();

  const plan = await generator(fetchImpl).generatePlan(REQUEST);

  const asked = calls.flatMap((c) => (sentBody(c) as { targetDays: number[] }).targetDays);
  assert.deepEqual(
    [...asked].sort((a, b) => a - b),
    Array.from({ length: 30 }, (_, i) => i + 1),
  );
  assert.deepEqual(
    plan.items.map((i) => i.day),
    Array.from({ length: 30 }, (_, i) => i + 1),
  );
});

test("each batch is told the hooks the earlier ones already used", async () => {
  const { calls, fetchImpl } = servesRequestedDays();

  await generator(fetchImpl).generatePlan(REQUEST);

  const first = sentBody(calls[0]) as { avoid: string[] };
  assert.deepEqual(first.avoid, [], "nothing has been written yet");

  // Whatever the first batch wrote, all of it, however many days that is.
  const second = sentBody(calls[1]) as { avoid: string[] };
  assert.deepEqual(
    second.avoid,
    Array.from({ length: MAX_TARGET_DAYS }, (_, i) => `Hook hari ${i + 1}.`),
  );

  const last = sentBody(calls[calls.length - 1]) as { avoid: string[] };
  const justBefore = 30 - (30 % MAX_TARGET_DAYS || MAX_TARGET_DAYS);
  assert.ok(
    last.avoid.includes(`Hook hari ${justBefore}.`),
    "the batch just before it is carried forward",
  );
});

test("days that arrive out of order still get the right dates", async () => {
  const { fetchImpl } = transport((call) => {
    const { targetDays } = sentBody(call) as { targetDays: number[] };
    return { body: { items: [...targetDays].reverse().map(day) } };
  });

  const plan = await generator(fetchImpl).generatePlan(REQUEST);

  assert.equal(plan.items[0].day, 1);
  assert.equal(plan.items[0].date, "2026-03-01");
  assert.equal(plan.items[29].day, 30);
  assert.equal(plan.items[29].date, "2026-03-30");
});
