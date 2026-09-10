import assert from "node:assert/strict";
import test from "node:test";

import { CATEGORY_META, PLAN_RHYTHM, SELLING_CATEGORIES } from "./categories.ts";
import { DEMO_RESTAURANT } from "./demo.ts";
import { CTA_SHAPES, ctaShapeFor, emojiBudgetFor, MAX_EMOJI } from "./voice.ts";
import {
  VIDEO_CATEGORIES,
  buildSchedule,
  factsOf,
  resolveCategory,
  resolvePlatform,
  wantsVideo,
} from "./schedule.ts";
import type { ContentCategory, Platform, RestaurantProfile } from "./types.ts";

/**
 * The month's shape, before a word is written.
 *
 * Both engines plan against this, so an owner gets the same strategy whether
 * the copy was written deterministically or by the model. Two rules earn their
 * place here rather than in a prompt: a selling day only survives when there is
 * a real offer to sell, and a post only lands on a platform the owner uses.
 */

const NO_PROMO: RestaurantProfile = {
  ...DEMO_RESTAURANT,
  promotion: null,
  promotionDates: "",
  promotionConditions: "",
};

/* --- facts ---------------------------------------------------------------- */

test("facts read the profile without inventing anything", () => {
  const f = factsOf(DEMO_RESTAURANT);

  assert.equal(f.hasPromotion, true);
  assert.equal(f.hasLocation, true);
  assert.equal(f.hasLogo, false);
  assert.equal(f.hasMenuFile, false);
  assert.deepEqual(f.dishes, DEMO_RESTAURANT.bestSellers);
});

test("whitespace-only answers do not count as facts", () => {
  const f = factsOf({
    ...DEMO_RESTAURANT,
    location: "   ",
    promotion: "  ",
    bestSellers: ["", "  "],
  });

  assert.equal(f.hasLocation, false);
  assert.equal(f.hasPromotion, false);
  assert.equal(f.hasDishes, false);
  assert.deepEqual(f.dishes, []);
});

/* --- selling days --------------------------------------------------------- */

test("a selling day is spent elsewhere when there is nothing to sell", () => {
  for (const selling of SELLING_CATEGORIES) {
    const resolved = resolveCategory(selling, factsOf(NO_PROMO), 3);
    assert.notEqual(resolved, selling, selling);
  }
});

test("a selling day survives when the owner has a real promotion", () => {
  for (const selling of SELLING_CATEGORIES) {
    assert.equal(resolveCategory(selling, factsOf(DEMO_RESTAURANT), 3), selling);
  }
});

test("no promotion means no promotion day anywhere in the month", () => {
  const schedule = buildSchedule(NO_PROMO, 30);

  for (const day of schedule) {
    assert.ok(!SELLING_CATEGORIES.includes(day.category), `day ${day.day} is ${day.category}`);
  }
});

test("a promotion is spread across the month rather than sold every day", () => {
  const schedule = buildSchedule(DEMO_RESTAURANT, 30);
  const selling = schedule.filter((d) => SELLING_CATEGORIES.includes(d.category));

  assert.ok(selling.length > 0, "a real offer should be sold at least once");
  assert.ok(selling.length <= 10, `${selling.length} selling days in 30 is a feed of adverts`);
});

/* --- platforms ------------------------------------------------------------ */

test("a category lands on its natural platform when the owner uses it", () => {
  const all: Platform[] = ["instagram", "tiktok", "facebook", "whatsapp"];
  for (const category of Object.keys(CATEGORY_META) as ContentCategory[]) {
    assert.equal(resolvePlatform(category, all), CATEGORY_META[category].platform, category);
  }
});

test("a post never lands on a platform the owner does not use", () => {
  const onlyWhatsapp = buildSchedule({ ...DEMO_RESTAURANT, platforms: ["whatsapp"] }, 30);

  for (const day of onlyWhatsapp) assert.equal(day.platform, "whatsapp");
});

test("video content moves to another video platform before a chat app", () => {
  assert.equal(resolvePlatform("reels", ["tiktok", "whatsapp"]), "tiktok");
});

test("an owner who picked nothing still gets a usable plan", () => {
  const schedule = buildSchedule({ ...DEMO_RESTAURANT, platforms: [] }, 30);

  assert.equal(schedule.length, 30);
  for (const day of schedule) assert.equal(day.platform, "instagram");
});

/* --- the month ------------------------------------------------------------ */

test("a 30-day plan has 30 days numbered once each", () => {
  const schedule = buildSchedule(DEMO_RESTAURANT, 30);

  assert.equal(schedule.length, 30);
  assert.deepEqual(
    schedule.map((d) => d.day),
    Array.from({ length: 30 }, (_, i) => i + 1),
  );
});

test("the same profile always produces the same month", () => {
  assert.deepEqual(buildSchedule(DEMO_RESTAURANT, 30), buildSchedule(DEMO_RESTAURANT, 30));
});

test("a single-day regeneration agrees with the month it belongs to", () => {
  const month = buildSchedule(DEMO_RESTAURANT, 30);
  const day17 = buildSchedule(DEMO_RESTAURANT, 30).find((d) => d.day === 17);

  assert.deepEqual(day17, month[16]);
});

test("the month uses a spread of categories rather than one repeated idea", () => {
  const categories = new Set(buildSchedule(DEMO_RESTAURANT, 30).map((d) => d.category));

  assert.ok(categories.size >= 6, `only ${categories.size} distinct categories`);
});

test("the rhythm covers the month without running out", () => {
  assert.ok(PLAN_RHYTHM.length > 0);
  const schedule = buildSchedule(DEMO_RESTAURANT, 30);
  assert.equal(schedule.length, 30);
});

/* --- video ---------------------------------------------------------------- */

test("video categories are asked for a video idea", () => {
  for (const category of VIDEO_CATEGORIES) {
    assert.equal(wantsVideo(category, "instagram"), true, category);
  }
});

test("anything posted to TikTok needs a video idea", () => {
  assert.equal(wantsVideo("storytelling", "tiktok"), true);
});

test("a plain photo post on Instagram does not", () => {
  assert.equal(wantsVideo("storytelling", "instagram"), false);
});

/* --- the shapes a month closes with --------------------------------------- */

test("no two days within four of each other close the same way", () => {
  for (let day = 1; day <= 30; day++) {
    for (let ahead = 1; ahead <= 4 && day + ahead <= 30; ahead++) {
      assert.notEqual(
        ctaShapeFor(day),
        ctaShapeFor(day + ahead),
        `day ${day} and day ${day + ahead} ask for the same invitation`,
      );
    }
  }
});

test("a month uses every shape, and none more than twice", () => {
  const used = new Map<string, number>();
  for (let day = 1; day <= 30; day++) {
    const shape = ctaShapeFor(day);
    used.set(shape, (used.get(shape) ?? 0) + 1);
  }

  assert.equal(used.size, CTA_SHAPES.length);
  for (const [shape, count] of used) {
    assert.ok(count <= 2, `${shape} asked for ${count} times`);
  }
});

test("a regenerated day is asked for the shape its neighbours were written around", () => {
  assert.equal(ctaShapeFor(17), ctaShapeFor(17));
  assert.equal(ctaShapeFor(0), ctaShapeFor(1));
});

/* --- emoji ---------------------------------------------------------------- */

test("most days carry no emoji, and a few carry one", () => {
  const month = Array.from({ length: 30 }, (_, i) => emojiBudgetFor(i + 1));
  const none = month.filter((n) => n === 0).length;

  assert.ok(none >= 18, `${none} of 30 days are plain`);
  assert.ok(none <= 24, "a month with no emoji anywhere is as uniform as one with emoji everywhere");
  assert.ok(month.some((n) => n > 0), "some day is allowed one");
});

test("no day is allowed more emoji than a caption may carry", () => {
  for (let day = 1; day <= 60; day++) {
    assert.ok(emojiBudgetFor(day) <= MAX_EMOJI, `day ${day}`);
    assert.ok(emojiBudgetFor(day) >= 0, `day ${day}`);
  }
});

test("the emoji allowance does not fall on the same weekday every week", () => {
  // A 7-day cycle read seven days at a time would put every emoji on a Monday.
  const allowed = [];
  for (let day = 1; day <= 30; day++) if (emojiBudgetFor(day) > 0) allowed.push(day % 7);
  assert.ok(new Set(allowed).size > 1, "the allowance moves through the week");
});

test("a regenerated day keeps the allowance its neighbours were written around", () => {
  assert.equal(emojiBudgetFor(12), emojiBudgetFor(12));
  assert.notEqual(emojiBudgetFor(2), emojiBudgetFor(1));
});
