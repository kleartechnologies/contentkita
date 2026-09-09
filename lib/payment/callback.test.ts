import assert from "node:assert/strict";
import test from "node:test";

import { decodeCallback, formParams } from "./callback.ts";
import { signPayload, verifySignature } from "./signature.ts";

/**
 * The bytes-to-record step, and the one thing that must survive it: the raw
 * parameters, unmodified, so the signature is checked against what was sent.
 */

const KEY = "test-x-signature-key";

const form = (fields: Record<string, string>) =>
  new URLSearchParams(fields).toString();

const FIELDS = {
  id: "8X0Iytgi",
  collection_id: "inbmmepb",
  paid: "true",
  state: "paid",
  amount: "3990",
  paid_amount: "3990",
  email: "owner@example.com",
  mobile: "",
  name: "OWNER",
  paid_at: "2026-09-10 04:22:11 +0800",
  transaction_id: "6TSHTBSA",
  transaction_status: "completed",
};

/* --- parsing -------------------------------------------------------------- */

test("a paid callback decodes to the fields fulfilment needs", () => {
  const callback = decodeCallback(form(FIELDS));
  assert.equal(callback.billId, "8X0Iytgi");
  assert.equal(callback.collectionId, "inbmmepb");
  assert.equal(callback.paid, true);
  assert.equal(callback.state, "paid");
  assert.equal(callback.amountSen, 3990);
  assert.equal(callback.paidAmountSen, 3990);
  assert.equal(callback.transactionId, "6TSHTBSA");
});

test("amounts stay integer sen and never become floats", () => {
  const callback = decodeCallback(form({ ...FIELDS, amount: "3990" }));
  assert.equal(callback.amountSen, 3990);
  assert.ok(Number.isInteger(callback.amountSen));
});

test("a ringgit-shaped amount is refused, not rounded into something plausible", () => {
  // "39.90" must not parse to 39: that is RM0.39, and it would pass an
  // "amount is a number" check while failing to be the price.
  assert.equal(decodeCallback(form({ ...FIELDS, amount: "39.90" })).amountSen, null);
  assert.equal(decodeCallback(form({ ...FIELDS, amount: "" })).amountSen, null);
  assert.equal(decodeCallback(form({ ...FIELDS, amount: "abc" })).amountSen, null);
});

test("only the literal string true means paid", () => {
  for (const paid of ["false", "1", "TRUE", "yes", ""]) {
    assert.equal(decodeCallback(form({ ...FIELDS, paid })).paid, false, paid);
  }
});

test("an empty body decodes rather than throwing", () => {
  const callback = decodeCallback("");
  assert.equal(callback.billId, "");
  assert.equal(callback.paid, false);
  assert.equal(callback.amountSen, null);
  assert.equal(callback.signature, null);
});

test("the redirect's bracketed keys are unwrapped", () => {
  const params = formParams("billplz%5Bid%5D=8X0Iytgi&billplz%5Bpaid%5D=true");
  assert.deepEqual(params, { id: "8X0Iytgi", paid: "true" });
});

/* --- what the signature is checked against -------------------------------- */

test("the raw parameters are preserved so the signature still verifies", () => {
  const x_signature = signPayload(FIELDS, KEY);
  const callback = decodeCallback(form({ ...FIELDS, x_signature }));

  assert.equal(callback.signature, x_signature);
  assert.equal(verifySignature(callback.params, callback.signature, KEY), true);
});

test("an unrecognised extra field is kept, not dropped", () => {
  // Billplz signs everything it sends. Silently discarding a field we did not
  // expect would make every callback fail verification the day they add one.
  const extra = { ...FIELDS, some_new_field: "x" };
  const x_signature = signPayload(extra, KEY);
  const callback = decodeCallback(form({ ...extra, x_signature }));

  assert.equal(callback.params.some_new_field, "x");
  assert.equal(verifySignature(callback.params, callback.signature, KEY), true);
});

test("url-encoded values round-trip before verification", () => {
  const spaced = { ...FIELDS, name: "NASI LEMAK & KOPI" };
  const x_signature = signPayload(spaced, KEY);
  const callback = decodeCallback(form({ ...spaced, x_signature }));

  assert.equal(callback.params.name, "NASI LEMAK & KOPI");
  assert.equal(verifySignature(callback.params, callback.signature, KEY), true);
});
