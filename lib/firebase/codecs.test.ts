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

/* --- the launch profile fields -------------------------------------------- */

/** A profile with every optional field filled, including uploaded assets. */
const FULL: RestaurantProfile = {
  ...DEMO_RESTAURANT,
  id: UID,
  menuNotes: "Nasi ayam guna ayam kampung. Teh ais buat sendiri.",
  menuFile: {
    path: `restaurants/${UID}/menus/1-menu.pdf`,
    url: "https://storage.example/menu.pdf",
    name: "menu.pdf",
    contentType: "application/pdf",
    size: 120_000,
    uploadedAt: "2026-02-01T00:00:00.000Z",
  },
  logo: {
    path: `restaurants/${UID}/logo/1-logo.png`,
    url: "https://storage.example/logo.png",
    name: "logo.png",
    contentType: "image/png",
    size: 40_000,
    uploadedAt: "2026-02-01T00:00:00.000Z",
  },
  visualStyle: "kampung",
  brandColours: "Hijau tua dan krim",
  referenceDesigns: "Suka design kedai kopi lama",
  language: "rojak",
  platforms: ["tiktok", "whatsapp"],
  copyStyles: ["bercerita", "menjual"],
  exampleCaption: "Petang ni kami buka macam biasa, jom singgah.",
};

test("every launch field round-trips through Firestore unchanged", () => {
  const decoded = decodeRestaurant(encodeRestaurant(FULL, UID), UID);

  assert.ok(decoded);
  assert.equal(decoded.menuNotes, FULL.menuNotes);
  assert.equal(decoded.visualStyle, "kampung");
  assert.equal(decoded.brandColours, FULL.brandColours);
  assert.equal(decoded.referenceDesigns, FULL.referenceDesigns);
  assert.equal(decoded.language, "rojak");
  assert.deepEqual(decoded.platforms, ["tiktok", "whatsapp"]);
  assert.deepEqual(decoded.copyStyles, ["bercerita", "menjual"]);
  assert.equal(decoded.exampleCaption, FULL.exampleCaption);
});

test("an uploaded logo and menu survive a sign-out and sign-in", () => {
  const decoded = decodeRestaurant(encodeRestaurant(FULL, UID), UID);

  assert.ok(decoded);
  assert.deepEqual(decoded.logo, FULL.logo);
  assert.deepEqual(decoded.menuFile, FULL.menuFile);
});

test("a half-written asset decodes to no asset rather than a broken image", () => {
  const doc = encodeRestaurant(FULL, UID) as unknown as Record<string, unknown>;
  doc.logo = { path: "", url: "", name: "", contentType: "", size: 0, uploadedAt: "" };

  const decoded = decodeRestaurant(doc, UID);

  assert.ok(decoded);
  assert.equal(decoded.logo, null);
});

test("promotion dates and conditions are dropped along with the promotion", () => {
  const decoded = decodeRestaurant(
    encodeRestaurant({ ...FULL, promotion: null }, UID),
    UID,
  );

  assert.ok(decoded);
  assert.equal(decoded.promotion, null);
  assert.equal(decoded.promotionDates, "");
  assert.equal(decoded.promotionConditions, "");
});

test("an unknown language, style or platform decodes to a safe default", () => {
  const doc = encodeRestaurant(FULL, UID) as unknown as Record<string, unknown>;
  doc.contentLanguage = "de";
  doc.visualStyle = "cyberpunk";
  doc.platforms = ["myspace"];
  doc.copyStyles = ["shouty"];

  const decoded = decodeRestaurant(doc, UID);

  assert.ok(decoded);
  assert.equal(decoded.language, "ms");
  assert.equal(decoded.visualStyle, "hangat");
  assert.deepEqual(decoded.platforms, ["instagram"]);
  assert.deepEqual(decoded.copyStyles, ["santai"]);
});

/* --- generated days ------------------------------------------------------- */

/** A day as the AI engine produces it: unbounded variants, never yet edited. */
async function aiDay() {
  const plan = await samplePlan();
  return {
    ...plan.items[0],
    objective: "Buat orang teringat kedai kami waktu tengah hari.",
    designDirection: "Warna hangat, teks minimum.",
    hashtags: ["warungkakina", "kajang"],
    variantCount: 0,
    edited: false,
  };
}

test("the AI fields of a day round-trip through Firestore", async () => {
  const day = await aiDay();
  const plan = await samplePlan();

  const stored = encodePlan({ ...plan, items: [day, ...plan.items.slice(1)] }, UID);
  const decoded = decodePlan(stored, UID);

  assert.ok(decoded);
  assert.equal(decoded.items[0].objective, day.objective);
  assert.equal(decoded.items[0].designDirection, day.designDirection);
  assert.deepEqual(decoded.items[0].hashtags, day.hashtags);
});

test("an unbounded variant count survives instead of being clamped to one", async () => {
  const day = await aiDay();
  const plan = await samplePlan();

  const decoded = decodePlan(
    encodePlan({ ...plan, items: [day, ...plan.items.slice(1)] }, UID),
    UID,
  );

  assert.ok(decoded);
  // 0 means "the engine can always write another version". Clamping it to 1
  // would silently disable the Regenerate button after a page refresh.
  assert.equal(decoded.items[0].variantCount, 0);
});

test("an owner's own edit is remembered across a refresh", async () => {
  const plan = await samplePlan();
  const edited = {
    ...plan.items[3],
    caption: "Ini caption yang saya tulis sendiri.",
    edited: true,
  };

  const decoded = decodePlan(encodePlan(replaceItem(plan, edited), UID), UID);

  assert.ok(decoded);
  const day4 = decoded.items.find((i) => i.day === edited.day);
  assert.ok(day4);
  assert.equal(day4.caption, "Ini caption yang saya tulis sendiri.");
  assert.equal(day4.edited, true);
});

test("a day that was never edited does not come back marked as edited", async () => {
  const plan = await samplePlan();
  const decoded = decodePlan(encodePlan(plan, UID), UID);

  assert.ok(decoded);
  for (const item of decoded.items) assert.equal(item.edited, false);
});

/* --- ownership ------------------------------------------------------------ */

/*
 * Read isolation itself is a rules concern, not a codec one: an owner can only
 * ever fetch `restaurants/{their-uid}`, so a document belonging to somebody
 * else never reaches this layer. `scripts/verify-firebase.mjs` proves that
 * against the real project. What the codec must guarantee is narrower and is
 * asserted here — decoded state is always attributed to the signed-in owner,
 * so a stored id can never impersonate one.
 */

test("a decoded restaurant is always attributed to the signed-in owner", () => {
  const stored = encodeRestaurant(FULL, UID) as unknown as Record<string, unknown>;
  stored.ownerId = "uid-someone-else";

  const decoded = decodeRestaurant(stored, UID);

  assert.ok(decoded);
  assert.equal(decoded.id, UID);
});

test("a plan missing its identifiers is attributed to the signed-in owner", async () => {
  const plan = await samplePlan();
  const stored = encodePlan(plan, UID) as unknown as Record<string, unknown>;
  delete stored.planId;
  delete stored.restaurantId;

  const decoded = decodePlan(stored, UID);

  assert.ok(decoded);
  assert.equal(decoded.id, `plan-${UID}`);
  assert.equal(decoded.restaurantId, UID);
});
