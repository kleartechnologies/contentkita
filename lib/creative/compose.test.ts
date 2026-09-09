import assert from "node:assert/strict";
import test from "node:test";

import { DEMO_RESTAURANT } from "../content/demo.ts";
import { MockContentGenerator } from "../content/mock-generator.ts";
import type { AssetRef, ContentItem, RestaurantProfile } from "../content/types.ts";
import { composeCreative, defaultName, dishInPost, formatFor, templateFor } from "./compose.ts";
import { CANVAS, isImage, isLogo, isText, type Creative } from "./types.ts";

const generator = new MockContentGenerator();

async function plan() {
  return generator.generatePlan({
    restaurant: DEMO_RESTAURANT,
    startDate: "2026-03-01",
  });
}

const PHOTO: AssetRef = {
  path: "restaurants/uid-1/creatives/ayam.jpg",
  url: "https://firebasestorage.googleapis.com/v0/b/bucket/o/x?alt=media&token=t",
  name: "ayam.jpg",
  contentType: "image/jpeg",
  size: 1024,
  uploadedAt: "2026-03-01T00:00:00.000Z",
};

function itemFor(patch: Partial<ContentItem>, base: ContentItem): ContentItem {
  return { ...base, ...patch };
}

/* --- format and template -------------------------------------------------- */

test("each platform gets the shape its feed actually publishes", async () => {
  const { items } = await plan();
  const base = items[0];

  assert.equal(formatFor(itemFor({ platform: "instagram", category: "promotion" }, base)), "square");
  assert.equal(formatFor(itemFor({ platform: "facebook", category: "promotion" }, base)), "square");
  assert.equal(formatFor(itemFor({ platform: "instagram", category: "reels" }, base)), "portrait");
  assert.equal(formatFor(itemFor({ platform: "tiktok", category: "reels" }, base)), "story");
  assert.equal(formatFor(itemFor({ platform: "whatsapp", category: "promotion" }, base)), "story");
});

test("the canvas matches the format, in real publishing pixels", async () => {
  const { items } = await plan();
  const creative = composeCreative(DEMO_RESTAURANT, "plan-1", items[0]);

  assert.deepEqual(creative.canvas, CANVAS[creative.format]);
  assert.equal(CANVAS.square.width, 1080);
  assert.equal(CANVAS.portrait.height, 1350);
  assert.equal(CANVAS.story.height, 1920);
});

test("the photo layout is only reachable once a real photo exists", async () => {
  const { items } = await plan();
  const item = itemFor({ platform: "instagram" }, items[0]);

  assert.equal(templateFor(item, null), "type-poster");
  assert.equal(templateFor(item, PHOTO), "photo-band");
  // WhatsApp Status is read at arm's length; it stays text-first either way.
  assert.equal(templateFor(itemFor({ platform: "whatsapp" }, item), PHOTO), "text-first");
});

test("a fresh creative starts with an empty slot, never a stand-in photograph", async () => {
  const { items } = await plan();
  const creative = composeCreative(DEMO_RESTAURANT, "plan-1", items[0]);

  for (const el of creative.elements) {
    if (isImage(el)) assert.equal(el.source, null);
  }
});

/* --- what may appear on a poster ------------------------------------------ */

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * The property that makes a creative safe: composition selects, it never
 * writes. If this fails, some string reached a poster that no validator saw.
 */
test("every word on the poster came from the plan or from the owner", async () => {
  const { id, items } = await plan();

  for (const item of items) {
    const creative = composeCreative(DEMO_RESTAURANT, id, item, { image: PHOTO });
    const allowed = normalise(
      [item.hook, item.cta, DEMO_RESTAURANT.name, ...DEMO_RESTAURANT.bestSellers].join(" "),
    );

    for (const el of creative.elements) {
      if (!isText(el)) continue;
      assert.ok(
        allowed.includes(normalise(el.text)),
        `day ${item.day}: "${el.text}" is not in the validated copy`,
      );
    }
  }
});

test("the caption never reaches the poster", async () => {
  const { items } = await plan();
  const item = items[0];
  const creative = composeCreative(DEMO_RESTAURANT, "plan-1", item);

  for (const el of creative.elements) {
    if (isText(el)) assert.notEqual(el.text, item.caption);
  }
});

test("a dish is named only when the post itself mentions it", async () => {
  const { items } = await plan();
  const base = items[0];

  assert.equal(
    dishInPost(itemFor({ hook: "Mee Goreng panas!", caption: "", visualIdea: "" }, base), [
      "Nasi Ayam Penyet",
      "Mee Goreng",
    ]),
    "Mee Goreng",
  );
  assert.equal(
    dishInPost(itemFor({ hook: "Datang hari ini", caption: "", visualIdea: "" }, base), [
      "Mee Goreng",
    ]),
    null,
  );
});

test("promotions and prices are not copied onto the design", async () => {
  const withPromo: RestaurantProfile = {
    ...DEMO_RESTAURANT,
    promotion: "Set Lunch RM12.90",
  };
  const { items } = await plan();
  const creative = composeCreative(withPromo, "plan-1", items[0]);

  for (const el of creative.elements) {
    if (isText(el)) assert.ok(!el.text.includes("RM12.90"));
  }
});

/* --- brand ---------------------------------------------------------------- */

test("the owner's own colour wins over the style default", async () => {
  const { items } = await plan();
  const branded = composeCreative(
    { ...DEMO_RESTAURANT, brandColours: "#0F7A5A" },
    "plan-1",
    items[0],
  );

  assert.equal(branded.palette.accent.toUpperCase(), "#0F7A5A");
});

test("a logo is placed only when the owner uploaded one", async () => {
  const { items } = await plan();

  const without = composeCreative(DEMO_RESTAURANT, "plan-1", items[0]);
  assert.equal(without.elements.filter(isLogo).length, 0);

  const logo: AssetRef = { ...PHOTO, path: "restaurants/uid-1/logo/mark.png" };
  const with_ = composeCreative({ ...DEMO_RESTAURANT, logo }, "plan-1", items[0]);
  const placed = with_.elements.filter(isLogo);
  assert.equal(placed.length, 1);
  assert.equal(placed[0].source?.path, logo.path);
});

/* --- identity ------------------------------------------------------------- */

test("composing the same day twice produces the same creative", async () => {
  const { items } = await plan();
  const a = composeCreative(DEMO_RESTAURANT, "plan-1", items[3], { now: "2026-03-01T00:00:00.000Z" });
  const b = composeCreative(DEMO_RESTAURANT, "plan-1", items[3], { now: "2026-03-01T00:00:00.000Z" });

  assert.deepEqual(a, b);
});

test("the creative is filed against the day it was built from", async () => {
  const { id, items } = await plan();
  const item = items[5];
  const creative: Creative = composeCreative(DEMO_RESTAURANT, id, item);

  assert.equal(creative.itemId, item.id);
  assert.equal(creative.id, item.id);
  assert.equal(creative.planId, id);
  assert.equal(creative.day, item.day);
  assert.equal(creative.edited, false);
});

test("the default name carries the day, zero-padded so it sorts", async () => {
  const { items } = await plan();
  const name = defaultName(itemFor({ day: 7 }, items[0]), "Nasi Ayam Penyet");

  assert.equal(name, "Nasi Ayam Penyet — Hari 07");
});
