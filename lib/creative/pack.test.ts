import assert from "node:assert/strict";
import test from "node:test";

import { DEMO_RESTAURANT } from "../content/demo.ts";
import { MockContentGenerator } from "../content/mock-generator.ts";
import type { AssetRef, ContentItem, ContentPlan } from "../content/types.ts";
import {
  contentFingerprint,
  dishInPost,
  formatFor,
  photoNamesDish,
  photoWordsInPost,
  treatmentFor,
} from "./compose.ts";
import { familyFor } from "./families.ts";
import { GRID, signatureFromGrid } from "./photo.ts";
import {
  assignPhotos,
  composePackDay,
  creativePhotos,
  daysNeedingPhotos,
  defaultPackName,
  isStale,
  missingItems,
  packStatus,
  photoPool,
  recomposeDay,
  runPack,
  staleCreatives,
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
    composePackDay(DEMO_RESTAURANT, p.id, p.items[0], new Map([[p.items[0].id, [b]]])),
    composePackDay(DEMO_RESTAURANT, p.id, p.items[1], new Map([[p.items[1].id, [a]]])),
    composePackDay(DEMO_RESTAURANT, p.id, p.items[2], new Map([[p.items[2].id, [a]]])),
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
  const used = new Set([...assigned.values()].flat().map((ref) => ref.name));
  assert.deepEqual([...used].sort(), ["a.jpg", "b.jpg", "c.jpg"]);
});

test("a layout never leads on the plate it led on last time", async () => {
  const p = await plan();
  const pool = ["a.jpg", "b.jpg", "c.jpg", "d.jpg", "e.jpg", "f.jpg"].map((name, i) =>
    photo(name, `2026-02-0${i + 1}T00:00:00.000Z`),
  );
  const assigned = assignPhotos(p.items, pool);

  // The family wheel gives each layout two days a month. Days 5 and 20 of the
  // M6.5 acceptance pack were both the editorial column on the same
  // photograph: two crops of one picture in one layout, which an owner reads
  // as the same page posted twice however far apart the crops are.
  const led = new Map<string, string[]>();
  for (const item of p.items) {
    const lead = assigned.get(item.id)?.[0];
    if (!lead) continue;
    const family = familyFor(item, true);
    const before = led.get(family) ?? [];
    assert.notEqual(
      before.at(-1),
      lead.name,
      `${family} led on ${lead.name} twice running (day ${item.day})`,
    );
    led.set(family, [...before, lead.name]);
  }
});

/** A flat line drawing on white, as `photo.ts` reads one off the file. */
function drawing(name: string, uploadedAt: string): AssetRef {
  const cells: number[] = [];
  for (let y = 0; y < GRID; y += 1) {
    for (let x = 0; x < GRID; x += 1) {
      const inside = x > GRID * 0.4 && x < GRID * 0.6 && y > GRID * 0.35 && y < GRID * 0.65;
      cells.push(...(inside ? [20, 20, 20] : [252, 252, 252]));
    }
  }
  return { ...photo(name, uploadedAt), signature: signatureFromGrid(cells, 1920, 2560) };
}

test("a drawing is placed because the copy asked for it, not because its turn came", async () => {
  const p = await plan();
  const pool = [
    photo("nasi-lemak.jpg", "2026-02-01T00:00:00.000Z"),
    photo("mee-goreng.jpg", "2026-02-02T00:00:00.000Z"),
    photo("roti-canai.jpg", "2026-02-03T00:00:00.000Z"),
    drawing("Teh-tarik.jpg", "2026-02-04T00:00:00.000Z"),
  ];
  assert.equal(pool[3].signature?.kind, "graphic");

  // The acceptance pack put this one drawn glass of tea on three of thirty
  // posts, twice in the same layout four days apart, for a shop whose copy on
  // two of those days was about the size of the room. Dealt in turn, a drawing
  // becomes a motif nobody chose.
  const assigned = assignPhotos(p.items, pool, DEMO_RESTAURANT.bestSellers);
  const drawn = p.items.filter((item) =>
    (assigned.get(item.id) ?? []).some((ref) => ref.name === "Teh-tarik.jpg"),
  );
  for (const item of drawn) {
    const said = `${item.hook} ${item.caption} ${item.visualIdea}`.toLowerCase();
    assert.ok(
      said.includes("teh tarik"),
      `day ${item.day} was handed the drawing without ever mentioning it`,
    );
  }
});

test("a pool of nothing but drawings is still dealt", async () => {
  const p = await plan();
  const pool = [
    drawing("satu.jpg", "2026-02-01T00:00:00.000Z"),
    drawing("dua.jpg", "2026-02-02T00:00:00.000Z"),
  ];
  const assigned = assignPhotos(p.items, pool);

  // Preferring photographs must not mean refusing to serve an owner who has
  // none. Every day that wanted a picture still gets one.
  for (const item of p.items) {
    const wanted = familyFor(item, true) === "collage" ? 3 : 1;
    const got = assigned.get(item.id);
    if (!got) continue;
    assert.equal(got.length, wanted, `day ${item.day} was served short`);
  }
  assert.ok(assigned.size > 0, "a drawings-only pool was never dealt at all");
});

test("two posts side by side in the grid do not lead on the same photograph", async () => {
  const p = await plan();
  const pool = ["nasi-lemak.jpg", "roti-canai.jpg", "mee-goreng.jpg", "sambal.jpg"].map(
    (name, i) => photo(name, `2026-02-0${i + 1}T00:00:00.000Z`),
  );
  const assigned = assignPhotos(p.items, pool, DEMO_RESTAURANT.bestSellers);

  // Days 16 and 17 of the acceptance pack both led on the roti canai: the
  // rotation gave it to one and the other's own caption claimed it. In a feed
  // the two posts touch, so it read as the same picture posted twice.
  // The exception is a day whose own copy names the dish. Two posts running
  // about the nasi lemak, and one photograph of nasi lemak, is a day for two
  // different crops — not a day to staple the wrong plate to the right words.
  const claimed = (item: ContentItem, name: string): boolean => {
    const dish = dishInPost(item, DEMO_RESTAURANT.bestSellers);
    if (dish !== null && photoNamesDish(name, dish)) return true;
    return photoWordsInPost(name, item) > 0;
  };

  let previous: string | undefined;
  for (const item of p.items) {
    const lead = assigned.get(item.id)?.[0]?.name;
    if (lead && !claimed(item, lead)) {
      assert.notEqual(lead, previous, `day ${item.day} repeats the day before's photograph`);
    }
    previous = lead;
  }
});

test("one photograph is reused rather than leaving twenty-nine empty slots", async () => {
  const p = await plan();
  const only = photo("satu.jpg", "2026-02-01T00:00:00.000Z");
  const assigned = assignPhotos(p.items, only ? [only] : []);

  for (const refs of assigned.values()) {
    for (const ref of refs) assert.equal(ref.path, only.path);
  }
  assert.ok(assigned.size >= 20);
});

test("the poster's photograph is of the dish the poster names", async () => {
  const p = await plan();
  const pool = [
    photo("teh-ais.jpg", "2026-02-01T00:00:00.000Z"),
    photo("mee-goreng.jpg", "2026-02-02T00:00:00.000Z"),
    photo("nasi-ayam-penyet.jpg", "2026-02-03T00:00:00.000Z"),
  ];
  const items = p.items.map((item, i) =>
    i % 3 === 0 ? { ...item, hook: "Mee Goreng panas hari ni." } : item,
  );
  const assigned = assignPhotos(items, pool, DEMO_RESTAURANT.bestSellers);

  for (const item of items) {
    if (item.hook !== "Mee Goreng panas hari ni.") continue;
    const picks = assigned.get(item.id);
    if (!picks) continue; // a typographic day has no picture to be wrong about
    assert.equal(picks[0].name, "mee-goreng.jpg", `day ${item.day}`);
  }
});

test("a day about food the menu never lists still gets the right photograph", async () => {
  const p = await plan();
  const pool = [
    photo("Nasi-lemak.jpg", "2026-02-01T00:00:00.000Z"),
    photo("Roti-canai.jpg", "2026-02-02T00:00:00.000Z"),
    photo("Sambal-ikan-bilis.jpg", "2026-02-03T00:00:00.000Z"),
    photo("Ayam-goreng-berempah.jpg", "2026-02-04T00:00:00.000Z"),
  ];
  // Neither line names a best seller: the menu says "Nasi Lemak Ayam
  // Berempah", and the sambal is not on it at all. Day 4 of the M6.5
  // acceptance pack printed the first of these over a man flipping roti canai
  // dough while the chicken sat unused in the same pool.
  const hooks = new Map([
    [3, "Ayam berempah kami direndam semalaman."],
    [9, "Sambal ikan bilis ni tak dibuat main."],
  ]);
  const items = p.items.map((item, i) => {
    const hook = hooks.get(i);
    return hook ? { ...item, hook, caption: `${hook}\n\nDatang pagi.` } : item;
  });
  const assigned = assignPhotos(items, pool, DEMO_RESTAURANT.bestSellers);

  for (const [i, name] of [[3, "Ayam-goreng-berempah.jpg"], [9, "Sambal-ikan-bilis.jpg"]] as const) {
    const picks = assigned.get(items[i].id);
    if (!picks) continue; // a typographic day has no picture to be wrong about
    assert.equal(picks[0].name, name, `day ${items[i].day}: ${items[i].hook}`);
  }
});

test("the month spreads across the library instead of leaning on one picture", async () => {
  const p = await plan();
  const pool = [
    photo("Nasi-lemak.jpg", "2026-02-01T00:00:00.000Z"),
    photo("Roti-canai.jpg", "2026-02-02T00:00:00.000Z"),
    photo("Mee-goreng-mamak.jpg", "2026-02-03T00:00:00.000Z"),
    photo("Sambal-ikan-bilis.jpg", "2026-02-04T00:00:00.000Z"),
    photo("Ayam-goreng-berempah.jpg", "2026-02-05T00:00:00.000Z"),
  ];
  // The acceptance pack led on the nasi lemak nine times and the sambal twice
  // out of this same library of five: a cursor visits the pool in turn, but
  // every claimed day and every guarded turn pulls it out of step, and the
  // drift all runs one way.
  const assigned = assignPhotos(p.items, pool, DEMO_RESTAURANT.bestSellers);
  const leads = new Map(pool.map((ref) => [ref.name, 0]));
  for (const refs of assigned.values()) {
    if (refs.length > 0) leads.set(refs[0].name, (leads.get(refs[0].name) ?? 0) + 1);
  }
  const counts = [...leads.values()];
  assert.ok(
    Math.max(...counts) - Math.min(...counts) <= 2,
    `the month leans on one photograph: ${[...leads].map(([n, c]) => `${n} ${c}`).join(", ")}`,
  );
});

test("the hook outranks a dish mentioned in passing further down", async () => {
  const p = await plan();
  const pool = [
    photo("Nasi-lemak.jpg", "2026-02-01T00:00:00.000Z"),
    photo("Sambal-ikan-bilis.jpg", "2026-02-02T00:00:00.000Z"),
  ];
  // Day 10 of the M6.5 acceptance pack. The hook is about the sambal; "nasi
  // lemak" turns up in the same paragraph as the reason the sambal matters,
  // and the poster came back with a photograph of the nasi lemak.
  const items = p.items.map((item, i) =>
    i === 9
      ? {
          ...item,
          hook: "Sambal ikan bilis ni tak dibuat main.",
          caption: "Kalau nasi lemak kami rasa lain sikit, salah satu sebabnya sambal ikan bilis yang dimasak tiap pagi.\n\nDatang pagi.",
        }
      : item,
  );
  const picks = assignPhotos(items, pool, DEMO_RESTAURANT.bestSellers).get(items[9].id);
  if (picks) assert.equal(picks[0].name, "Sambal-ikan-bilis.jpg");
});

test("a photograph the owner never named leaves the rotation exactly as it was", async () => {
  const p = await plan();
  // The ordinary library: a camera roll, not a labelled archive.
  const pool = [
    photo("IMG_4821.jpg", "2026-02-01T00:00:00.000Z"),
    photo("IMG_4822.jpg", "2026-02-02T00:00:00.000Z"),
    photo("IMG_4823.jpg", "2026-02-03T00:00:00.000Z"),
  ];
  const items = p.items.map((item) => ({ ...item, hook: "Mee Goreng panas hari ni." }));

  assert.deepEqual(
    [...assignPhotos(items, pool, DEMO_RESTAURANT.bestSellers)].map(([id, refs]) => [
      id,
      refs.map((r) => r.name),
    ]),
    [...assignPhotos(items, pool)].map(([id, refs]) => [id, refs.map((r) => r.name)]),
  );
});

test("two photographs of one dish take turns rather than one being used all month", async () => {
  const p = await plan();
  const pool = [
    photo("mee-goreng-satu.jpg", "2026-02-01T00:00:00.000Z"),
    photo("mee-goreng-dua.jpg", "2026-02-02T00:00:00.000Z"),
  ];
  const items = p.items.map((item) => ({ ...item, hook: "Mee Goreng panas hari ni." }));
  const assigned = assignPhotos(items, pool, DEMO_RESTAURANT.bestSellers);

  const first = new Set([...assigned.values()].map((refs) => refs[0].name));
  assert.deepEqual([...first].sort(), ["mee-goreng-dua.jpg", "mee-goreng-satu.jpg"]);
});

test("a dish the owner has no photograph of falls through to the rotation", async () => {
  const p = await plan();
  const pool = [
    photo("teh-ais.jpg", "2026-02-01T00:00:00.000Z"),
    photo("nasi-ayam-penyet.jpg", "2026-02-02T00:00:00.000Z"),
  ];
  const items = p.items.map((item) => ({ ...item, hook: "Mee Goreng panas hari ni." }));
  const assigned = assignPhotos(items, pool, DEMO_RESTAURANT.bestSellers);

  assert.ok(assigned.size >= 20, "no dish photo is not a reason to go without one");
  const used = new Set([...assigned.values()].flat().map((ref) => ref.name));
  assert.deepEqual([...used].sort(), ["nasi-ayam-penyet.jpg", "teh-ais.jpg"]);
});

test("a collage of several slots does not print the same photograph twice", async () => {
  const p = await plan();
  const pool = [
    photo("a.jpg", "2026-02-01T00:00:00.000Z"),
    photo("b.jpg", "2026-02-02T00:00:00.000Z"),
    photo("c.jpg", "2026-02-03T00:00:00.000Z"),
    photo("d.jpg", "2026-02-04T00:00:00.000Z"),
  ];
  const assigned = assignPhotos(p.items, pool, DEMO_RESTAURANT.bestSellers);

  for (const [id, refs] of assigned) {
    if (refs.length < 2) continue;
    assert.equal(new Set(refs.map((r) => r.path)).size, refs.length, id);
  }
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
  const assigned = assignPhotos(p.items, [only]);

  // Composed before the owner had any pictures: a typographic poster with no
  // slot at all, which is a day to rebuild rather than a day to patch.
  const empty = composePackDay(DEMO_RESTAURANT, p.id, p.items[0], new Map());
  const filled = composePackDay(DEMO_RESTAURANT, p.id, p.items[1], assigned);
  const ownEdit: Creative = {
    ...composePackDay(DEMO_RESTAURANT, p.id, p.items[2], new Map()),
    edited: true,
  };

  const wanted = daysNeedingPhotos([empty, filled, ownEdit], assigned);
  assert.deepEqual(wanted.map((c) => c.itemId), [empty.itemId]);
});

test("a day nobody dealt a photograph to is not reported as missing one", async () => {
  const p = await plan();
  const assigned = assignPhotos(p.items, [photo("satu.jpg", "2026-02-01T00:00:00.000Z")]);
  // A typographic day: its layout has no picture in it by design, so it is not
  // a poster with something missing.
  const typographic = p.items.find((item) => !assigned.has(item.id));
  assert.ok(typographic, "some days are typographic by design");

  const creative = composePackDay(DEMO_RESTAURANT, p.id, typographic, assigned);

  assert.deepEqual(daysNeedingPhotos([creative], assigned), []);
});

/* --- designs that stopped matching their words ------------------------------ */

/**
 * The regression these guard.
 *
 * A pack composes all thirty posters the moment the words are written. Press
 * "Jana semula" on day seven afterwards and the copy is replaced while the
 * poster is not — so the owner reads a new caption above a headline from the
 * version before it, on the one screen where the two are meant to be the same
 * post. The design has to follow the words, without touching a design the
 * owner has made their own.
 */

test("a rewritten day leaves its poster behind, and the poster knows it", async () => {
  const p = await plan();
  const before = composePackDay(DEMO_RESTAURANT, p.id, p.items[6], new Map());

  assert.equal(isStale(before, p.items[6]), false, "nothing has changed yet");

  const rewritten: ContentItem = {
    ...p.items[6],
    hook: "Kari kepala ikan hari Jumaat",
    caption: "Kuah kari kepala ikan kami direbus dari pagi.",
  };
  assert.equal(isStale(before, rewritten), true);
  assert.deepEqual(
    staleCreatives([rewritten], [before]).map((c) => c.day),
    [before.day],
  );
});

test("editing only the caption still counts, because the label reads it", async () => {
  const p = await plan();
  const before = composePackDay(DEMO_RESTAURANT, p.id, p.items[2], new Map());
  const edited: ContentItem = { ...p.items[2], caption: "Tulisan baru." };

  assert.equal(isStale(before, edited), true);
});

test("a design the owner has edited is never called stale", async () => {
  const p = await plan();
  const mine: Creative = {
    ...composePackDay(DEMO_RESTAURANT, p.id, p.items[3], new Map()),
    edited: true,
  };
  const rewritten: ContentItem = { ...p.items[3], hook: "Sesuatu yang lain" };

  assert.equal(isStale(mine, rewritten), false);
  assert.deepEqual(staleCreatives([rewritten], [mine]), []);
});

test("a design saved before this existed is left exactly alone", async () => {
  const p = await plan();
  const old: Creative = {
    ...composePackDay(DEMO_RESTAURANT, p.id, p.items[4], new Map()),
    source: "",
  };
  const rewritten: ContentItem = { ...p.items[4], hook: "Sesuatu yang lain" };

  assert.equal(isStale(old, rewritten), false);
});

test("rebuilding a day puts the new words on the poster", async () => {
  const p = await plan();
  const pool = [photo("a.jpg", "2026-02-01T00:00:00.000Z")];
  const photos = assignPhotos(p.items, pool);
  // A day that was dealt a photograph, so the rebuild has a picture to keep.
  const item = p.items.find((i) => (photos.get(i.id) ?? []).length > 0);
  assert.ok(item, "some day is built around a photograph");
  const before = composePackDay(DEMO_RESTAURANT, p.id, item, photos);

  const rewritten: ContentItem = { ...item, hook: "Nasi lemak sambal hitam" };
  const after = recomposeDay(DEMO_RESTAURANT, rewritten, before);

  const headline = after.elements.filter(isText).map((el) => el.text);
  assert.ok(
    headline.includes("Nasi lemak sambal hitam"),
    `the new hook is not on the poster: ${headline.join(" | ")}`,
  );
  assert.equal(isStale(after, rewritten), false, "the rebuild is current");
});

test("rebuilding a day keeps its photograph and the owner's filename", async () => {
  const p = await plan();
  const pool = [photo("a.jpg", "2026-02-01T00:00:00.000Z")];
  const photos = assignPhotos(p.items, pool);
  const item = p.items.find((i) => (photos.get(i.id) ?? []).length > 0);
  assert.ok(item, "some day is built around a photograph");
  const before: Creative = {
    ...composePackDay(DEMO_RESTAURANT, p.id, item, photos),
    name: "Poster raya saya",
    createdAt: "2026-03-01T00:00:00.000Z",
  };
  assert.ok(creativePhotos(before).length > 0, "the day started with a picture");

  const after = recomposeDay(
    DEMO_RESTAURANT,
    { ...item, hook: "Hook yang baru" },
    before,
  );

  assert.deepEqual(creativePhotos(after), creativePhotos(before));
  assert.equal(after.name, "Poster raya saya");
  assert.equal(after.createdAt, "2026-03-01T00:00:00.000Z");
  assert.equal(after.edited, false);
});

test("rebuilding is idempotent: the second pass finds nothing to do", async () => {
  const p = await plan();
  const before = composePackDay(DEMO_RESTAURANT, p.id, p.items[8], new Map());
  const rewritten: ContentItem = { ...p.items[8], hook: "Hook yang baru" };

  const once = recomposeDay(DEMO_RESTAURANT, rewritten, before, "2026-03-02T00:00:00.000Z");
  assert.deepEqual(staleCreatives([rewritten], [once]), []);
  const twice = recomposeDay(DEMO_RESTAURANT, rewritten, once, "2026-03-02T00:00:00.000Z");
  assert.deepEqual(once, twice);
});

test("rewriting one day marks one day, not the month", async () => {
  const p = await plan();
  const { db } = await generateAll();
  const rewritten: ContentItem = { ...p.items[6], hook: "Hook yang baru" };
  const items = p.items.map((item) => (item.day === rewritten.day ? rewritten : item));

  const stale = staleCreatives(items, [...db.docs.values()]);
  assert.deepEqual(stale.map((c) => c.day), [rewritten.day]);
});

test("the digest ignores what never reaches the design", async () => {
  const p = await plan();
  // Hashtags are copied from the caption block; they are not composed onto a
  // poster, so adding one must not rebuild thirty designs.
  const same: ContentItem = { ...p.items[0], hashtags: ["nasilemak", "kltuck"] };
  assert.equal(contentFingerprint(same), contentFingerprint(p.items[0]));
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
      [
        item.hook,
        item.cta,
        item.occasion?.name ?? "",
        DEMO_RESTAURANT.name,
        DEMO_RESTAURANT.location,
        ...DEMO_RESTAURANT.bestSellers,
      ].join(" "),
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

test("the two days that share a family are not the same poster twice", async () => {
  const p = await plan();
  const pool = [
    photo("a.jpg", "2026-02-01T00:00:00.000Z"),
    photo("b.jpg", "2026-02-02T00:00:00.000Z"),
  ];
  const photos = assignPhotos(p.items, pool);
  const byFamily = new Map<string, string[]>();

  for (const item of p.items) {
    const creative = composePackDay(DEMO_RESTAURANT, p.id, item, photos);
    const shape = JSON.stringify(creative.elements.map((el) => el.box));
    const seen = byFamily.get(creative.template) ?? [];
    seen.push(shape);
    byFamily.set(creative.template, seen);
  }

  // Each family composes two arrangements. Both are supposed to be rendered in
  // a month; a treatment whose period divides the family wheel's would show one
  // of them twice and the other never.
  for (const [family, shapes] of byFamily) {
    if (shapes.length < 2) continue;
    assert.ok(
      new Set(shapes).size > 1,
      `${family} lays out identically on all ${shapes.length} of its days`,
    );
  }
});

test("every day a picture was dealt to has somewhere to put it", async () => {
  const p = await plan();
  const pool = [photo("a.jpg", "2026-02-01T00:00:00.000Z")];
  const photos = assignPhotos(p.items, pool);
  const restaurant = { ...DEMO_RESTAURANT, photos: pool };

  for (const item of p.items) {
    const creative = composePackDay(restaurant, p.id, item, photos);
    const slots = creative.elements.filter(isImage);
    assert.equal(
      slots.length,
      (photos.get(item.id) ?? []).length,
      `day ${item.day} (${creative.template}) has ${slots.length} slots`,
    );
    for (const slot of slots) {
      assert.ok(slot.source, `day ${item.day} shows an empty slot`);
    }
  }
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
