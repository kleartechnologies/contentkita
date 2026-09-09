import assert from "node:assert/strict";
import test from "node:test";

import { PLAN_RHYTHM, SELLING_CATEGORIES } from "./categories.ts";
import { DEMO_RESTAURANT } from "./demo.ts";
import { MockContentGenerator, addDays } from "./mock-generator.ts";
import { TEMPLATES } from "./templates.ts";
import type { ContentCategory, RestaurantProfile } from "./types.ts";

const generator = new MockContentGenerator();
const REQUEST = { restaurant: DEMO_RESTAURANT, startDate: "2026-03-01" };

/** A profile with only the two required fields — the worst realistic case. */
const BARE: RestaurantProfile = {
  ...DEMO_RESTAURANT,
  id: "bare-restaurant",
  location: "",
  description: "",
  bestSellers: [],
  promotion: null,
  targetCustomers: "",
};

test("plan has exactly 30 days, numbered and dated in order", async () => {
  const plan = await generator.generatePlan(REQUEST);
  assert.equal(plan.items.length, 30);
  plan.items.forEach((item, i) => {
    assert.equal(item.day, i + 1);
    assert.equal(item.date, addDays("2026-03-01", i));
  });
});

test("every day is fully populated", async () => {
  const plan = await generator.generatePlan(REQUEST);
  for (const item of plan.items) {
    for (const field of ["hook", "caption", "cta", "visualIdea"] as const) {
      assert.ok(item[field].trim().length > 0, `day ${item.day} missing ${field}`);
    }
  }
});

test("category mix is varied and never repeats on consecutive days", async () => {
  const plan = await generator.generatePlan(REQUEST);
  const used = new Set(plan.items.map((i) => i.category));
  assert.ok(used.size >= 12, `expected a broad mix, got ${used.size} categories`);

  for (let i = 1; i < plan.items.length; i++) {
    assert.notEqual(
      plan.items[i].category,
      plan.items[i - 1].category,
      `day ${i + 1} repeats the previous day's category`,
    );
  }

  // No single category may dominate the month.
  const counts = new Map<ContentCategory, number>();
  for (const item of plan.items) {
    counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
  }
  for (const [category, count] of counts) {
    assert.ok(count <= 5, `${category} appears ${count} times — too repetitive`);
  }
});

test("captions are not near-duplicates of each other", async () => {
  const plan = await generator.generatePlan(REQUEST);
  const captions = plan.items.map((i) => i.caption);
  assert.equal(
    new Set(captions).size,
    captions.length,
    "two days share an identical caption",
  );

  const hooks = plan.items.map((i) => i.hook);
  assert.ok(
    new Set(hooks).size >= hooks.length - 2,
    "too many days reuse the same hook",
  );
});

test("never invents a promotion the owner did not give", async () => {
  const plan = await generator.generatePlan({ restaurant: BARE });

  for (const item of plan.items) {
    assert.ok(
      !SELLING_CATEGORIES.includes(item.category),
      `day ${item.day} scheduled a selling post with no real offer`,
    );
  }

  // The demo restaurant's real facts must not leak into a bare profile.
  const blob = JSON.stringify(plan.items).toLowerCase();
  for (const leak of ["rm12.90", "set lunch", "nasi ayam penyet", "kajang"]) {
    assert.ok(!blob.includes(leak), `fabricated detail leaked: ${leak}`);
  }
  // Nor may it claim anything the owner never stated.
  for (const claim of ["halal", "bintang 5", "anugerah", "award", "terbaik di malaysia"]) {
    assert.ok(!blob.includes(claim), `unfounded claim generated: ${claim}`);
  }
});

test("a bare profile still gets a complete, usable plan", async () => {
  const plan = await generator.generatePlan({ restaurant: BARE });
  assert.equal(plan.items.length, 30);
  for (const item of plan.items) {
    assert.ok(item.caption.trim().length > 20);
    // Unfilled slots would show up as empty fragments or stray punctuation.
    assert.ok(!item.caption.includes("  "), `day ${item.day} has a gap in the copy`);
    assert.ok(!item.hook.includes("  "), `day ${item.day} has a gap in the hook`);
  }
});

test("selling posts appear only when a promotion exists, and stay rare", async () => {
  const plan = await generator.generatePlan(REQUEST);
  const selling = plan.items.filter((i) => SELLING_CATEGORIES.includes(i.category));
  assert.ok(selling.length > 0, "a restaurant with an offer should promote it");
  assert.ok(
    selling.length <= 5,
    `${selling.length} selling posts in 30 days reads as an advert feed`,
  );
  // A promotion post must state the actual offer. Urgency posts are a
  // different job — "stock is running low" is urgent without being an offer.
  for (const item of plan.items.filter((i) => i.category === "promotion")) {
    assert.ok(
      item.caption.includes(DEMO_RESTAURANT.promotion!),
      `day ${item.day} promotes without stating the actual offer`,
    );
  }
});

test("a sparse profile still gets varied copy, not the same post repeated", async () => {
  const plan = await generator.generatePlan({ restaurant: BARE });
  const captions = plan.items.map((i) => i.caption);
  assert.equal(
    new Set(captions).size,
    captions.length,
    "a restaurant that filled in little gets duplicate posts",
  );
});

test("generation is deterministic", async () => {
  const a = await generator.generatePlan(REQUEST);
  const b = await generator.generatePlan(REQUEST);
  assert.deepEqual(
    a.items.map((i) => i.caption),
    b.items.map((i) => i.caption),
  );
});

test("regenerate returns different copy and cycles back round", async () => {
  const first = await generator.regenerateDay(REQUEST, 1);
  assert.ok(first.variantCount >= 2, "day 1 should offer alternatives");

  const second = await generator.regenerateDay(
    { ...REQUEST, variants: { 1: 1 } },
    1,
  );
  assert.notEqual(second.caption, first.caption, "regenerate produced identical copy");
  assert.equal(second.day, 1);

  const wrapped = await generator.regenerateDay(
    { ...REQUEST, variants: { 1: first.variantCount } },
    1,
  );
  assert.equal(wrapped.caption, first.caption, "variants should cycle");
});

test("video ideas are attached to video categories only", async () => {
  const plan = await generator.generatePlan(REQUEST);
  for (const item of plan.items) {
    if (item.category === "reels") {
      assert.ok(item.videoIdea, `day ${item.day} is a Reel with no video idea`);
    }
  }
});

test("every category can produce copy from required fields alone", () => {
  for (const category of Object.keys(TEMPLATES) as ContentCategory[]) {
    const safe = TEMPLATES[category].filter((t) => !t.requires);
    assert.ok(
      safe.length > 0,
      `${category} has no template that works without optional facts`,
    );
  }
});

test("the rhythm covers a month without gaps", () => {
  assert.equal(PLAN_RHYTHM.length, 30);
});
