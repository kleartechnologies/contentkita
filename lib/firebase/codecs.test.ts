import assert from "node:assert/strict";
import test from "node:test";

import { DEMO_RESTAURANT } from "../content/demo.ts";
import { MockContentGenerator } from "../content/mock-generator.ts";
import type { RestaurantProfile } from "../content/types.ts";
import {
  decodePlan,
  decodeRestaurant,
  encodeItem,
  encodePlan,
  encodeRestaurant,
  encodeUser,
  replaceItem,
} from "./codecs.ts";

const generator = new MockContentGenerator();
const UID = "uid-abc123";

async function samplePlan() {
  return generator.generatePlan({
    restaurant: DEMO_RESTAURANT,
    startDate: "2026-03-01",
  });
}

/* --- users ---------------------------------------------------------------- */

test("a returning sign-in keeps the original createdAt", () => {
  const first = encodeUser({ email: "kak@ina.com", now: "2026-01-01T00:00:00.000Z" });
  const later = encodeUser({
    email: "kak@ina.com",
    createdAt: first.createdAt,
    now: "2026-06-01T00:00:00.000Z",
  });

  assert.equal(later.createdAt, "2026-01-01T00:00:00.000Z");
  assert.equal(later.updatedAt, "2026-06-01T00:00:00.000Z");
});

/* --- restaurants ---------------------------------------------------------- */

test("a restaurant round-trips through Firestore unchanged", () => {
  const doc = encodeRestaurant(DEMO_RESTAURANT, UID);
  const back = decodeRestaurant(doc, UID);

  assert.ok(back);
  assert.equal(back.name, DEMO_RESTAURANT.name);
  assert.equal(back.cuisine, DEMO_RESTAURANT.cuisine);
  assert.equal(back.location, DEMO_RESTAURANT.location);
  assert.equal(back.description, DEMO_RESTAURANT.description);
  assert.deepEqual(back.bestSellers, DEMO_RESTAURANT.bestSellers);
  assert.equal(back.promotion, DEMO_RESTAURANT.promotion);
  assert.equal(back.targetCustomers, DEMO_RESTAURANT.targetCustomers);
  assert.equal(back.tone, DEMO_RESTAURANT.tone);
});

test("the stored document carries the owner uid", () => {
  assert.equal(encodeRestaurant(DEMO_RESTAURANT, UID).ownerId, UID);
});

test("the restaurant id is always the owner uid, never the stored value", () => {
  const doc = encodeRestaurant(DEMO_RESTAURANT, UID);
  assert.equal(decodeRestaurant(doc, UID)?.id, UID);
  // A document read under a different uid could never happen through the rules,
  // but the decoder must not take an id from the payload either.
  assert.equal(decodeRestaurant(doc, "uid-other")?.id, "uid-other");
});

test("a blank promotion is stored as no promotion, not an empty string", () => {
  const blank: RestaurantProfile = { ...DEMO_RESTAURANT, promotion: "   " };
  assert.equal(encodeRestaurant(blank, UID).currentPromotions, null);
  assert.equal(decodeRestaurant(encodeRestaurant(blank, UID), UID)?.promotion, null);
});

test("an unreadable restaurant document decodes to null rather than a blank one", () => {
  assert.equal(decodeRestaurant(null, UID), null);
  assert.equal(decodeRestaurant({ ownerId: UID }, UID), null);
  assert.equal(decodeRestaurant({ restaurantName: "Warung" }, UID), null);
});

/* --- content plans -------------------------------------------------------- */

test("a 30-day plan round-trips through Firestore unchanged", async () => {
  const plan = await samplePlan();
  const back = decodePlan(encodePlan(plan, UID), UID);

  assert.ok(back);
  assert.equal(back.items.length, 30);
  assert.equal(back.startDate, plan.startDate);
  assert.equal(back.generatorKind, plan.generatorKind);
  assert.deepEqual(back.items, plan.items);
});

test("a day with no video idea survives the round trip", async () => {
  const plan = await samplePlan();
  const withoutVideo = plan.items.find((item) => !item.videoIdea);
  assert.ok(withoutVideo, "expected at least one day without a video idea");

  // Firestore rejects `undefined`, so the encoder must write an explicit null.
  assert.equal(encodeItem(withoutVideo).videoIdea, null);
  const back = decodePlan(encodePlan(plan, UID), UID);
  assert.equal(back?.items.find((i) => i.day === withoutVideo.day)?.videoIdea, null);
});

test("plan days come back in order even if stored shuffled", async () => {
  const plan = await samplePlan();
  const doc = encodePlan(plan, UID);
  const shuffled = { ...doc, items: [...doc.items].reverse() };

  const back = decodePlan(shuffled, UID);
  assert.deepEqual(
    back?.items.map((i) => i.day),
    plan.items.map((i) => i.day),
  );
});

test("a plan with an unreadable day decodes to null rather than a partial month", async () => {
  const plan = await samplePlan();
  const doc = encodePlan(plan, UID);
  const broken = { ...doc, items: [...doc.items.slice(0, 9), { day: 10 }, ...doc.items.slice(10)] };

  assert.equal(decodePlan(broken, UID), null);
  assert.equal(decodePlan(null, UID), null);
  assert.equal(decodePlan({ ownerId: UID }, UID), null);
});

/* --- single-day regeneration ---------------------------------------------- */

test("replacing one day leaves the other twenty-nine untouched", async () => {
  const plan = await samplePlan();
  const swapped = await generator.regenerateDay(
    { restaurant: DEMO_RESTAURANT, startDate: plan.startDate, variants: { 7: 1 } },
    7,
  );

  const next = replaceItem(plan, swapped);

  assert.equal(next.items.length, 30);
  assert.notDeepEqual(next.items[6], plan.items[6]);
  for (const item of plan.items) {
    if (item.day === 7) continue;
    assert.deepEqual(
      next.items.find((i) => i.day === item.day),
      item,
      `day ${item.day} must be identical`,
    );
  }
});

test("replacing a day keeps the plan sorted and does not add days", async () => {
  const plan = await samplePlan();
  const first = plan.items[0];
  const next = replaceItem(plan, { ...first, caption: "Caption baharu" });

  assert.deepEqual(
    next.items.map((i) => i.day),
    plan.items.map((i) => i.day),
  );
  assert.equal(next.items[0].caption, "Caption baharu");
});
