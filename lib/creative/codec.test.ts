import assert from "node:assert/strict";
import test from "node:test";

import { DEMO_RESTAURANT } from "../content/demo.ts";
import { MockContentGenerator } from "../content/mock-generator.ts";
import type { AssetRef } from "../content/types.ts";
import { composeCreative } from "./compose.ts";
import { decodeCreative, editText, encodeCreative, setImage } from "./codec.ts";
import { isImage, isText, textOfRole, type Creative } from "./types.ts";

const generator = new MockContentGenerator();
const UID = "uid-abc123";

const PHOTO: AssetRef = {
  path: "restaurants/uid-abc123/creatives/ayam.jpg",
  url: "https://firebasestorage.googleapis.com/v0/b/bucket/o/ayam?alt=media&token=t",
  name: "ayam.jpg",
  contentType: "image/jpeg",
  size: 2048,
  uploadedAt: "2026-03-01T00:00:00.000Z",
};

async function sample(image: AssetRef | null = null): Promise<Creative> {
  const { id, items } = await generator.generatePlan({
    restaurant: { ...DEMO_RESTAURANT, brandColours: "#0F7A5A" },
    startDate: "2026-03-01",
  });
  return composeCreative(DEMO_RESTAURANT, id, items[2], {
    image,
    now: "2026-03-01T00:00:00.000Z",
  });
}

/* --- persistence ---------------------------------------------------------- */

test("a saved creative comes back as the same design", async () => {
  const creative = await sample();
  const doc = encodeCreative(creative, UID, "2026-03-02T00:00:00.000Z");
  const back = decodeCreative(doc, creative.itemId);

  assert.ok(back);
  assert.equal(back.name, creative.name);
  assert.equal(back.template, creative.template);
  assert.equal(back.format, creative.format);
  assert.deepEqual(back.canvas, creative.canvas);
  assert.deepEqual(back.palette, creative.palette);
  assert.deepEqual(back.elements, creative.elements);
  // The digest has to survive the trip or every reload reads the poster as
  // composed from words it cannot identify, and rebuilds it.
  assert.equal(back.source, creative.source);
  assert.ok(creative.source, "a composed design records what it was made from");
});

test("a design stored before the digest existed comes back without one", async () => {
  const creative = await sample();
  const doc = encodeCreative(creative, UID) as unknown as Record<string, unknown>;
  delete doc.source;

  const back = decodeCreative(doc, creative.itemId);
  assert.ok(back);
  assert.equal(back.source, "");
});

/**
 * A reload and a fresh sign-in are the same operation to this code: read the
 * document back and decode it. If the round trip holds, both do.
 */
test("the text stays text after a round trip, not a flattened picture", async () => {
  const creative = await sample();
  const edited = editText(creative, "headline", "Nasi Ayam Penyet hari ini");
  const back = decodeCreative(encodeCreative(edited, UID), creative.itemId);

  assert.ok(back);
  const headline = textOfRole(back, "headline");
  assert.equal(headline?.text, "Nasi Ayam Penyet hari ini");
  assert.equal(back.edited, true);
});

test("the document is stamped with the owner it belongs to", async () => {
  const creative = await sample();
  const doc = encodeCreative(creative, UID);

  assert.equal(doc.ownerId, UID);
  assert.equal(doc.itemId, creative.itemId);
  assert.equal(doc.creativeId, creative.id);
});

test("createdAt survives a re-save, updatedAt does not", async () => {
  const creative = await sample();
  const first = encodeCreative(creative, UID, "2026-03-02T00:00:00.000Z");
  const second = encodeCreative(
    decodeCreative(first, creative.itemId)!,
    UID,
    "2026-04-02T00:00:00.000Z",
  );

  assert.equal(second.createdAt, creative.createdAt);
  assert.equal(second.updatedAt, "2026-04-02T00:00:00.000Z");
});

test("nothing is written as undefined, which Firestore would reject", async () => {
  const creative = await sample();
  const doc = encodeCreative(creative, UID);

  const seen: string[] = [];
  JSON.stringify(doc, (key, value) => {
    if (value === undefined) seen.push(key);
    return value;
  });
  assert.deepEqual(seen, []);
});

/* --- schema validation ---------------------------------------------------- */

test("a document that is not a creative decodes to nothing", () => {
  assert.equal(decodeCreative(null, "d1"), null);
  assert.equal(decodeCreative("nope", "d1"), null);
  assert.equal(decodeCreative({}, "d1"), null);
  assert.equal(decodeCreative({ elements: [] }, "d1"), null);
});

test("one unreadable element rejects the whole design", async () => {
  const creative = await sample();
  const doc = encodeCreative(creative, UID) as unknown as Record<string, unknown>;
  const elements = [...(doc.elements as unknown[])];
  elements[1] = { kind: "wat", id: "x" };

  assert.equal(decodeCreative({ ...doc, elements }, creative.itemId), null);
});

test("out-of-range numbers are clamped rather than trusted", () => {
  const decoded = decodeCreative(
    {
      elements: [
        {
          kind: "text",
          id: "headline",
          order: 1,
          box: { x: 9, y: -9, width: 40, height: 0.2 },
          role: "headline",
          text: "Hai",
          style: { family: "display", weight: 4000, size: 12, lineHeight: 90, letterSpacing: 9 },
          colour: "not-a-colour",
          align: "sideways",
          valign: "middle",
        },
      ],
      format: "square",
    },
    "d1",
  );

  assert.ok(decoded);
  const el = decoded.elements[0];
  assert.ok(isText(el));
  assert.ok(el.box.x <= 2 && el.box.y >= -1);
  assert.equal(el.style.weight, 900);
  assert.ok(el.style.size <= 0.4);
  assert.equal(el.colour, "ink");
  assert.equal(el.align, "left");
});

test("a missing canvas falls back to the format's real dimensions", () => {
  const decoded = decodeCreative(
    {
      format: "portrait",
      elements: [{ kind: "shape", id: "rule", order: 0, box: {}, fill: "accent" }],
    },
    "d1",
  );

  assert.ok(decoded);
  assert.deepEqual(decoded.canvas, { width: 1080, height: 1350 });
});

/* --- editing -------------------------------------------------------------- */

test("a photo can be dropped in and taken out again", async () => {
  // Composed *with* a picture, because the layout a day gets depends on
  // whether there is one: the typographic families have no slot to drop a
  // photograph into, which is the point of them.
  const creative = await sample(PHOTO);
  const slot = creative.elements.find(isImage);
  assert.ok(slot);
  assert.equal(slot.source?.path, PHOTO.path);

  // Clearing gives the empty slot back, not the picture being removed.
  const cleared = setImage(creative, slot.id, null);
  assert.equal(cleared.elements.find(isImage)?.source, null);
  assert.equal(cleared.edited, true);

  const refilled = setImage(cleared, slot.id, PHOTO);
  assert.equal(refilled.elements.find(isImage)?.source?.path, PHOTO.path);
});

test("editing one element leaves every other one untouched", async () => {
  const creative = await sample();
  const next = editText(creative, "cta", "Datang sebelum pukul 3");

  assert.equal(next.elements.length, creative.elements.length);
  for (const el of next.elements) {
    if (el.id === "cta") continue;
    assert.deepEqual(el, creative.elements.find((o) => o.id === el.id));
  }
});

test("an edit aimed at an element that is not there changes nothing", async () => {
  const creative = await sample();

  assert.equal(editText(creative, "nope", "x"), creative);
  assert.equal(setImage(creative, "cta", PHOTO), creative);
});
