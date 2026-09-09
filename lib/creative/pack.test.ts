import assert from "node:assert/strict";
import test from "node:test";

import { DEMO_RESTAURANT } from "../content/demo.ts";
import { MockContentGenerator } from "../content/mock-generator.ts";
import type { AssetRef, ContentItem, ContentPlan } from "../content/types.ts";
import { formatFor, treatmentFor } from "./compose.ts";
import {
  assignPhotos,
  composePackDay,
  daysNeedingPhotos,
  defaultPackName,
  missingItems,
  packStatus,
  photoPool,
  runPack,
} from "./pack.ts";
import { CANVAS, isImage, isText, type Creative } from "./types.ts";

const generator = new MockContentGenerator();

function plan(): Promise<ContentPlan> {
  return generator.generatePlan({
    restaurant: DEMO_RESTAURANT,
    startDate: "2026-03-01",
  });
}

function photo(name: string, uploadedAt: string): AssetRef {
  return {
    path: `restaurants/uid-1/creatives/${name}`,
    url: `https://firebasestorage.googleapis.com/v0/b/bucket/o/${name}?alt=media&token=t`,
    name,
    contentType: "image/jpeg",
    size: 2048,
    uploadedAt,
  };
}

/**
 * A stand-in for Firestore that records what it was asked to store, keyed the
 * way the real collection is keyed. Overwriting one day with another shows up
 * here as a map that is too small.
 */
function store() {
  const docs = new Map<string, Creative>();
  return {
    docs,
    persist: async (creative: Creative) => {
      docs.set(creative.id, creative);
    },
  };
}

async function generateAll(existing: readonly Creative[] = []) {
  const p = await plan();
  const pool = photoPool(existing);
  const photos = assignPhotos(p.items, pool);
  const targets = missingItems(p.items, existing);
  const db = store();
  const result = await runPack(
    targets,
    (item) => composePackDay(DEMO_RESTAURANT, p.id, item, photos, "2026-03-01T00:00:00.000Z"),
    db.persist,
  );
  return { plan: p, db, result };
}

/* --- thirty days in, thirty designs out ----------------------------------- */

test("a thirty day plan becomes thirty designs", async () => {
  const { plan: p, db, result } = await generateAll();

  assert.equal(p.items.length, 30);
  assert.equal(result.saved.length, 30);
  assert.equal(result.failures.length, 0);
  assert.equal(db.docs.size, 30);
});

test("each design is filed against the day it was made from", async () => {
  const { plan: p, db } = await generateAll();

  for (const item of p.items) {
    const creative = db.docs.get(item.id);
    assert.ok(creative, `day ${item.day} has no design`);
    assert.equal(creative.itemId, item.id);
    assert.equal(creative.day, item.day);
    assert.equal(creative.planId, p.id);
  }
});

test("no day overwrites another day's design", async () => {
  const { plan: p, db } = await generateAll();

  // Thirty distinct document ids, and thirty distinct day numbers within them.
  assert.equal(new Set([...db.docs.keys()]).size, 30);
  assert.equal(new Set([...db.docs.values()].map((c) => c.day)).size, 30);
  assert.deepEqual(
    [...db.docs.values()].map((c) => c.day).sort((a, b) => a - b),
    p.items.map((i) => i.day),
  );
});

/* --- running it twice ------------------------------------------------------ */

test("generating twice leaves thirty designs, not sixty", async () => {
  const { plan: p, db, result } = await generateAll();

  const again = missingItems(p.items, [...db.docs.values()]);
  assert.equal(again.length, 0, "a second run has nothing left to do");

  const second = await runPack(
    again,
    (item) => composePackDay(DEMO_RESTAURANT, p.id, item, new Map()),
    db.persist,
  );
  assert.equal(second.saved.length, 0);
  assert.equal(db.docs.size, 30);
  assert.equal(result.saved.length, 30);
});

test("a design that is already saved is never rebuilt", async () => {
  const p = await plan();
  const kept = composePackDay(DEMO_RESTAURANT, p.id, p.items[0], new Map());
  const edited: Creative = { ...kept, name: "Nama sendiri", edited: true };

  const targets = missingItems(p.items, [edited]);
  assert.equal(targets.length, 29);
  assert.ok(!targets.some((item) => item.id === edited.itemId));
});

/* --- partial failure and retry --------------------------------------------- */

test("a day that fails to save does not stop the other twenty-nine", async () => {
  const p = await plan();
  const db = store();
  const broken = p.items[12].id;

  const result = await runPack(
    p.items,
    (item) => composePackDay(DEMO_RESTAURANT, p.id, item, new Map()),
    async (creative) => {
      if (creative.id === broken) throw new Error("rangkaian terputus");
      await db.persist(creative);
    },
  );

  assert.equal(result.saved.length, 29);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].day, p.items[12].day);
  assert.equal(result.failures[0].message, "rangkaian terputus");
});

test("retrying the failures fills the gaps without touching the successes", async () => {
  const p = await plan();
  const db = store();
  let firstAttempt = true;
  const broken = new Set([p.items[3].id, p.items[20].id]);

  const persist = async (creative: Creative) => {
    if (firstAttempt && broken.has(creative.id)) throw new Error("gagal");
    await db.persist(creative);
  };

  const first = await runPack(
    p.items,
    (item) => composePackDay(DEMO_RESTAURANT, p.id, item, new Map()),
    persist,
  );
  assert.equal(first.failures.length, 2);
  assert.equal(db.docs.size, 28);

  const untouched = new Map([...db.docs].map(([id, c]) => [id, c.updatedAt]));
  firstAttempt = false;

  const retry = await runPack(
    missingItems(p.items, [...db.docs.values()]),
    (item) => composePackDay(DEMO_RESTAURANT, p.id, item, new Map()),
    persist,
  );

  assert.equal(retry.saved.length, 2);
  assert.equal(retry.failures.length, 0);
  assert.equal(db.docs.size, 30);
  for (const [id, updatedAt] of untouched) {
    assert.equal(db.docs.get(id)?.updatedAt, updatedAt, `${id} was rewritten`);
  }
});

/* --- status ---------------------------------------------------------------- */

test("the pack is only ready once every day is actually saved", () => {
  assert.equal(packStatus({ total: 30, ready: 30, failed: 0, running: false }), "ready");
  assert.equal(packStatus({ total: 30, ready: 29, failed: 1, running: false }), "partial");
  assert.equal(packStatus({ total: 30, ready: 29, failed: 0, running: false }), "partial");
});

test("a run in flight reads as generating, whatever has landed so far", () => {
  assert.equal(packStatus({ total: 30, ready: 0, failed: 0, running: true }), "generating");
  assert.equal(packStatus({ total: 30, ready: 30, failed: 0, running: true }), "generating");
});

test("nothing saved is not_started, unless something was tried and failed", () => {
  assert.equal(packStatus({ total: 30, ready: 0, failed: 0, running: false }), "not_started");
  assert.equal(packStatus({ total: 30, ready: 0, failed: 30, running: false }), "failed");
  assert.equal(packStatus({ total: 0, ready: 0, failed: 0, running: false }), "not_started");
});

test("the pack is named after the restaurant, and the count is real", () => {
  assert.equal(
    defaultPackName(DEMO_RESTAURANT, 30),
    `30 Hari Content — ${DEMO_RESTAURANT.name}`,
  );
  assert.equal(defaultPackName({ ...DEMO_RESTAURANT, name: "  " }, 30), "30 Hari Content");
});

/* --- photographs ----------------------------------------------------------- */

test("the photo pool is what the owner uploaded, each picture once", async () => {
  const p = await plan();
  const a = photo("ayam.jpg", "2026-02-01T00:00:00.000Z");
  const b = photo("mee.jpg", "2026-02-02T00:00:00.000Z");

  const saved = [
    composePackDay(DEMO_RESTAURANT, p.id, p.items[0], new Map([[p.items[0].id, b]])),
    composePackDay(DEMO_RESTAURANT, p.id, p.items[1], new Map([[p.items[1].id, a]])),
    composePackDay(DEMO_RESTAURANT, p.id, p.items[2], new Map([[p.items[2].id, a]])),
  ];

  assert.deepEqual(photoPool(saved).map((ref) => ref.name), ["ayam.jpg", "mee.jpg"]);
});

test("a logo is never mistaken for a food photograph", async () => {
  const p = await plan();
  const logo: AssetRef = { ...photo("mark.png", "2026-02-01T00:00:00.000Z"), path: "restaurants/uid-1/logo/mark.png" };
  const branded = { ...DEMO_RESTAURANT, logo };
  const saved = [composePackDay(branded, p.id, p.items[0], new Map())];

  assert.equal(photoPool(saved).length, 0);
});

test("several photos are spread across the month rather than stacked on day one", async () => {
  const p = await plan();
  const pool = [
    photo("a.jpg", "2026-02-01T00:00:00.000Z"),
    photo("b.jpg", "2026-02-02T00:00:00.000Z"),
    photo("c.jpg", "2026-02-03T00:00:00.000Z"),
  ];
  const assigned = assignPhotos(p.items, pool);

  assert.ok(assigned.size >= 20, "most days should carry a picture");
  const used = new Set([...assigned.values()].map((ref) => ref.name));
  assert.deepEqual([...used].sort(), ["a.jpg", "b.jpg", "c.jpg"]);
});

test("one photograph is reused rather than leaving twenty-nine empty slots", async () => {
  const p = await plan();
  const only = photo("satu.jpg", "2026-02-01T00:00:00.000Z");
  const assigned = assignPhotos(p.items, only ? [only] : []);

  for (const ref of assigned.values()) assert.equal(ref.path, only.path);
  assert.ok(assigned.size >= 20);
});

test("a day with no photo slot is never handed a photograph", async () => {
  const p = await plan();
  const pool = [photo("a.jpg", "2026-02-01T00:00:00.000Z")];
  const assigned = assignPhotos(p.items, pool);

  for (const item of p.items) {
    if (item.platform !== "whatsapp") continue;
    assert.equal(assigned.has(item.id), false, `day ${item.day} is a Status`);
    const creative = composePackDay(DEMO_RESTAURANT, p.id, item, assigned);
    assert.equal(creative.elements.filter(isImage).length, 0);
  }
});

test("no photographs at all means empty slots, never a stand-in picture", async () => {
  const { db } = await generateAll();

  for (const creative of db.docs.values()) {
    for (const el of creative.elements) {
      if (isImage(el)) assert.equal(el.source, null);
    }
  }
});

test("the days offered an automatic photo are the empty, unedited ones", async () => {
  const p = await plan();
  const only = photo("satu.jpg", "2026-02-01T00:00:00.000Z");

  const empty = composePackDay(DEMO_RESTAURANT, p.id, p.items[0], new Map());
  const filled = composePackDay(DEMO_RESTAURANT, p.id, p.items[1], new Map([[p.items[1].id, only]]));
  const ownEdit: Creative = { ...composePackDay(DEMO_RESTAURANT, p.id, p.items[2], new Map()), edited: true };

  const wanted = daysNeedingPhotos([empty, filled, ownEdit]);
  assert.deepEqual(wanted.map((c) => c.itemId), [empty.itemId]);
});

/* --- what may appear on thirty posters ------------------------------------- */

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

test("every word across the whole pack came from the plan or from the owner", async () => {
  const p = await plan();
  const pool = [photo("a.jpg", "2026-02-01T00:00:00.000Z")];
  const photos = assignPhotos(p.items, pool);

  for (const item of p.items) {
    const creative = composePackDay(DEMO_RESTAURANT, p.id, item, photos);
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

test("the caption stays out of the poster on all thirty days", async () => {
  const { plan: p, db } = await generateAll();

  for (const item of p.items) {
    const creative = db.docs.get(item.id);
    assert.ok(creative);
    for (const el of creative.elements) {
      if (!isText(el)) continue;
      assert.notEqual(el.text, item.caption);
      // Nor a truncation of it: the poster carries the hook, not the post.
      assert.ok(
        el.text.length < 120,
        `day ${item.day}: "${el.text.slice(0, 40)}…" is caption-length`,
      );
    }
  }
});

/* --- platform ------------------------------------------------------------- */

test("each day is built at the size its own platform publishes", async () => {
  const { plan: p, db } = await generateAll();

  for (const item of p.items) {
    const creative = db.docs.get(item.id);
    assert.ok(creative);
    assert.equal(creative.platform, item.platform);
    assert.equal(creative.format, formatFor(item));
    assert.deepEqual(creative.canvas, CANVAS[creative.format]);
  }

  // And the month genuinely contains more than one shape, rather than one
  // canvas size stamped thirty times regardless of where the post is going.
  const shapes = new Set([...db.docs.values()].map((c) => c.format));
  assert.ok(shapes.size > 1, `only one canvas shape in the pack: ${[...shapes]}`);
});

/* --- variety, without an anti-repetition rule ------------------------------ */

test("consecutive days do not come out looking identical", async () => {
  const { plan: p, db } = await generateAll();

  let differing = 0;
  for (let i = 1; i < p.items.length; i++) {
    const before = db.docs.get(p.items[i - 1].id);
    const after = db.docs.get(p.items[i].id);
    assert.ok(before && after);
    const same =
      before.background.kind === after.background.kind &&
      JSON.stringify(before.elements.map((el) => el.box)) ===
        JSON.stringify(after.elements.map((el) => el.box)) &&
      JSON.stringify(before.background) === JSON.stringify(after.background);
    if (!same) differing += 1;
  }
  assert.ok(differing >= 25, `only ${differing} of 29 day pairs differ in layout`);
});

test("two days of the same category are both still made", async () => {
  const p = await plan();
  const twin: ContentItem = { ...p.items[1], category: p.items[0].category };
  const db = store();

  const result = await runPack(
    [p.items[0], twin],
    (item) => composePackDay(DEMO_RESTAURANT, p.id, item, new Map()),
    db.persist,
  );

  // Nothing rejects a day for repeating the one before it. M4A showed that
  // making repetition an error makes the output worse, not more varied.
  assert.equal(result.saved.length, 2);
  assert.equal(result.failures.length, 0);
});

test("the treatment is a function of the day, so it never drifts", async () => {
  const p = await plan();
  assert.deepEqual(treatmentFor(p.items[4]), treatmentFor({ ...p.items[9], day: 5 }));

  const once = composePackDay(DEMO_RESTAURANT, p.id, p.items[4], new Map(), "2026-03-01T00:00:00.000Z");
  const twice = composePackDay(DEMO_RESTAURANT, p.id, p.items[4], new Map(), "2026-03-01T00:00:00.000Z");
  assert.deepEqual(once, twice);
});

/* --- cost ------------------------------------------------------------------ */

/**
 * The cost requirement, as a test rather than as a promise in a comment.
 *
 * If any part of composing thirty designs reached for a model — or for
 * anything else over the network — this fails loudly instead of arriving on a
 * bill at the end of the month.
 */
test("generating a whole pack makes no network call at all", async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (...args: unknown[]) => {
    calls += 1;
    throw new Error(`pack generation called out to ${String(args[0])}`);
  }) as typeof fetch;

  try {
    const { result } = await generateAll();
    assert.equal(result.saved.length, 30);
    assert.equal(calls, 0, "composition must not call anything");
  } finally {
    globalThis.fetch = realFetch;
  }
});
