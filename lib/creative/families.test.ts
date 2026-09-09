import assert from "node:assert/strict";
import test from "node:test";

import { DEMO_RESTAURANT } from "../content/demo.ts";
import { MockContentGenerator } from "../content/mock-generator.ts";
import type { ContentItem } from "../content/types.ts";
import { FAMILIES, familyFor, focalFor, photosWanted } from "./families.ts";
import type { TemplateId } from "./types.ts";

/**
 * What a month of posters must not be.
 *
 * These tests are the brief's "variety" requirement written down as
 * arithmetic. The wheel in `families.ts` is chosen so they hold without a
 * search; if somebody adds a sixteenth entry or changes the stride, one of
 * these fails rather than the owner discovering two identical days in a row
 * three weeks after they paid.
 */

const generator = new MockContentGenerator();

async function month(): Promise<ContentItem[]> {
  const { items } = await generator.generatePlan({
    restaurant: DEMO_RESTAURANT,
    startDate: "2026-03-01",
  });
  return items;
}

/** Every family, spelled out, so a rename cannot quietly shrink the set. */
function used(items: readonly ContentItem[], hasPhoto: boolean): TemplateId[] {
  return items.map((item) => familyFor(item, hasPhoto));
}

/* --- spread --------------------------------------------------------------- */

test("no two days in a row are the same kind of poster", async () => {
  const families = used(await month(), true);

  for (let i = 1; i < families.length; i += 1) {
    assert.notEqual(
      families[i],
      families[i - 1],
      `day ${i + 1} repeats day ${i}: ${families[i]}`,
    );
  }
});

test("a month reaches every family it has, and leans on none of them", async () => {
  const items = await month();
  const families = used(items, true);
  const counts = new Map<TemplateId, number>();
  for (const family of families) {
    counts.set(family, (counts.get(family) ?? 0) + 1);
  }

  // Festive days come from the calendar, not the wheel, so the wheel families
  // are the ones a plain month must cover.
  const wheel = FAMILIES.filter((f) => f !== "festive");
  for (const family of wheel) {
    assert.ok(counts.has(family), `${family} never appears in thirty days`);
  }
  for (const [family, n] of counts) {
    assert.ok(n <= 4, `${family} carries ${n} of thirty days, which is a rut`);
  }
});

test("the same day always composes as the same family", async () => {
  const items = await month();

  for (const item of items) {
    assert.equal(familyFor(item, true), familyFor(item, true));
    assert.equal(focalFor(item).zoom, focalFor(item).zoom);
  }
});

/* --- photographs ---------------------------------------------------------- */

test("a restaurant with no pictures gets layouts that never wanted one", async () => {
  const items = await month();

  for (const item of items) {
    assert.equal(photosWanted(item, false), 0, `day ${item.day} asks for a photo`);
  }
  // And still varies: four typographic families rather than one repeated.
  assert.ok(new Set(used(items, false)).size >= 3);
});

test("a collage asks for three frames and a hero asks for one", async () => {
  const items = await month();
  const collage = items.find((item) => familyFor(item, true) === "collage");
  const hero = items.find((item) => familyFor(item, true) === "photo-band");
  assert.ok(collage && hero);

  assert.equal(photosWanted(collage, true), 3);
  assert.equal(photosWanted(hero, true), 1);
});

test("one photograph is framed differently on the days it comes back", async () => {
  const items = await month();
  const photoDays = items.filter((item) => photosWanted(item, true) > 0);
  const crops = new Set(
    photoDays.map((item) => {
      const f = focalFor(item);
      return `${f.x},${f.y},${f.zoom}`;
    }),
  );

  assert.ok(crops.size >= 5, `only ${crops.size} framings across the month`);
});

test("a collage of one photograph is three crops, not the same frame thrice", async () => {
  const items = await month();
  const collage = items.find((item) => familyFor(item, true) === "collage");
  assert.ok(collage);

  const frames = [0, 1, 2].map((slot) => {
    const f = focalFor(collage, slot);
    return `${f.x},${f.y},${f.zoom}`;
  });
  assert.equal(new Set(frames).size, 3);
});

test("a crop never goes so close that a phone photograph falls apart", async () => {
  const items = await month();

  for (const item of items) {
    for (const slot of [0, 1, 2]) {
      const f = focalFor(item, slot);
      assert.ok(f.zoom >= 1 && f.zoom <= 2, `day ${item.day} zooms ${f.zoom}x`);
      assert.ok(f.x >= 0 && f.x <= 1 && f.y >= 0 && f.y <= 1);
    }
  }
});
