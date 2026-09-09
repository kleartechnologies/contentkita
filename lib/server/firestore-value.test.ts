import assert from "node:assert/strict";
import test from "node:test";

import {
  documentId,
  fromFields,
  fromValue,
  toFields,
  toValue,
} from "./firestore-value.ts";

/**
 * The translation the payment callback's writes pass through.
 *
 * Worth testing properly for one reason above the others: the price goes
 * through here. If an amount ever left as a `doubleValue`, or came back as the
 * string "3990", the callback's `paid !== PACK_PRICE_SEN` check would start
 * refusing perfectly good payments — or, far worse, stop refusing bad ones.
 */

/* --- scalars -------------------------------------------------------------- */

test("integers travel as integerValue, and as strings", () => {
  assert.deepEqual(toValue(3990), { integerValue: "3990" });
  assert.equal(typeof (toValue(3990) as { integerValue: string }).integerValue, "string");
});

test("the price survives a round trip as an integer", () => {
  assert.equal(fromValue(toValue(3990)), 3990);
  assert.ok(Number.isInteger(fromValue(toValue(3990))));
});

test("strings, booleans and null map to their own tags", () => {
  assert.deepEqual(toValue("paid"), { stringValue: "paid" });
  assert.deepEqual(toValue(true), { booleanValue: true });
  assert.deepEqual(toValue(null), { nullValue: null });
});

test("undefined becomes null rather than vanishing", () => {
  // Firestore has no undefined. Dropping the key instead would turn "not set"
  // into "field absent", which reads differently on the way back.
  assert.deepEqual(toValue(undefined), { nullValue: null });
  assert.deepEqual(toFields({ paidAt: undefined }), { paidAt: { nullValue: null } });
});

test("a non-integer number is a double, not a rounded integer", () => {
  assert.deepEqual(toValue(1.5), { doubleValue: 1.5 });
});

test("NaN and Infinity are refused rather than stored", () => {
  assert.deepEqual(toValue(NaN), { nullValue: null });
  assert.deepEqual(toValue(Infinity), { nullValue: null });
});

/* --- structures ----------------------------------------------------------- */

test("arrays keep their order and element types", () => {
  const encoded = toValue(["a", 2, true]);
  assert.deepEqual(fromValue(encoded), ["a", 2, true]);
});

test("an empty array encodes without a values key", () => {
  // Firestore's own representation; sending `values: []` is also accepted but
  // this matches what it hands back, which keeps comparisons honest.
  assert.deepEqual(toValue([]), { arrayValue: {} });
  assert.deepEqual(fromValue(toValue([])), []);
});

test("nested objects round-trip", () => {
  const item = {
    id: "d1",
    day: 1,
    hashtags: ["#nasi", "#lemak"],
    logo: { path: "logos/a.png", size: 1024 },
    videoIdea: null,
  };
  assert.deepEqual(fromFields(toFields(item)), item);
});

test("a thirty-day plan survives the round trip unchanged", () => {
  const items = Array.from({ length: 30 }, (_, i) => ({
    id: `plan-d${i + 1}`,
    day: i + 1,
    caption: `Hari ${i + 1} — ayat penuh dengan "petikan" & simbol.`,
    hashtags: ["#kopi"],
    edited: false,
  }));
  assert.deepEqual(fromFields(toFields({ items })), { items });
});

/* --- reading what comes back ---------------------------------------------- */

test("an unknown or missing value reads as null, not as a throw", () => {
  assert.equal(fromValue(undefined), null);
  assert.equal(fromValue({ geoPointValue: {} } as never), null);
});

test("an integer too large to be exact still reads as a number", () => {
  assert.equal(typeof fromValue({ integerValue: "9007199254740993" }), "number");
});

test("the document id is the last segment of the resource name", () => {
  assert.equal(
    documentId("projects/p/databases/(default)/documents/contentPacks/uid/packs/pak_abc"),
    "pak_abc",
  );
  assert.equal(documentId(undefined), "");
});
